/**
 * Tests for the rule that puts a tab in a project's group: which project owns
 * a directory, and what a tab's panes have to agree on before the tab moves
 * (`terminal.followProjectOnCd`).
 *
 * Same shape as `closeReach.test.ts` — the functions are pure and
 * `terminalLayout.ts` imports nothing, so this runs on plain Node with type
 * stripping:
 *
 *     bun run test      (node --test "src/**\/*.test.ts")
 */
import {
  FREE_WORKSPACE_ID,
  projectIdForPath,
  scopeFollowingTab,
  workspaceFromCwds,
  type LayoutNode,
  type ProjectRoot,
  type TerminalTab,
} from './terminalLayout.ts';

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
};

function report() {
  console.log(`terminalWorkspace: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  x ${f}`);
    throw new Error(`${failures.length} terminalWorkspace test(s) failed`);
  }
}

const PROJECTS: ProjectRoot[] = [
  { id: 'cortx', rootPath: 'C:\\Users\\me\\Code\\CortX' },
  // Checked out *inside* CortX: the deeper root has to win.
  { id: 'plugin', rootPath: 'C:\\Users\\me\\Code\\CortX\\plugins\\zorg' },
  { id: 'site', rootPath: '/home/me/site/' },
  { id: 'nameless', rootPath: '' },
];

let nextLeaf = 0;
const leaf = (cwd?: string | null): LayoutNode => ({
  kind: 'leaf',
  id: `leaf-${nextLeaf++}`,
  terminalId: `shell:${nextLeaf}`,
  cwd,
});

const tab = (layout: LayoutNode): TerminalTab => ({
  id: 'tab-1',
  workspaceId: FREE_WORKSPACE_ID,
  title: null,
  color: null,
  pinned: false,
  order: 1,
  layout,
  activeLeafId: 'leaf-0',
});

const split = (...children: LayoutNode[]): LayoutNode => ({
  kind: 'split',
  id: 'split-1',
  direction: 'horizontal',
  sizes: children.map(() => 1 / children.length),
  children,
});

// --- the tests -------------------------------------------------------------

test('a directory belongs to the deepest project root that contains it', () => {
  assert.equal(projectIdForPath('C:\\Users\\me\\Code\\CortX\\frontend\\src', PROJECTS), 'cortx');
  assert.equal(projectIdForPath('C:\\Users\\me\\Code\\CortX\\plugins\\zorg\\src', PROJECTS), 'plugin');
  // The root itself, with and without a trailing separator.
  assert.equal(projectIdForPath('C:\\Users\\me\\Code\\CortX', PROJECTS), 'cortx');
  assert.equal(projectIdForPath('C:\\Users\\me\\Code\\CortX\\', PROJECTS), 'cortx');
});

test('separators and case are the OS\u2019s business, not the match\u2019s', () => {
  assert.equal(projectIdForPath('c:/users/me/code/cortx/frontend', PROJECTS), 'cortx');
  assert.equal(projectIdForPath('/home/me/site/public', PROJECTS), 'site');
});

test('a directory in no project, and a project with no root, are simply no project', () => {
  assert.equal(projectIdForPath('C:\\Users\\me\\Downloads', PROJECTS), null);
  assert.equal(projectIdForPath('', PROJECTS), null);
  assert.equal(projectIdForPath(null, PROJECTS), null);
  // A sibling whose name merely starts the same way is not inside it.
  assert.equal(projectIdForPath('C:\\Users\\me\\Code\\CortXOld\\src', PROJECTS), null);
});

test('a tab follows the project its panes are in', () => {
  assert.equal(workspaceFromCwds(tab(leaf('C:\\Users\\me\\Code\\CortX\\frontend')), PROJECTS), 'project:cortx');
  assert.equal(workspaceFromCwds(tab(leaf('C:\\Users\\me\\Downloads')), PROJECTS), FREE_WORKSPACE_ID);
});

test('a split only moves when every pane agrees', () => {
  const together = split(leaf('C:\\Users\\me\\Code\\CortX'), leaf('C:\\Users\\me\\Code\\CortX\\frontend'));
  assert.equal(workspaceFromCwds(tab(together), PROJECTS), 'project:cortx');
  const apart = split(leaf('C:\\Users\\me\\Code\\CortX'), leaf('/home/me/site'));
  assert.equal(workspaceFromCwds(tab(apart), PROJECTS), null, 'two projects, no right answer');
  const half = split(leaf('C:\\Users\\me\\Code\\CortX'), leaf('C:\\Users\\me\\Downloads'));
  assert.equal(workspaceFromCwds(tab(half), PROJECTS), null, 'one pane has left the project');
});

test('a pane that has not reported a directory abstains instead of voting', () => {
  // A restored session before its first prompt, or a shell with no
  // integration: it must not drag the tab out of its group.
  const quiet = split(leaf('C:\\Users\\me\\Code\\CortX'), leaf(undefined), leaf(null));
  assert.equal(workspaceFromCwds(tab(quiet), PROJECTS), 'project:cortx');
  // And a tab where nobody has spoken yet answers "no opinion", not "free".
  assert.equal(workspaceFromCwds(tab(split(leaf(undefined), leaf(null))), PROJECTS), null);
});

test('a drive spelled the Git Bash, Cygwin or WSL way is the same drive (#54)', () => {
  assert.equal(projectIdForPath('/c/Users/me/Code/CortX/frontend', PROJECTS), 'cortx');
  assert.equal(projectIdForPath('/c/Users/me/Code/CortX/plugins/zorg', PROJECTS), 'plugin');
  assert.equal(projectIdForPath('/cygdrive/c/Users/me/Code/CortX', PROJECTS), 'cortx');
  assert.equal(projectIdForPath('/mnt/c/Users/me/Code/CortX/src', PROJECTS), 'cortx');
  // Another drive is another place.
  assert.equal(projectIdForPath('/d/Users/me/Code/CortX', PROJECTS), null);
  // A Unix root is untouched: it is compared with itself.
  assert.equal(projectIdForPath('/home/me/site', PROJECTS), 'site');
});

test('a window on a project goes with the tab it shows (#54)', () => {
  const moved = (workspaceId: string): TerminalTab => ({ ...tab(leaf('x')), workspaceId });
  const onCortx = { projectId: 'cortx' };
  // Into another project: the window switches to it.
  const next = scopeFollowingTab(onCortx, moved('project:site'));
  assert.equal(typeof next === 'object' && next !== null && 'projectId' in next ? next.projectId : next, 'site');
  // Out of every project: Global, the only scope that still shows it.
  assert.equal(scopeFollowingTab(onCortx, moved(FREE_WORKSPACE_ID)), 'global');
  // Still in the window's project, or a window that shows every tab anyway.
  assert.equal(scopeFollowingTab(onCortx, moved('project:cortx')), null);
  assert.equal(scopeFollowingTab('global', moved('project:site')), null);
});

report();
