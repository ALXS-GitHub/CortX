/**
 * Tests for the colour maths (`color.ts`).
 *
 * Same shape as `terminalInputHit.test.ts`: pure module, plain Node, no
 * bundler and no jsdom.
 *
 *     node src/lib/color.test.ts
 *
 * What is pinned down: the picker's round trip (a colour dragged and read
 * back is the same colour), the contrast numbers the theme editor warns on,
 * and `readableOn` — which must be a **no-op on every theme CortX ships** and
 * only move the ones that genuinely cannot be read. That last property is the
 * whole reason the function is allowed to exist, so it is measured here
 * rather than asserted in a comment.
 */
import {
  CONTRAST,
  contrast,
  hsvToRgb,
  isDarkBackground,
  luminance,
  over,
  parseHex,
  readableOn,
  rgbToHsv,
  rgbToOklch,
  oklchToRgb,
  toHex,
} from './color.ts';

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
  close(actual: number, expected: number, tolerance: number, note = '') {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`expected ${expected} +/- ${tolerance}, got ${actual}${note ? ` (${note})` : ''}`);
    }
  },
};

const hex = (s: string) => {
  const c = parseHex(s);
  if (!c) throw new Error(`not a colour: ${s}`);
  return c;
};

// --- parsing ---------------------------------------------------------------

test('every hex length parses', () => {
  assert.equal(toHex(hex('#fff')), '#ffffff');
  assert.equal(toHex(hex('fff')), '#ffffff', 'the hash is optional');
  assert.equal(toHex(hex('#ffb4a8')), '#ffb4a8');
  assert.equal(toHex(hex('#0c161f6b')), '#0c161f6b', 'alpha survives the round trip');
  assert.equal(toHex(hex('#f00c')), '#ff0000cc', 'four digits expand');
});

test('a full alpha is dropped from the output', () => {
  assert.equal(toHex(hex('#ffb4a8ff')), '#ffb4a8');
});

test('what is not a colour is not guessed at', () => {
  assert.equal(parseHex(''), null);
  assert.equal(parseHex('#'), null);
  assert.equal(parseHex('#ff'), null, 'two digits mean nothing');
  assert.equal(parseHex('#fffff'), null, 'five digits mean nothing');
  assert.equal(parseHex('rebeccapurple'), null, 'named colours are not hex');
  assert.equal(parseHex('#gggggg'), null);
});

// --- the picker's coordinates ---------------------------------------------

test('rgb -> hsv -> rgb is the same colour', () => {
  for (const s of ['#000000', '#ffffff', '#ff0000', '#0d9488', '#ffb4a8', '#713d39', '#2dd4bf', '#808080']) {
    const c = hex(s);
    assert.equal(toHex(hsvToRgb(rgbToHsv(c))), s, s);
  }
});

test('hsv reads the way the picker draws it', () => {
  const red = rgbToHsv(hex('#ff0000'));
  assert.close(red.h, 0, 0.01, 'hue');
  assert.close(red.s, 1, 0.01, 'fully saturated');
  assert.close(red.v, 1, 0.01, 'fully bright');
  // Grey has no hue to speak of, and the square must not jump when it is
  // dragged to the left edge: saturation 0, value kept.
  const grey = rgbToHsv(hex('#808080'));
  assert.equal(grey.s, 0);
  assert.close(grey.v, 128 / 255, 0.001);
});

test('alpha rides along untouched', () => {
  assert.close(rgbToHsv(hex('#ff000080')).a, 128 / 255, 0.001);
  assert.equal(toHex(hsvToRgb({ h: 0, s: 1, v: 1, a: 0.5 })), '#ff000080');
});

// --- contrast --------------------------------------------------------------

test('the extremes are the textbook numbers', () => {
  assert.close(contrast(hex('#000000'), hex('#ffffff')), 21, 0.01);
  assert.close(contrast(hex('#ffffff'), hex('#ffffff')), 1, 0.001);
  assert.close(luminance(hex('#ffffff')), 1, 0.001);
  assert.close(luminance(hex('#000000')), 0, 0.001);
});

test("the case that started all this: aespa's accent on its own background", () => {
  // The theme shipped `accent: #0c161f` on `background: #713d39`, and CortX
  // paints the accent as text. 2.1:1 is why the running command read black.
  assert.close(contrast(hex('#0c161f'), hex('#713d39')), 2.11, 0.02);
  // What it was changed to.
  assert.ok(contrast(hex('#ffb4a8'), hex('#713d39')) >= CONTRAST.text, 'the replacement reads');
});

test('a translucent colour is judged on what it looks like, not on what it is', () => {
  // A selection wash is alpha over the canvas; the ratio that matters is the
  // one against the flattened result.
  const wash = over({ ...hex('#0c161f'), a: 0.42 }, hex('#713d39'));
  assert.equal(toHex(wash), '#472d2e');
  assert.ok(contrast(hex('#ffffff'), wash) > 10, 'white still reads on it');
});

