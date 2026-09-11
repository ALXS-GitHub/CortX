/**
 * What every terminal setting is worth when nobody has touched it — and the
 * arithmetic that answers "have I touched this one?" (ticket #39).
 *
 * ## Why this file exists
 *
 * The settings panel holds seventy-odd controls, and a `settings.json` with
 * sixty-eight keys written out explicitly looks **exactly** like a file with
 * none: every control shows a value, and not one of them says whether that
 * value is the user's or the factory's. Reorganising the cards did not fix
 * that, and could not. What fixes it is knowing the default.
 *
 * ## Where the truth lives
 *
 * There were two answers before this file, and they could drift:
 *
 * - **Rust** — `TerminalConfig`'s `impl Default` and its `#[serde(default =
 *   …)]`. This is the one that reaches the disk: for a field that is not an
 *   `Option`, serde fills the default in and it is written to
 *   `settings.json`, whether the user ever looked at it or not.
 * - **TypeScript** — the `?? 12`, `?? true`, `?? 'canvas'` scattered across
 *   the readers. This is the one that reaches the terminal for a field that
 *   *is* an `Option`: Rust writes nothing, so the fallback in the component
 *   is the effective value.
 *
 * Neither one alone is the default a user experiences, which is why "ask the
 * backend for `AppSettings::default()`" is not by itself the answer — it
 * would report `fontSize: null`, and the terminal opens at 13. The default
 * that matters is the **effective** one: Rust's value where Rust writes one,
 * the TS fallback where Rust writes nothing.
 *
 * So this table is that effective default, in one place, and the boundary is
 * machine-checked rather than promised:
 *
 * - `terminalDefaults.rust.json` is a snapshot of `serde_json` on
 *   `TerminalConfig::default()`. A Rust test (`models.rs`) asserts the
 *   snapshot still matches the struct; `terminalDefaults.test.ts` asserts
 *   every key in the snapshot matches this table. Change a default on either
 *   side without the other and a test fails naming the key.
 * - The keys *absent* from the snapshot are exactly the `Option` fields —
 *   the ones TypeScript owns. For those, the test cross-reads the `DEFAULT_*`
 *   constants still exported by the modules that use them, so a second
 *   definition cannot quietly disagree with this one either.
 *
 * A follow-up would delete even that snapshot: see the report on ticket #39
 * for the `terminal_default_settings` Tauri command that would let the
 * frontend read `TerminalConfig::default()` from the process that writes the
 * file. It is not built here because `commands.rs` and `lib.rs` were out of
 * bounds for this change.
 *
 * ## Nothing here touches a store, the DOM or Tauri
 *
 * Every function takes the config it is asked about. That is what lets
 * `terminalDefaults.test.ts` run under plain Node, and it is why the reset
 * gestures can be unit-tested without clicking anything in the user's own
 * settings.
 */
import type { TerminalConfig, TerminalTabDisplay } from '@/types';
import { DEFAULT_MUTED_COMMANDS } from './notificationPolicy.ts';

// ---------------------------------------------------------------------------
// Values a setting can hold
// ---------------------------------------------------------------------------

export type SettingValue = string | number | boolean | readonly string[] | Record<string, string> | undefined;

/** Config shape these functions need: a partial one, or nothing loaded yet. */
export type TerminalConfigLike = Partial<TerminalConfig> | null | undefined;

/**
 * Stand-in for "nothing is stored here", in the space `normalize` compares in.
 *
 * A bare word is safe as a sentinel because every other value goes through
 * `JSON.stringify`, which never returns one: a string comes back quoted, and
 * anything else starts with a digit, a sign, `t` / `f` / `n`, `[` or `{`.
 */
const ABSENT = 'absent';

/**
 * Blank and absent are the same thing.
 *
 * The text fields write `undefined` when they are cleared (`v.trim() ||
 * undefined`) but an older file may hold `""`, and `customPath`'s own default
 * *is* `""`. Folding the three together is what stops an empty box from
 * reading as a change.
 */
