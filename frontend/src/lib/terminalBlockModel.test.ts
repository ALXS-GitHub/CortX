/**
 * Tests for the command-block geometry (DEV-13 P4, ticket #7).
 *
 * Same shape as `terminalInputState.test.ts`: the module under test is pure,
 * so this runs on plain Node with nothing but type stripping —
 *
 *     npm test          (node --test "src/**\/*.test.ts")
 *
 * A failure throws at the end of the module, so the exit code carries the
 * result. What is pinned down here is the part that is easy to get subtly
 * wrong and impossible to eyeball: the one-line difference between the shells'
 * `133;C` / `133;D`, the clipping that keeps a fold covering its output while
 * you scroll through it, prompt-to-prompt navigation, and the reassembly of
 * wrapped rows into the command you actually typed.
 */
import {
  type BlockActionContext,
  type BlockActionId,
  type TerminalBlock,
  blockActions,
  blockAtLine,
  blockFailed,
  blockMarkdown,
  blockRange,
  blockStatusLabel,
  blockToolbarWidth,
  boundaryLine,
  clipToViewport,
  colorLuminance,
  dividerOffsetRows,
  foldLabel,
  foldedRange,
  joinBufferRows,
  navigateBlocks,
  parseBlockMarker,
  shortCommand,
  terminalIsDark,
} from './terminalBlockModel.ts';

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

function report() {
  console.log(`terminalBlockModel: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  x ${f}`);
    throw new Error(`${failures.length} test(s) failed`);
  }
}

/** A finished block spanning `start`..`endExclusive`, output right after the command. */
function block(over: Partial<TerminalBlock> = {}): TerminalBlock {
  return {
    id: 1,
    start: 10,
    outputStart: 11,
    endExclusive: 20,
    command: 'git status',
    exitCode: 0,
    status: 'done',
    folded: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Marker parsing
// ---------------------------------------------------------------------------

test('the four markers cortx init emits are recognised', () => {
  assert.deepEqual(parseBlockMarker('A'), { kind: 'A' });
  assert.deepEqual(parseBlockMarker('B'), { kind: 'B' });
  assert.deepEqual(parseBlockMarker('D;0'), { kind: 'D', exitCode: 0 });
  assert.deepEqual(parseBlockMarker('D;1'), { kind: 'D', exitCode: 1 });
});

test('133;C carries the command as base64', () => {
  // `git status` → Z2l0IHN0YXR1cw==
  assert.deepEqual(parseBlockMarker('C;cmd=Z2l0IHN0YXR1cw=='), { kind: 'C', command: 'git status' });
});

test('a 133;C without cmd= is still a command start', () => {
  assert.deepEqual(parseBlockMarker('C'), { kind: 'C' });
});

test('unicode survives the base64 round trip', () => {
  const command = 'echo "héllo → ✓"';
  // Exactly what `cortx init` does in the shell: UTF-8, then base64.
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(command)));
  assert.equal(parseBlockMarker(`C;cmd=${b64}`)?.command, command);
});

test('a broken payload degrades instead of throwing', () => {
  assert.deepEqual(parseBlockMarker('C;cmd=not base64!!'), { kind: 'C' });
  assert.deepEqual(parseBlockMarker('D;notanumber'), { kind: 'D' });
  assert.deepEqual(parseBlockMarker('D'), { kind: 'D' });
});

test('markers CortX does not use are ignored, not guessed at', () => {
  // iTerm2 / WezTerm also send `P` (right prompt) and `L`; a foreign flavour
  // must never invent a block.
  assert.equal(parseBlockMarker('P;k=r'), null);
  assert.equal(parseBlockMarker('L'), null);
  assert.equal(parseBlockMarker(''), null);
});

// ---------------------------------------------------------------------------
// Where a boundary falls (the one-line difference between the shells)
// ---------------------------------------------------------------------------

test('PowerShell: 133;C arrives with the cursor still on the typed line', () => {
  // PSReadLine's Enter handler fires before the newline is echoed.
  assert.equal(boundaryLine(42, 17), 43);
});

