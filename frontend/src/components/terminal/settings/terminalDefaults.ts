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
 * There were two answers before ticket #39, and they could drift:
 *
 * - **Rust** — `TerminalConfig`'s `impl Default` and its `#[serde(default =
 *   …)]`. This is the one that reaches the disk: for a field that is not an
 *   `Option`, serde fills the default in and it is written to
 *   `settings.json`, whether the user ever looked at it or not.
 * - **TypeScript** — the `?? 13`, `?? true`, `?? 'canvas'` scattered across
 *   the readers. This is the one that reaches the terminal for a field that
 *   *is* an `Option`: Rust writes nothing, so the fallback in the component
 *   is the effective value.
 *
 * Neither one alone is the default a user experiences. The default that
 * matters is the **effective** one: Rust's value where Rust writes one, the
 * TS fallback where Rust writes nothing. So the two halves are split along
 * exactly that line, and each is asked of whoever actually knows it:
 *
 * - **The backend answers for everything serde writes.** At startup the app
 *   store calls the `terminal_default_settings` command — which is literally
 *   `TerminalConfig::default()` — and hands the object to
 *   [`setRustTerminalDefaults`]. Those settings carry [`FROM_RUST`] in the
 *   table below instead of a value, so there is nothing here to keep in step:
 *   change a default in `models.rs` and the markers follow, with no snapshot
 *   to regenerate. (There used to be one, `terminalDefaults.rust.ts`, pasted
 *   in by hand when a Rust test complained. It is gone, and so is the test.)
 * - **This file answers for the `Option` fields**, the seventeen serde skips
 *   entirely. Asking the backend for those would get `fontSize: null` while a
 *   terminal opens at 13 — Rust's own doc comment there still says 12, which
 *   is precisely the drift a null would hide. `None` carries no value, so the
 *   value has to live on the side that supplies it.
 *
 * The boundary between the two is not a promise either: [`checkTerminalDefaults`]
 * runs over the backend's answer at startup and complains, by name, about a
 * setting this table claims that serde does not write, a setting serde writes
 * that this table also carries a fallback for, a field the backend has that no
 * setting here covers, and a reader fallback elsewhere in the frontend that no
 * longer agrees with Rust. It is the snapshot test's job, done against the
 * running backend rather than against a pasted file.
 *
 * ## Nothing here touches a store, the DOM or Tauri
 *
 * Every function takes the config it is asked about, and the backend's
 * defaults are *pushed in* rather than fetched. That is what lets
 * `terminalDefaults.test.ts` run under plain Node, and it is why the reset
 * gestures can be unit-tested without clicking anything in the user's own
 * settings.
 */
import type { TerminalConfig, TerminalTabDisplay } from '@/types';
import {
  DEFAULT_LONG_COMMAND_SECONDS,
  DEFAULT_MUTED_COMMANDS,
  DEFAULT_NOTIFY_ONLY_WHEN_HIDDEN,
} from './notificationPolicy.ts';

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
// The half of the defaults the backend owns
// ---------------------------------------------------------------------------

/**
 * "Whatever `TerminalConfig::default()` says" — the `fallback` of every
 * setting serde writes out.
 *
 * A symbol rather than a string so it cannot collide with a real default, and
 * so `tsc` refuses to let one be used as a value by accident.
 */
export const FROM_RUST = Symbol('TerminalConfig::default()');

/**
 * The backend's answer, once it has given one. `null` until then.
 *
 * Module-level state in a file that is otherwise pure, on purpose: it is
 * written exactly once, from the app store, and a test can set it to a fixture
 * in one line. The alternative — threading the defaults through every
 * `settingDefault` call — would reach into `SettingMark`, `ResetSetting`,
 * `ResetScope` and four section components for no gain.
 */
let rustDefaults: Record<string, SettingValue> | null = null;

/** Has the backend answered yet? Nothing is marked before it has. */
export function rustTerminalDefaultsLoaded(): boolean {
  return rustDefaults !== null;
}

/** `rustDefaults` at `key`, walking one dot (`tabDisplay.cwd`). */
function rustDefault(key: string): SettingValue {
  if (!rustDefaults) return undefined;
  const dot = key.indexOf('.');
  if (dot < 0) return rustDefaults[key];
  const parent = rustDefaults[key.slice(0, dot)] as Record<string, SettingValue> | undefined;
  return parent?.[key.slice(dot + 1)];
}

/**
 * Reader fallbacks elsewhere in the frontend that stand in for a default Rust
 * owns — `cfg.scrollbackLines ?? DEFAULT_SCROLLBACK_LINES` and friends.
 *
 * They cannot come from the backend: the modules that use them want a number
 * at import time, before any command has been sent, and what they are for is
 * the frame before `settings.json` has been read. But they are still second
 * copies of a Rust number, which is the thing this file exists to stop, so
 * [`checkTerminalDefaults`] holds them against the real one.
 *
 * Only constants declared in this file or in `notificationPolicy.ts` are
 * listed: the rest live in `lib/terminalSessions.ts`, which imports *from*
 * here, and naming them would close an import cycle.
 *
 * A function rather than a `const` because two of the four are declared
 * further down this very file.
 */
function mirroredReaderDefaults(): Record<string, SettingValue> {
  return {
    scrollbackLines: DEFAULT_SCROLLBACK_LINES,
    inputPosition: DEFAULT_INPUT_POSITION,
    longCommandSeconds: DEFAULT_LONG_COMMAND_SECONDS,
    notifyOnlyWhenHidden: DEFAULT_NOTIFY_ONLY_WHEN_HIDDEN,
  };
}

/**
 * Take the backend's `TerminalConfig::default()` and return what is wrong with
 * the split between it and this table — an empty array when nothing is.
 *
 * This is what the deleted snapshot test used to buy, checked against the
 * process that actually writes `settings.json` instead of against a JSON
 * literal somebody had to remember to repaste. The app store logs whatever
 * comes back.
 */
export function checkTerminalDefaults(payload: Readonly<Record<string, unknown>>): string[] {
  const problems: string[] = [];
  const written = new Set<string>();
  for (const [key, value] of Object.entries(payload)) {
    // `tabDisplay` is one serde field and six settings here.
    if (key === 'tabDisplay' && value && typeof value === 'object') {
      for (const sub of Object.keys(value as object)) written.add(`tabDisplay.${sub}`);
    } else {
      written.add(key);
    }
  }

  for (const key of ALL_KEYS) {
    const ownedByRust = TERMINAL_SETTINGS[key].fallback === FROM_RUST;
    if (ownedByRust && !written.has(key)) {
      problems.push(`${key}: marked FROM_RUST, but TerminalConfig::default() writes no such field`);
    } else if (!ownedByRust && written.has(key)) {
      problems.push(`${key}: has a fallback here *and* is written by serde — two defaults that can disagree`);
    }
  }

  const unmarked = new Set<string>(UNMARKED_TERMINAL_FIELDS);
  for (const key of written) {
    if (!unmarked.has(key) && !(key in TERMINAL_SETTINGS)) {
      problems.push(`${key}: written by the backend, but no setting in this table claims it`);
    }
  }

  for (const [key, mirror] of Object.entries(mirroredReaderDefaults())) {
    const value = payload[key] as SettingValue;
    if (!sameSettingValue(value, mirror)) {
      problems.push(
        `${key}: the backend says ${JSON.stringify(value)}, the frontend's reader fallback still says ${JSON.stringify(mirror)}`
      );
    }
  }

  return problems;
}