function normalize(value: SettingValue): string {
  if (value === undefined || value === null || value === '') return ABSENT;
  return JSON.stringify(value);
}

/** Nothing is stored for this setting, so whatever it does is the default. */
function isAbsent(value: SettingValue): boolean {
  return normalize(value) === ABSENT;
}

/** Compare two setting values the way the panel means it. */
export function sameSettingValue(a: SettingValue, b: SettingValue): boolean {
  return normalize(a) === normalize(b);
}

// ---------------------------------------------------------------------------
// The three defaults ticket #39 moved, as typed constants
// ---------------------------------------------------------------------------
//
// Named separately from the table below because the modules that *apply* them
// want a number, not a `SettingValue` union — and because a default is worth
// finding by name. The table references these, so there is still one
// definition each; `lib/terminalSessions.ts` and `lib/terminalInputPosition.ts`
// re-export them rather than carrying a second literal.

/**
 * Font size of a fresh install, in px.
 *
 * 12 for a long time. Warp opens at 13, and 12 px is small on a dense screen —
 * the first thing a new user reaches for. Rust keeps `font_size` as an
 * `Option`, so this fallback, not the struct, is what a terminal actually
 * opens at.
 */
export const DEFAULT_FONT_SIZE = 13;

/**
 * Lines kept per terminal. See `default_scrollback_lines` in
 * `crates/cortx-core/src/models.rs` for why it is 25 000 and what it costs.
 */
export const DEFAULT_SCROLLBACK_LINES = 25000;

/**
 * Where the input line sits. `bottom` is Warp's `pinned_to_bottom` and half of
 * what makes the blocks read as blocks. Purely visual — no PTY is resized.
 */
export const DEFAULT_INPUT_POSITION = 'bottom';

// ---------------------------------------------------------------------------
// The groups, in the order the cards draw them
// ---------------------------------------------------------------------------

/** A settings card. The panel mounts them in this order. */
export type CardId = 'integrated' | 'appearance' | 'notifications' | 'shortcuts' | 'external';

/** A `Group` heading inside a card (or the card itself, when it has one group). */
export type GroupId =
  | 'shell'
  | 'text'
  | 'blocks'
  | 'completion'
  | 'keyboard'
  | 'scrolling'
  | 'links'
  | 'tabs'
  | 'sessions'
  | 'accessibility'
  | 'appearance'
  | 'notifications'
  | 'keys'
  | 'keybindings'
  | 'external';

const GROUP_CARD: Record<GroupId, CardId> = {
  shell: 'integrated',
  text: 'integrated',
  blocks: 'integrated',
  completion: 'integrated',
  keyboard: 'integrated',
  scrolling: 'integrated',
  links: 'integrated',
  tabs: 'integrated',
  sessions: 'integrated',
  accessibility: 'integrated',
  appearance: 'appearance',
  notifications: 'notifications',
  keys: 'shortcuts',
  keybindings: 'shortcuts',
  external: 'external',
};

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

interface SettingMeta {
  /** Short name, for the "this will change" list of a group reset. */
  readonly label: string;
  readonly group: GroupId;
  /** The effective default: a value, or a function of the rest of the config. */
  readonly fallback: SettingValue | ((cfg: TerminalConfigLike) => SettingValue);
  /** Effective stored value. Defaults to `cfg[key]`. */
  readonly read?: (cfg: TerminalConfigLike) => SettingValue;
  /** Patch that puts it back. Defaults to `{ [key]: <the default> }`. */
  readonly reset?: (cfg: TerminalConfigLike, fallback: SettingValue) => Partial<TerminalConfig>;
}

