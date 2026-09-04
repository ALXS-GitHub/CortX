/**
 * The glyphs of the block toolbar (DEV-13 P4, ticket #7).
 *
 * The blocks overlay is plain DOM — it lives beside the xterm instance, not
 * inside React, so `lucide-react` is not reachable from it. These are the same
 * Lucide outlines, kept as bare path data and stamped into a 24×24 stroked
 * `<svg>` by `blockIconSvg`. Everything inherits `currentColor`, so the
 * toolbar follows the terminal palette like the rest of the overlay.
 */
import type { BlockActionId } from '@/lib/terminalBlockModel';

/** `⋯`, the toolbar button that opens the full menu. */
export type BlockIconId = BlockActionId | 'more';

/** Lucide path data, one entry per `<path d="…">` of the icon. */
const PATHS: Record<BlockIconId, string[]> = {
  // terminal — the command line itself
  copyCommand: ['m4 17 6-6-6-6', 'M12 19h8'],
  // text-align-left — the lines a command printed
  copyOutput: ['M21 6H3', 'M15 12H3', 'M17 18H3'],
  // copy — command and output together
  copyBlock: [
    'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Z',
    'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  ],
  // hash — Markdown
  copyMarkdown: ['M4 9h16', 'M4 15h16', 'M10 3 8 21', 'M16 3l-2 18'],
  // refresh-cw — run it again
  rerun: ['M21 12a9 9 0 1 1-2.64-6.36', 'M21 3v6h-6'],
  // corner-down-left — put the command back on the prompt line
  reinput: ['m9 10-5 5 5 5', 'M20 4v7a4 4 0 0 1-4 4H4'],
  // chevrons-down-up — fold the output away (the label flips, not the icon)
  fold: ['m7 20 5-5 5 5', 'm7 4 5 5 5-5'],
  // text-select — hand the rows to the terminal's own selection
  selectText: ['M5 3a2 2 0 0 0-2 2', 'M19 3a2 2 0 0 1 2 2', 'M21 19a2 2 0 0 1-2 2', 'M5 21a2 2 0 0 1-2-2', 'M9 3h1', 'M9 21h1', 'M14 3h1', 'M14 21h1', 'M3 9v1', 'M21 9v1', 'M3 14v1', 'M21 14v1'],
  // arrow-up-to-line / arrow-down-to-line — jump to either end of the block
  scrollTop: ['M5 3h14', 'm18 13-6-6-6 6', 'M12 7v14'],
  scrollBottom: ['M5 21h14', 'm18 11-6 6-6-6', 'M12 17V3'],
  // ellipsis — everything else
  more: ['M12 12h.01', 'M19 12h.01', 'M5 12h.01'],
};

/**
 * The icon as an `<svg>` element. `aria-hidden`: the button around it carries
 * the label, so a screen reader reads that and not a decorative outline.
 */
export function blockIconSvg(id: BlockIconId): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  // `⋯` is three dots drawn as zero-length strokes: they only exist with a
  // round cap, and they need a fatter stroke to read at 13 px.
  svg.setAttribute('stroke-width', id === 'more' ? '2.6' : '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of PATHS[id]) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}