// --- OKLCh -----------------------------------------------------------------

test('rgb -> oklch -> rgb is the same colour', () => {
  for (const s of ['#000000', '#ffffff', '#ff0000', '#0d9488', '#ffb4a8', '#713d39', '#bd93f9']) {
    assert.equal(toHex(oklchToRgb(rgbToOklch(hex(s)))), s, s);
  }
});

test('oklch lightness orders colours the way the eye does', () => {
  // The HSL trap: these two claim the same 50 % lightness there.
  const yellow = rgbToOklch(hex('#ffff00'));
  const blue = rgbToOklch(hex('#0000ff'));
  assert.ok(yellow.l > blue.l, 'yellow is lighter than blue');
});

// --- readableOn ------------------------------------------------------------

test('readableOn leaves every theme CortX ships alone', () => {
  const shipped: Array<[string, string, string]> = [
    ['Dracula', '#bd93f9', '#282a36'],
    ['Nord', '#88c0d0', '#2e3440'],
    ['Halcyon Dark', '#2dd4bf', '#0f1b1f'],
    ['Light Modern', '#005fb8', '#ffffff'],
    ['Gruvbox-ish', '#fabd2f', '#282828'],
  ];
  for (const [name, accent, background] of shipped) {
    const fixed = readableOn(hex(accent), hex(background));
    assert.equal(toHex(fixed), accent.toLowerCase(), `${name} must not be touched`);
  }
});

test('readableOn rescues the ones that cannot be read', () => {
  const cases: Array<[string, string, string]> = [
    ['aespa on its wallpaper red', '#0c161f', '#713d39'],
    ['amber on a white app', '#f59e0b', '#ffffff'],
    ['halcyon light teal', '#0d9488', '#eaf4f5'],
  ];
  for (const [name, accent, background] of cases) {
    const bg = hex(background);
    const before = contrast(hex(accent), bg);
    const after = readableOn(hex(accent), bg);
    assert.ok(before < CONTRAST.text, `${name} starts unreadable`);
    assert.ok(contrast(after, bg) >= CONTRAST.text, `${name} ends readable`);
  }
});

test('readableOn keeps the hue it was given', () => {
  // The point of moving lightness only: amber must still look like amber.
  const before = rgbToOklch(hex('#f59e0b'));
  const after = rgbToOklch(readableOn(hex('#f59e0b'), hex('#ffffff')));
  assert.close(after.h, before.h, 12, 'hue drifts by less than a name');
  assert.ok(after.l < before.l, 'on a white background it goes darker');
});

test('readableOn goes lighter on a dark background and darker on a light one', () => {
  const onDark = readableOn(hex('#1a1a2e'), hex('#101010'));
  const onLight = readableOn(hex('#eeeeff'), hex('#fafafa'));
  assert.ok(luminance(onDark) > luminance(hex('#1a1a2e')), 'lifted');
  assert.ok(luminance(onLight) < luminance(hex('#eeeeff')), 'lowered');
});

test('readableOn always returns something, even against mid grey', () => {
  // Neither direction can reach 4.5 from here; it must still hand back the
  // best it found rather than the unreadable input.
  const grey = hex('#777777');
  const fixed = readableOn(hex('#787878'), grey);
  assert.ok(contrast(fixed, grey) > contrast(hex('#787878'), grey), 'improved as far as it could');
});

test('a glyph is allowed less contrast than a word', () => {
  const bg = hex('#713d39');
  const icon = readableOn(hex('#ff8272'), bg, CONTRAST.ui);
  assert.equal(toHex(icon), '#ff8272', '3.58:1 already passes the icon bar');
  assert.ok(toHex(readableOn(hex('#ff8272'), bg, CONTRAST.text)) !== '#ff8272', 'but not the text one');
});

// --- dark or light ---------------------------------------------------------

test('dark and light are read off the background, never declared', () => {
  assert.equal(isDarkBackground(hex('#713d39')), true, 'aespa is dark however it is labelled');
  assert.equal(isDarkBackground(hex('#282a36')), true, 'dracula');
  assert.equal(isDarkBackground(hex('#0f1b1f')), true, 'halcyon dark');
  assert.equal(isDarkBackground(hex('#eaf4f5')), false, 'halcyon light');
  assert.equal(isDarkBackground(hex('#ffffff')), false, 'white');
  // The threshold is linear light, not the 50 % a human would guess.
  assert.equal(isDarkBackground(hex('#767676')), false, 'mid grey counts as light');
});

console.log(`color: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  x ${f}`);
  throw new Error(`${failures.length} test(s) failed`);
}