/** A `tabDisplay` sub-field, addressed as its own setting. */
function tabDisplayMeta(
  sub: keyof TerminalTabDisplay,
  label: string,
  fallback: SettingValue
): SettingMeta {
  return {
    label,
    group: 'tabs',
    fallback,
    read: (cfg: TerminalConfigLike) => cfg?.tabDisplay?.[sub] as SettingValue,
    reset: (cfg: TerminalConfigLike, value: SettingValue) => ({ tabDisplay: { ...cfg?.tabDisplay, [sub]: value } }),
  };
}

/**
 * Every setting the panel shows, with what it is worth untouched.
 *
 * Two fields of `TerminalConfig` are deliberately **not** here, and the
 * coverage test knows both by name:
 *
 * - `notifyOnLongCommand` — superseded by `notifyWhen`, kept only so a file
 *   written before `notifyWhen` existed still reads right. The UI writes it
 *   in mirror; marking it on its own would mark the same choice twice.
 * - `dockUsesTerminalTheme` — same story for `dockTheme`. Its value *is*
 *   read, but through `dockTheme`'s own fallback below.
 */
export const TERMINAL_SETTINGS = {
  // --- External terminal ---------------------------------------------------
  preset: { label: 'Terminal application', group: 'external', fallback: 'cortxterminal' },
  customPath: { label: 'Custom terminal path', group: 'external', fallback: '' },
  customArgs: { label: 'Custom arguments', group: 'external', fallback: [] },

  // --- Shell ---------------------------------------------------------------
  integratedShell: { label: 'Shell', group: 'shell', fallback: undefined },
  shellIntegration: { label: 'Shell integration', group: 'shell', fallback: true },

  // --- Text ----------------------------------------------------------------
  fontFamily: { label: 'Font', group: 'text', fallback: undefined },
  fontSize: { label: 'Font size', group: 'text', fallback: DEFAULT_FONT_SIZE },
  // The one default that is not a constant: the browser renderer needs a line
  // box of exactly 1 or powerline separators show a hairline between rows.
  // Mirrors `defaultLineHeight` in `lib/terminalSessions.ts`.
  lineHeight: {
    label: 'Line height',
    group: 'text',
    fallback: (cfg: TerminalConfigLike) => ((cfg?.renderer ?? 'canvas') === 'dom' ? 1 : 1.2),
  },
  fontWeight: { label: 'Text weight', group: 'text', fallback: 400 },
  fontWeightBold: { label: 'Bold weight', group: 'text', fallback: 700 },
  letterSpacing: { label: 'Letter spacing', group: 'text', fallback: undefined },
  selectionColor: { label: 'Selection colour', group: 'text', fallback: undefined },
  renderer: { label: 'Renderer', group: 'text', fallback: 'canvas' },
  ligatures: { label: 'Font ligatures', group: 'text', fallback: false },

  // --- Command blocks ------------------------------------------------------
  blocks: { label: 'Command blocks', group: 'blocks', fallback: true },
  blockSpacing: { label: 'Block spacing', group: 'blocks', fallback: 'comfortable' },
  blockDividers: { label: 'Block dividers', group: 'blocks', fallback: true },
  blockActions: { label: 'Block actions on hover', group: 'blocks', fallback: true },
  blockGutter: { label: 'Block gutter', group: 'blocks', fallback: true },
  blockFailedWash: { label: 'Tint failed blocks', group: 'blocks', fallback: true },
  blockCards: { label: 'Block cards', group: 'blocks', fallback: true },
  blockStickyHeader: { label: 'Pin the command while scrolling', group: 'blocks', fallback: true },
  blockJumpToBottom: { label: 'Jump to the end of a block', group: 'blocks', fallback: true },

  // --- Suggestions and completion -----------------------------------------
  inlineSuggestions: { label: 'Inline suggestions', group: 'completion', fallback: true },
  suggestionsFromOutput: { label: 'Suggest from the last output', group: 'completion', fallback: true },
  suggestionConfidence: { label: 'Suggest only when sure', group: 'completion', fallback: 'balanced' },
  completionMenu: { label: 'Completion menu', group: 'completion', fallback: 'ctrlSpace' },
  completionSpecs: { label: "Learn a command's flags", group: 'completion', fallback: true },
  completionContext: { label: 'Complete from the directory', group: 'completion', fallback: true },

  // --- Keyboard and input --------------------------------------------------
  macOptionAsMeta: { label: 'Option as the Meta key', group: 'keyboard', fallback: 'wordKeys' },
  inputPosition: { label: 'Input line position', group: 'keyboard', fallback: DEFAULT_INPUT_POSITION },
  inputEditor: { label: 'Universal input editor', group: 'keyboard', fallback: false },
  inputEditorHandoff: { label: 'Hand unknown keys back to the shell', group: 'keyboard', fallback: true },

  // --- Scrolling and scrollback -------------------------------------------
  scrollbackLines: { label: 'Scrollback', group: 'scrolling', fallback: DEFAULT_SCROLLBACK_LINES },
  historyMaxMb: { label: 'Command history size cap', group: 'scrolling', fallback: 10 },
  redactSecrets: { label: 'Mask secrets in the command history', group: 'scrolling', fallback: true },
  smoothScrollDuration: { label: 'Smooth scrolling', group: 'scrolling', fallback: 100 },

  // --- Links, images and clipboard ----------------------------------------
  filePathLinks: { label: 'Clickable file paths', group: 'links', fallback: true },
  linkTooltip: { label: "Show a link's target on hover", group: 'links', fallback: true },
  kittyGraphics: { label: 'Kitty graphics', group: 'links', fallback: true },
  osc52: { label: 'Clipboard access from programs', group: 'links', fallback: 'deny' },

  // --- Tabs and windows ----------------------------------------------------
  tabsPlacement: { label: 'Terminal window tabs', group: 'tabs', fallback: 'sidebar' },
  ctrlTabBehavior: { label: 'Ctrl+Tab goes to', group: 'tabs', fallback: 'sequential' },
  'tabDisplay.cwd': tabDisplayMeta('cwd', 'Tab shows the directory', true),
  'tabDisplay.command': tabDisplayMeta('command', 'Tab shows the running command', true),
  'tabDisplay.status': tabDisplayMeta('status', 'Tab shows the status', true),
  'tabDisplay.agent': tabDisplayMeta('agent', 'Tab shows the agent', true),
  'tabDisplay.colorBar': tabDisplayMeta('colorBar', 'Tab shows a colour bar', false),
  'tabDisplay.index': tabDisplayMeta('index', 'Tab number', 'ctrl'),
  openProcessesIn: { label: 'Services and scripts open in', group: 'tabs', fallback: 'dock' },
  openDevSessionsIn: { label: 'Dev sessions open in', group: 'tabs', fallback: 'window' },

  // --- Sessions ------------------------------------------------------------
  confirmCloseRunning: { label: 'Ask before closing a busy terminal', group: 'sessions', fallback: true },
  restoreSessions: { label: 'Restore sessions on start', group: 'sessions', fallback: true },
  restoreScrollback: { label: 'Restore scrollback', group: 'sessions', fallback: true },
  restoreScrollbackLines: { label: 'Lines replayed on start', group: 'sessions', fallback: 200 },

  // --- Accessibility -------------------------------------------------------
  minimumContrastRatio: { label: 'Minimum text contrast', group: 'accessibility', fallback: 1 },
  screenReaderMode: { label: 'Screen reader support', group: 'accessibility', fallback: false },

  // --- Terminal appearance -------------------------------------------------
  themeDark: { label: 'Theme for dark mode', group: 'appearance', fallback: 'dark-modern' },
  themeLight: { label: 'Theme for light mode', group: 'appearance', fallback: 'light-modern' },
  themeFollowsApp: { label: "Follow the app's light / dark mode", group: 'appearance', fallback: true },
  // `dockTheme` is an `Option` that supersedes a boolean, so its effective
  // value has to walk the same fallback `lib/terminalTheme.ts › dockThemeMode`
  // walks — otherwise a dock themed through the old boolean reads as untouched.
  // Resetting writes both, exactly as the card does.
  dockTheme: {
    label: 'In the dock, the theme colours',
    group: 'appearance',
    fallback: 'app',
    read: (cfg: TerminalConfigLike) => cfg?.dockTheme ?? (cfg?.dockUsesTerminalTheme ? 'chrome' : undefined),
    reset: () => ({ dockTheme: undefined, dockUsesTerminalTheme: false }),
  },
  cursorStyle: { label: 'Cursor', group: 'appearance', fallback: 'bar' },
  cursorBlink: { label: 'Cursor blink', group: 'appearance', fallback: true },
  cursorInactiveStyle: { label: 'Cursor in an unfocused pane', group: 'appearance', fallback: 'outline' },
  padding: { label: 'Padding', group: 'appearance', fallback: 8 },
  wallpaperOpacity: { label: 'Wallpaper opacity', group: 'appearance', fallback: undefined },
  wallpaperBlur: { label: 'Wallpaper blur', group: 'appearance', fallback: undefined },
  wallpaperFit: { label: 'Wallpaper fit', group: 'appearance', fallback: undefined },
  wallpaperDim: { label: 'Wallpaper dimming', group: 'appearance', fallback: 0 },
  chromeOpacity: { label: 'Title bar & rail opacity', group: 'appearance', fallback: 72 },
  chromeBlur: { label: 'Title bar & rail blur', group: 'appearance', fallback: 20 },
  windowOpacity: { label: 'Window opacity', group: 'appearance', fallback: 100 },
  windowEffect: { label: 'Backdrop effect', group: 'appearance', fallback: 'none' },

  // --- Notifications -------------------------------------------------------
  // `notifyWhen` writes `notifyOnLongCommand` in mirror, as the card does.
  notifyWhen: {
    label: 'Notify me when',
    group: 'notifications',
    fallback: 'failed',
    reset: () => ({ notifyWhen: undefined, notifyOnLongCommand: true }),
  },
  longCommandSeconds: { label: '"Long" starts at', group: 'notifications', fallback: 10 },
  notifyOnlyWhenHidden: { label: 'Only for terminals out of sight', group: 'notifications', fallback: true },
  notifyStyle: { label: 'Show it as', group: 'notifications', fallback: 'both' },
  // The built-in list *is* the default, and the card lets it be edited back
  // to exactly that. Reading a verbatim copy as `undefined` keeps the marker
  // off a list that only looks changed.
  notifyMutedCommands: {
    label: 'Never notify for these commands',
    group: 'notifications',
    fallback: undefined,
    read: (cfg: TerminalConfigLike) =>
      cfg?.notifyMutedCommands && !sameSettingValue(cfg.notifyMutedCommands, DEFAULT_MUTED_COMMANDS)
        ? cfg.notifyMutedCommands
        : undefined,
  },
  bell: { label: 'When a program rings the bell', group: 'notifications', fallback: 'visual' },

  // --- Keys and selection / shortcuts -------------------------------------
  copyOnSelect: { label: 'Copy on select', group: 'keys', fallback: true },
  shiftEnter: { label: 'Shift+Enter sends', group: 'keys', fallback: 'escape-enter' },
  keybindings: { label: 'Terminal shortcuts', group: 'keybindings', fallback: {} },
} satisfies Record<string, SettingMeta>;