/**
 * Publish the backend's defaults, and return [`checkTerminalDefaults`]'s
 * verdict on them.
 *
 * Pass `null` to go back to "not answered yet", which is what a test does when
 * it wants to see the panel before the command lands.
 */
export function setRustTerminalDefaults(payload: Readonly<Record<string, unknown>> | null): string[] {
  if (!payload) {
    rustDefaults = null;
    return [];
  }
  rustDefaults = payload as Record<string, SettingValue>;
  return checkTerminalDefaults(payload);
}

// ---------------------------------------------------------------------------
// The three defaults ticket #39 moved, as typed constants
// ---------------------------------------------------------------------------
//
// Named separately from the table below because the modules that *apply* them
// want a number, not a `SettingValue` union, at import time — before any
// command has been answered. `lib/terminalSessions.ts` and
// `lib/terminalInputPosition.ts` re-export them rather than carrying a second
// literal.
//
// Only `DEFAULT_FONT_SIZE` is still a default in the table's sense: `font_size`
// is an `Option`, so this file really is the only place that value exists. The
// other two belong to Rust and the table takes them from `FROM_RUST`; the
// literals here are the "nothing loaded yet" fallback of the readers, and
// `checkTerminalDefaults` shouts if they stop agreeing with the backend.

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
  /**
   * The effective default: [`FROM_RUST`] when serde writes the field and the
   * backend is the one that knows, or — for an `Option` field, which serde
   * skips — a value, or a function of the rest of the config.
   */
  readonly fallback: SettingValue | typeof FROM_RUST | ((cfg: TerminalConfigLike) => SettingValue);
  /** Effective stored value. Defaults to `cfg[key]`. */
  readonly read?: (cfg: TerminalConfigLike) => SettingValue;
  /** Patch that puts it back. Defaults to `{ [key]: <the default> }`. */
  readonly reset?: (cfg: TerminalConfigLike, fallback: SettingValue) => Partial<TerminalConfig>;
}

