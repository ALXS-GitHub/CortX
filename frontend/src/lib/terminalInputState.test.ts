/**
 * Tests for the universal input editor's state machine (ticket #15, U1).
 *
 * The machine is pure, so this runs on plain Node — no bundler, no jsdom, and
 * nothing to add to `package.json`:
 *
 *     node src/lib/terminalInputState.test.ts
 *
 * (Node >= 22.18 strips the types by itself.) It deliberately imports nothing
 * but the module under test: `node:test` would need the Node type definitions,
 * which `tsconfig.app.json` does not load for the app sources. A failure
 * throws, so the process exit code says whether the suite passed.
 *
 * What is pinned down here is exactly what §5 of `plans/universal_input.md`
 * says must never regress: the activation contract, the two Ctrl+D behaviours,
 * closing on submission and not on `133;C`, and the hand-off.
 */
import {
  ERASE_BYTE,
  ESC_CR_SEQUENCE,
  TerminalInputMachine,
  controlByte,
  wordEnd,
  wordStart,
  type InputAction,
  type KeyDescriptor,
} from './terminalInputState.ts';

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

/** Run at the very end of the module: throws when anything failed. */
function report() {
  console.log(`terminalInputState: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  x ${f}`);
    throw new Error(`${failures.length} test(s) failed`);
  }
}

const ANCHOR = { canActivate: true, anchor: { y: 5, x: 12 } };
const BLOCKED = { canActivate: false, anchor: { y: 5, x: 12 } };

function key(k: string, mods: Partial<KeyDescriptor> = {}): KeyDescriptor {
  return { key: k, ctrl: false, alt: false, shift: false, meta: false, ...mods };
}

/** A machine sitting at a prompt with `text` typed into it. */
function editing(text = ''): TerminalInputMachine {
  const m = new TerminalInputMachine();
  m.marker('B', ANCHOR);
  if (text) m.setText(text, text.length);
  return m;
}

function type(m: TerminalInputMachine, k: string, mods: Partial<KeyDescriptor> = {}): InputAction {
  return m.key(key(k, mods));
}

// ---------------------------------------------------------------------------
// Activation contract (§3.a) — the fail-safe property
// ---------------------------------------------------------------------------

test('starts classic and stays classic without a prompt marker', () => {
  const m = new TerminalInputMachine();
  assert.equal(m.phase, 'classic');
  assert.equal(m.isEditing, false);
  // No shell integration → no marker ever → no editor, forever.
  assert.deepEqual(type(m, 'a'), { type: 'none' });
  assert.deepEqual(type(m, 'Enter'), { type: 'none' });
  assert.deepEqual(type(m, 'd', { ctrl: true }), { type: 'none' });
});

test('133;B opens the editor and records the anchor', () => {
  const m = new TerminalInputMachine();
  m.marker('B', ANCHOR);
  assert.equal(m.phase, 'editing');
  assert.deepEqual(m.anchor, { y: 5, x: 12 });
});

test('133;B does not open the editor when the caller refuses (ssh, TUI, setting off)', () => {
  const m = new TerminalInputMachine();
  m.marker('B', BLOCKED);
  assert.equal(m.phase, 'classic');
  // The marker was still seen: integration exists, we simply may not show.
  assert.equal(m.integrationSeen, true);
});

test('a second 133;B while editing only re-anchors, it never wipes the line', () => {
  const m = editing('git comm');
  m.marker('B', { canActivate: true, anchor: { y: 9, x: 3 } });
  assert.equal(m.text, 'git comm');
  assert.deepEqual(m.anchor, { y: 9, x: 3 });
});

test('133;A parks the line as a draft and the next 133;B restores it', () => {
  const m = editing('npm run de');
  m.marker('A', ANCHOR);
  assert.equal(m.phase, 'classic');
  assert.equal(m.text, '');
  assert.equal(m.draft, 'npm run de');
  m.marker('B', ANCHOR);
  assert.equal(m.phase, 'editing');
  assert.equal(m.text, 'npm run de');
  assert.equal(m.caret, 'npm run de'.length);
});

test('a 133;B that may not activate throws the draft away', () => {
  const m = editing('half a line');
  m.marker('A', ANCHOR);
  m.marker('B', BLOCKED);
  assert.equal(m.phase, 'classic');
  assert.equal(m.draft, null);
});