export type TerminalSettingKey = keyof typeof TERMINAL_SETTINGS;

/** Fields of `TerminalConfig` that are deliberately not marked. See above. */
export const UNMARKED_TERMINAL_FIELDS = ['notifyOnLongCommand', 'dockUsesTerminalTheme'] as const;

/**
 * Compile-time guard: **every** field of `TerminalConfig` is either marked or
 * listed as deliberately unmarked.
 *
 * This is the check that keeps the next setting honest. Add a field to
 * `TerminalConfig` and forget the table, and `bunx tsc -b` fails right here
 * naming it - rather than the panel silently growing one more control that
 * can never say it was changed, which is the whole complaint ticket #39 came
 * from. `tabDisplay` is excluded because its six sub-fields are marked one by
 * one instead.
 */
type UnmarkedField = (typeof UNMARKED_TERMINAL_FIELDS)[number];
type MarkedField = Extract<TerminalSettingKey, keyof TerminalConfig>;
type UncoveredField = Exclude<keyof TerminalConfig, MarkedField | UnmarkedField | 'tabDisplay'>;
type AssertNoUncoveredField<T extends never> = T;
export type _EverySettingIsAccountedFor = AssertNoUncoveredField<UncoveredField>;

const ALL_KEYS = Object.keys(TERMINAL_SETTINGS) as TerminalSettingKey[];

