/**
 * Keyboard shortcuts of the Terminal window (DEV-13): the list of actions,
 * their Warp-like defaults, and the pure helpers that turn a `KeyboardEvent`
 * or a user-typed combo into one normalised string (`ctrl+shift+d`) so the
 * dispatcher can look it up in a map.
 *
 * The user's overrides live in `settings.terminal.keybindings` as
 * `{ [actionId]: "Ctrl+Shift+D" | "Ctrl+K, Ctrl+Shift+P" | "" }` — an empty
 * string unbinds the action, a missing key keeps the defaults.
 *
 * Normalised combos: modifiers in the order `ctrl`, `alt`, `shift`, `meta`,
 * then the key, all lower-case, joined by `+`. On macOS ⌘ is the primary
 * modifier (Warp maps Ctrl→Cmd there), so it is written `ctrl` and the real
 * Control key becomes `control`.
 */

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export type KeybindingCategory = 'Tabs' | 'Panes' | 'Terminal' | 'Window';

export const KEYBINDING_ACTIONS = [
  // --- Tabs
  { id: 'tab.new', label: 'New terminal', category: 'Tabs', defaults: ['ctrl+shift+t'] },
  { id: 'tab.close', label: 'Close pane (last pane closes the tab)', category: 'Tabs', defaults: ['ctrl+shift+w'] },
  { id: 'tab.next', label: 'Next tab', category: 'Tabs', defaults: ['ctrl+tab'] },
  { id: 'tab.prev', label: 'Previous tab', category: 'Tabs', defaults: ['ctrl+shift+tab'] },
  { id: 'tab.goto1', label: 'Go to tab 1', category: 'Tabs', defaults: ['ctrl+1'] },
  { id: 'tab.goto2', label: 'Go to tab 2', category: 'Tabs', defaults: ['ctrl+2'] },
  { id: 'tab.goto3', label: 'Go to tab 3', category: 'Tabs', defaults: ['ctrl+3'] },
  { id: 'tab.goto4', label: 'Go to tab 4', category: 'Tabs', defaults: ['ctrl+4'] },
  { id: 'tab.goto5', label: 'Go to tab 5', category: 'Tabs', defaults: ['ctrl+5'] },
  { id: 'tab.goto6', label: 'Go to tab 6', category: 'Tabs', defaults: ['ctrl+6'] },
  { id: 'tab.goto7', label: 'Go to tab 7', category: 'Tabs', defaults: ['ctrl+7'] },
  { id: 'tab.goto8', label: 'Go to tab 8', category: 'Tabs', defaults: ['ctrl+8'] },
  { id: 'tab.goto9', label: 'Go to last tab', category: 'Tabs', defaults: ['ctrl+9'] },
  { id: 'tab.rename', label: 'Rename tab', category: 'Tabs', defaults: ['ctrl+shift+r'] },
  { id: 'tab.duplicate', label: 'Duplicate tab', category: 'Tabs', defaults: [] },
  { id: 'tab.reopen', label: 'Reopen closed tab', category: 'Tabs', defaults: ['ctrl+shift+o'] },
  // --- Panes
  { id: 'pane.splitRight', label: 'Split right', category: 'Panes', defaults: ['ctrl+shift+d'] },
  { id: 'pane.splitDown', label: 'Split down', category: 'Panes', defaults: ['ctrl+shift+e'] },
  // Ctrl+Alt+arrow only: a bare Alt+arrow is Option/Alt + arrow for the
  // program under the PTY (word by word in Claude Code, zsh and PSReadLine),
  // and a split pane in that direction used to swallow it.
  { id: 'pane.focusLeft', label: 'Focus pane left', category: 'Panes', defaults: ['ctrl+alt+left'] },
  { id: 'pane.focusRight', label: 'Focus pane right', category: 'Panes', defaults: ['ctrl+alt+right'] },
  { id: 'pane.focusUp', label: 'Focus pane above', category: 'Panes', defaults: ['ctrl+alt+up'] },
  { id: 'pane.focusDown', label: 'Focus pane below', category: 'Panes', defaults: ['ctrl+alt+down'] },
  { id: 'pane.resizeLeft', label: 'Resize pane left', category: 'Panes', defaults: ['ctrl+alt+shift+left'] },
  { id: 'pane.resizeRight', label: 'Resize pane right', category: 'Panes', defaults: ['ctrl+alt+shift+right'] },
  { id: 'pane.resizeUp', label: 'Resize pane up', category: 'Panes', defaults: ['ctrl+alt+shift+up'] },
  { id: 'pane.resizeDown', label: 'Resize pane down', category: 'Panes', defaults: ['ctrl+alt+shift+down'] },
  { id: 'pane.maximize', label: 'Maximize / restore pane', category: 'Panes', defaults: ['ctrl+shift+enter'] },
  // --- Terminal
  { id: 'block.previous', label: 'Previous block', category: 'Terminal', defaults: ['ctrl+up'] },
  { id: 'block.next', label: 'Next block', category: 'Terminal', defaults: ['ctrl+down'] },
  { id: 'terminal.find', label: 'Find in terminal', category: 'Terminal', defaults: ['ctrl+shift+f'] },
  { id: 'terminal.clear', label: 'Clear terminal', category: 'Terminal', defaults: ['ctrl+shift+l'] },
  { id: 'terminal.zoomIn', label: 'Zoom in', category: 'Terminal', defaults: ['ctrl+='] },
  { id: 'terminal.zoomOut', label: 'Zoom out', category: 'Terminal', defaults: ['ctrl+-'] },
  { id: 'terminal.zoomReset', label: 'Reset zoom', category: 'Terminal', defaults: ['ctrl+0'] },
  { id: 'terminal.copyCwd', label: 'Copy working directory', category: 'Terminal', defaults: [] },
  { id: 'terminal.openCwd', label: 'Open working directory in Explorer', category: 'Terminal', defaults: [] },
  // --- Window
  { id: 'window.palette', label: 'Command palette', category: 'Window', defaults: ['ctrl+k', 'ctrl+shift+p'] },
  { id: 'window.rail', label: 'Toggle the sessions rail', category: 'Window', defaults: ['ctrl+b'] },
  { id: 'window.scopeGlobal', label: 'Scope: global', category: 'Window', defaults: [] },
] as const satisfies readonly { id: string; label: string; category: KeybindingCategory; defaults: readonly string[] }[];

