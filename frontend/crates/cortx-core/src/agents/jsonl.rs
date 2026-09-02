//! Incremental JSONL reader. Transcripts are append-only, so a file that only
//! grew since the last scan is read from the previous byte offset. The final
//! line is only delivered once it is newline-terminated (a writer may be in
//! the middle of it).

use std::fs::File;
use std::io::{self, BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

/// Lines longer than this are handed to the callback but callers may choose
/// to skip parsing them (e.g. base64 images in Codex rollouts).
pub const HUGE_LINE_BYTES: usize = 4 * 1024 * 1024;

/// Read complete lines from `offset` and call `on_line` for each (without the
/// trailing `\n` / `\r\n`). Returns the byte offset right after the last
/// complete line, i.e. the offset to resume from next time.
pub fn scan_from<F>(path: &Path, offset: u64, mut on_line: F) -> io::Result<u64>
where
    F: FnMut(&str),
{
    let mut file = File::open(path)?;
    if offset > 0 {
        file.seek(SeekFrom::Start(offset))?;
    }
    let mut reader = BufReader::with_capacity(256 * 1024, file);
    let mut buf: Vec<u8> = Vec::with_capacity(64 * 1024);
    let mut pos = offset;

    loop {
        buf.clear();
        let n = reader.read_until(b'\n', &mut buf)?;
        if n == 0 {
            break;
        }
        if buf.last() != Some(&b'\n') {
            // Partial trailing line: leave it for the next scan.
            break;
        }
        pos += n as u64;
        let mut line: &[u8] = &buf[..n - 1];
        if line.last() == Some(&b'\r') {
            line = &line[..line.len() - 1];
        }
        if line.is_empty() {
            continue;
        }
        match std::str::from_utf8(line) {
            Ok(s) => on_line(s),
            Err(_) => {
                let s = String::from_utf8_lossy(line);
                on_line(&s);
            }
        }
    }
    Ok(pos)
}

/// First `max` bytes of `s`, backed off to a char boundary.
pub fn head(s: &str, max: usize) -> &str {
    let mut n = max.min(s.len());
    while n > 0 && !s.is_char_boundary(n) {
        n -= 1;
    }
    &s[..n]
}

/// Read the whole file as complete lines (convenience for transcripts).
pub fn read_all_lines<F>(path: &Path, on_line: F) -> io::Result<()>
where
    F: FnMut(&str),
{
    scan_from(path, 0, on_line).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn scan_is_incremental_and_ignores_partial_tail() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("t.jsonl");
        std::fs::write(&p, "{\"a\":1}\r\n{\"a\":2}\n{\"a\":3").unwrap();

        let mut seen = Vec::new();
        let off = scan_from(&p, 0, |l| seen.push(l.to_string())).unwrap();
        assert_eq!(seen, vec!["{\"a\":1}", "{\"a\":2}"]);
        assert_eq!(off, "{\"a\":1}\r\n{\"a\":2}\n".len() as u64);

        // Writer finishes the line and appends one more.
        let mut f = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(b"}\n{\"a\":4}\n").unwrap();
        drop(f);

        let mut seen2 = Vec::new();
        let off2 = scan_from(&p, off, |l| seen2.push(l.to_string())).unwrap();
        assert_eq!(seen2, vec!["{\"a\":3}", "{\"a\":4}"]);
        assert_eq!(off2, std::fs::metadata(&p).unwrap().len());
    }
}
