//! Keeping secrets out of the recorded command line.
//!
//! `runtime/command-history.jsonl` stores the line the user typed, verbatim,
//! as reported by the shell integration (OSC 133 `;C;cmd=<base64>`). That one
//! string then feeds three surfaces at once — the file on disk, the history
//! view (Ctrl+Shift+H / Ctrl+R) and the ranking behind the inline
//! suggestions — because all three read the same file. A single
//! `export AWS_SECRET_ACCESS_KEY=…` therefore lands in all three and stays
//! there.
//!
//! This module is the filter that runs on the way *in*, in
//! [`CommandHistory::append`](super::history::CommandHistory::append), before
//! anything is serialised: a secret that touches the disk once is on the disk.
//!
//! # What it is not
//!
//! It is not a scanner. Redacting too much is worse than redacting too little
//! here: a history where `git commit -m "fix auth"` or `export PATH=…` comes
//! back as bullets is a history nobody keeps switched on, and the setting that
//! turns this off takes the real protection with it. So the rules below aim at
//! the *obvious* secret — a suspicious name, a known flag, a value whose very
//! shape is a credential — and deliberately stop short of guessing. The test
//! module carries both halves of that bargain: what must be masked, and what
//! must be left exactly as typed.
//!
//! # The three ways a value is caught
//!
//! 1. **By the name it is given.** `NAME=value`, `set -x NAME value`,
//!    `$env:NAME = value`, `--flag=value`, `--flag value`: when the *name*
//!    contains `token`, `secret`, `password`, `api key`, `credential`, `auth`,
//!    `private key`…, the value is masked whatever it looks like.
//! 2. **By the position it sits in.** `Authorization: Bearer …` in a header
//!    argument, `-u user:password`, `https://user:password@host`, `?api_key=…`
//!    in a URL, `mysql -p<password>`.
//! 3. **By its own shape.** An AWS key id, a GitHub token, an
//!    OpenAI/Anthropic key, a Slack token, a Google API key, a JWT, a PEM
//!    private key — these are recognisable on their own and are masked
//!    wherever they appear on the line.
//!
//! A value that is a *reference* rather than a secret is never masked:
//! `export TOKEN=$OTHER`, `export TOKEN=$(op read …)`, `%USERPROFILE%`. The
//! text holds nothing to leak, and masking it would hide the useful half.

use regex::Regex;
use std::borrow::Cow;
use std::sync::OnceLock;

/// What a masked value is replaced with.
///
/// Six bullets rather than `<redacted>` for two reasons. It reads as "hidden"
/// on sight in the history view, with no legend to learn — the place this is
/// looked at most. And it is *inert*: these lines come back as inline
/// suggestions and ghost text, so one can be accepted and run, and a bullet
/// run is a harmless literal word, where `<redacted>` would be a shell
/// redirection (`<`) and `****` a glob the shell would expand against the
/// current directory. Nothing types a bullet by hand either, so it never
/// collides with real command text, and `•` is a one-character grep for
/// auditing what was masked.
pub const REDACTED: &str = "\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}";

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// The command line with every secret value replaced by [`REDACTED`].
///
/// Returns [`Cow::Borrowed`] when there was nothing to mask, which is the
/// overwhelmingly common case — the caller then writes the record it already
/// had, with no allocation.
pub fn redact(line: &str) -> Cow<'_, str> {
    if line.is_empty() {
        return Cow::Borrowed(line);
    }
    let mut spans: Vec<(usize, usize)> = Vec::new();
    collect_named_spans(line, &mut spans);
    collect_shape_spans(line, &mut spans);
    if spans.is_empty() {
        return Cow::Borrowed(line);
    }
    match splice(line, spans) {
        Some(out) => Cow::Owned(out),
        None => Cow::Borrowed(line),
    }
}

/// True when `line` holds something [`redact`] would mask. Used by the tests
/// and by anything that wants the question without the rewrite; the hot path
/// calls [`redact`] and looks at the `Cow`.
pub fn has_secret(line: &str) -> bool {
    matches!(redact(line), Cow::Owned(_))
}

// ---------------------------------------------------------------------------
// Names that make a value suspicious
// ---------------------------------------------------------------------------

/// Substrings that, in a *name*, make the value next to it a secret.
///
/// Matched against the name with everything but letters and digits removed and
/// lowercased, so `--api-key`, `API_KEY` and `ApiKey` are one case.
const SECRET_WORDS: &[&str] = &[
    "token",
    "secret",
    "password",
    "passwd",
    "passphrase",
    "apikey",
    "credential",
    "privatekey",
    "accesskey",
    "auth",
    "bearer",
];

/// Endings that turn a name which *contains* a secret word back into something
/// harmless — it designates where the secret lives, or what kind it is, not the
/// secret itself.
///
/// `--token-file ~/.gh`, `VAULT_SECRET_PATH=secret/data/app`,
/// `--auth-type basic`, `--secret-name prod-db` and, the one that really
/// matters, `docker login --password-stdin`: masking the word after that last
/// one would eat the registry host and leave a line that cannot be read back
/// at all.
const HARMLESS_ENDINGS: &[&str] = &[
    "file",
    "path",
    "dir",
    "directory",
    "url",
    "uri",
    "host",
    "type",
    "kind",
    "mode",
    "method",
    "provider",
    "user",
    "username",
    "name",
    "id",
    "header",
    "scheme",
    "stdin",
    "enabled",
    "expiry",
    "expires",
    "ttl",
    "length",
    "format",
    "region",
    "profile",
    "prompt",
];

