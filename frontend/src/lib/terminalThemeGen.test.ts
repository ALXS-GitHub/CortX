/**
 * Tests for "an image becomes a theme" (`terminalThemeGen.ts`).
 *
 *     node src/lib/terminalThemeGen.test.ts
 *
 * The property worth a test file is not "the colours are pretty" — nothing
 * can assert that — it is **every variant of every image is legible**. So the
 * suite feeds in synthetic images chosen to be hostile (a nearly black photo,
 * a nearly white one, a single flat colour, one hue only) and asserts the
 * contrast floors on all five variants of each.
 *
 * That is the check that would have caught what shipped: `aespa_wda`'s accent
 * at 2.1:1 on its own background, and the same ratio for the app's own Amber
 * preset on a light canvas.
 */
import { CONTRAST, contrast, isDarkBackground, parseHex } from './color.ts';
import {
  ansiFloor,
  auditTheme,
  paletteFromColor,
  quantize,
  synthesize,
  variants,
  VARIANTS,
  type AnsiSet,
  type Swatch,
  type ThemeDraft,
} from './terminalThemeGen.ts';

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
  ok(value: unknown, note = '') {
    if (!value) throw new Error(`expected truthy${note ? ` (${note})` : ''}`);
  },
};

const hex = (s: string) => {
  const c = parseHex(s);
  if (!c) throw new Error(`not a colour: ${s}`);
  return c;
};
const ratio = (a: string, b: string) => contrast(hex(a), hex(b));

/** An "image": a flat run of RGBA bytes per colour, in the given proportions. */
function image(parts: Array<[string, number]>): Uint8ClampedArray {
  const out: number[] = [];
  for (const [colour, count] of parts) {
    const c = hex(colour);
    for (let i = 0; i < count; i++) out.push(c.r, c.g, c.b, 255);
  }
  return Uint8ClampedArray.from(out);
}

// --- quantisation ----------------------------------------------------------

test('a flat image yields its one colour', () => {
  const p = quantize(image([['#713d39', 400]]), 8, 1);
  assert.ok(p.length >= 1);
  assert.equal(Math.round(p[0].color.r), 113);
  assert.equal(Math.round(p[0].color.g), 61);
  assert.equal(Math.round(p[0].color.b), 57);
  assert.equal(Math.round(p[0].weight * 100), 100, 'it is all of the image');
});

test('the palette is ordered by how much of the image each colour is', () => {
  const p = quantize(image([['#ff0000', 800], ['#00ff00', 200], ['#0000ff', 100]]), 3, 1);
  assert.equal(p.length, 3);
  assert.ok(p[0].weight > p[1].weight && p[1].weight > p[2].weight, 'sorted by weight');
  assert.ok(p[0].color.r > 200 && p[0].color.g < 60, 'the dominant one is the red');
});

test('transparent pixels are not colours', () => {
  // A cut-out PNG: the empty corners decode to black and would otherwise win.
  const solid = hex('#2dd4bf');
  const bytes: number[] = [];
  for (let i = 0; i < 100; i++) bytes.push(0, 0, 0, 0);
  for (let i = 0; i < 100; i++) bytes.push(solid.r, solid.g, solid.b, 255);
  const p = quantize(Uint8ClampedArray.from(bytes), 4, 1);
  assert.ok(p.length >= 1);
  assert.ok(p[0].color.g > 150, 'the teal, not the transparent black');
});

test('an empty image does not throw', () => {
  assert.equal(quantize(new Uint8ClampedArray(0), 8, 1).length, 0);
  assert.equal(variants([]).length, 5, 'and the variants still come back');
});

// --- the floors every variant must clear -----------------------------------

const ANSI_NAMES: Array<keyof AnsiSet> = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
];

function assertLegible(draft: ThemeDraft, label: string) {
  const bg = draft.background;
  const fg = ratio(draft.foreground, bg);
  assert.ok(fg >= 7, `${label}: foreground is ${fg.toFixed(2)}:1, wanted 7`);
  const ac = ratio(draft.accent, bg);
  assert.ok(ac >= CONTRAST.text, `${label}: accent is ${ac.toFixed(2)}:1, wanted ${CONTRAST.text}`);
  const dark = isDarkBackground(hex(bg));
  for (const set of ['normal', 'bright'] as const) {
    for (const name of ANSI_NAMES) {
      // Each colour owes what its job owes: the dim tone at the canvas's own
      // end only has to be visible, the other fourteen owe the glyph floor.
      const floor = ansiFloor(name, dark, set === 'bright');
      const r = ratio(draft[set][name], bg);
      assert.ok(r >= floor, `${label}: ${set}.${name} is ${r.toFixed(2)}:1, wanted ${floor}`);
    }
  }
  // The dim pair must still be a scale, and which end is the fainter flips
  // with the theme: on a dark canvas the scale runs away from it, so
  // brightBlack is the more visible grey; on a light one brightWhite is the
  // whitest white and therefore the nearest to the canvas.
  const dim = dark ? 'black' : 'white';
  const brighter = ratio(draft.bright[dim], bg);
  const normal = ratio(draft.normal[dim], bg);
  assert.ok(
    dark ? brighter > normal : normal > brighter,
    `${label}: the ${dim} pair is not a scale (normal ${normal.toFixed(2)}, bright ${brighter.toFixed(2)})`
  );
  // The field that caused the original bug must agree with the colours.
  assert.equal(draft.details, dark ? 'darker' : 'lighter', `${label}: details matches the background`);
}

