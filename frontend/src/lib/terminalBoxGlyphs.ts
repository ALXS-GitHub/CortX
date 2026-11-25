/**
 * Box drawing, block elements and Powerline separators drawn as vectors, the
 * way xterm draws them (`customGlyphs`), for the block layout's page rows.
 *
 * A font glyph cannot do it: its vertical placement in the cell comes from the
 * font's ascent and descent, not from the cell, so `╭` and `╰` on two rows do
 * not meet, and a Powerline arrow stretched to the row overshoots the coloured
 * band it closes. Drawn from the cell's own size, a vertical line reaches both
 * edges of its row and a separator is exactly as tall as its band.
 *
 * Coordinates are CSS px inside one SVG per run of cells (`x0` is the cell's
 * left edge in it). Everything is filled or stroked with `currentColor`, so
 * the run's colour (bold, dim, inverse…) applies as for text.
 */

/** Arms of a line glyph, in the order up, right, down, left: 0 none, 1 light, 2 heavy, 3 double. */
const ARMS: Record<number, string> = {
  0x2500: '0101', 0x2501: '0202', 0x2502: '1010', 0x2503: '2020',
  0x250c: '0110', 0x250d: '0210', 0x250e: '0120', 0x250f: '0220',
  0x2510: '0011', 0x2511: '0012', 0x2512: '0021', 0x2513: '0022',
  0x2514: '1100', 0x2515: '1200', 0x2516: '2100', 0x2517: '2200',
  0x2518: '1001', 0x2519: '1002', 0x251a: '2001', 0x251b: '2002',
  0x251c: '1110', 0x251d: '1210', 0x251e: '2110', 0x251f: '1120',
  0x2520: '2120', 0x2521: '2210', 0x2522: '1220', 0x2523: '2220',
  0x2524: '1011', 0x2525: '1012', 0x2526: '2011', 0x2527: '1021',
  0x2528: '2021', 0x2529: '2012', 0x252a: '1022', 0x252b: '2022',
  0x252c: '0111', 0x252d: '0112', 0x252e: '0211', 0x252f: '0212',
  0x2530: '0121', 0x2531: '0122', 0x2532: '0221', 0x2533: '0222',
  0x2534: '1101', 0x2535: '1102', 0x2536: '1201', 0x2537: '1202',
  0x2538: '2101', 0x2539: '2102', 0x253a: '2201', 0x253b: '2202',
  0x253c: '1111', 0x253d: '1112', 0x253e: '1211', 0x253f: '1212',
  0x2540: '2111', 0x2541: '1121', 0x2542: '2121', 0x2543: '2112',
  0x2544: '2211', 0x2545: '1122', 0x2546: '1221', 0x2547: '2212',
  0x2548: '1222', 0x2549: '2122', 0x254a: '2221', 0x254b: '2222',
  0x2550: '0303', 0x2551: '3030', 0x2552: '0310', 0x2553: '0130',
  0x2554: '0330', 0x2555: '0013', 0x2556: '0031', 0x2557: '0033',
  0x2558: '1300', 0x2559: '3100', 0x255a: '3300', 0x255b: '1003',
  0x255c: '3001', 0x255d: '3003', 0x255e: '1310', 0x255f: '3130',
  0x2560: '3330', 0x2561: '1013', 0x2562: '3031', 0x2563: '3033',
  0x2564: '0313', 0x2565: '0131', 0x2566: '0333', 0x2567: '1303',
  0x2568: '3101', 0x2569: '3303', 0x256a: '1313', 0x256b: '3131',
  0x256c: '3333',
  0x2574: '0001', 0x2575: '1000', 0x2576: '0100', 0x2577: '0010',
  0x2578: '0002', 0x2579: '2000', 0x257a: '0200', 0x257b: '0020',
  0x257c: '0201', 0x257d: '1020', 0x257e: '0102', 0x257f: '2010',
};