/// Name → is the value beside it a secret?
///
/// `author` is the reason this is not one `contains` call: it holds `auth`, and
/// `git commit --author "…"` / `export AUTHOR=…` must survive untouched.
/// `authoriz…` (the header, the URL parameter) is exempted from that
/// exemption.
fn is_secret_name(name: &str) -> bool {
    let n = normalise_name(name);
    if n.is_empty() {
        return false;
    }
    if n.starts_with("author") && !n.starts_with("authoriz") {
        return false;
    }
    if !SECRET_WORDS.iter().any(|w| n.contains(w)) {
        return false;
    }
    !HARMLESS_ENDINGS.iter().any(|s| n.ends_with(s))
}

fn normalise_name(name: &str) -> String {
    name.chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// A value that carries no secret *in the text*: a variable reference, a
/// command substitution, or nothing at all. `export TOKEN=$OTHER` and
/// `echo $AWS_SECRET_ACCESS_KEY` expose exactly nothing, and masking them would
/// throw away the only informative half of the line.
fn is_reference(value: &str) -> bool {
    let v = value.trim();
    if v.is_empty() || v == "-" {
        return true;
    }
    let first = v.as_bytes()[0];
    if first == b'$' || first == b'`' {
        return true;
    }
    // `%USERPROFILE%` and friends (cmd.exe).
    v.len() > 2 && first == b'%' && v.ends_with('%')
}

// ---------------------------------------------------------------------------
// Tokenising
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
struct Tok {
    start: usize,
    end: usize,
}

/// The raw text of one token, quotes and all.
fn raw(line: &str, t: Tok) -> &str {
    &line[t.start..t.end]
}

/// Split the line into whitespace-separated tokens, keeping quoted runs whole.
///
/// Not a shell parser — it never expands anything and does not care what the
/// tokens mean. It only has to agree with a human reading the line about where
/// one argument stops and the next starts. Indices come from `char_indices`, so
/// every span is a valid slice boundary whatever the line holds.
fn tokenize(line: &str) -> Vec<Tok> {
    let chars: Vec<(usize, char)> = line.char_indices().collect();
    let at = |k: usize| chars.get(k).map(|(i, _)| *i).unwrap_or(line.len());
    let mut out = Vec::new();
    let mut k = 0usize;
    while k < chars.len() {
        while k < chars.len() && chars[k].1.is_whitespace() {
            k += 1;
        }
        if k >= chars.len() {
            break;
        }
        let start = at(k);
        let mut quote: Option<char> = None;
        while k < chars.len() {
            let c = chars[k].1;
            match quote {
                Some(q) => {
                    if c == '\\' && q == '"' {
                        k += 2;
                        continue;
                    }
                    if c == q {
                        quote = None;
                    }
                    k += 1;
                }
                None => {
                    if c == '\\' {
                        k += 2;
                        continue;
                    }
                    if c == '\'' || c == '"' {
                        quote = Some(c);
                        k += 1;
                        continue;
                    }
                    if c.is_whitespace() {
                        break;
                    }
                    k += 1;
                }
            }
        }
        let end = at(k.min(chars.len()));
        if end > start {
            out.push(Tok { start, end });
        }
    }
    out
}

/// Strip one matching pair of surrounding quotes, reporting how many bytes were
/// taken off the front so spans can still be expressed in the original line.
fn unquote(raw: &str) -> (usize, &str) {
    let b = raw.as_bytes();
    if b.len() >= 2 && (b[0] == b'"' || b[0] == b'\'') && b[b.len() - 1] == b[0] {
        (1, &raw[1..raw.len() - 1])
    } else {
        (0, raw)
    }
}

/// Tokens that end one command and start the next.
fn is_separator(raw: &str) -> bool {
    matches!(raw, "|" | "||" | "&&" | "&" | ";" | ";;" | "|&")
}

/// Wrappers that stand in front of the real command.
const WRAPPERS: &[&str] = &[
    "sudo", "doas", "env", "command", "builtin", "time", "nohup", "exec", "nice", "stdbuf",
    "setsid", "winpty",
];

/// `/usr/bin/mysql.exe` → `mysql`.
fn basename(raw: &str) -> String {
    let (_, inner) = unquote(raw);
    let tail = inner.rsplit(['/', '\\']).next().unwrap_or(inner);
    let tail = tail.strip_suffix(".exe").unwrap_or(tail);
    tail.to_ascii_lowercase()
}

/// One command of the line, with the program it runs.
struct Segment {
    tokens: std::ops::Range<usize>,
    /// `mysql`, `docker`, … — lowercased, without directory or `.exe`.
    cmd: String,
    /// `docker login` when there is a subcommand, else the same as `cmd`.
    scope: String,
}

fn segments(line: &str, toks: &[Tok]) -> Vec<Segment> {
    let mut out = Vec::new();
    let mut start = 0usize;
    for i in 0..=toks.len() {
        let boundary = i == toks.len() || is_separator(raw(line, toks[i]));
        if boundary {
            if i > start {
                out.push(build_segment(line, toks, start..i));
            }
            start = i + 1;
        }
    }
    out
}

fn build_segment(line: &str, toks: &[Tok], range: std::ops::Range<usize>) -> Segment {
    let mut cmd = String::new();
    let mut sub = String::new();
    for t in &toks[range.clone()] {
        let text = raw(line, *t);
        if cmd.is_empty() {
            // Environment prefixes (`FOO=bar cmd`) and wrappers stand in front
            // of the program; step over them.
            if assignment(text).is_some() || text.starts_with('-') {
                continue;
            }
            let name = basename(text);
            if WRAPPERS.contains(&name.as_str()) {
                continue;
            }
            cmd = name;
            continue;
        }
        if !text.starts_with('-') && assignment(text).is_none() {
            sub = basename(text);
            break;
        }
    }
    let scope = if sub.is_empty() {
        cmd.clone()
    } else {
        format!("{cmd} {sub}")
    };
    Segment {
        tokens: range,
        cmd,
        scope,
    }
}

// ---------------------------------------------------------------------------
// Rules 1 and 2: names, flags, positions
// ---------------------------------------------------------------------------

fn assignment_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(\$(?i:env):)?([A-Za-z_][A-Za-z0-9_.\-]*)=").expect("static"))
}

