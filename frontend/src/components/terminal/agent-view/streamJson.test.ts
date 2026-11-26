/**
 * Tests for the stream-json reducer of the agent view (`streamJson.ts`).
 *
 *     node src/components/terminal/agent-view/streamJson.test.ts
 */
import {
  allowResponse,
  denyResponse,
  initialState,
  reduce,
  visibleMessages,
  withPendingControl,
  withUserPrompt,
  type GuiAgentState,
} from './streamJson.ts';

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

const fold = (state: GuiAgentState, ...messages: Record<string, unknown>[]) => messages.reduce((s, m) => reduce(s, m, 0), state);
const delta = (index: number, d: Record<string, unknown>) => ({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: d } });

test('init gives the session, the model and the commands', () => {
  const s = fold(initialState(), {
    type: 'system',
    subtype: 'init',
    session_id: 'sess-1',
    model: 'claude-opus',
    permissionMode: 'default',
    slash_commands: ['compact', 'review'],
  });
  assert.equal([s.sessionId, s.model, s.permissionMode, s.slashCommands], ['sess-1', 'claude-opus', 'default', ['compact', 'review']]);
});

test('the answer streams in, then the finished block takes its place', () => {
  let s = withUserPrompt(initialState(), 'hello', 0, 0);
  s = fold(
    s,
    { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } } },
    { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    delta(0, { type: 'text_delta', text: 'Hel' }),
    delta(0, { type: 'text_delta', text: 'lo!' })
  );
  let shown = visibleMessages(s);
  assert.equal(shown.map((m) => m.role), ['user', 'assistant']);
  assert.equal(shown[1].parts, [{ type: 'text', text: 'Hello!' }]);
  assert.equal(s.busy, true);

  // The block arrives whole: drawn once, not twice.
  s = fold(s, { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'Hello!' }] } });
  shown = visibleMessages(s);
  assert.equal(shown.length, 2);
  assert.equal(shown[1].parts, [{ type: 'text', text: 'Hello!' }]);

  // A tool call of the same message: one message, two parts.
  s = fold(
    s,
    { type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'Read' } } },
    { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a' } }] } },
    { type: 'stream_event', event: { type: 'message_stop' } }
  );
  shown = visibleMessages(s);
  assert.equal(shown.length, 2);
  assert.equal(shown[1].parts.map((p) => p.type), ['text', 'tool-call']);
});

test('tool results, then the end of the turn', () => {
  let s = withUserPrompt(initialState(), 'go', 0, 0);
  s = fold(
    s,
    { type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'a\nb' }] }] } },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 1200, total_cost_usd: 0.01, result: 'done', session_id: 's' }
  );
  assert.equal(s.messages[2].parts, [{ type: 'tool-result', toolId: 't1', output: 'a\nb', isError: false }]);
  assert.equal([s.busy, s.lastResult?.durationMs, s.sessionId], [false, 1200, 's']);
});

test('a permission request, and the answers to it', () => {
  const s = fold(initialState(), {
    type: 'control_request',
    request_id: 'r1',
    request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'rm x' }, permission_suggestions: [{ type: 'addRules' }], tool_use_id: 't9' },
  });
  assert.equal(s.permissions.map((p) => [p.requestId, p.toolName]), [['r1', 'Bash']]);
  const req = s.permissions[0];
  assert.equal(allowResponse(req, { always: true }), {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: 'r1',
      response: { behavior: 'allow', updatedInput: { command: 'rm x' }, updatedPermissions: [{ type: 'addRules' }], toolUseID: 't9' },
    },
  });
  assert.equal((denyResponse(req, 'no') as { response: { response: unknown } }).response.response, { behavior: 'deny', message: 'no', toolUseID: 't9' });
  assert.equal(fold(s, { type: 'control_cancel_request', request_id: 'r1' }).permissions, []);
});

test("sub-agents' messages say what they do, without entering the conversation", () => {
  let s = fold(initialState(), {
    type: 'assistant',
    parent_tool_use_id: 'task1',
    message: { id: 'x', content: [{ type: 'tool_use', id: 'z', name: 'Read', input: { file_path: '/p/a.ts' } }] },
  });
  assert.equal([s.messages.length, s.subagents], [0, { task1: 'Read · a.ts' }]);
  s = fold(s, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'task1', content: 'ok' }] } });
  assert.equal(s.subagents, {});
});

test('the response to our initialize gives the commands', () => {
  let s = withPendingControl(initialState(), 'c1', 'initialize');
  s = fold(s, { type: 'control_response', response: { subtype: 'success', request_id: 'c1', response: { commands: [{ name: 'review' }] } } });
  assert.equal([s.slashCommands, s.pendingControl, s.initialized], [['review'], {}, true]);
});

if (failures.length > 0) {
  console.error(`${failures.length} failed, ${passed} passed\n\n${failures.join('\n\n')}`);
  throw new Error(`${failures.length} test(s) failed`);
}
console.log(`streamJson: ${passed} passed`);
