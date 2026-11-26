/**
 * Tests for the image paths the agent view finds in a message (`imagePaths.ts`).
 *
 *     node src/components/terminal/agent-view/imagePaths.test.ts
 */
import { imagePathsIn } from './imagePaths.ts';

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

function equal(actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

test('absolute paths, Windows and POSIX', () => {
  equal(imagePathsIn('Saved to C:\\shots\\home.png, and /tmp/out/a.jpg.'), ['C:\\shots\\home.png', '/tmp/out/a.jpg']);
  equal(imagePathsIn('see ~/Pictures/x.webp'), ['~/Pictures/x.webp']);
});

test('relative paths need a folder', () => {
  equal(imagePathsIn('I updated logo.png'), []);
  equal(imagePathsIn('Look at ./docs/flow.svg and docs/b.PNG'), ['./docs/flow.svg', 'docs/b.PNG']);
});

test('quoted and backticked paths may hold spaces', () => {
  equal(imagePathsIn('The capture is in `C:\\My Shots\\a b.png`.'), ['C:\\My Shots\\a b.png']);
  equal(imagePathsIn('"/Users/me/Screen Shot 1.png"'), ['/Users/me/Screen Shot 1.png']);
});

test('links and embedded images are left out', () => {
  equal(imagePathsIn('https://example.com/img/a.png'), []);
  equal(imagePathsIn('![shot](./a/b.png) and ./a/c.png'), ['./a/c.png']);
});

test('each path once, in order', () => {
  equal(imagePathsIn('`/a/b.png` then /a/b.png then /c/d.gif'), ['/a/b.png', '/c/d.gif']);
});

test('not an image, nothing', () => {
  equal(imagePathsIn('src/main.ts and C:\\x\\y.txt'), []);
  equal(imagePathsIn(''), []);
});

if (failures.length > 0) {
  console.error(`imagePaths: ${failures.length} failed, ${passed} passed\n  ${failures.join('\n  ')}`);
  throw new Error(`${failures.length} test(s) failed`);
}
console.log(`imagePaths: ${passed} passed`);