test('bash / zsh: 133;C arrives with the cursor already on the next line', () => {
  // DEBUG trap / preexec run after the echo, cursor in column 0.
  assert.equal(boundaryLine(43, 0), 43);
});

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

test('a finished block covers exactly what the shell delimited', () => {
  assert.deepEqual(blockRange(block(), 999), { start: 10, endExclusive: 20 });
});

test('a running block grows with the output', () => {
  const running = block({ endExclusive: null, status: 'running', exitCode: null });
  assert.deepEqual(blockRange(running, 14), { start: 10, endExclusive: 14 });
  assert.deepEqual(blockRange(running, 260), { start: 10, endExclusive: 260 });
});

test('a block can never end before it starts', () => {
  const running = block({ endExclusive: null, status: 'running' });
  // The live end can lag behind after a clear; the range stays degenerate
  // rather than inverted.
  assert.deepEqual(blockRange(running, 3), { start: 10, endExclusive: 10 });
});

test('folding hides the output and never the command', () => {
  assert.deepEqual(foldedRange(block(), 999), { start: 11, endExclusive: 20 });
});

test('a command that printed nothing has nothing to fold', () => {
  assert.equal(foldedRange(block({ outputStart: 11, endExclusive: 11 }), 999), null);
  assert.equal(foldedRange(block({ outputStart: null, endExclusive: null }), 999), null);
});

test('a folded block that is still running keeps swallowing its output', () => {
  const running = block({ endExclusive: null, status: 'running', folded: true });
  assert.deepEqual(foldedRange(running, 15), { start: 11, endExclusive: 15 });
  assert.deepEqual(foldedRange(running, 400), { start: 11, endExclusive: 400 });
});

// ---------------------------------------------------------------------------
// Clipping (what keeps a fold cover honest while the viewport moves)
// ---------------------------------------------------------------------------

test('a range fully on screen maps to its rows', () => {
  assert.deepEqual(clipToViewport({ start: 12, endExclusive: 18 }, 10, 24), { row: 2, count: 6 });
});

test('a range starting above the viewport is clipped, not dropped', () => {
  // This is the case that decides whether a long folded build stays folded
  // when you scroll into the middle of it.
  assert.deepEqual(clipToViewport({ start: 0, endExclusive: 400 }, 100, 24), { row: 0, count: 24 });
});

test('a range ending below the viewport is clipped too', () => {
  assert.deepEqual(clipToViewport({ start: 20, endExclusive: 400 }, 10, 24), { row: 10, count: 14 });
});

test('a range entirely off screen draws nothing', () => {
  assert.equal(clipToViewport({ start: 0, endExclusive: 5 }, 10, 24), null);
  assert.equal(clipToViewport({ start: 100, endExclusive: 120 }, 10, 24), null);
  assert.equal(clipToViewport({ start: 10, endExclusive: 10 }, 10, 24), null);
});

// ---------------------------------------------------------------------------
// Spacing (ticket #7 — Warp's `appearance.spacing`)
// ---------------------------------------------------------------------------

test('with no spacing line the divider stays on the block’s top edge', () => {
  assert.equal(dividerOffsetRows(null), 0);
});