/** Every setting in a group, in table order. */
export const GROUP_KEYS: Record<GroupId, TerminalSettingKey[]> = (() => {
  const out = {} as Record<GroupId, TerminalSettingKey[]>;
  for (const group of Object.keys(GROUP_CARD) as GroupId[]) out[group] = [];
  for (const key of ALL_KEYS) out[TERMINAL_SETTINGS[key].group].push(key);
  return out;
})();

/** Every setting on a card, in table order. */
export const CARD_KEYS: Record<CardId, TerminalSettingKey[]> = (() => {
  const out = { integrated: [], appearance: [], notifications: [], shortcuts: [], external: [] } as Record<
    CardId,
    TerminalSettingKey[]
  >;
  for (const key of ALL_KEYS) out[GROUP_CARD[TERMINAL_SETTINGS[key].group]].push(key);
  return out;
})();

// ---------------------------------------------------------------------------
// Reading the table
// ---------------------------------------------------------------------------

/** What this setting is worth when nobody has touched it. */
export function settingDefault(key: TerminalSettingKey, cfg?: TerminalConfigLike): SettingValue {
  const meta: SettingMeta = TERMINAL_SETTINGS[key];
  return typeof meta.fallback === 'function' ? meta.fallback(cfg) : meta.fallback;
}

