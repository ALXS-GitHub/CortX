/**
 * Tests for the agent prompt's paste sequence (`agentPromptParts.ts`).
 *
 *     node src/components/terminal/agentPromptParts.test.ts
 *
 * What is pinned down: an image lands where its `[Image #N]` marker is in the
 * text — the text before it, its path alone, the text after — and a marker
 * the user deleted (or typed by hand) does not send an image.
 */
import {
  eraseMarker,
  imageMarker,
  markerSpans,
  nextImageNumber,
  promptParts,
  snapCaret,
  visibleAttachments,
  type PromptAttachment,
} from './agentPromptParts.ts';

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

const img = (n: number, path = `C:/cache/img${n}.png`): PromptAttachment => ({ path, name: `img${n}.png`, image: true, n });

test('an image is pasted where its marker is', () => {
  equal(promptParts(`look at ${imageMarker(1)} and fix it`, [img(1)]), [
    { kind: 'text', text: 'look at ' },
    { kind: 'image', path: 'C:/cache/img1.png' },
    { kind: 'text', text: ' and fix it' },
  ]);
});

test('two images keep their order and the text between them', () => {
  equal(promptParts(`${imageMarker(2)} vs ${imageMarker(1)}`, [img(1), img(2)]), [
    { kind: 'image', path: 'C:/cache/img2.png' },
    { kind: 'text', text: ' vs ' },
    { kind: 'image', path: 'C:/cache/img1.png' },
  ]);
});

test('a path with spaces is quoted, as a dropped file is', () => {
  equal(promptParts(imageMarker(1), [img(1, 'C:/Users/Alexis Munch/a.png')]), [{ kind: 'image', path: '"C:/Users/Alexis Munch/a.png"' }]);
});

test('a marker typed by hand is text; a deleted marker sends nothing', () => {
  equal(promptParts(`see ${imageMarker(7)}`, [img(1)]), [{ kind: 'text', text: `see ${imageMarker(7)}` }]);
  equal(visibleAttachments('no marker left', [img(1)]), []);
});

test('files go last as paths; older images without a marker go first', () => {
  const file: PromptAttachment = { path: 'C:/src/main.rs', name: 'main.rs', image: false };
  const legacy: PromptAttachment = { path: 'C:/old.png', name: 'old.png', image: true };
  equal(promptParts('read this  ', [legacy, file]), [
    { kind: 'image', path: 'C:/old.png' },
    { kind: 'text', text: 'read this\n\nC:/src/main.rs' },
  ]);
});

test('numbers keep counting up', () => {
  equal(nextImageNumber([]), 1);
  equal(nextImageNumber([img(1), img(3)]), 4);
});

test('a marker is erased whole, with the space it was set off with', () => {
  const text = `see ${imageMarker(1)} now`;
  const spans = markerSpans(text, [img(1)]);
  equal(spans, [{ start: 4, end: 14, n: 1 }]);
  equal(eraseMarker(text, spans, 14, 14, 'Backspace'), { text: 'see now', caret: 3 });
  equal(eraseMarker(text, spans, 4, 4, 'Delete'), { text: 'see now', caret: 3 });
  equal(eraseMarker(text, spans, 9, 9, 'Backspace'), { text: 'see now', caret: 3 });
  equal(eraseMarker(text, spans, 3, 3, 'Backspace'), null);
  equal(eraseMarker(text, spans, 15, 15, 'Delete'), null);
});

test('a selection over part of a marker takes all of it', () => {
  const text = `a ${imageMarker(2)}b`;
  const spans = markerSpans(text, [img(2)]);
  equal(eraseMarker(text, spans, 0, 5, 'Backspace'), { text: 'b', caret: 0 });
  equal(eraseMarker('plain', [], 0, 2, 'Delete'), null);
});

test('a hand-typed marker is not one piece', () => {
  equal(markerSpans(`x ${imageMarker(9)}`, [img(1)]), []);
});

test('a caret inside a marker goes to an edge', () => {
  const spans = [{ start: 4, end: 14, n: 1 }];
  equal(snapCaret(spans, 6), 4);
  equal(snapCaret(spans, 12), 14);
  equal(snapCaret(spans, 6, 'end'), 14);
  equal(snapCaret(spans, 14), 14);
});

console.log(`agentPromptParts: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  throw new Error(`${failures.length} test(s) failed`);
}
