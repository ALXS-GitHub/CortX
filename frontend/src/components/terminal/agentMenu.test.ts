/**
 * Tests for reading an agent's menu off the screen (`agentMenu.ts`).
 *
 *     node src/components/terminal/agentMenu.test.ts
 */
import { KEY_DOWN, KEY_UP, keysToOption, readAgentMenu, sameMenu } from './agentMenu.ts';

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
  equal(actual: unknown, expected: unknown) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`expected ${e}, got ${a}`);
  },
};

const RULE = '─'.repeat(60);

const PERMISSION = [
  '● I will run the tests.',
  '',
  RULE,
  ' Bash command',
  '',
  '   npm test -- --watch=false',
  '   Run the unit tests',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  "   2. Yes, and don't ask again for npm test commands in /home/u/proj",
  '   3. No, and tell Claude what to do differently (esc)',
  '',
  '',
];

test('a permission prompt: its options, its question, the pointer', () => {
  const menu = readAgentMenu(PERMISSION)!;
  assert.equal(menu.title, 'Do you want to proceed?');
  assert.equal(menu.options.map((o) => o.n), [1, 2, 3]);
  assert.equal(menu.options.map((o) => o.label), [
    'Yes',
    "Yes, and don't ask again for npm test commands in /home/u/proj",
    'No, and tell Claude what to do differently (esc)',
  ]);
  assert.equal(menu.options.map((o) => o.selected), [true, false, false]);
  assert.equal(menu.context, ['Bash command', 'npm test -- --watch=false', 'Run the unit tests']);
});

test('the boxed prompt of older versions', () => {
  const menu = readAgentMenu([
    '╭──────────────────────────────────────╮',
    '│ Edit file                            │',
    '│                                      │',
    '│ Do you want to make this edit?       │',
    '│   1. Yes                             │',
    '│ ❯ 2. No, and tell Claude (esc)       │',
    '╰──────────────────────────────────────╯',
  ])!;
  assert.equal(menu.title, 'Do you want to make this edit?');
  assert.equal(menu.options.map((o) => [o.label, o.selected]), [['Yes', false], ['No, and tell Claude (esc)', true]]);
  assert.equal(menu.context, ['Edit file']);
});

test('a question: descriptions under the options, the free-text option, the hint', () => {
  const menu = readAgentMenu([
    '←  ☐ Database  ✔ Submit  →',
    '',
    'Which database should we use?',
    '',
    '❯ 1. Postgres',
    '     Relational, battle tested',
    '  2. SQLite',
    '     A single file',
    '  3. Type something.',
    '',
    'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
  ])!;
  assert.equal(menu.title, 'Which database should we use?');
  assert.equal(menu.options.map((o) => o.label), ['Postgres', 'SQLite', 'Type something.']);
  assert.equal(menu.options.map((o) => o.detail), ['Relational, battle tested', 'A single file', '']);
  assert.equal(menu.options.map((o) => o.freeText), [false, false, true]);
  assert.equal(menu.hint, 'Enter to select · Tab/Arrow keys to navigate · Esc to cancel');
});

test('the description of the last option', () => {
  const menu = readAgentMenu(['Pick one', '❯ 1. A', '     first', '  2. B', '     second', '', 'Esc to cancel'])!;
  assert.equal(menu.options.map((o) => o.detail), ['first', 'second']);
  assert.equal(menu.hint, 'Esc to cancel');
});

test('checkbox options (multi-select)', () => {
  const menu = readAgentMenu(['Which ones?', '❯ 1. [ ] Lint', '  2. [✔] Tests', '  3. [ ] Build'])!;
  assert.equal(menu.options.map((o) => [o.label, o.checked]), [['Lint', false], ['Tests', true], ['Build', false]]);
});

test('a numbered list in the answer is not a menu (no pointer)', () => {
  assert.equal(readAgentMenu(['● Here is the plan:', '  1. Read the code', '  2. Fix it', '', RULE, '❯ ', RULE]), null);
});

test('options out of order are not a menu', () => {
  assert.equal(readAgentMenu(['❯ 1. A', '  3. B']), null);
  assert.equal(readAgentMenu(['❯ 2. A', '  3. B']), null);
});

test('no menu on a plain screen', () => {
  assert.equal(readAgentMenu(['● Done.', '', RULE, '❯ hello', RULE, '  ? for shortcuts']), null);
  assert.equal(readAgentMenu([]), null);
});

test('the keys from the pointer to an option', () => {
  const menu = readAgentMenu(PERMISSION)!;
  assert.equal(keysToOption(menu, 1), []);
  assert.equal(keysToOption(menu, 3), [KEY_DOWN, KEY_DOWN]);
  const up = readAgentMenu(['Q', '  1. A', '  2. B', '❯ 3. C'])!;
  assert.equal(keysToOption(up, 1), [KEY_UP, KEY_UP]);
});

test('sameMenu sees a moved pointer', () => {
  const a = readAgentMenu(PERMISSION);
  const b = readAgentMenu(PERMISSION.map((r) => r.replace(' ❯ 1.', '   1.').replace('   2. Yes,', ' ❯ 2. Yes,')));
  assert.equal(sameMenu(a, readAgentMenu(PERMISSION)), true);
  assert.equal(sameMenu(a, b), false);
});

if (failures.length > 0) {
  console.error(`${failures.length} failed, ${passed} passed\n\n${failures.join('\n\n')}`);
  throw new Error(`${failures.length} test(s) failed`);
}
console.log(`agentMenu: ${passed} passed`);