/// `NAME=` / `$env:NAME=` at the start of `raw` → (name, byte offset of the
/// value). A quoted token never matches, which is what keeps `awk 'a=b'` out.
fn assignment(raw: &str) -> Option<(&str, usize)> {
    let m = assignment_re().captures(raw)?;
    let name = m.get(2)?;
    Some((name.as_str(), m.get(0)?.end()))
}

fn header_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\s*([A-Za-z][A-Za-z0-9_\-]*)\s*:\s*(\S.*)$").expect("static"))
}

fn url_userinfo_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"[A-Za-z][A-Za-z0-9+.\-]*://[^/\s:@]+:([^/\s:@]+)@").expect("static")
    })
}

fn url_query_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new("[?&#]([A-Za-z0-9_.\\-]+)=([^&#\\s\"']+)").expect("static"))
}

/// Schemes kept in front of a masked credential, because they say how the line
/// authenticated without saying what with.
const AUTH_SCHEMES: &[&str] = &["bearer", "basic", "token", "digest", "negotiate", "apikey"];

/// `set`-like builtins whose *name* and *value* are separate words.
const ASSIGN_BUILTINS: &[&str] = &["set", "setx", "declare", "typeset", "local", "export"];

/// Commands whose `-u` / `--user` carries `user:password` in one argument.
const USERINFO_COMMANDS: &[&str] = &["curl", "wget", "http", "https", "xh", "aria2c"];

/// `(scope, flag)` where `-<flag><value>`, glued together, is a password.
///
/// Only the glued form: `mysql -p secret` does *not* pass a password (mysql
/// prompts, and `secret` would be the database name), and a blanket `-p` rule
/// would mangle `mkdir -p`, `docker run -p 8080:80` and `ssh -p 2222`.
const ATTACHED_SECRET_FLAGS: &[(&str, char)] = &[
    ("mysql", 'p'),
    ("mysqldump", 'p'),
    ("mysqladmin", 'p'),
    ("mariadb", 'p'),
    ("7z", 'p'),
    ("7za", 'p'),
    ("zip", 'p'),
    ("unzip", 'p'),
    ("rar", 'p'),
    ("unrar", 'p'),
    ("redis-cli", 'a'),
];

/// `(scope, flag)` where the *next* word is a password. Every entry is a scope
/// in which that letter has no other meaning.
const NEXT_WORD_SECRET_FLAGS: &[(&str, char)] = &[
    ("docker login", 'p'),
    ("podman login", 'p'),
    ("nerdctl login", 'p'),
    ("redis-cli", 'a'),
];

fn collect_named_spans(line: &str, spans: &mut Vec<(usize, usize)>) {
    let toks = tokenize(line);
    if toks.is_empty() {
        return;
    }

    for seg in segments(line, &toks) {
        let range = seg.tokens.clone();
        let mut i = range.start;
        while i < range.end {
            let t = toks[i];
            let text = raw(line, t);

            // --- `NAME=value`, `$env:NAME=value`, environment prefixes -----
            if let Some((name, at)) = assignment(text) {
                if is_secret_name(name) {
                    push_value(line, t.start + at, t.end, spans);
                }
                i += 1;
                continue;
            }

            // --- `set -x NAME value`, `setx NAME value` --------------------
            if i == range.start && ASSIGN_BUILTINS.contains(&basename(text).as_str()) {
                if let Some(next) = assign_builtin_spans(line, &toks, i + 1..range.end, spans) {
                    i = next;
                    continue;
                }
            }

            // --- `$env:NAME = value` (PowerShell, spaces around the `=`) ---
            if let Some(rest) = text.strip_prefix('$') {
                let name = rest
                    .strip_prefix("env:")
                    .or_else(|| rest.strip_prefix("Env:"))
                    .or_else(|| rest.strip_prefix("ENV:"));
                if let Some(name) = name {
                    if is_secret_name(name)
                        && i + 2 < range.end
                        && raw(line, toks[i + 1]) == "="
                    {
                        let v = toks[i + 2];
                        push_value(line, v.start, v.end, spans);
                        i += 3;
                        continue;
                    }
                }
            }

            // --- Flags ------------------------------------------------------
            if text.starts_with('-') && text.len() > 1 {
                i = flag_spans(line, &toks, i, &range, &seg, spans);
                continue;
            }

            // --- `Authorization: Bearer …` inside an argument ---------------
            let after_header_flag = i > range.start
                && matches!(raw(line, toks[i - 1]), "-H" | "--header" | "-b" | "--cookie");
            header_spans(line, t, after_header_flag, spans);

            // --- URLs -------------------------------------------------------
            url_spans(line, t, spans);

            i += 1;
        }
    }
}