/**
 * A `tabDisplay` sub-field, addressed as its own setting.
 *
 * `tab_display` is one serde field holding a struct with no `Option` in it, so
 * all six defaults come from the backend: the table key `tabDisplay.cwd` is
 * also the path `rustDefault` walks into the answer.
 */
function tabDisplayMeta(sub: keyof TerminalTabDisplay, label: string): SettingMeta {
  return {
    label,
    group: 'tabs',
    fallback: FROM_RUST,
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
  preset: { label: 'Terminal application', group: 'external', fallback: FROM_RUST },
  customPath: { label: 'Custom terminal path', group: 'external', fallback: FROM_RUST },
  customArgs: { label: 'Custom arguments', group: 'external', fallback: FROM_RUST },

  // --- Shell ---------------------------------------------------------------
  integratedShell: { label: 'Shell', group: 'shell', fallback: undefined },
  shellIntegration: { label: 'Shell integration', group: 'shell', fallback: FROM_RUST },

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
  renderer: { label: 'Renderer', group: 'text', fallback: FROM_RUST },
  ligatures: { label: 'Font ligatures', group: 'text', fallback: FROM_RUST },

  // --- Command blocks ------------------------------------------------------
  blocks: { label: 'Command blocks', group: 'blocks', fallback: FROM_RUST },
  blockSpacing: { label: 'Block spacing', group: 'blocks', fallback: FROM_RUST },
  blockDividers: { label: 'Block dividers', group: 'blocks', fallback: FROM_RUST },
  blockActions: { label: 'Block actions on hover', group: 'blocks', fallback: FROM_RUST },
  blockGutter: { label: 'Block gutter', group: 'blocks', fallback: FROM_RUST },
  blockFailedWash: { label: 'Tint failed blocks', group: 'blocks', fallback: FROM_RUST },
  blockCards: { label: 'Block cards', group: 'blocks', fallback: FROM_RUST },
  blockStickyHeader: { label: 'Pin the command while scrolling', group: 'blocks', fallback: FROM_RUST },
  blockJumpToBottom: { label: 'Jump to the end of a block', group: 'blocks', fallback: FROM_RUST },

  // --- Suggestions and completion -----------------------------------------
  inlineSuggestions: { label: 'Inline suggestions', group: 'completion', fallback: FROM_RUST },
  suggestionsFromOutput: { label: 'Suggest from the last output', group: 'completion', fallback: FROM_RUST },
  suggestionConfidence: { label: 'Suggest only when sure', group: 'completion', fallback: FROM_RUST },
  completionMenu: { label: 'Completion menu', group: 'completion', fallback: FROM_RUST },
  completionSpecs: { label: "Learn a command's flags", group: 'completion', fallback: FROM_RUST },
  completionContext: { label: 'Complete from the directory', group: 'completion', fallback: FROM_RUST },

  // --- Keyboard and input --------------------------------------------------
  macOptionAsMeta: { label: 'Option as the Meta key', group: 'keyboard', fallback: FROM_RUST },
  inputPosition: { label: 'Input line position', group: 'keyboard', fallback: FROM_RUST },
  inputEditor: { label: 'Universal input editor', group: 'keyboard', fallback: FROM_RUST },
  inputEditorHandoff: { label: 'Hand unknown keys back to the shell', group: 'keyboard', fallback: FROM_RUST },

  // --- Scrolling and scrollback -------------------------------------------
  scrollbackLines: { label: 'Scrollback', group: 'scrolling', fallback: FROM_RUST },
  historyMaxMb: { label: 'Command history size cap', group: 'scrolling', fallback: FROM_RUST },
  redactSecrets: { label: 'Mask secrets in the command history', group: 'scrolling', fallback: FROM_RUST },
  smoothScrollDuration: { label: 'Smooth scrolling', group: 'scrolling', fallback: FROM_RUST },

  // --- Links, images and clipboard ----------------------------------------
  filePathLinks: { label: 'Clickable file paths', group: 'links', fallback: FROM_RUST },
  linkTooltip: { label: "Show a link's target on hover", group: 'links', fallback: FROM_RUST },
  kittyGraphics: { label: 'Kitty graphics', group: 'links', fallback: FROM_RUST },
  osc52: { label: 'Clipboard access from programs', group: 'links', fallback: FROM_RUST },

  // --- Tabs and windows ----------------------------------------------------
  tabsPlacement: { label: 'Terminal window tabs', group: 'tabs', fallback: FROM_RUST },
  ctrlTabBehavior: { label: 'Ctrl+Tab goes to', group: 'tabs', fallback: FROM_RUST },
  'tabDisplay.cwd': tabDisplayMeta('cwd', 'Tab shows the directory'),
  'tabDisplay.command': tabDisplayMeta('command', 'Tab shows the running command'),
  'tabDisplay.status': tabDisplayMeta('status', 'Tab shows the status'),
  'tabDisplay.agent': tabDisplayMeta('agent', 'Tab shows the agent'),
  'tabDisplay.colorBar': tabDisplayMeta('colorBar', 'Tab shows a colour bar'),
  'tabDisplay.index': tabDisplayMeta('index', 'Tab number'),
  openProcessesIn: { label: 'Services and scripts open in', group: 'tabs', fallback: FROM_RUST },
  openDevSessionsIn: { label: 'Dev sessions open in', group: 'tabs', fallback: FROM_RUST },

  // --- Sessions ------------------------------------------------------------
  confirmCloseRunning: { label: 'Ask before closing a busy terminal', group: 'sessions', fallback: FROM_RUST },
  restoreSessions: { label: 'Restore sessions on start', group: 'sessions', fallback: FROM_RUST },
  restoreScrollback: { label: 'Restore scrollback', group: 'sessions', fallback: FROM_RUST },
  restoreScrollbackLines: { label: 'Lines replayed on start', group: 'sessions', fallback: FROM_RUST },

  // --- Accessibility -------------------------------------------------------
  minimumContrastRatio: { label: 'Minimum text contrast', group: 'accessibility', fallback: FROM_RUST },
  screenReaderMode: { label: 'Screen reader support', group: 'accessibility', fallback: FROM_RUST },

  // --- Terminal appearance -------------------------------------------------
  themeDark: { label: 'Theme for dark mode', group: 'appearance', fallback: 'dark-modern' },
  themeLight: { label: 'Theme for light mode', group: 'appearance', fallback: 'light-modern' },
  themeFollowsApp: { label: "Follow the app's light / dark mode", group: 'appearance', fallback: FROM_RUST },
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
  cursorStyle: { label: 'Cursor', group: 'appearance', fallback: FROM_RUST },
  cursorBlink: { label: 'Cursor blink', group: 'appearance', fallback: FROM_RUST },
  cursorInactiveStyle: { label: 'Cursor in an unfocused pane', group: 'appearance', fallback: FROM_RUST },
  padding: { label: 'Padding', group: 'appearance', fallback: FROM_RUST },
  wallpaperOpacity: { label: 'Wallpaper opacity', group: 'appearance', fallback: undefined },
  wallpaperBlur: { label: 'Wallpaper blur', group: 'appearance', fallback: undefined },
  wallpaperFit: { label: 'Wallpaper fit', group: 'appearance', fallback: undefined },
  wallpaperDim: { label: 'Wallpaper dimming', group: 'appearance', fallback: FROM_RUST },
  chromeOpacity: { label: 'Title bar & rail opacity', group: 'appearance', fallback: FROM_RUST },
  chromeBlur: { label: 'Title bar & rail blur', group: 'appearance', fallback: FROM_RUST },
  windowOpacity: { label: 'Window opacity', group: 'appearance', fallback: FROM_RUST },
  windowEffect: { label: 'Backdrop effect', group: 'appearance', fallback: FROM_RUST },

  // --- Notifications -------------------------------------------------------
  // `notifyWhen` writes `notifyOnLongCommand` in mirror, as the card does.
  notifyWhen: {
    label: 'Notify me when',
    group: 'notifications',
    fallback: 'failed',
    reset: () => ({ notifyWhen: undefined, notifyOnLongCommand: true }),
  },
  longCommandSeconds: { label: '"Long" starts at', group: 'notifications', fallback: FROM_RUST },
  notifyOnlyWhenHidden: { label: 'Only for terminals out of sight', group: 'notifications', fallback: FROM_RUST },
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
  bell: { label: 'When a program rings the bell', group: 'notifications', fallback: FROM_RUST },

  // --- Keys and selection / shortcuts -------------------------------------
  copyOnSelect: { label: 'Copy on select', group: 'keys', fallback: FROM_RUST },
  shiftEnter: { label: 'Shift+Enter sends', group: 'keys', fallback: FROM_RUST },
  keybindings: { label: 'Terminal shortcuts', group: 'keybindings', fallback: FROM_RUST },
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

/**
 * What this setting is worth when nobody has touched it.
 *
 * For a [`FROM_RUST`] setting before the backend has answered there is no
 * honest answer, and this returns `undefined` — which reads as "nothing
 * stored". Callers must gate on [`isSettingModified`], which knows the
 * difference; every caller in the panel already does.
 */
export function settingDefault(key: TerminalSettingKey, cfg?: TerminalConfigLike): SettingValue {
  const meta: SettingMeta = TERMINAL_SETTINGS[key];
  if (meta.fallback === FROM_RUST) return rustDefault(key);
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
 *
 * And it answers **no** for a [`FROM_RUST`] setting until the backend has
 * said what its default is. That window is short — the app store fetches the
 * defaults in the same `Promise.all` as `settings.json`, so the panel has both
 * or neither — but "I do not know" must not come out as "changed": a marker
 * that appears a frame late is invisible, one that appears on a value nobody
 * touched is a lie, and a group reset built on it would overwrite real
 * settings with `undefined`.
 */
export function isSettingModified(cfg: TerminalConfigLike, key: TerminalSettingKey): boolean {
  if (!cfg) return false;
  if (TERMINAL_SETTINGS[key].fallback === FROM_RUST && rustDefaults === null) return false;
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
