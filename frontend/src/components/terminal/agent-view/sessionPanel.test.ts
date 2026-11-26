/**
 * Tests for the agent view's side panel data (`sessionPanel.ts`).
 *
 *     node src/components/terminal/agent-view/sessionPanel.test.ts
 */
import { contextUsed, sessionPanel } from './sessionPanel.ts';

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
const msg = (role: 'user' | 'assistant', parts: unknown[]) =>
  ({ id: `m${++seq}`, role, timestamp: '2026-11-26T10:00:00Z', parts, isSidechain: false }) as never;
const call = (toolId: string, name: string, input: unknown) => ({ type: 'tool-call', toolId, name, input });
const result = (toolId: string, output = 'ok', extra: Record<string, unknown> = {}) => ({ type: 'tool-result', toolId, output, isError: false, ...extra });

const messages = [
  msg('user', [{ type: 'text', text: 'go' }, { type: 'image', mediaType: 'image/png', data: 'AAA' }]),
  msg('assistant', [
    call('t1', 'TodoWrite', { todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }] }),
    call('e1', 'Edit', { file_path: '/p/src/a.ts', old_string: 'x', new_string: 'y\nz' }),
    call('e2', 'Edit', { file_path: '/p/src/a.ts', old_string: 'q', new_string: 'r' }),
    call('w1', 'Write', { file_path: '/p/new.md', content: 'a\nb\nc' }),
    call('s1', 'Task', { description: 'Explore the code', subagent_type: 'Explore' }),
    call('b1', 'Bash', { command: 'npm run dev', run_in_background: true }),
    call('f1', 'WebFetch', { url: 'https://docs.example.com/guide' }),
    call('r1', 'Read', { file_path: '/p/shot.png' }),
  ]),
  msg('user', [
    result('t1'),
    result('e1'),
    result('e2'),
    result('w1'),
    result('b1', 'Command running in background with ID: shell_7'),
    result('f1'),
    result('r1', '[image]', { name: 'Read', images: [{ mediaType: 'image/png', data: 'BBB' }] }),
  ]),
];

test('to-dos, changes, sub-agents, background commands, sources, images', () => {
  const panel = sessionPanel(messages, true);
  assert.equal(panel.todos.map((t) => t.status), ['completed', 'in_progress']);
  assert.equal(
    panel.changes.map((c) => [c.name, c.added, c.removed, c.created, c.edits]),
    [
      ['a.ts', 3, 2, false, 2],
      ['new.md', 3, 0, true, 1],
    ]
  );
  assert.equal(panel.subagents, [{ id: 's1', description: 'Explore the code', kind: 'Explore', status: 'running' }]);
  assert.equal(panel.background.map((b) => [b.command, b.shellId, b.status]), [['npm run dev', 'shell_7', 'running']]);
  assert.equal(panel.sources, [{ kind: 'page', label: 'docs.example.com/guide', url: 'https://docs.example.com/guide' }]);
  assert.equal(panel.images.map((i) => i.label), ['Your image', 'Read']);
});

test('a killed shell is stopped; a sub-agent left without result after the turn is not running', () => {
  const panel = sessionPanel(
    [...messages, msg('assistant', [call('k1', 'KillShell', { shell_id: 'shell_7' })]), msg('user', [result('k1')])],
    false
  );
  assert.equal(panel.background[0].status, 'stopped');
  assert.equal(panel.subagents[0].status, 'failed');
});

test('context used', () => {
  assert.equal(contextUsed({ input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 5 }), 1015);
  assert.equal(contextUsed(null), 0);
});

if (failures.length > 0) {
  console.error(`${failures.length} failed, ${passed} passed\n\n${failures.join('\n\n')}`);
  throw new Error(`${failures.length} test(s) failed`);
}
console.log(`sessionPanel: ${passed} passed`);