/// `set -x GITHUB_TOKEN ghp_…`: skip the flags, test the name, mask every value
/// word that follows. Returns the index to continue from, or `None` when this
/// is not an assignment after all (`set -euo pipefail`).
fn assign_builtin_spans(
    line: &str,
    toks: &[Tok],
    range: std::ops::Range<usize>,
    spans: &mut Vec<(usize, usize)>,
) -> Option<usize> {
    let mut i = range.start;
    while i < range.end && raw(line, toks[i]).starts_with('-') {
        i += 1;
    }
    if i >= range.end {
        return None;
    }
    let name = raw(line, toks[i]);
    // `export TOKEN=x` is an assignment token; the caller's own rule owns it.
    if name.contains('=') || !is_secret_name(name) {
        return None;
    }
    for t in &toks[i + 1..range.end] {
        push_value(line, t.start, t.end, spans);
    }
    Some(range.end)
}

/// Everything that hangs off a `-x` / `--xxx` token. Returns the next index.
fn flag_spans(
    line: &str,
    toks: &[Tok],
    i: usize,
    range: &std::ops::Range<usize>,
    seg: &Segment,
    spans: &mut Vec<(usize, usize)>,
) -> usize {
    let t = toks[i];
    let text = raw(line, t);

    // `--flag=value`
    if let Some(eq) = text.find('=') {
        let (flag, value) = (&text[..eq], &text[eq + 1..]);
        if is_secret_name(flag.trim_start_matches('-')) {
            push_value(line, t.start + eq + 1, t.end, spans);
            return i + 1;
        }
        // `--from-literal=password=hunter2`: the flag is innocent, what it
        // carries is not.
        if let Some((name, at)) = assignment(value) {
            if is_secret_name(name) {
                push_value(line, t.start + eq + 1 + at, t.end, spans);
            }
        }
        return i + 1;
    }

    let bare = text.trim_start_matches('-');
    let long = text.starts_with("--");
    let next = (i + 1 < range.end).then(|| toks[i + 1]);
    let next_is_value = next.is_some_and(|n| {
        let r = raw(line, n);
        !r.starts_with('-') && !is_separator(r)
    });

    // `--password hunter2`, `--api-key …`
    if long && is_secret_name(bare) && next_is_value {
        let n = next.expect("checked just above");
        push_value(line, n.start, n.end, spans);
        return i + 2;
    }

    // `-u user:password` / `--user user:password` for the HTTP clients.
    if (text == "-u" || text == "--user")
        && USERINFO_COMMANDS.contains(&seg.cmd.as_str())
        && next_is_value
    {
        let n = next.expect("checked just above");
        let (off, inner) = unquote(raw(line, n));
        if let Some(colon) = inner.find(':') {
            let from = n.start + off + colon + 1;
            let to = n.start + off + inner.len();
            push_value(line, from, to, spans);
            return i + 2;
        }
    }

    // Short flag with a glued value: `mysql -phunter2`.
    if !long && text.chars().count() > 2 {
        let flag = text[1..].chars().next().expect("more than two characters");
        if scoped_flag(ATTACHED_SECRET_FLAGS, seg, flag) {
            push_value(line, t.start + 1 + flag.len_utf8(), t.end, spans);
            return i + 1;
        }
    }

    // Short flag whose value is the next word: `docker login -p hunter2`.
    if !long && text.chars().count() == 2 {
        let flag = text[1..].chars().next().expect("exactly two characters");
        if scoped_flag(NEXT_WORD_SECRET_FLAGS, seg, flag) && next_is_value {
            let n = next.expect("checked just above");
            push_value(line, n.start, n.end, spans);
            return i + 2;
        }
    }

    i + 1
}

fn scoped_flag(table: &[(&str, char)], seg: &Segment, flag: char) -> bool {
    table
        .iter()
        .any(|(scope, f)| *f == flag && (*scope == seg.scope || *scope == seg.cmd))
}

/// `-H "Authorization: Bearer …"`. Restricted to a quoted argument, or one that
/// follows a header flag, so an ordinary `name:value` word elsewhere on the
/// line is left alone.
fn header_spans(line: &str, t: Tok, after_header_flag: bool, spans: &mut Vec<(usize, usize)>) {
    let raw = &line[t.start..t.end];
    let (off, inner) = unquote(raw);
    if off == 0 && !after_header_flag {
        return;
    }
    let Some(m) = header_re().captures(inner) else {
        return;
    };
    let (name, value) = (m.get(1).expect("group 1"), m.get(2).expect("group 2"));
    if !is_secret_name(name.as_str()) {
        return;
    }
    // `git commit -m "auth: fix the login redirect"` is a conventional-commit
    // scope, not a header. Real headers are either announced by a header flag,
    // hyphenated (`X-Api-Key`, `Proxy-Authorization`), or `Authorization`
    // itself; a bare one-word scope is none of those.
    let looks_like_a_header = after_header_flag
        || name.as_str().contains('-')
        || name.as_str().eq_ignore_ascii_case("authorization");
    if !looks_like_a_header {
        return;
    }
    let base = t.start + off;
    // Keep `Bearer` / `Basic`: it says how, never what.
    let text = value.as_str();
    // `Authorization: Bearer` with nothing after it holds no credential at
    // all — masking the scheme word would be pure noise.
    if AUTH_SCHEMES.contains(&text.trim_end().to_ascii_lowercase().as_str()) {
        return;
    }
    if let Some(sp) = text.find(char::is_whitespace) {
        if AUTH_SCHEMES.contains(&text[..sp].to_ascii_lowercase().as_str()) {
            let rest = text[sp..].trim_start();
            if rest.is_empty() {
                return;
            }
            let at = value.start() + (text.len() - rest.len());
            push_value(line, base + at, base + value.end(), spans);
            return;
        }
    }
    push_value(line, base + value.start(), base + value.end(), spans);
}