test('the alternate buffer (vim, htop) closes the editor and keeps no draft', () => {
  const m = editing('vim');
  m.bufferChanged('alternate');
  assert.equal(m.phase, 'classic');
  assert.equal(m.draft, null);
  // Back to the main buffer alone changes nothing: we wait for a real prompt.
  m.bufferChanged('normal');
  assert.equal(m.phase, 'classic');
  m.marker('B', ANCHOR);
  assert.equal(m.phase, 'editing');
});

test('133;C and 133;D are a safety net, never the normal way out', () => {
  for (const marker of ['C', 'D']) {
    const m = editing('something');
    m.marker(marker, ANCHOR);
    assert.equal(m.phase, 'classic', marker);
    assert.equal(m.draft, null, marker);
  }
});

// ---------------------------------------------------------------------------
// Submission — we close here, not on 133;C (§3.a.1)
// ---------------------------------------------------------------------------

test('Enter submits text + CR and leaves the editor immediately', () => {
  const m = editing('ls -la');
  const action = type(m, 'Enter');
  assert.deepEqual(action, { type: 'submit', data: 'ls -la\r', text: 'ls -la' });
  // Immediately: a program reading stdin right away must not see our editor.
  assert.equal(m.phase, 'classic');
  assert.equal(m.text, '');
});

test('an empty Enter still submits (a bare CR redraws the prompt)', () => {
  const m = editing();
  assert.deepEqual(type(m, 'Enter'), { type: 'submit', data: '\r', text: '' });
});

test('a missing 133;C (PSReadLine 2.0 / no PSReadLine) changes nothing', () => {
  const m = editing('echo hi');
  type(m, 'Enter');
  // No C ever arrives; D closes the command. We are already classic.
  m.marker('D', ANCHOR);
  assert.equal(m.phase, 'classic');
  m.marker('A', ANCHOR);
  m.marker('B', ANCHOR);
  assert.equal(m.phase, 'editing');
  assert.equal(m.text, '');
});

test('Shift+Enter hands the line over with the ESC+CR of today', () => {
  const m = editing('claude');
  assert.deepEqual(type(m, 'Enter', { shift: true }), {
    type: 'handoff',
    flush: 'claude',
    data: ESC_CR_SEQUENCE,
  });
  assert.equal(m.phase, 'classic');
});

// ---------------------------------------------------------------------------
// Ctrl+D — the trap the plan singled out (§3.c)
// ---------------------------------------------------------------------------

test('Ctrl+D on an empty editor sends EOT to the PTY', () => {
  const m = editing();
  assert.deepEqual(type(m, 'd', { ctrl: true }), { type: 'write', data: '\x04' });
  // Still editing: the shell decides whether it exits.
  assert.equal(m.phase, 'editing');
});

test('Ctrl+D with text deletes forward and NEVER reaches the PTY', () => {
  const m = editing('exit');
  m.setText('exit', 1);
  const action = type(m, 'd', { ctrl: true });
  assert.deepEqual(action, { type: 'edit' });
  assert.equal(m.text, 'eit');
  assert.equal(m.caret, 1);
});

test('Ctrl+D with the caret at the end of a non-empty line is a no-op, not an EOF', () => {
  const m = editing('exit');
  const action = type(m, 'd', { ctrl: true });
  assert.deepEqual(action, { type: 'edit' });
  assert.equal(m.text, 'exit');
});

// ---------------------------------------------------------------------------
// Keys that must always traverse (§3.c)
// ---------------------------------------------------------------------------

test('Ctrl+C always reaches the PTY and empties the editor', () => {
  const m = editing('rm -rf /');
  assert.deepEqual(type(m, 'c', { ctrl: true }), { type: 'write', data: '\x03' });
  assert.equal(m.text, '');
  assert.equal(m.draft, null);
  // The shell prints ^C and redraws: A then B, and we come back empty.
  m.marker('A', ANCHOR);
  m.marker('B', ANCHOR);
  assert.equal(m.text, '');
});

test('Ctrl+L clears the screen but keeps the line we are writing', () => {
  const m = editing('cargo b');
  assert.deepEqual(type(m, 'l', { ctrl: true }), { type: 'write', data: '\x0c' });
  assert.equal(m.text, 'cargo b');
  // The shell redraws its prompt: A parks the draft, B brings it back.
  m.marker('A', ANCHOR);
  m.marker('B', { canActivate: true, anchor: { y: 0, x: 12 } });
  assert.equal(m.text, 'cargo b');
  assert.deepEqual(m.anchor, { y: 0, x: 12 });
});