export type KeybindingActionId = (typeof KEYBINDING_ACTIONS)[number]['id'];
export type KeybindingAction = (typeof KEYBINDING_ACTIONS)[number];

export const KEYBINDING_CATEGORIES: readonly KeybindingCategory[] = ['Tabs', 'Panes', 'Terminal', 'Window'];

/** User overrides: action id → combo(s) (`"Ctrl+Shift+D"`, `"Ctrl+K, Ctrl+P"`, `""` = none). */
export type KeybindingOverrides = Record<string, string>;

const ACTION_BY_ID = new Map<string, KeybindingAction>(KEYBINDING_ACTIONS.map((a) => [a.id, a]));

export function isKeybindingActionId(id: string): id is KeybindingActionId {
  return ACTION_BY_ID.has(id);
}

export function keybindingAction(id: KeybindingActionId): KeybindingAction {
  return ACTION_BY_ID.get(id)!;
}

// ---------------------------------------------------------------------------
// Combos
// ---------------------------------------------------------------------------

const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta', 'control'] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

const MODIFIER_ALIASES: Record<string, Modifier> = {
  ctrl: 'ctrl',
  ctl: 'ctrl',
  cmd: 'ctrl',
  command: 'ctrl',
  '⌘': 'ctrl',
  mod: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  '⌥': 'alt',
  shift: 'shift',
  '⇧': 'shift',
  meta: 'meta',
  win: 'meta',
  super: 'meta',
  control: 'control',
  '⌃': 'control',
};

const KEY_ALIASES: Record<string, string> = {
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  arrowdown: 'down',
  esc: 'escape',
  return: 'enter',
  '↵': 'enter',
  spacebar: 'space',
  ' ': 'space',
  del: 'delete',
  plus: '=',
  '+': '=',
  minus: '-',
  equal: '=',
  equals: '=',
  pgup: 'pageup',
  pgdn: 'pagedown',
  pgdown: 'pagedown',
};

