/**
 * Tests for the agent view's conversation model (`conversationModel.ts`).
 *
 *     node src/components/terminal/agent-view/conversationModel.test.ts
 */
import { answerOf, buildTurns, editStats, stepLabel, stepsSummary } from './conversationModel.ts';

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

let seq = 0;
const at = '2026-11-26T10:00:00Z';
const msg = (role: 'user' | 'assistant', parts: unknown[]) =>
  ({ id: `m${++seq}`, role, timestamp: at, parts, isSidechain: false }) as never;
const text = (t: string) => ({ type: 'text', text: t });
const call = (toolId: string, name: string, input: unknown) => ({ type: 'tool-call', toolId, name, input });
const result = (toolId: string, output = 'ok') => ({ type: 'tool-result', toolId, output, isError: false });

test('one answer for everything the agent did until you spoke again', () => {
  const turns = buildTurns([
    msg('user', [text('fix the build')]),
    msg('assistant', [text('Looking.'), call('a', 'Read', { file_path: '/p/src/a.ts' })]),
    msg('user', [result('a')]),
    msg('assistant', [call('b', 'Read', { file_path: '/p/src/b.ts' })]),
    msg('user', [result('b')]),
    msg('assistant', [call('c', 'Edit', { file_path: '/p/src/a.ts', old_string: 'x', new_string: 'y\nz' })]),
    msg('user', [result('c')]),
    msg('assistant', [text('Done.')]),
  ]);
  assert.equal(turns.map((t) => t.kind), ['user', 'assistant']);
  const answer = turns[1] as Extract<(typeof turns)[number], { kind: 'assistant' }>;
  assert.equal(answer.blocks.map((b) => b.kind), ['text', 'steps', 'text']);
  const steps = answer.blocks[1] as { steps: { call: { toolId: string }; result: unknown }[] };
  assert.equal(steps.steps.map((s) => s.call.toolId), ['a', 'b', 'c']);
  assert.equal(steps.steps.every((s) => s.result !== null), true);
});

test("Claude Code's bookkeeping does not show; commands and interruptions do", () => {
  const turns = buildTurns([
    msg('user', [text('<local-command-caveat>Caveat</local-command-caveat>')]),
    msg('user', [text('<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>')]),
    msg('user', [text('<local-command-stdout>Set model to opus</local-command-stdout>')]),
    msg('user', [text('<system-reminder>be nice</system-reminder>')]),
    msg('user', [text('[Request interrupted by user]')]),
    msg('user', [text('look at [Image #1] please'), { type: 'attachment', description: 'image' }]),
  ]);
  assert.equal(turns.map((t) => t.kind), ['user', 'notice', 'notice', 'user']);
  assert.equal((turns[0] as { command: unknown }).command, { name: '/model', args: 'opus' });
  assert.equal((turns[1] as { text: string }).text, 'Set model to opus');
  assert.equal((turns[2] as { text: string }).text, 'Interrupted');
  assert.equal([(turns[3] as { text: string }).text, (turns[3] as { images: number }).images], ['look at  please', 1]);
});

test('the to-do list, the plan and a question are content, not steps', () => {
  const turns = buildTurns([
    msg('user', [text('go')]),
    msg('assistant', [call('t', 'TodoWrite', { todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress', activeForm: 'Doing B' }] })]),
    msg('user', [result('t')]),
    msg('assistant', [call('q', 'AskUserQuestion', { questions: [{ question: 'Which DB?' }] })]),
    msg('user', [result('q', 'User has answered your questions: "Which DB?"="Postgres". You can now continue.')]),
    msg('assistant', [call('p', 'ExitPlanMode', { plan: '# Plan' })]),
  ]);
  const blocks = (turns[1] as { blocks: { kind: string }[] }).blocks;
  assert.equal(blocks.map((b) => b.kind), ['todos', 'question', 'plan']);
  assert.equal((blocks[1] as unknown as { answer: string }).answer, 'Postgres');
  assert.equal((blocks[2] as unknown as { result: unknown }).result, null);
});

test('step labels', () => {
  assert.equal(stepLabel(call('a', 'Read', { file_path: 'C:\\p\\x.ts' }) as never, true), { category: 'read', verb: 'Read', target: 'x.ts', mono: true });
  assert.equal(stepLabel(call('a', 'Bash', { command: 'npm test', description: 'Run the tests' }) as never, false).verb, 'Running');
  assert.equal(stepLabel(call('a', 'mcp__zorg__show_ticket', {}) as never, true).target, 'show_ticket · zorg');
});

test('steps summary', () => {
  const s = (id: string, name: string, input: unknown) => ({ call: call(id, name, input) as never, result: null });
  assert.equal(
    stepsSummary([
      s('1', 'Read', { file_path: 'a' }),
      s('2', 'Read', { file_path: 'b' }),
      s('3', 'Read', { file_path: 'a' }),
      s('4', 'Bash', { command: 'ls' }),
      s('5', 'Edit', { file_path: 'a' }),
    ]),
    'Read 2 files, ran a command, edited a file'
  );
  assert.equal(stepsSummary([s('1', 'Grep', { pattern: 'x' })]), 'Searched once');
});

test('edit stats and answers', () => {
  assert.equal(editStats(call('a', 'Edit', { old_string: 'a\nb', new_string: 'c' }) as never), { added: 1, removed: 2 });
  assert.equal(editStats(call('a', 'Read', {}) as never), null);
  assert.equal(answerOf('User has answered your questions: "A?"="x", "B?"="y". You can now continue.'), 'x · y');
});

if (failures.length > 0) {
  console.error(`${failures.length} failed, ${passed} passed\n\n${failures.join('\n\n')}`);
  throw new Error(`${failures.length} test(s) failed`);
}
console.log(`conversationModel: ${passed} passed`);
