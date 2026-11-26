/**
 * Tests for reading Claude Code's input box off the screen
 * (`agentPromptRestore.ts`).
 *
 *     node src/components/terminal/agentPromptRestore.test.ts
 */
import { clearKeys, inputHoldsPrompt, readInputBox } from './agentPromptRestore.ts';

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

function screen(input: string[], transcript: string[] = ['● Hello', '', '❯ corrige ma phrase', '']): string[] {
  return [...transcript, RULE, ...input, RULE, '  GCP | +671 -291', '  ▸▸ bypass permissions on'];
}

test('reads the input box between the last two rules', () => {
  assert.equal(readInputBox(screen(['❯ echo bonjour'])), 'echo bonjour');
  assert.equal(readInputBox(screen(['❯ '])), '');
  assert.equal(readInputBox(screen(['❯ first line', '  second line'])), 'first line\nsecond line');
});

test('no box: no rules, or a single one', () => {
  assert.equal(readInputBox(['● Hello', '❯ hi']), null);
  assert.equal(readInputBox(['● Hello', RULE, '❯ hi']), null);
});

test('a box without a prompt is not the input (a menu in its place)', () => {
  assert.equal(readInputBox(screen(['  1. Yes', '  2. No'])), null);
});

test('the transcript\'s own copy of the prompt is never taken for the input', () => {
  const s = screen(['❯ '], ['❯ corrige ma phrase', '● Done']);
  assert.equal(inputHoldsPrompt(readInputBox(s), 'corrige ma phrase'), false);
});

test('the prompt given back matches, wrapped or not', () => {
  const sent = 'Hello, juste un message de Bojan qui demande si vous pouvez regarder avec Westpole';
  const box = readInputBox(screen(['❯ Hello, juste un message de Bojan qui demande si vous', '  pouvez regarder avec Westpole']));
  assert.equal(inputHoldsPrompt(box, sent), true);
  assert.equal(inputHoldsPrompt(box, 'something else'), false);
});

test('image markers are ignored on both sides (numbered differently)', () => {
  assert.equal(inputHoldsPrompt('look at [Image #3] please', 'look at [Image #1] please'), true);
});

test('a folded paste matches when what surrounds it is part of the prompt', () => {
  assert.equal(inputHoldsPrompt('[Pasted text #1 +24 lines]', 'a\nlong\nprompt'), true);
  assert.equal(inputHoldsPrompt('unrelated [Pasted text #1 +24 lines]', 'a\nlong\nprompt'), false);
});

test('an empty box holds nothing', () => {
  assert.equal(inputHoldsPrompt('', 'x'), false);
  assert.equal(inputHoldsPrompt(null, 'x'), false);
});

test('clearing: end of line, then a Backspace per character and a few more', () => {
  assert.equal(clearKeys('héé'), '\x05' + '\x7f'.repeat(11));
});

console.log(`agentPromptRestore: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  throw new Error(`${failures.length} test(s) failed`);
}
