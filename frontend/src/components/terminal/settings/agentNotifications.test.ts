/**
 * Tests for when an agent event is announced (agent mode).
 *
 *     bun run test      (node --test "src/**\/*.test.ts")
 */
import { decideAgentNotification } from './notificationPolicy.ts';

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
  deepEqual(actual: unknown, expected: unknown, note = '') {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`expected ${b}, got ${a}${note ? ` (${note})` : ''}`);
  },
};

const away = { inView: false, windowFocused: false };

test('both events are on by default, for agents out of sight', () => {
  assert.deepEqual(decideAgentNotification({}, { event: 'needs-you', ...away }), { toast: true, system: true });
  assert.deepEqual(decideAgentNotification({}, { event: 'done', ...away }), { toast: true, system: true });
  assert.deepEqual(decideAgentNotification({}, { event: 'done', inView: true, windowFocused: true }), null, 'in front of you');
});

test('each event has its own switch', () => {
  assert.deepEqual(decideAgentNotification({ agentNotifyDone: false }, { event: 'done', ...away }), null);
  assert.deepEqual(decideAgentNotification({ agentNotifyDone: false }, { event: 'needs-you', ...away }), { toast: true, system: true });
  assert.deepEqual(decideAgentNotification({ agentNotifyNeedsYou: false }, { event: 'needs-you', ...away }), null);
});

test('"only out of sight" can be turned off, and the style follows notifyStyle', () => {
  const here = { inView: true, windowFocused: true };
  assert.deepEqual(decideAgentNotification({ agentNotifyOnlyWhenHidden: false }, { event: 'done', ...here }), { toast: true, system: false });
  assert.deepEqual(decideAgentNotification({ notifyStyle: 'system' }, { event: 'done', ...away }), { toast: false, system: true });
  assert.deepEqual(decideAgentNotification({ notifyStyle: 'toast' }, { event: 'done', ...away }), { toast: true, system: false });
});

console.log(`agentNotifications: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  x ${f}`);
  throw new Error(`${failures.length} agentNotifications test(s) failed`);
}