/** The keys that are modifiers on their own (never a combo by themselves). */
const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'os', 'altgraph']);

function normaliseKeyName(raw: string): string {
  const key = raw.length === 1 ? raw.toLowerCase() : raw.toLowerCase().replace(/\s+/g, '');
  return KEY_ALIASES[key] ?? key;
}

function buildCombo(mods: Set<Modifier>, key: string): string {
  const parts: string[] = [];
  for (const m of MODIFIER_ORDER) if (mods.has(m)) parts.push(m);
  parts.push(key);
  return parts.join('+');
}

/**
 * Parse a user-typed combo (`Ctrl+Shift+D`, `cmd+k`, `Ctrl++`) into its
 * normalised form, or null when there is no key in it.
 */
export function parseCombo(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // `Ctrl++` / `Ctrl+Shift++`: the last `+` is the key, not a separator.
  let body = trimmed;
  let trailingPlus = false;
  if (body.endsWith('+') && body.length > 1) {
    trailingPlus = true;
    body = body.slice(0, -1);
    if (body.endsWith('+')) body = body.slice(0, -1);
  }
  const tokens = body.split('+').map((t) => t.trim()).filter(Boolean);
  if (trailingPlus) tokens.push('+');
  const mods = new Set<Modifier>();
  let key: string | null = null;
  for (const token of tokens) {
    const mod = MODIFIER_ALIASES[token.toLowerCase()];
    if (mod) {
      mods.add(mod);
      continue;
    }
    key = normaliseKeyName(token);
  }
  if (!key || MODIFIER_KEYS.has(key)) return null;
  // `+` needs Shift on most layouts, but it is the same physical intent as `=`.
  if (key === '=') mods.delete('shift');
  return buildCombo(mods, key);
}

/** Split a settings value (`"Ctrl+K, Ctrl+Shift+P"`) into normalised combos. */
export function parseComboList(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(',')) {
    const combo = parseCombo(part);
    if (combo && !out.includes(combo)) out.push(combo);
  }
  return out;
}

/**
 * The normalised combo of a keyboard event, or null for a bare modifier
 * press. Letters, digits and `= - +` come from `e.key` (the user's layout);
 * a shifted digit row (AZERTY `&é"`, US `!@#`) falls back to `e.code` so
 * Ctrl+1 works everywhere.
 */
export function comboFromEvent(e: KeyboardEvent): string | null {
  const rawKey = e.key;
  if (!rawKey) return null;
  const lower = rawKey.toLowerCase();
  if (MODIFIER_KEYS.has(lower) || lower === 'dead' || lower === 'unidentified') return null;

  const mods = new Set<Modifier>();
  if (IS_MAC) {
    if (e.metaKey) mods.add('ctrl');
    if (e.ctrlKey) mods.add('control');
  } else {
    if (e.ctrlKey) mods.add('ctrl');
    if (e.metaKey) mods.add('meta');
  }
  if (e.altKey) mods.add('alt');
  if (e.shiftKey) mods.add('shift');

  let key: string;
  const digitFromCode = /^(?:Digit|Numpad)(\d)$/.exec(e.code)?.[1];
  if (/^\d$/.test(rawKey)) key = rawKey;
  else if (/^[a-z]$/i.test(rawKey)) key = lower;
  else if (rawKey === '=' || rawKey === '+' || rawKey === '-') key = normaliseKeyName(rawKey);
  else if (digitFromCode) key = digitFromCode;
  else if (rawKey.length === 1 && /^Key[A-Z]$/.test(e.code) && (e.altKey || e.ctrlKey || e.metaKey)) {
    // Alt/AltGr turned the letter into a symbol (`ø`, `†`): use the physical key.
    key = e.code.slice(3).toLowerCase();
  } else key = normaliseKeyName(rawKey);

  if (key === '=') mods.delete('shift');
  return buildCombo(mods, key);
}

