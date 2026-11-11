/**
 * Tests for the agent phases: working / needs you / done (unseen) / idle.
 *
 *     bun run test      (node --test "src/**\/*.test.ts")
 */
import { agentPhase, attentionOrder, foldPhases, rawPhase, type RawPhase } from './agentPhase.ts';

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

function report() {
  console.log(`agentPhase: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  x ${f}`);
    throw new Error(`${failures.length} agentPhase test(s) failed`);
  }
}

const map = (entries: Record<string, RawPhase>) => new Map(Object.entries(entries));

test('the registry and the prompt detection map onto the phases', () => {
  assert.deepEqual(rawPhase({ state: 'running' }), 'working');
  assert.deepEqual(rawPhase({ state: 'running', needsInput: 'permission' }), 'needs-you');
  assert.deepEqual(rawPhase({ state: 'waiting', needsInput: 'question' }), 'needs-you');
  assert.deepEqual(rawPhase({ state: 'waiting' }), 'rest');
  assert.deepEqual(rawPhase({ state: 'unknown' }), 'unknown');
  // An idle turn is "done" only until seen.
  assert.deepEqual(agentPhase({ state: 'waiting' }, true), 'done');
  assert.deepEqual(agentPhase({ state: 'waiting' }, false), 'idle');
});

test('a turn that ends out of sight stays unseen until looked at', () => {
  const step = foldPhases(map({ a: 'working' }), new Set(), map({ a: 'rest' }), () => false);
  assert.deepEqual([...step.unseen], ['a']);
  assert.deepEqual(step.transitions, [{ terminalId: 'a', from: 'working', to: 'rest' }]);
  // Next payload, nothing changed: still unseen, no transition.
  const again = foldPhases(map({ a: 'rest' }), step.unseen, map({ a: 'rest' }), () => false);
  assert.deepEqual([...again.unseen], ['a']);
  assert.deepEqual(again.transitions, []);
});

test('a turn that ends in front of you is seen at once', () => {
  const step = foldPhases(map({ a: 'needs-you' }), new Set(), map({ a: 'rest' }), () => true);
  assert.deepEqual([...step.unseen], []);
});

test('going back to work, or the agent leaving, clears it', () => {
  assert.deepEqual([...foldPhases(map({ a: 'rest' }), new Set(['a']), map({ a: 'working' }), () => false).unseen], []);
  assert.deepEqual([...foldPhases(map({ a: 'rest' }), new Set(['a']), map({}), () => false).unseen], []);
});

test('a terminal seen for the first time at rest is not "done"', () => {
  // CortX starting, or an agent found mid-session: nothing ended in front of us.
  assert.deepEqual([...foldPhases(map({}), new Set(), map({ a: 'rest' }), () => false).unseen], []);
});

test('the inbox lists needs-you first, the longest waiting first', () => {
  const order = attentionOrder([
    { id: 'done-old', phase: 'done', since: 1 },
    { id: 'busy', phase: 'working', since: 0 },
    { id: 'ask-new', phase: 'needs-you', since: 9 },
    { id: 'ask-old', phase: 'needs-you', since: 5 },
  ] as const);
  assert.deepEqual(
    order.map((o) => o.id),
    ['ask-old', 'ask-new', 'done-old']
  );
});

report();