/// `https://user:token@host` and `…?api_key=…`.
fn url_spans(line: &str, t: Tok, spans: &mut Vec<(usize, usize)>) {
    let raw = &line[t.start..t.end];
    let (off, inner) = unquote(raw);
    if !inner.contains("://") {
        return;
    }
    let base = t.start + off;
    if let Some(m) = url_userinfo_re().captures(inner) {
        let g = m.get(1).expect("group 1");
        push_value(line, base + g.start(), base + g.end(), spans);
    }
    for m in url_query_re().captures_iter(inner) {
        let name = m.get(1).expect("group 1");
        let value = m.get(2).expect("group 2");
        if is_secret_name(name.as_str()) {
            push_value(line, base + value.start(), base + value.end(), spans);
        }
    }
}

/// Record `[start, end)` as a value to mask, unless the text there is a
/// reference rather than a secret.
fn push_value(line: &str, start: usize, end: usize, spans: &mut Vec<(usize, usize)>) {
    if end <= start || !line.is_char_boundary(start) || !line.is_char_boundary(end) {
        return;
    }
    let (_, inner) = unquote(&line[start..end]);
    if is_reference(inner) {
        return;
    }
    spans.push((start, end));
}

// ---------------------------------------------------------------------------
// Rule 3: values recognisable on their own
// ---------------------------------------------------------------------------

/// `(pattern, needs a digit)` — the capture group is the credential itself.
///
/// The digit test only guards the loosest pattern (`sk-…`), where a long
/// hyphenated word could otherwise be taken for an OpenAI key; every real one
/// carries digits.
fn shape_patterns() -> &'static [(Regex, bool)] {
    static PATTERNS: OnceLock<Vec<(Regex, bool)>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        [
            // AWS key ids (long-lived, temporary, role, user…).
            (
                r"(?:^|[^A-Za-z0-9])((?:AKIA|ASIA|AROA|AIDA|AGPA|ANPA|ANVA|APKA|ABIA|ACCA)[0-9A-Z]{16})",
                false,
            ),
            // GitHub: personal access, OAuth, user-to-server, refresh…
            (r"(?:^|[^A-Za-z0-9_])(gh[pousr]_[A-Za-z0-9]{20,})", false),
            (r"(?:^|[^A-Za-z0-9_])(github_pat_[A-Za-z0-9_]{20,})", false),
            // Anthropic, then OpenAI and everything else shaped like it.
            (r"(?:^|[^A-Za-z0-9_])(sk-ant-[A-Za-z0-9_\-]{12,})", false),
            (r"(?:^|[^A-Za-z0-9_])(sk-[A-Za-z0-9_\-]{20,})", true),
            // Slack bot / user / app tokens.
            (r"(?:^|[^A-Za-z0-9_])(xox[abprs]-[A-Za-z0-9\-]{10,})", false),
            // Google API key.
            (r"(?:^|[^A-Za-z0-9_])(AIza[0-9A-Za-z_\-]{35})", false),
            // A JWT: three base64url parts, the first being the header.
            (
                r"(?:^|[^A-Za-z0-9_])(eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]*)",
                false,
            ),
            // A PEM private key pasted onto the line.
            (
                r"(-----BEGIN [A-Z ]*PRIVATE KEY-----(?s:.)*?(?:-----END [A-Z ]*PRIVATE KEY-----|$))",
                false,
            ),
        ]
        .into_iter()
        .map(|(p, d)| (Regex::new(p).expect("static pattern"), d))
        .collect()
    })
}

fn collect_shape_spans(line: &str, spans: &mut Vec<(usize, usize)>) {
    for (re, needs_digit) in shape_patterns() {
        for m in re.captures_iter(line) {
            let g = m.get(1).expect("every pattern captures the credential");
            if *needs_digit && !g.as_str().bytes().any(|b| b.is_ascii_digit()) {
                continue;
            }
            spans.push((g.start(), g.end()));
        }
    }
}

// ---------------------------------------------------------------------------
// Rewriting
// ---------------------------------------------------------------------------