test('Ctrl+Z is always forwarded', () => {
  assert.deepEqual(type(editing('x'), 'z', { ctrl: true }), { type: 'write', data: '\x1a' });
});

// ---------------------------------------------------------------------------
// Hand-off (§3.b) — the mechanism that makes U1 shippable
// ---------------------------------------------------------------------------

test('Tab flushes the line without a CR and gives the key to the shell', () => {
  const m = editing('cd src/comp');
  const action = type(m, 'Tab');
  assert.deepEqual(action, { type: 'handoff', flush: 'cd src/comp', data: '\t' });
  assert.equal(m.phase, 'classic');
  assert.equal(m.text, '');
  assert.equal(m.draft, null, 'the flushed text is the shell’s now, not a draft');
});

test('Shift+Tab hands over the back-tab sequence', () => {
  assert.deepEqual(type(editing('a'), 'Tab', { shift: true }), {
    type: 'handoff',
    flush: 'a',
    data: '\x1b[Z',
  });
});

test('Ctrl+R and the arrows hand over until U2 owns history', () => {
  assert.deepEqual(type(editing('gi'), 'r', { ctrl: true }), { type: 'handoff', flush: 'gi', data: '\x12' });
  assert.deepEqual(type(editing(''), 'ArrowUp'), { type: 'handoff', flush: '', data: '\x1b[A' });
  assert.deepEqual(type(editing(''), 'ArrowDown'), { type: 'handoff', flush: '', data: '\x1b[B' });
});

test('an unbound Ctrl combination hands over its control byte', () => {
  assert.deepEqual(type(editing('x'), 'p', { ctrl: true }), { type: 'handoff', flush: 'x', data: '\x10' });
  assert.deepEqual(type(editing('x'), 'g', { ctrl: true }), { type: 'handoff', flush: 'x', data: '\x07' });
});

test('Ctrl+Space is swallowed, never handed over as a NUL', () => {
  // It is CortX's completion key (`terminal.completionMenu`). Handing it off
  // would close the editor and lose the draft to send the shell a byte no
  // line editor acts on.
  assert.deepEqual(type(editing('git che'), ' ', { ctrl: true }), { type: 'none' });
});

test('a function key hands over its VT sequence', () => {
  assert.deepEqual(type(editing('x'), 'F7'), { type: 'handoff', flush: 'x', data: '\x1b[18~' });
});

test('a Ctrl combination with no control byte is left to the app (zoom, tabs)', () => {
  assert.deepEqual(type(editing('x'), '=', { ctrl: true }), { type: 'none' });
  assert.deepEqual(type(editing('x'), '0', { ctrl: true }), { type: 'none' });
  assert.deepEqual(type(editing('x'), 'Tab', { ctrl: true }), { type: 'none' });
  assert.equal(editing('x').phase, 'editing');
});

test('hand-off can be switched off: the key is swallowed, the editor stays', () => {
  const m = editing('cd sr');
  m.handoffEnabled = false;
  assert.deepEqual(type(m, 'Tab'), { type: 'edit' });
  assert.equal(m.phase, 'editing');
  assert.equal(m.text, 'cd sr');
});

test('after a hand-off the editor only comes back at the next prompt', () => {
  const m = editing('cd sr');
  type(m, 'Tab');
  assert.equal(m.phase, 'classic');
  assert.deepEqual(type(m, 'a'), { type: 'none' }, 'keys go straight to the PTY meanwhile');
  m.marker('B', ANCHOR);
  assert.equal(m.phase, 'editing');
  assert.equal(m.text, '', 'the shell owns that line now — no draft comes back');
});

// ---------------------------------------------------------------------------
// Editing bindings (emacs, matching the user's PSReadLine EditMode)
// ---------------------------------------------------------------------------

test('Ctrl+A / Ctrl+E move to the ends of the line', () => {
  const m = editing('hello world');
  type(m, 'a', { ctrl: true });
  assert.equal(m.caret, 0);
  type(m, 'e', { ctrl: true });
  assert.equal(m.caret, 11);
});

test('Ctrl+U kills to the start, Ctrl+K to the end', () => {
  const m = editing('hello world');
  m.setText('hello world', 6);
  type(m, 'u', { ctrl: true });
  assert.equal(m.text, 'world');
  assert.equal(m.caret, 0);

  const n = editing('hello world');
  n.setText('hello world', 5);
  type(n, 'k', { ctrl: true });
  assert.equal(n.text, 'hello');
});

