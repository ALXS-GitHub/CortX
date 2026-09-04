/**
 * Which command lines look like they started a shell of their own — the
 * detection half of the sub-shell integration (ticket #16). Pure and
 * dependency-free on purpose: what CortX is willing to type into a running
 * program is worth being able to test on its own.
 *
 * The list is deliberately the one Warp ships (read out of its binary), plus
 * `kubectl exec` and `nix develop`. It is only ever used to *offer*: see
 * `subshell.ts` for why nothing is ever injected without a click.
 */

export type SubshellShell = 'bash' | 'zsh' | 'fish' | 'powershell';

export type SubshellKind = 'shell' | 'ssh' | 'container' | 'wsl' | 'environment';

export interface SubshellMatch {
  kind: SubshellKind;
  /** Shell the command names, when it does (`docker exec … bash`). */
  shell: SubshellShell | null;
  /** Human wording for the banner ("an SSH session", "a Docker container"). */
  what: string;
  /**
   * The sub-shell runs somewhere `CORTX_TERMINAL_ID` and the `cortx` binary
   * cannot follow (another host, container or WSL distribution). Those need
   * the whole block shipped over the wire.
   */
  remote: boolean;
}

interface Pattern {
  re: RegExp;
  kind: SubshellKind;
  what: string;
  remote: boolean;
  /** Index of the capture group naming the shell, if any. */
  shellGroup?: number;
}

/**
 * `wsl --list`, `wsl --shutdown`… are not sessions. Warp keeps the same kind
 * of ignore list next to its `^wsl` pattern.
 */
const WSL_NOT_A_SESSION =
  /^\s*wsl(?:\.exe)?\s+--(?:default-user|enable-wsl1|export|help|import|import-in-place|inbox|install|list|mount|no-distribution|no-launch|set-default|shutdown|status|terminate|uninstall|unmount|unregister|update|version|web-download)\b/i;

/**
 * The command shapes worth offering on. Deliberately the same list Warp
 * ships (read out of its binary), plus `kubectl exec` and `nix develop`,
 * minus anything that would match a program that is not a shell.
 */
const PATTERNS: Pattern[] = [
  // A shell invoked on its own, with no arguments: `bash`, `/bin/zsh`, `pwsh`.
  {
    re: /^\s*(?:sudo\s+(?:-i\s+)?)?(?:[\w.-]*[\\/])*(bash|zsh|fish|pwsh|powershell)(?:\.exe)?\s*$/i,
    kind: 'shell',
    what: 'a sub-shell',
    remote: false,
    shellGroup: 1,
  },
  {
    // The separator before the shell name matters: without it `docker exec
    // … splash` would end in "sh" and look like a shell.
    re: /^\s*(?:docker|podman)\s+(?:run|exec)\s+.*[\s/'"](bash|zsh|fish|sh)['"]?\s*$/i,
    kind: 'container',
    what: 'a container',
    remote: true,
    shellGroup: 1,
  },
  {
    re: /^\s*kubectl\s+exec\s+.*[\s/'"](bash|zsh|fish|sh)['"]?\s*$/i,
    kind: 'container',
    what: 'a Kubernetes pod',
    remote: true,
    shellGroup: 1,
  },
  { re: /^\s*ssh\s+(?!-[TWO])\S/i, kind: 'ssh', what: 'an SSH session', remote: true },
  { re: /^\s*gcloud\s+compute\s+ssh\s+\S/i, kind: 'ssh', what: 'an SSH session', remote: true },
  { re: /^\s*doctl\s+compute\s+ssh\s+\S/i, kind: 'ssh', what: 'an SSH session', remote: true },
  { re: /^\s*eb\s+ssh\s+\S/i, kind: 'ssh', what: 'an SSH session', remote: true },
  { re: /^\s*wsl(?:\.exe)?(?:$|\s)/i, kind: 'wsl', what: 'a WSL distribution', remote: true },
  { re: /^\s*(?:poetry|pipenv)\s+shell\b/i, kind: 'environment', what: 'a virtualenv shell', remote: false },
  { re: /^\s*aws-vault\s+exec\b/i, kind: 'environment', what: 'an aws-vault shell', remote: false },
  { re: /^\s*flox\s+(?:-\S+\s+)*activate\b/i, kind: 'environment', what: 'a flox environment', remote: false },
  { re: /^\s*nix\s+(?:develop|shell)\b/i, kind: 'environment', what: 'a Nix shell', remote: false },
];

/** Does this command line look like it started a shell of its own? */
export function detectSubshell(command: string | null | undefined): SubshellMatch | null {
  if (!command) return null;
  const line = command.trim();
  if (!line || line.length > 500) return null;
  if (WSL_NOT_A_SESSION.test(line)) return null;
  for (const p of PATTERNS) {
    const m = p.re.exec(line);
    if (!m) continue;
    const named = p.shellGroup ? m[p.shellGroup]?.toLowerCase() : undefined;
    const shell: SubshellShell | null =
      named === 'bash' || named === 'zsh' || named === 'fish'
        ? named
        : named === 'pwsh' || named === 'powershell'
          ? 'powershell'
          : named === 'sh'
            ? 'bash'
            : null;
    return { kind: p.kind, shell, what: p.what, remote: p.remote };
  }
  return null;
}