/** What it is worth right now — `undefined` when nothing is stored. */
export function settingValue(cfg: TerminalConfigLike, key: TerminalSettingKey): SettingValue {
  const meta: SettingMeta = TERMINAL_SETTINGS[key];
  if (meta.read) return meta.read(cfg);
  return (cfg as Record<string, SettingValue> | null | undefined)?.[key];
}

/**
 * Is this setting away from its default?
 *
 * Note what this deliberately does *not* ask: whether the key is present in
 * `settings.json`. Sixty-eight of them are, because serde writes every
 * non-`Option` field out — so "is it written down" answers yes for almost
 * everything and means nothing. Only the value counts.
 */
export function isSettingModified(cfg: TerminalConfigLike, key: TerminalSettingKey): boolean {
  if (!cfg) return false;
  const value = settingValue(cfg, key);
  // Nothing stored: the setting *is* its default, whatever that default is.
  // This is the case for every `Option` field serde never wrote, and for the
  // whole config for the frame before `settings.json` has been read.
  if (isAbsent(value)) return false;
  return !sameSettingValue(value, settingDefault(key, cfg));
}

/** Those of `keys` that are away from their default, in table order. */
export function modifiedSettings(cfg: TerminalConfigLike, keys: readonly TerminalSettingKey[]): TerminalSettingKey[] {
  return keys.filter((key) => isSettingModified(cfg, key));
}

/** How many of `keys` are away from their default. */
export function modifiedCount(cfg: TerminalConfigLike, keys: readonly TerminalSettingKey[]): number {
  return modifiedSettings(cfg, keys).length;
}

// ---------------------------------------------------------------------------
// Putting one back
// ---------------------------------------------------------------------------