const HOSTILE: Array<[string, Swatch[]]> = [
  ['the aespa wallpaper (dark red)', quantize(image([['#713d39', 500], ['#2a1512', 300], ['#c0574e', 120], ['#0c161f', 80]]), 8, 1)],
  ['almost black', quantize(image([['#050508', 900], ['#101018', 100]]), 8, 1)],
  ['almost white', quantize(image([['#fafafa', 900], ['#eeeef4', 100]]), 8, 1)],
  ['one flat mid grey', quantize(image([['#777777', 500]]), 8, 1)],
  ['a single hue, no reds at all', quantize(image([['#0b3d2e', 400], ['#126b4f', 300], ['#1fae80', 200]]), 8, 1)],
  ['a saturated sunset', quantize(image([['#ff6b35', 300], ['#f7c59f', 250], ['#2a1b3d', 250], ['#efefd0', 200]]), 8, 1)],
  ['from a single colour, no image', paletteFromColor(hex('#0d9488'))],
  ['from a near-black colour', paletteFromColor(hex('#0c161f'))],
];

for (const [name, palette] of HOSTILE) {
  test(`every variant of ${name} is legible`, () => {
    for (const draft of variants(palette)) {
      assertLegible(draft, `${name}/${draft.kind}`);
    }
  });
}

test('all five variants are offered and named', () => {
  const drafts = variants(HOSTILE[0][1]);
  assert.equal(drafts.length, 5);
  assert.equal(drafts.map((d) => d.kind).join(','), VARIANTS.map((v) => v.kind).join(','));
});

test('the variants are actually different themes', () => {
  const drafts = variants(HOSTILE[5][1]);
  const backgrounds = new Set(drafts.map((d) => d.background));
  assert.ok(backgrounds.size >= 3, `expected distinct canvases, got ${[...backgrounds].join(' ')}`);
  const light = drafts.find((d) => d.kind === 'light');
  const dark = drafts.find((d) => d.kind === 'dark');
  assert.equal(light?.details, 'lighter');
  assert.equal(dark?.details, 'darker');
});

test('vivid picks a bolder accent than muted', () => {
  const palette = HOSTILE[5][1];
  const vivid = synthesize(palette, 'vivid');
  const muted = synthesize(palette, 'muted');
  assert.ok(vivid.accent !== muted.accent, 'they are not the same colour');
});

// --- the audit the editor shows -------------------------------------------

test('the audit names the bug that started all this', () => {
  const warnings = auditTheme({
    background: '#713d39',
    foreground: '#ffffff',
    accent: '#0c161f',
    details: 'darker',
  });
  const accent = warnings.find((w) => w.field === 'accent');
  assert.ok(accent, 'the accent is reported');
  assert.equal(accent?.severity, 'error');
  assert.ok(accent?.message.includes('2.11'), `got: ${accent?.message}`);
  assert.ok(!warnings.some((w) => w.field === 'foreground'), 'white on that red is fine');
});

test('the audit catches a details that contradicts the colours', () => {
  // Exactly the "make it a light theme" idea: flipping the label alone.
  const warnings = auditTheme({
    background: '#713d39',
    foreground: '#ffffff',
    accent: '#ffb4a8',
    details: 'lighter',
  });
  const d = warnings.find((w) => w.field === 'details');
  assert.ok(d, 'reported');
  assert.equal(d?.severity, 'error');
});

test('the audit is silent on a theme that is fine', () => {
  assert.equal(
    auditTheme({ background: '#282a36', foreground: '#f8f8f2', accent: '#bd93f9', details: 'darker' }).length,
    0,
    'Dracula has nothing to answer for'
  );
});

test('a generated theme never trips its own audit', () => {
  for (const [name, palette] of HOSTILE) {
    for (const draft of variants(palette)) {
      const warnings = auditTheme(draft);
      assert.equal(warnings.length, 0, `${name}/${draft.kind}: ${warnings.map((w) => `${w.field} ${w.message}`).join('; ')}`);
    }
  }
});

test('the audit reports what is not a colour instead of guessing', () => {
  const w = auditTheme({ background: '#282a36', foreground: 'nope', accent: '#bd93f9' });
  assert.equal(w.length, 1);
  assert.equal(w[0].field, 'foreground');
  assert.equal(w[0].severity, 'error');
});

console.log(`terminalThemeGen: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  x ${f}`);
  throw new Error(`${failures.length} test(s) failed`);
}
