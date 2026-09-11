/**
 * Tests for the "changed from the default" arithmetic (ticket #39).
 *
 * Same shape as `lib/tabCycle.test.ts`: the module under test is pure, so this
 * runs on plain Node with nothing but type stripping —
 *
 *     bun run test      (node --test "src/**\/*.test.ts")
 *
 * A failure throws at the end of the module, so the exit code carries it.
 *
 * There is a second reason this file exists in this shape, beyond coverage.
 * The feature it tests is a **reset button**, on a settings panel belonging to
 * a real person whose `settings.json` holds sixty-eight hand-tuned keys.
 * Clicking one to see whether it works would destroy the thing it is meant to
 * protect. So the gestures are exercised here, on fixtures, and the app is
 * only ever read.
 *
 * What is pinned down:
 *
 *  1. the contract with Rust — every default serde writes matches the table;
 *  2. the contract with the notification policy, the other module that still
 *     owns defaults of its own;
 *  3. the awkward comparisons: a renderer-dependent default, a deprecated
 *     boolean standing in for an enum, six sub-fields of one object, a list
 *     that equals the built-in list, blank versus absent;
 *  4. that a reset patch contains exactly the changes and nothing else, and
 *     that the undo handed to the toast puts every one of them back.
 */
import {
  CARD_KEYS,
  DEFAULT_FONT_SIZE,
  DEFAULT_INPUT_POSITION,
  DEFAULT_SCROLLBACK_LINES,
  GROUP_KEYS,
  TERMINAL_SETTINGS,
  UNMARKED_TERMINAL_FIELDS,
  formatSettingValue,
  isSettingModified,
  modifiedSettings,
  resetPatch,
  restorePatch,
  settingChanges,
  settingDefault,
  settingValue,
  type TerminalSettingKey,
} from './terminalDefaults.ts';
import { RUST_TERMINAL_DEFAULTS } from './terminalDefaults.rust.ts';
import {
  DEFAULT_LONG_COMMAND_SECONDS,
  DEFAULT_MUTED_COMMANDS,
  DEFAULT_NOTIFY_ONLY_WHEN_HIDDEN,
  DEFAULT_NOTIFY_STYLE,
  DEFAULT_NOTIFY_WHEN,
} from './notificationPolicy.ts';

// --- a test runner in twenty lines ----------------------------------------

const failures: string[] = [];
let passed = 0;

function test(name: string, body: () => void) {
  try {
    body();
    passed++;
  } catch (error) {
    failures.push(`${name}\n    ${error instanceof Error ? error.message : String(error)}`);
  }
}

