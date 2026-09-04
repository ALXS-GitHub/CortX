/**
 * When a finished command is worth interrupting you (DEV-13 #5).
 *
 * Shell integration (OSC 133 D) closes a *command*, not a *job*: quitting
 * Claude Code, exiting `vim` or Ctrl+C-ing a watcher all look exactly like a
 * command that ended. With the original rule — "any command longer than
 * 10 s in a tab you are not looking at" — an agent session running for hours
 * was, by construction, always a notification. Hence three filters, in this
 * order:
 *
 *  1. the command's *outcome* (`notifyWhen`): failures only, by default;
 *  2. the *program* (`notifyMutedCommands`): long-lived interactive tools
 *     never notify, because their exit code says nothing useful — under
 *     PowerShell a Ctrl+C leaves `$?` false, so quitting `claude` reads as
 *     "exit 1";
 *  3. *visibility* (`notifyOnlyWhenHidden`): nothing for a terminal you are
 *     currently looking at.
 *
 * Not implemented on purpose: "the terminal is asking for a password". OSC
 * 133 marks command boundaries only — it says nothing about a program waiting
 * on stdin — and the alternative (sniffing the PTY output for `Password:`)
 * fires on any program that prints the word. See the DEV-13 report.
 */

import type { TerminalConfig, TerminalNotifyStyle, TerminalNotifyWhen } from '@/types';

export const DEFAULT_NOTIFY_WHEN: TerminalNotifyWhen = 'failed';
export const DEFAULT_NOTIFY_STYLE: TerminalNotifyStyle = 'both';
export const DEFAULT_NOTIFY_ONLY_WHEN_HIDDEN = true;
export const DEFAULT_LONG_COMMAND_SECONDS = 10;

/**
 * Programs whose exit means "I closed it", not "it finished": agents, editors,
 * pagers, remote shells, watchers. Editable in the settings.
 */
export const DEFAULT_MUTED_COMMANDS: readonly string[] = [
  'claude',
  'codex',
  'gemini',
  'aider',
  'vim',
  'nvim',
  'vi',
  'nano',
  'emacs',
  'less',
  'man',
  'top',
  'htop',
  'btop',
  'ssh',
  'tmux',
  'screen',
  'lazygit',
  'watch',
];

/**
 * Exit codes that mean "you stopped it yourself" on POSIX shells (128 + the
 * signal) and on Windows (`STATUS_CONTROL_C_EXIT`, as i32 and as u32).
 * PowerShell reports a plain 1 for its own Ctrl+C, which is why the muted
 * list above matters more than this one.
 */
const CANCELLED_EXIT_CODES = new Set([130, 143, -1073741510, 3221225786]);

export const NOTIFY_WHEN_OPTIONS: { value: TerminalNotifyWhen; label: string; hint: string }[] = [
  { value: 'never', label: 'Never', hint: 'No notification when a command ends. The tab badges still show what happened.' },
  { value: 'failed', label: 'A command fails', hint: 'Only a non-zero exit code — usually the only case worth interrupting you.' },
  {
    value: 'failed-or-long',
    label: 'A command fails, or takes long',
    hint: 'Failures, plus any command that succeeded after the threshold below.',
  },
  { value: 'all', label: 'Any command ends', hint: 'Every command, however short. Noisy.' },
];

export const NOTIFY_STYLE_OPTIONS: { value: TerminalNotifyStyle; label: string; hint: string }[] = [
  { value: 'toast', label: 'Toast', hint: 'A toast inside CortX only — nothing when CortX is in the background.' },
  { value: 'system', label: 'System', hint: 'A desktop notification only, whether CortX is in front or not.' },
  { value: 'both', label: 'Both', hint: 'A toast, plus a desktop notification when the window is in the background.' },
];

// ---------------------------------------------------------------------------
// Resolving the settings
// ---------------------------------------------------------------------------

/** Effective mode, honouring an explicit `notifyOnLongCommand: false` opt-out. */
export function resolveNotifyWhen(cfg?: Partial<TerminalConfig> | null): TerminalNotifyWhen {
  if (cfg?.notifyWhen) return cfg.notifyWhen;
  return cfg?.notifyOnLongCommand === false ? 'never' : DEFAULT_NOTIFY_WHEN;
}