test('a spacing line puts the divider through its middle', () => {
  // Half a row up from the prompt: the blank line the shell printed then has
  // half of itself above the rule and half below, which is the padding Warp
  // gets by reserving pixels. Anything else (0, or a whole row) would glue the
  // rule to one of the two blocks instead of separating them.
  assert.equal(dividerOffsetRows('above'), -0.5);
  // And half a row *down* when the blank line is the block's own first row.
  assert.equal(dividerOffsetRows('first'), 0.5);
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const LADDER: TerminalBlock[] = [
  block({ id: 1, start: 0, outputStart: 1, endExclusive: 10 }),
  block({ id: 2, start: 10, outputStart: 11, endExclusive: 30 }),
  block({ id: 3, start: 30, outputStart: 31, endExclusive: 55 }),
];

test('Ctrl+↑ walks up one prompt at a time', () => {
  assert.equal(navigateBlocks(LADDER, 30, 'previous')?.id, 2);
  assert.equal(navigateBlocks(LADDER, 10, 'previous')?.id, 1);
  assert.equal(navigateBlocks(LADDER, 0, 'previous'), null, 'nothing above the first block');
});

test('Ctrl+↓ walks back down', () => {
  assert.equal(navigateBlocks(LADDER, 0, 'next')?.id, 2);
  assert.equal(navigateBlocks(LADDER, 10, 'next')?.id, 3);
  assert.equal(navigateBlocks(LADDER, 30, 'next'), null, 'nothing below the last block');
});

test('with nothing selected the anchor is the top of the viewport', () => {
  // Scrolled to the middle of block 2: up goes to its own prompt, down to the next.
  assert.equal(navigateBlocks(LADDER, 20, 'previous')?.id, 2);
  assert.equal(navigateBlocks(LADDER, 20, 'next')?.id, 3);
});

test('stepping is stable: jumping puts the anchor on the block start', () => {
  let anchor = 55;
  const seen: number[] = [];
  for (let i = 0; i < 5; i++) {
    const target = navigateBlocks(LADDER, anchor, 'previous');
    if (!target) break;
    seen.push(target.id);
    anchor = target.start;
  }
  assert.deepEqual(seen, [3, 2, 1], 'each jump lands on the next prompt up, never twice on one');
});

test('navigation is a no-op without blocks', () => {
  assert.equal(navigateBlocks([], 42, 'previous'), null);
  assert.equal(navigateBlocks([], 42, 'next'), null);
});

test('a line resolves to the block that owns it', () => {
  assert.equal(blockAtLine(LADDER, 0, 999)?.id, 1);
  assert.equal(blockAtLine(LADDER, 9, 999)?.id, 1);
  assert.equal(blockAtLine(LADDER, 10, 999)?.id, 2);
  assert.equal(blockAtLine(LADDER, 54, 999)?.id, 3);
  assert.equal(blockAtLine(LADDER, 55, 999), null, 'past the last block');
});

// ---------------------------------------------------------------------------
// Reading the text back
// ---------------------------------------------------------------------------

test('wrapped rows come back as the single line that was typed', () => {
  const text = joinBufferRows([
    { text: 'git commit -m "a really long ', wrapped: false },
    { text: 'message that wrapped"', wrapped: true },
  ]);
  assert.equal(text, 'git commit -m "a really long message that wrapped"');
});

test('unwrapped rows stay separate lines and are right-trimmed', () => {
  assert.equal(joinBufferRows([{ text: 'one   ', wrapped: false }, { text: 'two ', wrapped: false }]), 'one\ntwo');
});

test('the blank rows a grid always has are dropped', () => {
  const text = joinBufferRows([
    { text: 'output', wrapped: false },
    { text: '   ', wrapped: false },
    { text: '', wrapped: false },
  ]);
  assert.equal(text, 'output');
});

test('a blank line inside the output is kept', () => {
  const text = joinBufferRows([
    { text: 'a', wrapped: false },
    { text: '', wrapped: false },
    { text: 'b', wrapped: false },
  ]);
  assert.equal(text, 'a\n\nb');
});

test('an empty block copies as an empty string, not as a crash', () => {
  assert.equal(joinBufferRows([]), '');
  assert.equal(joinBufferRows([{ text: '  ', wrapped: false }]), '');
});

test('a leading wrapped row (the block starts mid-wrap) is not glued to nothing', () => {
  assert.equal(joinBufferRows([{ text: 'tail', wrapped: true }]), 'tail');
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

test('the status label says what happened', () => {
  assert.equal(blockStatusLabel(block({ status: 'prompt' })), 'Prompt');
  assert.equal(blockStatusLabel(block({ status: 'running' })), 'Running');
  assert.equal(blockStatusLabel(block({ exitCode: 0 })), 'Succeeded');
  assert.equal(blockStatusLabel(block({ exitCode: 130 })), 'Failed · exit 130');
  assert.equal(blockStatusLabel(block({ exitCode: null })), 'Finished');
});

test('only a finished non-zero exit counts as a failure', () => {
  assert.equal(blockFailed(block({ exitCode: 1 })), true);
  assert.equal(blockFailed(block({ exitCode: 0 })), false);
  assert.equal(blockFailed(block({ status: 'running', exitCode: null })), false);
  assert.equal(blockFailed(block({ exitCode: null })), false);
});

test('a long command is elided for the menu, a short one is left alone', () => {
  assert.equal(shortCommand('git status'), 'git status');
  assert.equal(shortCommand('git   status\n--short'), 'git status --short');
  assert.equal(shortCommand(null), '');
  assert.equal(shortCommand('x'.repeat(80)).length, 48);
});

test('the fold label counts in plain English', () => {
  assert.equal(foldLabel(1), '1 line hidden');
  assert.equal(foldLabel(412), '412 lines hidden');
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** A block with a command, nine lines of output and a shell at its prompt. */
function context(over: Partial<BlockActionContext> = {}): BlockActionContext {
  return {
    block: block(),
    hasCommand: true,
    hiddenLines: 9,
    atPrompt: true,
    inputEditor: false,
    ...over,
  };
}

/** Every action, keyed by id — the list is never filtered, only disabled. */
function actionMap(ctx: BlockActionContext): Map<BlockActionId, { label: string; disabled: boolean; hint?: string }> {
  return new Map(blockActions(ctx).map((a) => [a.id, { label: a.label, disabled: a.disabled, hint: a.hint }]));
}

test('the toolbar and the menu are the same list, never two lists', () => {
  const all = blockActions(context());
  const ids = all.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'no action is offered twice');
  // Everything the toolbar shows is in the menu, because it is one list and
  // `primary` only says which entries get their own button.
  assert.deepEqual(
    all.filter((a) => a.primary).map((a) => a.id),
    ['copyCommand', 'copyOutput', 'copyBlock', 'rerun', 'fold']
  );
});

test('a healthy finished block offers everything', () => {
  const actions = actionMap(context());
  for (const [id, spec] of actions) assert.equal(spec.disabled, false, `${id} should be available`);
});

test('a command that printed nothing cannot have its output copied or folded', () => {
  const actions = actionMap(context({ hiddenLines: 0 }));
  assert.equal(actions.get('copyOutput')?.disabled, true);
  assert.equal(actions.get('fold')?.disabled, true);
  assert.equal(actions.get('scrollBottom')?.disabled, true);
  assert.equal(actions.get('copyCommand')?.disabled, false, 'the command is still there');
  assert.equal(actions.get('copyBlock')?.disabled, false);
});

test('an empty block offers nothing to copy but can still be scrolled to', () => {
  const actions = actionMap(context({ hasCommand: false, hiddenLines: 0 }));
  assert.equal(actions.get('copyBlock')?.disabled, true);
  assert.equal(actions.get('copyMarkdown')?.disabled, true);
  assert.equal(actions.get('scrollTop')?.disabled, false);
  assert.equal(actions.get('selectText')?.disabled, false);
});

test('nothing is typed into a shell that is busy, and the entry says why', () => {
  const actions = actionMap(context({ atPrompt: false }));
  assert.equal(actions.get('rerun')?.disabled, true);
  assert.equal(actions.get('rerun')?.hint, 'busy');
  assert.equal(actions.get('reinput')?.disabled, true);
  assert.equal(actions.get('reinput')?.hint, 'busy');
  assert.equal(actions.get('copyOutput')?.disabled, false, 'copying a running block is fine');
});

test('the universal input editor refuses reinput and only reinput', () => {
  const actions = actionMap(context({ inputEditor: true }));
  assert.equal(actions.get('reinput')?.disabled, true);
  assert.equal(actions.get('reinput')?.hint, 'input editor');
  assert.equal(actions.get('rerun')?.disabled, false, 'running submits at once, nothing to desync');
});

test('the fold entry flips its label and counts what it hides', () => {
  assert.equal(actionMap(context())?.get('fold')?.label, 'Fold output');
  assert.equal(actionMap(context())?.get('fold')?.hint, '9 lines hidden');
  const folded = actionMap(context({ block: block({ folded: true }) }));
  assert.equal(folded.get('fold')?.label, 'Unfold output');
});

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** Multi-line fixtures, written as lines: escapes in a fenced string are unreadable. */
const lines = (...parts: string[]) => parts.join('\n');

test('a block becomes a console transcript', () => {
  assert.equal(
    blockMarkdown('git status', lines('On branch main', 'nothing to commit'), 0),
    lines('```console', '$ git status', 'On branch main', 'nothing to commit', '```')
  );
});

test('a failing command carries its exit code, a successful one does not', () => {
  assert.equal(blockMarkdown('false', '', 1), lines('```console', '$ false', '# exit 1', '```'));
  assert.equal(blockMarkdown('true', '', 0), lines('```console', '$ true', '```'));
  assert.equal(blockMarkdown('true', '', null), lines('```console', '$ true', '```'));
});

test('a multi-line command keeps its continuation lines', () => {
  assert.equal(
    blockMarkdown(lines('for x in a b; do', '  echo $x', 'done'), lines('a', 'b'), 0),
    lines('```console', '$ for x in a b; do', '>   echo $x', '> done', 'a', 'b', '```')
  );
});

test('the fence grows past backticks in the output', () => {
  const out = blockMarkdown('cat readme.md', 'use ```js fences```', 0);
  assert.equal(out.startsWith('````console\n'), true, out);
  assert.equal(out.endsWith('\n````'), true, out);
});

test('a block with neither a command nor output produces nothing at all', () => {
  assert.equal(blockMarkdown('', '', 0), '');
  assert.equal(blockMarkdown('   ', lines('', ''), null), '');
});

// --- the divider's neutral colour -----------------------------------------

test('a colour is read from every notation a terminal palette uses', () => {
  assert.equal(colorLuminance('#000'), 0);
  assert.equal(colorLuminance('#000000'), 0);
  assert.equal(colorLuminance('#ffffff'), 1);
  assert.equal(colorLuminance('#ffffffcc'), 1);
  assert.equal(colorLuminance('rgb(255, 255, 255)'), 1);
  assert.equal(colorLuminance('rgba(0 0 0 / 0.5)'), 0);
  assert.equal(colorLuminance(undefined), null);
  assert.equal(colorLuminance('rebeccapurple'), null);
  assert.equal(colorLuminance('#12345'), null);
});

test('the wallpaper theme that made the divider pink is read as dark', () => {
  // `aespa_wda`: white text on a warm brown-red, with a photo behind it. A
  // divider mixed from the foreground came out pink; a *white* wash at 11 %
  // does not, and this is the test that says which of the two we pick.
  assert.equal(terminalIsDark('#713d39', '#ffffff'), true);
});

test('light, dark and half-configured palettes each pick a side', () => {
  assert.equal(terminalIsDark('#1e1e1e', '#d4d4d4'), true);
  assert.equal(terminalIsDark('#ffffff', '#000000'), false);
  assert.equal(terminalIsDark('#fafafa', undefined), false);
  // No background: decided from the foreground instead (light text = dark pane).
  assert.equal(terminalIsDark(undefined, '#eeeeee'), true);
  assert.equal(terminalIsDark(undefined, '#111111'), false);
  // Nothing at all: a terminal is dark until told otherwise.
  assert.equal(terminalIsDark(undefined, undefined), true);
});

test('the toolbar width is predicted before the toolbar exists', () => {
  // 22 px buttons, a 1 px gap, 3 px of padding either side, a 1 px border.
  assert.equal(blockToolbarWidth(0), 0);
  assert.equal(blockToolbarWidth(1), 30);
  assert.equal(blockToolbarWidth(6), 145);
});

report();