test('Ctrl+W and Alt+Backspace kill the word before the caret', () => {
  const m = editing('git commit --amend');
  type(m, 'w', { ctrl: true });
  assert.equal(m.text, 'git commit ');
  const n = editing('git commit --amend');
  type(n, 'Backspace', { alt: true });
  assert.equal(n.text, 'git commit ');
});

test('Alt+arrows walk over words', () => {
  const m = editing('one two three');
  type(m, 'ArrowLeft', { alt: true });
  assert.equal(m.caret, 8);
  type(m, 'ArrowRight', { alt: true });
  assert.equal(m.caret, 13);
});

test('Escape clears a typed line, and hands over when there is nothing to clear', () => {
  const m = editing('oops');
  assert.deepEqual(type(m, 'Escape'), { type: 'edit' });
  assert.equal(m.text, '');
  assert.equal(m.phase, 'editing');
  assert.deepEqual(type(m, 'Escape'), { type: 'handoff', flush: '', data: '\x1b' });
});

test('a printable key, Backspace and the horizontal arrows are the textarea’s job', () => {
  const m = editing('abc');
  for (const k of ['a', 'é', '~', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    assert.deepEqual(type(m, k), { type: 'none' }, k);
  }
  // AltGr on a French keyboard reports ctrl+alt: the character must get through.
  assert.deepEqual(type(m, '~', { ctrl: true, alt: true }), { type: 'none' });
});

test('Cmd (macOS) and Ctrl+V leave the platform’s copy / paste alone', () => {
  const m = editing('abc');
  assert.deepEqual(type(m, 'v', { meta: true }), { type: 'none' });
  assert.deepEqual(type(m, 'a', { meta: true }), { type: 'none' });
  assert.deepEqual(type(m, 'v', { ctrl: true }), { type: 'none' });
  assert.deepEqual(type(m, 'v', { ctrl: true, shift: true }), { type: 'paste' });
  assert.deepEqual(type(m, 'c', { ctrl: true, shift: true }), { type: 'none' });
});

test('PageUp / PageDown scroll the grid instead of being swallowed', () => {
  assert.deepEqual(type(editing('x'), 'PageUp'), { type: 'scroll', pages: -1 });
  assert.deepEqual(type(editing('x'), 'PageDown'), { type: 'scroll', pages: 1 });
});

// ---------------------------------------------------------------------------
// Typeahead (§3.b, risk #1)
// ---------------------------------------------------------------------------

test('typeahead echoed by the shell is adopted once, and the shell buffer is erased', () => {
  const m = editing();
  const erase = m.adoptTypeahead('git st');
  assert.equal(m.text, 'git st');
  assert.equal(m.caret, 6);
  assert.equal(erase, ERASE_BYTE.repeat(6));
  // Never twice: the editor is no longer empty.
  assert.equal(m.adoptTypeahead('git st'), null);
});

test('typeahead is ignored outside the editor and for blank echoes', () => {
  const classic = new TerminalInputMachine();
  assert.equal(classic.adoptTypeahead('ls'), null);
  assert.equal(editing().adoptTypeahead('   '), null);
});

test('insert() drops text at the caret (redirected key, paste)', () => {
  const m = editing('ac');
  m.setText('ac', 1);
  m.insert('b');
  assert.equal(m.text, 'abc');
  assert.equal(m.caret, 2);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

test('controlByte covers the letters and the punctuation shells expect', () => {
  assert.equal(controlByte('a'), '\x01');
  assert.equal(controlByte('C'), '\x03');
  assert.equal(controlByte('z'), '\x1a');
  assert.equal(controlByte('['), '\x1b');
  assert.equal(controlByte(' '), '\x00');
  assert.equal(controlByte('1'), null);
  assert.equal(controlByte('ArrowUp'), null);
});

test('word boundaries skip the whitespace next to the caret', () => {
  assert.equal(wordStart('git commit  ', 12), 4);
  assert.equal(wordEnd('git commit', 0), 3);
  assert.equal(wordStart('', 0), 0);
  assert.equal(wordEnd('', 0), 0);
});

test('reset() puts a pane back to the day it was born', () => {
  const m = editing('anything');
  m.reset();
  assert.equal(m.phase, 'classic');
  assert.equal(m.text, '');
  assert.equal(m.anchor, null);
  assert.equal(m.draft, null);
});

report();