export function resolveNotifyStyle(cfg?: Partial<TerminalConfig> | null): TerminalNotifyStyle {
  return cfg?.notifyStyle ?? DEFAULT_NOTIFY_STYLE;
}

export function resolveNotifyOnlyWhenHidden(cfg?: Partial<TerminalConfig> | null): boolean {
  return cfg?.notifyOnlyWhenHidden ?? DEFAULT_NOTIFY_ONLY_WHEN_HIDDEN;
}

export function resolveLongCommandSeconds(cfg?: Partial<TerminalConfig> | null): number {
  const raw = cfg?.longCommandSeconds;
  return typeof raw === 'number' && raw > 0 ? raw : DEFAULT_LONG_COMMAND_SECONDS;
}

/** The muted list as stored, or the built-in one when it was never edited. */
export function resolveMutedCommands(cfg?: Partial<TerminalConfig> | null): string[] {
  return cfg?.notifyMutedCommands ? [...cfg.notifyMutedCommands] : [...DEFAULT_MUTED_COMMANDS];
}

/** One entry per line or comma, trimmed, empties dropped, duplicates removed. */
export function parseMutedCommands(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[\n,]/)) {
    const entry = part.trim().toLowerCase();
    if (entry) seen.add(entry);
  }
  return [...seen];
}

export function formatMutedCommands(list: readonly string[]): string {
  return list.join(', ');
}

// ---------------------------------------------------------------------------
// Matching a command against the muted list
// ---------------------------------------------------------------------------

/** `C:\tools\claude.exe --resume` → `claude`; `sudo npm ci` → `npm`. */
function programName(command: string): string {
  let rest = command.trim();
  if (/^sudo\s+/i.test(rest)) rest = rest.replace(/^sudo\s+/i, '');
  const first = (rest.split(/\s+/)[0] ?? '').replace(/^["']|["']$/g, '');
  const base = first.split(/[\\/]/).pop() ?? '';
  return base.replace(/\.(exe|cmd|bat|com|ps1)$/i, '').toLowerCase();
}

/**
 * An entry matches either the program name (`claude` catches
 * `claude --resume` and `/usr/bin/claude`) or a whole prefix of the command
 * line (`npm run dev` catches `npm run dev -- --host`).
 */
export function isCommandMuted(command: string | null | undefined, muted: readonly string[]): boolean {
  if (!command) return false;
  const line = command.trim().toLowerCase();
  if (!line) return false;
  const program = programName(command);
  return muted.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (!entry) return false;
    if (entry === program) return true;
    return line === entry || line.startsWith(`${entry} `);
  });
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export interface FinishedCommandFacts {
  command: string | null;
  exitCode: number | null;
  durationMs: number;
  /** The terminal was on screen, in a focused window, when the command ended. */
  inView: boolean;
  /** The window running this check has the OS focus. */
  windowFocused: boolean;
}

export interface NotifyDecision {
  toast: boolean;
  system: boolean;
  /** A failure reads as an error toast, a success as a success toast. */
  failed: boolean;
}

/** Null when nothing should be shown. */
export function decideCommandNotification(
  cfg: Partial<TerminalConfig> | null | undefined,
  facts: FinishedCommandFacts
): NotifyDecision | null {
  const when = resolveNotifyWhen(cfg);
  if (when === 'never') return null;
  if (resolveNotifyOnlyWhenHidden(cfg) && facts.inView) return null;
  if (isCommandMuted(facts.command, resolveMutedCommands(cfg))) return null;

  const cancelled = facts.exitCode != null && CANCELLED_EXIT_CODES.has(facts.exitCode);
  const failed = !cancelled && facts.exitCode != null && facts.exitCode !== 0;
  if (cancelled && when !== 'all') return null;

  if (when === 'failed' && !failed) return null;
  if (when === 'failed-or-long' && !failed && facts.durationMs < resolveLongCommandSeconds(cfg) * 1000) return null;

  const style = resolveNotifyStyle(cfg);
  return {
    toast: style !== 'system',
    // `both` keeps the original rule: the desktop only hears about it when
    // you are not already looking at CortX.
    system: style === 'system' || (style === 'both' && !facts.windowFocused),
    failed,
  };
}