/** Dashed lines: [horizontal?, heavy?, dashes]. */
const DASHES: Record<number, [boolean, boolean, number]> = {
  0x2504: [true, false, 3], 0x2505: [true, true, 3], 0x2506: [false, false, 3], 0x2507: [false, true, 3],
  0x2508: [true, false, 4], 0x2509: [true, true, 4], 0x250a: [false, false, 4], 0x250b: [false, true, 4],
  0x254c: [true, false, 2], 0x254d: [true, true, 2], 0x254e: [false, false, 2], 0x254f: [false, true, 2],
};

/** Quadrants (2596–259F): bits upper-left 1, upper-right 2, lower-left 4, lower-right 8. */
const QUADRANTS: Record<number, number> = {
  0x2596: 4, 0x2597: 8, 0x2598: 1, 0x2599: 1 | 4 | 8, 0x259a: 1 | 8,
  0x259b: 1 | 2 | 4, 0x259c: 1 | 2 | 8, 0x259d: 2, 0x259e: 2 | 4, 0x259f: 2 | 4 | 8,
};

/** Does this character have a drawing of its own here? */
export function hasBoxGlyph(ch: string): boolean {
  if (ch.length > 2) return false;
  const c = ch.codePointAt(0) ?? 0;
  return (
    ARMS[c] !== undefined ||
    DASHES[c] !== undefined ||
    (c >= 0x256d && c <= 0x2573) ||
    (c >= 0x2580 && c <= 0x259f) ||
    (c >= 0xe0b0 && c <= 0xe0bf)
  );
}

const n = (v: number) => Math.round(v * 100) / 100;
const rect = (x1: number, y1: number, x2: number, y2: number) =>
  x2 > x1 && y2 > y1 ? `<rect x="${n(x1)}" y="${n(y1)}" width="${n(x2 - x1)}" height="${n(y2 - y1)}"/>` : '';
const stroke = (d: string, w: number) =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${n(w)}" stroke-linecap="butt"/>`;
const fill = (d: string) => `<path d="${d}"/>`;

/** Line weights of a cell `w` × `h` px. */
function weights(w: number, h: number) {
  const light = Math.max(1, Math.round(Math.min(w, h * 0.5) / 8));
  return { light, heavy: Math.max(2, light * 2), gap: Math.max(2, light * 2) };
}