/// Replace every (merged) span with [`REDACTED`].
///
/// Returns `None` if nothing survives the merge, so the caller can keep the
/// borrowed line.
fn splice(line: &str, mut spans: Vec<(usize, usize)>) -> Option<String> {
    spans.retain(|(a, b)| b > a && line.is_char_boundary(*a) && line.is_char_boundary(*b));
    if spans.is_empty() {
        return None;
    }
    spans.sort_unstable();
    let mut merged: Vec<(usize, usize)> = Vec::with_capacity(spans.len());
    for (a, b) in spans {
        match merged.last_mut() {
            Some(last) if a <= last.1 => last.1 = last.1.max(b),
            _ => merged.push((a, b)),
        }
    }
    let mut out = String::with_capacity(line.len());
    let mut at = 0usize;
    for (a, b) in merged {
        out.push_str(&line[at..a]);
        out.push_str(REDACTED);
        at = b;
    }
    out.push_str(&line[at..]);
    Some(out)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// Every value below is invented. Nothing here is, or has ever been, a real
// credential: the tokens only carry the *shape* of one.
#[cfg(test)]
mod tests {
    use super::*;

    /// `redact`, asserting the line really did change.
    fn hide(line: &str) -> String {
        let out = redact(line);
        assert!(matches!(&out, Cow::Owned(_)), "nothing was masked in: {line}");
        out.into_owned()
    }

    /// Assert the line comes back byte for byte, still borrowed.
    fn keep(line: &str) {
        let out = redact(line);
        assert!(
            matches!(&out, Cow::Borrowed(_)),
            "this must not be touched: {line}\n            got: {out}"
        );
        assert_eq!(out, line);
    }

    const M: &str = REDACTED;

    /// A GitHub token with the right *shape* and an obviously fake body.
    fn fake_gh_token() -> String {
        format!("ghp_{}", "0".repeat(36))
    }

    // =======================================================================
    // What MUST be masked
    // =======================================================================

    #[test]
    fn environment_assignments_in_every_shell() {
        // POSIX / bash / zsh.
        assert_eq!(
            hide("export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY"),
            format!("export AWS_SECRET_ACCESS_KEY={M}")
        );
        assert_eq!(hide("export GITHUB_TOKEN=abcdef123456"), format!("export GITHUB_TOKEN={M}"));
        // Quotes come off with the value.
        assert_eq!(hide(r#"export DB_PASSWORD="hunter2""#), format!("export DB_PASSWORD={M}"));
        assert_eq!(hide("export API_KEY='hunter2'"), format!("export API_KEY={M}"));
        // A bare assignment with no `export` at all.
        assert_eq!(hide("STRIPE_SECRET=whatever"), format!("STRIPE_SECRET={M}"));
        // An environment prefix in front of a command: the command survives.
        assert_eq!(
            hide("NPM_TOKEN=abcdef123456 npm publish --access public"),
            format!("NPM_TOKEN={M} npm publish --access public")
        );
        // Windows `cmd`.
        assert_eq!(hide("set API_TOKEN=abcdef123456"), format!("set API_TOKEN={M}"));
        // A dotted name, as `git config` and `helm --set` spell them.
        assert_eq!(
            hide("helm install app . --set db.password=hunter2"),
            format!("helm install app . --set db.password={M}")
        );
    }

    #[test]
    fn fish_set_and_powershell_env() {
        assert_eq!(
            hide(&format!("set -x GITHUB_TOKEN {}", fake_gh_token())),
            format!("set -x GITHUB_TOKEN {M}")
        );
        assert_eq!(hide("set -gx OPENAI_API_KEY abcdef123456"), format!("set -gx OPENAI_API_KEY {M}"));
        assert_eq!(
            hide(r#"$env:GITHUB_TOKEN = "abcdef123456""#),
            format!("$env:GITHUB_TOKEN = {M}")
        );
        assert_eq!(hide(r#"$env:API_KEY="abcdef123456""#), format!("$env:API_KEY={M}"));
        assert_eq!(hide("setx CORTX_SECRET abcdef123456"), format!("setx CORTX_SECRET {M}"));
    }

    #[test]
    fn flags_long_short_and_glued() {
        assert_eq!(hide("gh auth login --token abcdef123456"), format!("gh auth login --token {M}"));
        assert_eq!(hide("mytool --token=abcdef123456"), format!("mytool --token={M}"));
        assert_eq!(hide("mytool --password hunter2"), format!("mytool --password {M}"));
        assert_eq!(hide("mytool --api-key abcdef123456"), format!("mytool --api-key {M}"));
        assert_eq!(hide("mytool --secret abcdef123456"), format!("mytool --secret {M}"));
        assert_eq!(
            hide("vault login --client-secret=abcdef123456"),
            format!("vault login --client-secret={M}")
        );
        // `-p` glued, only where it means a password.
        assert_eq!(hide("mysql -uroot -phunter2 mydb"), format!("mysql -uroot -p{M} mydb"));
        assert_eq!(hide("redis-cli -a hunter2 ping"), format!("redis-cli -a {M} ping"));
        // `docker login -p` is scoped to the `login` subcommand.
        assert_eq!(
            hide("docker login -u alexis -p hunter2 ghcr.io"),
            format!("docker login -u alexis -p {M} ghcr.io")
        );
        // The value of an innocent flag can still be an assignment.
        assert_eq!(
            hide("kubectl create secret generic db --from-literal=password=hunter2"),
            format!("kubectl create secret generic db --from-literal=password={M}")
        );
    }

    #[test]
    fn curl_headers_and_basic_auth() {
        assert_eq!(
            hide(r#"curl -H "Authorization: Bearer abcdef123456" https://api.example.com"#),
            format!(r#"curl -H "Authorization: Bearer {M}" https://api.example.com"#)
        );
        assert_eq!(
            hide(r#"curl -H 'X-Api-Key: abcdef123456' https://api.example.com"#),
            format!(r#"curl -H 'X-Api-Key: {M}' https://api.example.com"#)
        );
        // No scheme word: the whole value goes.
        assert_eq!(
            hide(r#"curl --header "Authorization: abcdef123456" https://api.example.com"#),
            format!(r#"curl --header "Authorization: {M}" https://api.example.com"#)
        );
        assert_eq!(
            hide("curl -u alexis:hunter2 https://api.example.com"),
            format!("curl -u alexis:{M} https://api.example.com")
        );
        // Credentials inside the URL itself.
        assert_eq!(
            hide("git clone https://alexis:hunter2@example.com/repo.git"),
            format!("git clone https://alexis:{M}@example.com/repo.git")
        );
        assert_eq!(
            hide(r#"curl "https://api.example.com/v1/me?api_key=abcdef123456&page=2""#),
            format!(r#"curl "https://api.example.com/v1/me?api_key={M}&page=2""#)
        );
    }

    #[test]
    fn values_recognised_by_their_own_shape() {
        // Invented values with the right *shape*, never a real credential.
        // The bodies are built here rather than typed out so the lengths the
        // patterns require are exact and obvious.
        let zeros = |n: usize| "0".repeat(n);
        let cases = [
            // AWS access key id: the prefix plus exactly 16.
            "echo AKIAIOSFODNN7EXAMPLE".to_string(),
            format!("gh auth login --with-token {}", fake_gh_token()),
            format!("echo github_pat_{}", zeros(40)),
            format!("echo sk-ant-api03-{}", zeros(28)),
            format!("echo sk-{}", zeros(48)),
            format!("echo xoxb-{}-{}-abcdefghijklmnop", zeros(12), zeros(12)),
            // Google API keys are the prefix plus exactly 35.
            format!("echo AIzaSy{}", zeros(33)),
            "curl -d eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij".to_string(),
        ];
        for case in &cases {
            let out = hide(case);
            assert!(out.contains(M), "{case} -> {out}");
            // The command word is never eaten by a shape rule.
            assert!(out.starts_with(case.split(' ').next().unwrap()), "{case} -> {out}");
            assert!(!out.contains("0000"), "nothing of the value survives: {out}");
        }
        assert_eq!(hide("echo AKIAIOSFODNN7EXAMPLE"), format!("echo {M}"));
    }

    #[test]
    fn a_pasted_private_key_goes_whole() {
        let line = "echo \"-----BEGIN RSA PRIVATE KEY-----AAAA0000BBBB-----END RSA PRIVATE KEY-----\" > k.pem";
        let out = hide(line);
        assert!(!out.contains("AAAA0000BBBB"), "{out}");
        assert!(!out.contains("BEGIN RSA PRIVATE KEY"), "{out}");
        assert!(out.ends_with("> k.pem"), "the rest of the line is intact: {out}");
        // An unterminated paste is masked to the end of the line.
        let open = "echo -----BEGIN OPENSSH PRIVATE KEY-----b3BlbnNzaC1rZXktdjEAAAAA";
        assert_eq!(hide(open), format!("echo {M}"));
    }

    #[test]
    fn several_secrets_on_one_line_and_across_a_pipeline() {
        assert_eq!(
            hide("export A_TOKEN=aaa && export B_PASSWORD=bbb"),
            format!("export A_TOKEN={M} && export B_PASSWORD={M}")
        );
        assert_eq!(
            hide("echo AKIAIOSFODNN7EXAMPLE | tee /tmp/k && mysql -phunter2"),
            format!("echo {M} | tee /tmp/k && mysql -p{M}")
        );
    }

    // =======================================================================
    // What must NOT be masked
    //
    // Half the value of this module. A history that mangles ordinary commands
    // is a history the user turns off, and the protection goes with it.
    // =======================================================================

    #[test]
    fn ordinary_commands_are_untouched() {
        for line in [
            "git commit -m \"fix auth\"",
            "git commit -m 'refactor: token parsing in the lexer'",
            "git log --author \"Alexis Munch\" --since 2.weeks",
            "git push origin main",
            "export PATH=/usr/local/bin:$PATH",
            "export EDITOR=nvim",
            "export NODE_ENV=production",
            "export RUST_LOG=debug",
            "cargo test -p cortx-core",
            "npm run build",
            "bun run lint",
            "mkdir -p src/components/terminal",
            "docker run -p 8080:80 -d nginx",
            "ssh -p 2222 alexis@example.com",
            "ssh -i ~/.ssh/id_ed25519 alexis@example.com",
            "grep -rn \"password\" src/",
            "rg --hidden -g '!node_modules' secret",
            "cat ~/.ssh/authorized_keys",
            "ls -la /etc/ssl/private",
            "kubectl get secret my-db-secret -o yaml",
            "vault kv get secret/data/cortx",
            "echo $AWS_SECRET_ACCESS_KEY",
            "echo \"$GITHUB_TOKEN\" | gh auth login --with-token",
            "aws s3 ls --profile prod",
            "curl -s https://api.example.com/health",
            "psql -h localhost -U postgres -d cortx",
            "tar -xzf backup.tar.gz -C /srv",
            "chmod 600 ~/.ssh/id_ed25519",
            "openssl genrsa -out private.pem 4096",
            "code --diff a.txt b.txt",
        ] {
            keep(line);
        }
    }

    #[test]
    fn a_name_that_points_at_a_secret_is_not_the_secret() {
        for line in [
            "export VAULT_SECRET_PATH=secret/data/cortx",
            "export TOKEN_FILE=/run/secrets/token",
            "export AWS_PROFILE=prod",
            "mytool --token-file ~/.config/gh/hosts.yml",
            "mytool --auth-type basic",
            "mytool --auth-provider oidc",
            "aws secretsmanager get-secret-value --secret-id prod/db",
            "podman login --authfile ~/.docker/config.json ghcr.io",
        ] {
            keep(line);
        }
        // The line this rule deliberately does *not* draw: a bare `--secret`
        // is masked, because in most tools it really is the value. `gcloud`,
        // where it names a secret rather than holding one, pays for that —
        // and `--secret-id` / `--secret-name`, the spellings that always mean
        // a name, are kept (above).
        assert_eq!(
            hide("gcloud secrets versions access latest --secret=cortx-db"),
            format!("gcloud secrets versions access latest --secret={M}")
        );
    }

    #[test]
    fn docker_login_with_password_stdin_keeps_the_registry() {
        // The *recommended* form. Masking the word after `--password-stdin`
        // would swallow `ghcr.io` and leave a line nobody can read back.
        keep("echo \"$GH_TOKEN\" | docker login ghcr.io -u alexis --password-stdin");
        keep("docker login --password-stdin ghcr.io");
    }

    #[test]
    fn a_reference_is_never_a_secret() {
        for line in [
            "export GITHUB_TOKEN=$GH_PAT",
            "export API_KEY=${API_KEY}",
            "export ANTHROPIC_API_KEY=$(op read op://private/anthropic/key)",
            "export DB_PASSWORD=%DB_PASSWORD%",
            "$env:GITHUB_TOKEN = $Env:GH_PAT",
            "set -x OPENAI_API_KEY $OPENAI_KEY",
            "export TOKEN=\"\"",
        ] {
            keep(line);
        }
    }

    #[test]
    fn bash_set_options_are_not_assignments() {
        for line in ["set -e", "set -euo pipefail", "set -x", "set +x", "set -o vi"] {
            keep(line);
        }
    }

    #[test]
    fn short_flags_keep_their_ordinary_meaning() {
        for line in [
            "mkdir -p a/b/c",
            "docker run -p 5432:5432 postgres",
            "docker compose -p cortx up -d",
            "ssh -p 22 host",
            "cp -p a b",
            "sort -u names.txt",
            "docker exec -u root -it web sh",
            "curl -u alexis https://api.example.com",
        ] {
            keep(line);
        }
    }

    #[test]
    fn colons_that_are_not_headers() {
        for line in [
            "docker run -p 8080:80 nginx",
            "kubectl get pods -n kube-system",
            "scp file.txt host:/tmp/",
            "git remote add origin git@github.com:ALXS-GitHub/cortx.git",
            "echo \"note: remember to rotate the token\"",
            "echo \"Authorization: Bearer\"",
            // Conventional-commit scopes, which are shaped exactly like a
            // header and are not one.
            "git commit -m \"auth: fix the login redirect\"",
            "git commit -m \"secret: stop logging the body\"",
        ] {
            keep(line);
        }
    }

    #[test]
    fn words_that_merely_look_long_and_random() {
        for line in [
            "git checkout 8e1cb4529b6f1d0a3c5e7f9012345678abcdef01",
            "docker pull nginx@sha256:0000000000000000000000000000000000000000000000000000000000000000",
            "cargo add serde --features derive",
            "npm i sk-really-long-package-name-without-digits",
            "curl https://example.com/very/long/path/that/goes/on/forever/and/ever",
        ] {
            keep(line);
        }
    }

    // =======================================================================
    // Shape of the output
    // =======================================================================

    #[test]
    fn the_marker_is_inert_and_the_line_stays_greppable() {
        let out = hide("export GITHUB_TOKEN=abcdef123456");
        // Nothing a shell would read as a redirection, a glob or an expansion:
        // these lines come back as ghost text and can be accepted and run.
        for c in ['<', '>', '*', '?', '$', '`', '|', '&', ';', '(', ')'] {
            assert!(!out.contains(c), "the marker must be inert, found {c:?} in {out}");
        }
        // The half that makes the record useful is still there.
        assert!(out.starts_with("export GITHUB_TOKEN="));
        assert!(out.contains('\u{2022}'), "one character is enough to grep for");
    }

    #[test]
    fn redaction_is_idempotent_and_leaves_nothing_behind() {
        for line in [
            "export GITHUB_TOKEN=abcdef123456",
            "curl -H \"Authorization: Bearer abcdef123456\" https://api.example.com",
            "mysql -uroot -phunter2",
        ] {
            let once = hide(line);
            assert_eq!(redact(&once), once, "a masked line is already clean");
        }
        assert!(has_secret("export API_KEY=abcdef123456"));
        assert!(!has_secret("cargo build --release"));
    }

    #[test]
    fn nothing_panics_on_ragged_input() {
        for line in [
            "",
            " ",
            "=",
            "--",
            "--token",
            "--token=",
            "export =x",
            "export TOKEN=",
            "\"unterminated quote --password x",
            "échantillon --password mot-de-passe --token=clé-privée",
            "set",
            "$env:",
            "$env:TOKEN =",
            "a=b=c=d",
            "|| && ; |",
        ] {
            let _ = redact(line);
        }
        // The accented line really is handled, not merely survived.
        assert_eq!(
            hide("échantillon --password mot-de-passe"),
            format!("échantillon --password {M}")
        );
    }

    #[test]
    fn names_are_classified_the_way_the_rules_claim() {
        for name in [
            "TOKEN",
            "GITHUB_TOKEN",
            "api-key",
            "ApiKey",
            "AWS_SECRET_ACCESS_KEY",
            "DB_PASSWD",
            "client-secret",
            "Authorization",
            "X-Api-Key",
            "OAUTH_TOKEN",
            "SSH_PRIVATE_KEY",
            "passphrase",
        ] {
            assert!(is_secret_name(name), "{name} should be suspicious");
        }
        for name in [
            "PATH",
            "AUTHOR",
            "author",
            "--author-date",
            "EDITOR",
            "TOKEN_FILE",
            "SECRET_PATH",
            "auth-type",
            "password-stdin",
            "secret-name",
            "TOKEN_TTL",
            "AWS_REGION",
            "",
        ] {
            assert!(!is_secret_name(name), "{name} should be ordinary");
        }
    }
}