const KEY_LABELS: Record<string, string> = {
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  enter: IS_MAC ? '↩' : 'Enter',
  tab: 'Tab',
  escape: 'Esc',
  space: 'Space',
  backspace: IS_MAC ? '⌫' : 'Backspace',
  delete: IS_MAC ? '⌦' : 'Del',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  home: 'Home',
  end: 'End',
  '=': '+',
  '-': '−',
};

const MODIFIER_LABELS: Record<Modifier, string> = IS_MAC
  ? { ctrl: '⌘', alt: '⌥', shift: '⇧', meta: '⌘', control: '⌃' }
  : { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win', control: 'Ctrl' };

/** Display tokens of a normalised combo: `ctrl+shift+d` → `['Ctrl', 'Shift', 'D']`. */
export function comboTokens(combo: string): string[] {
  return combo.split('+').map((p) => {
    if ((MODIFIER_ORDER as readonly string[]).includes(p)) return MODIFIER_LABELS[p as Modifier];
    if (KEY_LABELS[p]) return KEY_LABELS[p];
    if (/^f\d{1,2}$/.test(p)) return p.toUpperCase();
    return p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1);
  });
}

/** Human form of a normalised combo: `ctrl+shift+d` → `Ctrl Shift D`. */
export function formatCombo(combo: string): string {
  return comboTokens(combo).join(IS_MAC ? '' : ' ');
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * The combos an action answers to once the overrides are applied: the
 * override when there is one (possibly none at all), else the defaults.
 */
export function effectiveCombos(actionId: KeybindingActionId, overrides?: KeybindingOverrides | null): string[] {
  const override = overrides?.[actionId];
  if (override !== undefined) return parseComboList(override);
  return keybindingAction(actionId).defaults.slice();
}

/** True when the user changed this action's binding (even to "none"). */
export function isOverridden(actionId: KeybindingActionId, overrides?: KeybindingOverrides | null): boolean {
  const override = overrides?.[actionId];
  if (override === undefined) return false;
  const defaults = keybindingAction(actionId).defaults;
  const combos = parseComboList(override);
  return combos.length !== defaults.length || combos.some((c, i) => c !== defaults[i]);
}

/**
 * combo → action id. Overrides take precedence over every default, so
 * binding "Find" to Ctrl+B silently displaces the rail toggle; two overrides
 * on one combo keep the first in registry order (see `conflicts`).
 */
export function resolveKeybindings(overrides?: KeybindingOverrides | null): Map<string, KeybindingActionId> {
  const map = new Map<string, KeybindingActionId>();
  const overridden = KEYBINDING_ACTIONS.filter((a) => overrides?.[a.id] !== undefined);
  const rest = KEYBINDING_ACTIONS.filter((a) => overrides?.[a.id] === undefined);
  for (const action of [...overridden, ...rest]) {
    for (const combo of effectiveCombos(action.id, overrides)) {
      if (!map.has(combo)) map.set(combo, action.id);
    }
  }
  return map;
}

export interface KeybindingConflict {
  combo: string;
  /** Actions sharing the combo, in registry order; the first one wins. */
  actionIds: KeybindingActionId[];
}

/** Every combo claimed by more than one action once the overrides are applied. */
export function conflicts(overrides?: KeybindingOverrides | null): KeybindingConflict[] {
  const claims = new Map<string, KeybindingActionId[]>();
  for (const action of KEYBINDING_ACTIONS) {
    for (const combo of effectiveCombos(action.id, overrides)) {
      const list = claims.get(combo) ?? [];
      list.push(action.id);
      claims.set(combo, list);
    }
  }
  const out: KeybindingConflict[] = [];
  for (const [combo, actionIds] of claims) {
    if (actionIds.length > 1) out.push({ combo, actionIds });
  }
  return out;
}

/** First effective combo of an action, formatted for a hint, or null when unbound. */
export function comboLabelFor(actionId: KeybindingActionId, overrides?: KeybindingOverrides | null): string | null {
  const combos = effectiveCombos(actionId, overrides);
  return combos.length > 0 ? formatCombo(combos[0]) : null;
}