const assert = {
  ok(value: unknown, note = '') {
    if (!value) throw new Error(`expected truthy${note ? ` (${note})` : ''}`);
  },
  equal(actual: unknown, expected: unknown, note = '') {
    if (!Object.is(actual, expected)) {
      throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}${note ? ` (${note})` : ''}`);
    }
  },
  deepEqual(actual: unknown, expected: unknown, note = '') {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`expected ${b}, got ${a}${note ? ` (${note})` : ''}`);
  },
};

function report() {
  console.log(`terminalDefaults: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  x ${f}`);
    throw new Error(`${failures.length} test(s) failed`);
  }
}

// --- fixtures --------------------------------------------------------------

/** Nothing stored at all: a fresh install before anyone opens the panel. */
const FRESH = {};

/**
 * A settings file shaped like the one this ticket came from: sixty-odd keys
 * written out explicitly, a handful of them actually chosen.
 */
const LIVED_IN = {
  fontFamily: 'Hack NF',
  fontSize: 13,
  lineHeight: 1,
  renderer: 'canvas',
  padding: 10,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollbackLines: 10000,
  inputPosition: 'flow',
  inputEditor: true,
  blockGutter: false,
  blocks: true,
  blockDividers: true,
  dockUsesTerminalTheme: true,
  chromeOpacity: 71,
  chromeBlur: 0,
  wallpaperDim: 14,
  shellIntegration: true,
  copyOnSelect: true,
  bell: 'visual',
  keybindings: {},
  tabDisplay: { cwd: true, command: true, status: true, agent: true, index: 'ctrl', colorBar: false },
} as const;

// --- 1. the contract with Rust --------------------------------------------

test('every default serde writes is the default the panel compares against', () => {
  const snapshot = RUST_TERMINAL_DEFAULTS as Record<string, unknown>;
  const unmarked = new Set<string>(UNMARKED_TERMINAL_FIELDS);
  for (const [key, rust] of Object.entries(snapshot)) {
    if (unmarked.has(key)) continue;
    if (key === 'tabDisplay') {
      for (const [sub, value] of Object.entries(rust as Record<string, unknown>)) {
        const k = `tabDisplay.${sub}` as TerminalSettingKey;
        assert.ok(k in TERMINAL_SETTINGS, `tabDisplay.${sub} is missing from the table`);
        assert.deepEqual(settingDefault(k), value, `tabDisplay.${sub}`);
      }
      continue;
    }
    assert.ok(key in TERMINAL_SETTINGS, `${key} is written by Rust but missing from the table`);
    assert.deepEqual(settingDefault(key as TerminalSettingKey), rust, key);
  }
});

test('the three defaults ticket #39 moved are the ones that moved', () => {
  // If one of these ever reads differently, the Rust test above has already
  // failed too: the snapshot carries the same three numbers.
  assert.equal(DEFAULT_FONT_SIZE, 13);
  assert.equal(DEFAULT_SCROLLBACK_LINES, 25000);
  assert.equal(DEFAULT_INPUT_POSITION, 'bottom');
  assert.equal((RUST_TERMINAL_DEFAULTS as Record<string, unknown>).scrollbackLines, 25000);
  assert.equal((RUST_TERMINAL_DEFAULTS as Record<string, unknown>).inputPosition, 'bottom');
});

test('a settings file from before the change is marked on exactly those three', () => {
  // What the user who filed the ticket will see. `fontSize` is the
  // interesting one: he had already set 13 by hand, so making 13 the default
  // takes the marker *off* it — the value stopped being a deviation.
  assert.equal(isSettingModified(LIVED_IN, 'scrollbackLines'), true, 'scrollbackLines 10000');
  assert.equal(isSettingModified(LIVED_IN, 'inputPosition'), true, 'inputPosition flow');
  assert.equal(isSettingModified(LIVED_IN, 'fontSize'), false, 'fontSize 13 is now the default');
});

// --- 2. the contract with the notification policy -------------------------

test('the notification defaults have one definition, not two', () => {
  assert.equal(settingDefault('notifyWhen'), DEFAULT_NOTIFY_WHEN);
  assert.equal(settingDefault('notifyStyle'), DEFAULT_NOTIFY_STYLE);
  assert.equal(settingDefault('longCommandSeconds'), DEFAULT_LONG_COMMAND_SECONDS);
  assert.equal(settingDefault('notifyOnlyWhenHidden'), DEFAULT_NOTIFY_ONLY_WHEN_HIDDEN);
});

// --- 3. the awkward comparisons -------------------------------------------

test('nothing is marked on a fresh install', () => {
  const everything = Object.keys(TERMINAL_SETTINGS) as TerminalSettingKey[];
  assert.deepEqual(modifiedSettings(FRESH, everything), []);
});

test('nothing is marked while the settings are still loading', () => {
  // The panel renders before `settings.json` is read; a null config must not
  // paint seventy markers for one frame.
  assert.equal(isSettingModified(null, 'padding'), false);
  assert.deepEqual(modifiedSettings(undefined, ['padding', 'fontSize']), []);
});

test('blank, empty and absent are the same value', () => {
  assert.equal(isSettingModified({ fontFamily: '' }, 'fontFamily'), false);
  assert.equal(isSettingModified({ fontFamily: undefined }, 'fontFamily'), false);
  assert.equal(isSettingModified({ customPath: '' }, 'customPath'), false);
  assert.equal(isSettingModified({ fontFamily: 'Hack NF' }, 'fontFamily'), true);
});

test('an array is compared by content, not by identity', () => {
  assert.equal(isSettingModified({ customArgs: [] }, 'customArgs'), false);
  assert.equal(isSettingModified({ customArgs: ['-e'] }, 'customArgs'), true);
});

test("the line-height default follows the renderer, as the terminal does", () => {
  // `dom` needs a line box of exactly 1 or powerline separators show a seam,
  // so 1.0 is the default there and 1.2 everywhere else. A flat 1.2 would put
  // a marker on every browser-renderer user who never touched the field.
  assert.equal(settingDefault('lineHeight', { renderer: 'dom' }), 1);
  assert.equal(settingDefault('lineHeight', { renderer: 'canvas' }), 1.2);
  assert.equal(isSettingModified({ renderer: 'dom', lineHeight: 1 }, 'lineHeight'), false);
  assert.equal(isSettingModified({ renderer: 'canvas', lineHeight: 1 }, 'lineHeight'), true);
});

test('a dock themed through the deprecated boolean is marked', () => {
  // `dockUsesTerminalTheme: true` with no `dockTheme` is what an older
  // settings file holds, and the dock really is themed. Reading only
  // `dockTheme` would call it untouched.
  assert.equal(isSettingModified({ dockUsesTerminalTheme: true }, 'dockTheme'), true);
  assert.equal(settingValue({ dockUsesTerminalTheme: true }, 'dockTheme'), 'chrome');
  assert.equal(isSettingModified({ dockUsesTerminalTheme: false }, 'dockTheme'), false);
  assert.equal(isSettingModified({ dockTheme: 'app' }, 'dockTheme'), false);
  assert.equal(isSettingModified({ dockTheme: 'canvas' }, 'dockTheme'), true);
});

test('resetting the dock theme clears the mirror as well', () => {
  const patch = resetPatch({ dockTheme: 'canvas', dockUsesTerminalTheme: true }, ['dockTheme']);
  assert.deepEqual(patch, { dockTheme: undefined, dockUsesTerminalTheme: false });
});

test('resetting "notify me when" keeps its legacy mirror in step', () => {
  const patch = resetPatch({ notifyWhen: 'never', notifyOnLongCommand: false }, ['notifyWhen']);
  assert.deepEqual(patch, { notifyWhen: undefined, notifyOnLongCommand: true });
});

test('the muted list is only marked when it is really not the built-in one', () => {
  assert.equal(isSettingModified({ notifyMutedCommands: [...DEFAULT_MUTED_COMMANDS] }, 'notifyMutedCommands'), false);
  assert.equal(isSettingModified({ notifyMutedCommands: ['claude'] }, 'notifyMutedCommands'), true);
  assert.equal(isSettingModified({ notifyMutedCommands: [] }, 'notifyMutedCommands'), true);
});

test('each part of a tab is its own setting', () => {
  const cfg = { tabDisplay: { cwd: false, colorBar: true } };
  assert.equal(isSettingModified(cfg, 'tabDisplay.cwd'), true);
  assert.equal(isSettingModified(cfg, 'tabDisplay.colorBar'), true);
  assert.equal(isSettingModified(cfg, 'tabDisplay.status'), false, 'absent = the default');
  assert.equal(isSettingModified(cfg, 'tabDisplay.index'), false);
});

test('resetting two parts of a tab at once keeps both', () => {
  // The trap: each `tabDisplay` reset rebuilds the whole object, so a second
  // one built from the untouched config would undo the first.
  const cfg = { tabDisplay: { cwd: false, command: false, agent: true, index: 'always' as const } };
  const patch = resetPatch(cfg, ['tabDisplay.cwd', 'tabDisplay.command', 'tabDisplay.index']);
  assert.deepEqual(patch, { tabDisplay: { cwd: true, command: true, agent: true, index: 'ctrl' } });
});

// --- 4. what a reset does, and what undoes it ------------------------------

test('a reset patch carries the changes and nothing else', () => {
  const keys = GROUP_KEYS.blocks;
  const patch = resetPatch(LIVED_IN, keys);
  // `blockGutter: false` is the only block setting he changed.
  assert.deepEqual(patch, { blockGutter: true });
});

test('a group with nothing changed produces an empty patch', () => {
  assert.deepEqual(resetPatch(FRESH, GROUP_KEYS.text), {});
  assert.deepEqual(settingChanges(FRESH, GROUP_KEYS.text), []);
});

test('the undo handed to the toast puts every value back', () => {
  const keys = Object.keys(TERMINAL_SETTINGS) as TerminalSettingKey[];
  const changed = modifiedSettings(LIVED_IN, keys);
  assert.ok(changed.length > 5, `expected a lived-in config to be marked, got ${changed.length}`);

  const undo = restorePatch(LIVED_IN, changed);
  const afterReset = { ...LIVED_IN, ...resetPatch(LIVED_IN, changed) };
  assert.deepEqual(modifiedSettings(afterReset, keys), [], 'the reset must leave nothing marked');

  const afterUndo = { ...afterReset, ...undo };
  for (const key of changed) {
    assert.deepEqual(settingValue(afterUndo, key), settingValue(LIVED_IN, key), key);
  }
});

test('the confirmation names each change, old value and new', () => {
  const changes = settingChanges(LIVED_IN, ['scrollbackLines', 'inputPosition', 'blockGutter']);
  assert.deepEqual(
    changes.map((c) => `${c.label}: ${c.from} -> ${c.to}`),
    ['Scrollback: 10,000 -> 25,000', 'Input line position: flow -> bottom', 'Block gutter: off -> on']
  );
});

test('a value is printed the way the confirmation needs to read', () => {
  assert.equal(formatSettingValue(undefined), 'default');
  assert.equal(formatSettingValue(''), 'default');
  assert.equal(formatSettingValue(true), 'on');
  assert.equal(formatSettingValue(false), 'off');
  assert.equal(formatSettingValue(25000), '25,000');
  assert.equal(formatSettingValue('bottom'), 'bottom');
  assert.equal(formatSettingValue([]), 'empty');
  assert.equal(formatSettingValue(['-e', 'bash']), '2 entries');
  assert.equal(formatSettingValue({}), 'none');
  assert.equal(formatSettingValue({ 'split.right': 'Ctrl+D' }), '1 changed');
});

// --- 5. the panel's own bookkeeping ---------------------------------------

test('every setting belongs to exactly one group and one card', () => {
  const all = Object.keys(TERMINAL_SETTINGS) as TerminalSettingKey[];
  const grouped = Object.values(GROUP_KEYS).flat();
  const carded = Object.values(CARD_KEYS).flat();
  assert.equal(grouped.length, all.length, 'a setting is in no group, or in two');
  assert.equal(carded.length, all.length, 'a setting is on no card, or on two');
  assert.deepEqual([...grouped].sort(), [...all].sort());
  assert.deepEqual([...carded].sort(), [...all].sort());
});

test('a card counts every group under it', () => {
  // The count in a card header must be the sum of its groups', or the two
  // numbers on screen disagree.
  const integratedGroups: (keyof typeof GROUP_KEYS)[] = [
    'shell',
    'text',
    'blocks',
    'completion',
    'keyboard',
    'scrolling',
    'links',
    'tabs',
    'sessions',
    'accessibility',
  ];
  const fromGroups = integratedGroups.flatMap((g) => GROUP_KEYS[g]);
  assert.deepEqual([...CARD_KEYS.integrated].sort(), [...fromGroups].sort());
});

report();
