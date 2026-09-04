import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { writeTerminal } from '@/lib/tauri';
import { useAppStore } from '@/stores/appStore';
import type { SubshellShell } from './subshellDetect';

export * from './subshellDetect';

/**
 * Sub-shell shell integration — CortX's answer to Warp's "warpify"
 * (ticket #16).
 *
 * ## What already works without any of this
 *
 * CortX's PTYs set `CORTX_TERMINAL_ID`, and every block `cortx init` emits is
 * guarded on it. Environment variables are inherited, so a shell started
 * *inside* a CortX terminal already emits OSC 7 / 133 **as long as its own
 * startup file calls `cortx init`** — a local `bash` from PowerShell, a
 * `poetry shell`, a `nix develop`. On top of that, the shell CortX spawns
 * itself never depends on the profile at all: the block is injected as
 * start-up code (`process_manager::inject_shell_integration`).
 *
 * ## What cannot work by inheritance
 *
 * Nothing crosses a machine or a namespace boundary: `ssh`, `docker exec`,
 * `podman`, `kubectl exec`, WSL (which only forwards the variables listed in
 * `WSLENV`), `sudo -i` / `su`. There is no `CORTX_TERMINAL_ID` on the far
 * side, no `cortx` binary, and no startup file of ours. The block has to be
 * *sent* — which is exactly what Warp does: it types a bootstrap into the PTY
 * when you press its "Warpify" button.
 *
 * ## Why this is explicit, and stays explicit
 *
 * A terminal cannot tell a shell from any other interactive program. `python`,
 * `psql`, `ssh` while it asks for a passphrase — they all look the same from
 * the outside. Typing a command into one of those would at best print noise
 * and at worst send a line into something that is reading a secret. So CortX
 * detects a *likely* sub-shell (the same command shapes Warp recognises) and
 * only ever **offers**; nothing is ever injected on its own.
 */

/** Single-quote a value for a POSIX shell. */
function sq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The line to type when `cortx` itself is reachable (a sub-shell on this
 * machine). Short, readable in the scrollback, and it reuses the generator
 * the profile uses — so there is no second copy of the integration to drift.
 */
function localInjection(shell: SubshellShell, terminalId: string): string {
  switch (shell) {
    case 'powershell':
      return ` $env:CORTX_TERMINAL_ID = '${terminalId.replace(/'/g, "''")}'; cortx init powershell | Out-String | Invoke-Expression`;
    case 'fish':
      return ` set -gx CORTX_TERMINAL_ID ${sq(terminalId)}; cortx init fish | source`;
    default:
      return ` CORTX_TERMINAL_ID=${sq(terminalId)}; export CORTX_TERMINAL_ID; eval "$(cortx init ${shell})"`;
  }
}

/**
 * The self-contained line (block carried base64-encoded, no `cortx` needed on
 * the far side) built by `cortx_core::shell_init::subshell_injection`. Older
 * builds do not have the command yet, hence the null.
 */
async function remoteInjection(shell: SubshellShell, terminalId: string): Promise<string | null> {
  try {
    const line = await invoke<string>('terminal_subshell_snippet', { shell, terminalId });
    return typeof line === 'string' && line.trim() ? line : null;
  } catch {
    return null;
  }
}

export interface WarpifyResult {
  ok: boolean;
  /** What was typed, for the toast / the report. */
  line?: string;
}

/**
 * Hand the CortX shell integration to the sub-shell running in a terminal.
 *
 * Called from a click, never from a detection: see the note at the top of the
 * file. The line is typed with a leading space so shells set to ignore
 * space-prefixed commands keep it out of their history.
 */
export async function warpifySubshell(
  terminalId: string,
  shell: SubshellShell,
  options: { remote?: boolean } = {}
): Promise<WarpifyResult> {
  const enabled = useAppStore.getState().settings?.terminal.shellIntegration;
  if (enabled === false) {
    toast.error('Shell integration is turned off', {
      description: 'Turn it back on in Settings → Terminal before enabling it in a sub-shell.',
    });
    return { ok: false };
  }
  const remote = options.remote ?? false;
  const line = (await remoteInjection(shell, terminalId)) ?? (remote ? null : localInjection(shell, terminalId));
  if (!line) {
    toast.error('This build cannot set up a remote sub-shell', {
      description:
        'Sending the integration to another host, container or WSL distribution needs the `terminal_subshell_snippet` command. A sub-shell on this machine works.',
    });
    return { ok: false };
  }
  try {
    await writeTerminal(terminalId, `${line}\r`);
    return { ok: true, line };
  } catch (error) {
    toast.error('Could not talk to that terminal', { description: String(error) });
    return { ok: false };
  }
}
