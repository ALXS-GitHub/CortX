/**
 * Tests for the agent view's reading of the pending tool call (`pendingTool.ts`).
 *
 *     node src/components/terminal/agent-view/pendingTool.test.ts
 */
import { diffLines, pendingToolCall, toolCardTitle, toolPreview } from './pendingTool.ts';

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

const at = '2026-11-26T10:00:00Z';
const call = (toolId: string, name: string, input: unknown) => ({ type: 'tool-call' as const, toolId, name, input });
const result = (toolId: string) => ({ type: 'tool-result' as const, toolId, output: 'ok', isError: false });
const msg = (role: 'user' | 'assistant', parts: unknown[], id = Math.random().toString(36)) =>
  ({ id, role, timestamp: at, parts, isSidechain: false }) as never;

test('the last call without a result is pending', () => {
  const messages = [
    msg('assistant', [call('a', 'Read', { file_path: 'x' })]),
    msg('user', [result('a')]),
    msg('assistant', [{ type: 'text', text: 'Running' }, call('b', 'Bash', { command: 'npm test' })]),
  ];
  assert.equal(pendingToolCall(messages)?.toolId, 'b');
});

test('nothing is pending once the last call has its result', () => {
  const messages = [msg('assistant', [call('a', 'Bash', { command: 'ls' })]), msg('user', [result('a')])];
  assert.equal(pendingToolCall(messages), null);
  assert.equal(pendingToolCall([]), null);
});

test('an older call left without a result (interrupted) does not count', () => {
  const messages = [
    msg('assistant', [call('a', 'Bash', { command: 'ls' })]),
    msg('assistant', [call('b', 'Read', { file_path: 'x' })]),
    msg('user', [result('b')]),
  ];
  assert.equal(pendingToolCall(messages), null);
});

test('previews', () => {
  assert.equal(toolPreview(call('a', 'Bash', { command: 'npm test', description: 'Tests' })), {
    kind: 'command',
    command: 'npm test',
    description: 'Tests',
  });
  assert.equal(toolPreview(call('a', 'Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' })), {
    kind: 'edit',
    path: 'a.ts',
    hunks: [{ removed: 'x', added: 'y' }],
  });
  assert.equal(toolPreview(call('a', 'ExitPlanMode', { plan: '# Plan' })), { kind: 'plan', plan: '# Plan' });
  assert.equal(toolPreview(call('a', 'Grep', { pattern: 'foo' })).kind, 'generic');
});

test('titles', () => {
  assert.equal(toolCardTitle(call('a', 'Bash', {}), 'Claude'), 'Allow Claude to run this command?');
  assert.equal(toolCardTitle(call('a', 'mcp__zorg__show_ticket', {}), 'Claude'), 'Allow Claude to use show_ticket?');
  assert.equal(toolCardTitle(null, 'Claude'), 'Claude needs your input');
});

test('diff lines', () => {
  assert.equal(diffLines({ removed: 'a\nb', added: 'c' }), [
    { sign: '-', text: 'a' },
    { sign: '-', text: 'b' },
    { sign: '+', text: 'c' },
  ]);
});

if (failures.length > 0) {
  console.error(`${failures.length} failed, ${passed} passed\n\n${failures.join('\n\n')}`);
  throw new Error(`${failures.length} test(s) failed`);
}
console.log(`pendingTool: ${passed} passed`);