/**
 * The patch that puts `keys` back to their defaults.
 *
 * Settings already at their default contribute nothing, so the patch is
 * exactly the set of changes — which is what makes the confirmation honest
 * and the undo below exact.
 *
 * A default of `undefined` is written as `undefined` rather than deleted:
 * `JSON.stringify` drops it on the way to `settings.json`, serde fills the
 * field back in on the way out, and every reader already falls back. The
 * nested and mirrored keys (`tabDisplay.*`, `dockTheme`, `notifyWhen`) carry
 * their own `reset` in the table.
 */
export function resetPatch(cfg: TerminalConfigLike, keys: readonly TerminalSettingKey[]): Partial<TerminalConfig> {
  let patch: Partial<TerminalConfig> = {};
  for (const key of modifiedSettings(cfg, keys)) {
    const meta: SettingMeta = TERMINAL_SETTINGS[key];
    const value = settingDefault(key, cfg);
    // `{ ...cfg, ...patch }`: a group reset touching two `tabDisplay`
    // sub-fields must build on the sub-field the previous step just set.
    const step = meta.reset
      ? meta.reset({ ...cfg, ...patch }, value)
      : ({ [key]: value } as Partial<TerminalConfig>);
    patch = { ...patch, ...step };
  }
  return patch;
}

/**
 * The patch that puts back exactly what `keys` hold right now — the undo of
 * `resetPatch`, captured before it is applied.
 */
export function restorePatch(cfg: TerminalConfigLike, keys: readonly TerminalSettingKey[]): Partial<TerminalConfig> {
  let patch: Partial<TerminalConfig> = {};
  for (const key of keys) {
    const meta: SettingMeta = TERMINAL_SETTINGS[key];
    const step = meta.reset
      ? restoreStep(cfg, key, meta)
      : ({ [key]: settingValue(cfg, key) } as Partial<TerminalConfig>);
    patch = { ...patch, ...step };
  }
  return patch;
}

/**
 * Undo for a key with a custom reset: replay the reset's own shape with the
 * current value instead of the default, so the mirrored field
 * (`dockUsesTerminalTheme`, `notifyOnLongCommand`) comes back too.
 */
function restoreStep(cfg: TerminalConfigLike, key: TerminalSettingKey, meta: SettingMeta): Partial<TerminalConfig> {
  const current = settingValue(cfg, key);
  if (key === 'dockTheme') {
    return { dockTheme: current as TerminalConfig['dockTheme'], dockUsesTerminalTheme: cfg?.dockUsesTerminalTheme };
  }
  if (key === 'notifyWhen') {
    return { notifyWhen: cfg?.notifyWhen, notifyOnLongCommand: cfg?.notifyOnLongCommand };
  }
  return meta.reset ? meta.reset(cfg, current) : {};
}

// ---------------------------------------------------------------------------
// Saying what would change
// ---------------------------------------------------------------------------

export interface SettingChange {
  readonly key: TerminalSettingKey;
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

/** A number, a flag or a name as the confirmation should print it. */
export function formatSettingValue(value: SettingValue): string {
  if (value === undefined || value === null || value === '') return 'default';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') return value.toLocaleString('en-US');
  if (Array.isArray(value)) return value.length === 0 ? 'empty' : `${value.length} entries`;
  if (typeof value === 'object') {
    const size = Object.keys(value).length;
    return size === 0 ? 'none' : `${size} changed`;
  }
  return String(value);
}

/** Every change a reset of `keys` would make, named — what the dialog lists. */
export function settingChanges(cfg: TerminalConfigLike, keys: readonly TerminalSettingKey[]): SettingChange[] {
  return modifiedSettings(cfg, keys).map((key) => ({
    key,
    label: TERMINAL_SETTINGS[key].label,
    from: formatSettingValue(settingValue(cfg, key)),
    to: formatSettingValue(settingDefault(key, cfg)),
  }));
}