/** Shapes of one cell, its left edge at `x0`. */
function cellShapes(code: number, x0: number, w: number, h: number): string {
  const { light, heavy, gap } = weights(w, h);
  const x1 = x0 + w;
  // Centres snapped so a light line is crisp and the same on every row.
  const cx = Math.round(x0 + w / 2 - light / 2) + light / 2;
  const cy = Math.round(h / 2 - light / 2) + light / 2;

  const arms = ARMS[code];
  if (arms) {
    const [u, r, d, l] = arms.split('').map(Number);
    const width = (k: number) => (k === 1 ? light : k === 2 ? heavy : k === 3 ? gap * 2 + light : 0);
    const half = light / 2;
    let out = '';
    // Horizontal arms.
    for (const side of ['r', 'l'] as const) {
      const k = side === 'r' ? r : l;
      if (!k) continue;
      const far = side === 'r' ? x1 : x0;
      const span = (from: number) => (side === 'r' ? [from, far] : [far, 2 * cx - from]);
      if (k === 3) {
        // Two lines; each stops where the vertical it meets is.
        const inner = (a: number, b: number) =>
          a ? (a === 3 ? cx + gap - half : cx - width(a) / 2) : b ? (b === 3 ? cx - gap - half : cx - width(b) / 2) : cx - gap - half;
        const [ta, tb] = span(inner(u, d));
        const [ba, bb] = span(inner(d, u));
        out += rect(Math.min(ta, tb), cy - gap - half, Math.max(ta, tb), cy - gap + half);
        out += rect(Math.min(ba, bb), cy + gap - half, Math.max(ba, bb), cy + gap + half);
      } else {
        const t = width(k);
        const start = u === 3 && d === 3 ? cx + gap - half : cx - Math.max(width(u), width(d), t) / 2;
        const [a, b] = span(start);
        out += rect(Math.min(a, b), Math.round(cy - t / 2), Math.max(a, b), Math.round(cy - t / 2) + t);
      }
    }
    // Vertical arms.
    for (const side of ['d', 'u'] as const) {
      const k = side === 'd' ? d : u;
      if (!k) continue;
      const far = side === 'd' ? h : 0;
      const span = (from: number) => (side === 'd' ? [from, far] : [far, 2 * cy - from]);
      if (k === 3) {
        const inner = (a: number, b: number) =>
          a ? (a === 3 ? cy + gap - half : cy - width(a) / 2) : b ? (b === 3 ? cy - gap - half : cy - width(b) / 2) : cy - gap - half;
        const [la, lb] = span(inner(l, r));
        const [ra, rb] = span(inner(r, l));
        out += rect(cx - gap - half, Math.min(la, lb), cx - gap + half, Math.max(la, lb));
        out += rect(cx + gap - half, Math.min(ra, rb), cx + gap + half, Math.max(ra, rb));
      } else {
        const t = width(k);
        const start = l === 3 && r === 3 ? cy + gap - half : cy - Math.max(width(l), width(r), t) / 2;
        const [a, b] = span(start);
        const left = Math.round(cx - t / 2);
        out += rect(left, Math.min(a, b), left + t, Math.max(a, b));
      }
    }
    return out;
  }

  const dash = DASHES[code];
  if (dash) {
    const [horizontal, isHeavy, count] = dash;
    const t = isHeavy ? heavy : light;
    const length = horizontal ? w : h;
    const slot = length / count;
    const space = Math.max(1, slot * 0.35);
    let out = '';
    for (let i = 0; i < count; i++) {
      const a = i * slot + space / 2;
      const b = (i + 1) * slot - space / 2;
      if (horizontal) out += rect(x0 + a, Math.round(cy - t / 2), x0 + b, Math.round(cy - t / 2) + t);
      else {
        const left = Math.round(cx - t / 2);
        out += rect(left, a, left + t, b);
      }
    }
    return out;
  }

  // Rounded corners and diagonals.
  if (code >= 0x256d && code <= 0x2570) {
    // As round as the cell allows without the arc leaving it.
    const radius = Math.max(1, Math.min(x1 - cx, cx - x0, h - cy, cy));
    const paths: Record<number, string> = {
      0x256d: `M${n(x1)} ${n(cy)}H${n(cx + radius)}A${n(radius)} ${n(radius)} 0 0 0 ${n(cx)} ${n(cy + radius)}V${n(h)}`,
      0x256e: `M${n(x0)} ${n(cy)}H${n(cx - radius)}A${n(radius)} ${n(radius)} 0 0 1 ${n(cx)} ${n(cy + radius)}V${n(h)}`,
      0x256f: `M${n(cx)} 0V${n(cy - radius)}A${n(radius)} ${n(radius)} 0 0 1 ${n(cx - radius)} ${n(cy)}H${n(x0)}`,
      0x2570: `M${n(cx)} 0V${n(cy - radius)}A${n(radius)} ${n(radius)} 0 0 0 ${n(cx + radius)} ${n(cy)}H${n(x1)}`,
    };
    return stroke(paths[code], light);
  }
  if (code >= 0x2571 && code <= 0x2573) {
    const forward = `M${n(x1)} 0L${n(x0)} ${n(h)}`;
    const back = `M${n(x0)} 0L${n(x1)} ${n(h)}`;
    return stroke(code === 0x2571 ? forward : code === 0x2572 ? back : `${forward}${back}`, light);
  }

  // Block elements.
  if (code >= 0x2580 && code <= 0x259f) {
    if (code === 0x2580) return rect(x0, 0, x1, h / 2);
    if (code >= 0x2581 && code <= 0x2588) return rect(x0, h - (h * (code - 0x2580)) / 8, x1, h);
    if (code >= 0x2589 && code <= 0x258f) return rect(x0, 0, x0 + (w * (0x2590 - code)) / 8, h);
    if (code === 0x2590) return rect(x0 + w / 2, 0, x1, h);
    if (code >= 0x2591 && code <= 0x2593) {
      const opacity = (code - 0x2590) * 0.25;
      return `<rect x="${n(x0)}" y="0" width="${n(w)}" height="${n(h)}" fill-opacity="${opacity}"/>`;
    }
    if (code === 0x2594) return rect(x0, 0, x1, h / 8);
    if (code === 0x2595) return rect(x1 - w / 8, 0, x1, h);
    const q = QUADRANTS[code] ?? 0;
    const mx = x0 + w / 2;
    const my = h / 2;
    return (
      (q & 1 ? rect(x0, 0, mx, my) : '') +
      (q & 2 ? rect(mx, 0, x1, my) : '') +
      (q & 4 ? rect(x0, my, mx, h) : '') +
      (q & 8 ? rect(mx, my, x1, h) : '')
    );
  }

  // Powerline. A solid shape reaches half a pixel past its flat side, under
  // the band it continues: on a fractional cell edge the two would otherwise
  // leave a hairline seam between them.
  const my = h / 2;
  const a0 = x0 - 0.5;
  const a1 = x1 + 0.5;
  switch (code) {
    case 0xe0b0: return fill(`M${n(a0)} 0L${n(x1)} ${n(my)}L${n(a0)} ${n(h)}Z`);
    case 0xe0b1: return stroke(`M${n(x0)} 0L${n(x1 - light / 2)} ${n(my)}L${n(x0)} ${n(h)}`, light);
    case 0xe0b2: return fill(`M${n(a1)} 0L${n(x0)} ${n(my)}L${n(a1)} ${n(h)}Z`);
    case 0xe0b3: return stroke(`M${n(x1)} 0L${n(x0 + light / 2)} ${n(my)}L${n(x1)} ${n(h)}`, light);
    case 0xe0b4: return fill(`M${n(a0)} 0H${n(x0)}A${n(w)} ${n(my)} 0 0 1 ${n(x0)} ${n(h)}H${n(a0)}Z`);
    case 0xe0b5: return stroke(`M${n(x0)} 0A${n(w - light / 2)} ${n(my)} 0 0 1 ${n(x0)} ${n(h)}`, light);
    case 0xe0b6: return fill(`M${n(a1)} 0H${n(x1)}A${n(w)} ${n(my)} 0 0 0 ${n(x1)} ${n(h)}H${n(a1)}Z`);
    case 0xe0b7: return stroke(`M${n(x1)} 0A${n(w - light / 2)} ${n(my)} 0 0 0 ${n(x1)} ${n(h)}`, light);
    case 0xe0b8: return fill(`M${n(x0)} 0L${n(x1)} ${n(h)}L${n(x0)} ${n(h)}Z`);
    case 0xe0ba: return fill(`M${n(x1)} 0L${n(x1)} ${n(h)}L${n(x0)} ${n(h)}Z`);
    case 0xe0bc: return fill(`M${n(x0)} 0L${n(x1)} 0L${n(x0)} ${n(h)}Z`);
    case 0xe0be: return fill(`M${n(x0)} 0L${n(x1)} 0L${n(x1)} ${n(h)}Z`);
    case 0xe0b9:
    case 0xe0bf: return stroke(`M${n(x0)} 0L${n(x1)} ${n(h)}`, light);
    case 0xe0bb:
    case 0xe0bd: return stroke(`M${n(x1)} 0L${n(x0)} ${n(h)}`, light);
  }
  return '';
}

/**
 * One SVG for a run of drawn cells (`chars`, one per cell), `cellWidth` ×
 * `cellHeight` px each. Laid over the run's own (transparent) text, which
 * stays for selection and copy.
 */
export function boxGlyphSvg(chars: string[], cellWidth: number, cellHeight: number): string {
  let shapes = '';
  for (let i = 0; i < chars.length; i++) shapes += cellShapes(chars[i].codePointAt(0) ?? 0, i * cellWidth, cellWidth, cellHeight);
  const w = n(chars.length * cellWidth);
  const h = n(cellHeight);
  return `<svg class="g" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${shapes}</svg>`;
}
