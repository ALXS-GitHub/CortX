/**
 * The block layout — Warp-style command blocks that stay web (CORT-57).
 *
 * The classic layout (`terminalBlocks.ts`) draws blocks *over* one xterm grid,
 * and everything it cannot do comes from that grid: the space between two
 * blocks can only be whole blank rows, a fold covers its rows instead of
 * giving them back, a card plate needs a transparent canvas, and nothing can
 * stick to the top of the pane. This module lays the pane out as a list of
 * blocks instead:
 *
 * - **Finished blocks are page text.** Each one is a block in a native,
 *   scrollable list — continuous, one hairline between two, as in Warp — its rows rendered as HTML from xterm's own buffer cells
 *   (`terminalBlockViewRender.ts`), with real padding, a gap, a fold that
 *   animates and frees the room, a command that sticks while you scroll its
 *   output, a per-block filter, and native selection and copy.
 * - **Only the block in progress is xterm.** The live card holds the xterm
 *   element itself, clipped to the rows that block actually uses. Programs
 *   still talk to a real terminal — cursor addressing, mouse modes, Claude
 *   Code's redraws, the alternate screen — so nothing about the PTY changes.
 * - **One emulator, one truth.** The page text is read from the *same*
 *   buffer xterm renders from, at the same line numbers, so a block cannot
 *   drift from what the program printed, reflow on resize is xterm's own, and
 *   a ConPTY repaint that rewrites the screen is simply re-read. (The backend
 *   cuts blocks too — `cortx_core::terminal::blocks` — for the MCP and for
 *   headless snapshots; it is not what this view draws, because a separate
 *   grid per block would put a Windows prompt wherever ConPTY's absolute
 *   cursor moves say, rows down from where the block starts.)
 *
 * The xterm viewport never scrolls: the list does. The scrollback rows above
 * the live block are page rows like any other, and the wheel over the live
 * card scrolls the list natively.
 *
 * ## The edge cases
 *
 * - **No shell integration** (ssh, tmux, a shell without `cortx init`): there
 *   is no block, so the whole scrollback is one stream of page rows above the
 *   live screen — a classic terminal with a native scrollbar.
 * - **A marker dies** (its line was erased or trimmed): the block goes, its
 *   text does not — every buffer line is drawn by *something*, and lines no
 *   block owns are drawn as plain rows between the cards.
 * - **`clear` / `reset`**: xterm drops its scrollback and the markers with it;
 *   the list follows, as in Warp.
 * - **The alternate screen** (vim, htop, less): the live card takes the whole
 *   pane, without chrome, until the program leaves it.
 * - **Live → frozen**: a block stops being xterm in the frame its successor's
 *   prompt starts. Its rows keep their exact place: same row height, same
 *   column grid, same left offset as the xterm screen they were on.
 */
import type { IBufferLine, IDisposable, IMarker, Terminal } from '@xterm/xterm';
import {
  blockActions,
  blockMarkdown,
  blockStatusLabel,
  boundaryLine,
  foldLabel,
  joinBlockTexts,
  parseBlockMarker,
  shortCommand,
  type BlockActionId,
  type BlockStatus,
  type TerminalBlock,
} from '@/lib/terminalBlockModel';
import { blockIconSvg, type BlockIconId } from '@/lib/terminalBlockIcons';
import type { BlockMenuItem } from '@/lib/terminalBlockMenu';
import {
  buildPalette,
  colorAlpha,
  columnInRun,
  lineIsBlank,
  parseColor,
  renderRow,
  textBetween,
  type CellLike,
  type LineLike,
  type Rgb,
  type RowContext,
} from '@/lib/terminalBlockViewRender';

export type BlockViewSpacing = 'compact' | 'normal' | 'comfortable';

/** A file path the link layer found on a buffer line. */
export interface BlockViewPathLink {
  /** Buffer cells it covers, in reading order (0-based x, absolute y). */
  cells: { x: number; y: number }[];
  target: string;
  open(reveal: boolean): void;
}

/** Everything the view needs from the app. Kept narrow so it runs in a harness. */
export interface BlockViewHost {
  spacing(): BlockViewSpacing;
  stickyHeader(): boolean;
  failedWash(): boolean;
  /** The hairline between two blocks (`terminal.blockDividers`). */
  dividers(): boolean;
  actionBar(): boolean;
  /** `terminal.inputPosition === 'bottom'`: a short list sits at the bottom. */
  bottomAligned(): boolean;
  /** The universal input editor owns the prompt line. */
  inputEditor(): boolean;
  copyOnSelect(): boolean;
  /** Solid colour behind the pane, for inverse video and the contrast floor. */
  surface(): Rgb;
  /** Is this a translucent surface (the Terminal window over its wallpaper)? */
  translucent(): boolean;
  write(data: string): Promise<unknown>;
  copy(text: string, what: string, quiet?: boolean): void;
  paste(): void;
  openMenu(x: number, y: number, header: string, items: BlockMenuItem[]): void;
  closeMenu(): void;
  /** Ctrl+↑ / Ctrl+↓ (rebindable), with Shift to extend. */
  navigation(e: KeyboardEvent): { direction: 'previous' | 'next'; extend: boolean } | null;
  /** The modifier+click that opens a link. */
  isLinkClick(e: MouseEvent): boolean;
  linkModifierHeld(e: MouseEvent | KeyboardEvent): boolean;
  openUrl(url: string): void;
  pathLinks?(line: number): Promise<BlockViewPathLink[]>;
  /** One cell of an inline image (Sixel / iTerm2), as a cell-sized canvas. */
  imageTile?(x: number, y: number): HTMLCanvasElement | undefined;
  hasImages?(): boolean;
  /** Something laid out over the live xterm must be re-placed (input editor). */
  onLayout?(): void;
  /** The backend scrollback is being replayed (a reload, a restore). */
  isReplaying(): boolean;
  now(): number;
}

interface BlockRecord {
  id: number;
  start: IMarker | null;
  output: IMarker | null;
  end: IMarker | null;
  command: string | null;
  exitCode: number | null;
  status: BlockStatus;
  folded: boolean;
  /** Output filter (Warp's "filter block output"); null = off. */
  filter: string | null;
  filterOpen: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  /** Rebuilt from a replayed scrollback: no trustworthy timings. */
  replayed: boolean;
}

interface Seg {
  key: string;
  kind: 'block' | 'loose' | 'live';
  record: BlockRecord | null;
  block: TerminalBlock | null;
  /** First line drawn (absolute). */
  start: number;
  /** End of the prompt rows (absolute); `start` when there are none. */
  promptEnd: number;
  /** First line after the page rows (absolute). */
  end: number;
  /** Filtered body rows (absolute lines), or null for `[promptEnd, end)`. */
  rows: number[] | null;
  bodyCount: number;
  /** Output lines hidden by the fold / the filter (for the labels). */
  outputLines: number;
  folded: boolean;
  card: boolean;
  height: number;
  top: number;
  /** Live only: first screen row shown, and how many. */
  screenTop: number;
  screenRows: number;
}

interface SegEl {
  root: HTMLElement;
  head: HTMLElement | null;
  promptRows: HTMLElement | null;
  body: HTMLElement;
  fold: HTMLElement | null;
  tools: HTMLElement | null;
  meta: HTMLElement | null;
  filterBox: HTMLElement | null;
  filterInput: HTMLInputElement | null;
  filterCount: HTMLElement | null;
  chunks: Map<number, { el: HTMLElement; key: string }>;
  promptKey: string;
  seg: Seg;
}

/** Rows per rendered chunk of a body. */
const CHUNK = 48;
/** Blocks remembered per terminal (same budget as the classic layout). */
const MAX_BLOCKS = 400;
/** A prompt taller than this is not a prompt: the rest is drawn as body. */
const MAX_PROMPT_ROWS = 12;
/** Left gutter inside a card (the status bar lives in it), px. */
const PAD_LEFT = 14;
/** Right padding inside a card, px. */
const PAD_RIGHT = 10;
/** Shortest the overlay scrollbar's thumb gets, px. */
const MIN_THUMB = 28;

/**
 * Air inside a block, above and below its rows, in cells. Warp's blocks are
 * continuous — one after the other, a rule between two — so the spacing
 * setting is the block's own padding (Warp: ~1.1 cells above, 1.0 below),
 * not a gap: `gap` stays 0 and exists for the layout arithmetic only.
 */
const SPACING: Record<BlockViewSpacing, { pad: number; gap: number }> = {
  compact: { pad: 0.35, gap: 0 },
  normal: { pad: 0.6, gap: 0 },
  comfortable: { pad: 0.9, gap: 0 },
};

let nextBlockId = 1;

const URL_RE = /\bhttps?:\/\/[^\s"'<>`]+/g;

/** Strip the punctuation a sentence puts after a URL. */
function trimUrl(url: string): string {
  let out = url.replace(/[.,;:!?]+$/, '');
  // A closing bracket belongs to the URL only if it opened inside it.
  for (const [open, close] of [['(', ')'], ['[', ']']] as const) {
    while (out.endsWith(close) && out.split(open).length < out.split(close).length) out = out.slice(0, -1);
  }
  return out;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m} min ${s.toString().padStart(2, '0')} s`;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;
}

const css = (c: Rgb, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);

export class BlockView {
  readonly term: Terminal;
  readonly container: HTMLElement;
  private readonly host: BlockViewHost;
  private readonly disposables: IDisposable[] = [];

  // -- Model ----------------------------------------------------------------
  private records: BlockRecord[] = [];
  private current: BlockRecord | null = null;
  private selection = new Set<number>();
  private anchorId: number | null = null;
  private headId: number | null = null;
  private tearingDown = false;

  // -- DOM ------------------------------------------------------------------
  private active = false;
  private scroller: HTMLElement | null = null;
  private list: HTMLElement | null = null;
  private live: SegEl | null = null;
  private clip: HTMLElement | null = null;
  private probe: HTMLElement | null = null;
  /** The overlay scrollbar: a track over the list's right edge, and its thumb. */
  private bar: HTMLElement | null = null;
  private thumb: HTMLElement | null = null;
  private barTimer = 0;
  private drag: { y: number; top: number; ratio: number } | null = null;
  private linkLine: HTMLElement | null = null;
  private els = new Map<string, SegEl>();
  private segs: Seg[] = [];
  private frame = 0;

  // -- Geometry ---------------------------------------------------------------
  private cellW = 0;
  private cellH = 0;
  private padTop = 6;
  private padBottom = 6;
  private gap = 8;
  private fontKey = '';
  private natural = 0;
  private fitsCache = new Map<string, boolean>();
  private measureCtx: CanvasRenderingContext2D | null = null;

  // -- Render caches ----------------------------------------------------------
  /** Bumped by anything that changes what an unchanged line looks like. */
  private epoch = 0;
  /** Lines trimmed off the top of the buffer since we started counting. */
  private trimmed = 0;
  private trimSource: unknown = null;
  private trimSub: IDisposable | null = null;
  private lastLength = 0;
  private lastCols = 0;
  private rowCtx: RowContext | null = null;
  private paletteKey = '';
  private stuck = true;
  private alt = false;
  /** Segment heights of the previous frame, for scroll anchoring. */
  private prevLayout = new Map<string, { top: number; height: number }>();
  /** Anything but a scroll asked for this frame: the segments are rebuilt. */
  private layoutDirty = true;
  /** Height of the list at the last full layout, px. */
  private lastListH = -1;
  /** Frozen segments drawn around the view at the last paint. */
  private shown = new Set<string>();
  /**
   * The lowest screen row the running command has used. A program that
   * redraws (an agent's UI, a progress bar) erases its rows before it writes
   * them again, and a frame can land in between: the block would shrink and
   * grow back, and the whole list jump with it. A real screen does not
   * shrink while a program runs either.
   */
  private liveHigh: { id: number; row: number } | null = null;

  // -- Search -----------------------------------------------------------------
  private searchRe: RegExp | null = null;
  private searchGen = 0;
  private activeMatch: { line: number; col: number; len: number } | null = null;

  // -- Pointer ----------------------------------------------------------------
  private downAt: { x: number; y: number; t: number } | null = null;
  private linkAt: { key: string; open: (e: MouseEvent) => void } | null = null;
  private linkGen = 0;

  constructor(term: Terminal, container: HTMLElement, host: BlockViewHost) {
    this.term = term;
    this.container = container;
    this.host = host;
    this.disposables.push(
      term.parser.registerOscHandler(133, (data) => {
        this.onMarker(data);
        return false;
      })
    );
    // Erase in line: a running program wiping rows above its own block
    // (`onEraseAbove`). Never consumed — xterm's own handler runs after.
    this.disposables.push(
      term.parser.registerCsiHandler({ final: 'K' }, () => {
        this.onEraseAbove();
        return false;
      })
    );
    const redraw = () => this.schedule();
    this.disposables.push(term.onWriteParsed(redraw));
    this.disposables.push(term.onRender(redraw));
    this.disposables.push(term.onResize(() => {
      this.epoch++;
      this.schedule();
    }));
    this.disposables.push(
      term.buffer.onBufferChange(() => {
        this.epoch++;
        this.schedule();
      })
    );
    // The list scrolls, xterm's own viewport never does: whatever moved it
    // (the search addon, `scrollOnUserInput`, a programmatic scroll) is put
    // back at the bottom, where the live rows are.
    this.disposables.push(
      term.onScroll(() => {
        if (!this.active) return;
        const buf = term.buffer.active;
        if (buf.type === 'normal' && buf.viewportY !== buf.baseY) term.scrollToBottom();
      })
    );
    // Typing follows the prompt, the way it does in any terminal; it also
    // puts away a page selection, as Warp does.
    this.disposables.push(
      term.onData(() => {
        if (!this.active) return;
        this.stuck = true;
        this.schedule();
      })
    );
    term.attachCustomWheelEventHandler((e) => {
      if (!this.active || e.ctrlKey) return true;
      const buf = term.buffer.active;
      // A program that reads the mouse (or the alternate screen) gets the
      // wheel; otherwise it is the list's, natively — returning false keeps
      // xterm from handling it, and the event goes on to the scroller.
      if (buf.type !== 'normal' || term.modes.mouseTrackingMode !== 'none') return true;
      return false;
    });
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  isActive(): boolean {
    return this.active;
  }

  setActive(on: boolean) {
    if (on === this.active) return;
    if (on) this.activate();
    else this.deactivate();
  }

  dispose() {
    this.deactivate();
    this.tearingDown = true;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.trimSub?.dispose();
    this.trimSub = null;
    for (const r of this.records) this.disposeMarkers(r);
    this.records = [];
    this.current = null;
    this.tearingDown = false;
  }

  /** Settings or theme changed: rebuild everything that depends on them. */
  refresh() {
    this.epoch++;
    this.paletteKey = '';
    this.fontKey = '';
    this.schedule();
  }

  /**
   * Size the xterm grid from the list instead of from its parent (FitAddon
   * measures the element xterm sits in, which here is the clip). Returns
   * false when the view cannot measure yet and the caller should fit as usual.
   */
  fit(): boolean {
    if (!this.active || !this.scroller || !this.container.isConnected) return false;
    if (!this.measure()) return false;
    const vw = this.scroller.clientWidth;
    const vh = this.scroller.clientHeight;
    if (vw <= 0 || vh <= 0) return false;
    this.updateSpacing();
    // The scrollbar is an overlay (see `updateBar`): the cards run to the
    // pane's right edge and the grid gets the width the cards' padding leaves.
    const cols = Math.max(2, Math.floor((vw - PAD_LEFT - PAD_RIGHT) / this.cellW));
    const rows = Math.max(2, Math.floor((vh - this.padTop - this.padBottom) / this.cellH));
    if (cols !== this.term.cols || rows !== this.term.rows) this.term.resize(cols, rows);
    this.schedule();
    return true;
  }

  /** Back to the live block, following output again. */
  scrollToBottom() {
    this.stuck = true;
    this.schedule();
  }

  /** Ctrl+Shift+C with no xterm selection: the page selection, else the selected blocks. */
  copySelected(): boolean {
    const text = this.selectionText();
    if (text) {
      this.host.copy(text, 'selection', true);
      return true;
    }
    const blocks = this.selectedBlocks();
    if (blocks.length === 0) return false;
    this.host.copy(joinBlockTexts(blocks.map((b) => this.blockText(b))), blocks.length > 1 ? `${blocks.length} blocks` : 'block');
    return true;
  }

  /** The page text under the selection, or null when the page has none. */
  selectionText(): string | null {
    if (!this.active || !this.scroller) return null;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!this.scroller.contains(range.commonAncestorContainer)) return null;
    const from = this.pointToCell(range.startContainer, range.startOffset, 'start');
    const to = this.pointToCell(range.endContainer, range.endOffset, 'end');
    if (!from || !to) return sel.toString() || null;
    const buf = this.term.buffer.active;
    const text = textBetween((y) => buf.getLine(y) as unknown as LineLike | undefined, from, to);
    return text || null;
  }

  clearPageSelection() {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && this.scroller && sel.rangeCount && this.scroller.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      sel.removeAllRanges();
    }
  }

  jump(direction: 'previous' | 'next', extend = false): boolean {
    const blocks = this.blocks().filter((b) => b.status === 'done');
    if (blocks.length === 0) return false;
    const from = extend ? this.headId ?? this.anchorId : this.anchorId;
    let index = from === null ? -1 : blocks.findIndex((b) => b.id === from);
    if (index < 0) {
      // Nothing selected: start from the block at the top of the view.
      const top = this.scroller?.scrollTop ?? 0;
      const visible = this.segs.find((s) => s.kind === 'block' && s.top + s.height > top);
      index = visible?.block ? blocks.findIndex((b) => b.id === visible.block!.id) : blocks.length;
      if (direction === 'next') index -= 1;
    }
    const targetIndex = direction === 'previous' ? index - 1 : index + 1;
    const target = blocks[Math.max(0, Math.min(blocks.length - 1, targetIndex))];
    if (!target || (targetIndex < 0 || targetIndex >= blocks.length)) return false;
    if (extend && this.anchorId !== null && this.selection.size > 0) this.extendTo(target.id);
    else this.selectOnly(target.id);
    this.scrollToBlock(target.id, 'top');
    this.schedule();
    return true;
  }

  openSelectedMenu(x: number, y: number): boolean {
    const id = this.headId ?? this.anchorId;
    if (id === null) return false;
    this.openMenu(id, x, y);
    return true;
  }

  /** Find bar: highlight every match on the page rows. */
  setSearch(query: string | null, opts: { caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean } = {}) {
    let re: RegExp | null = null;
    if (query) {
      try {
        let source = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (opts.wholeWord) source = `\\b${source}\\b`;
        re = new RegExp(source, opts.caseSensitive ? 'g' : 'gi');
      } catch {
        re = null;
      }
    }
    this.searchRe = re;
    if (!re) this.activeMatch = null;
    this.searchGen++;
    this.schedule();
  }

  /**
   * The search addon just selected a match in xterm's buffer: bring it into
   * the list's view, opening a fold or a filter that hides it.
   */
  revealSearchMatch() {
    if (!this.active) return;
    const pos = this.term.getSelectionPosition();
    if (!pos) return;
    const line = pos.start.y;
    const col = pos.start.x;
    const len = pos.end.y === pos.start.y ? Math.max(1, pos.end.x - pos.start.x) : 1;
    this.activeMatch = { line, col, len };
    this.searchGen++;
    for (const b of this.blocks()) {
      const record = this.recordOf(b.id);
      if (!record) continue;
      const end = b.endExclusive ?? Infinity;
      if (line >= b.start && line < end) {
        if (record.folded) record.folded = false;
        if (record.filter) {
          record.filter = null;
          record.filterOpen = false;
        }
      }
    }
    this.renderNow();
    this.scrollToLine(line);
  }

  // ==========================================================================
  // Activation
  // ==========================================================================

  private activate() {
    this.active = true;
    const scroller = document.createElement('div');
    scroller.className = 'cortx-bv';
    scroller.tabIndex = -1;
    const list = document.createElement('div');
    list.className = 'cortx-bv-list';
    scroller.appendChild(list);
    const probe = document.createElement('span');
    probe.className = 'cortx-bv-probe';
    probe.setAttribute('aria-hidden', 'true');
    scroller.appendChild(probe);
    this.scroller = scroller;
    this.list = list;
    this.probe = probe;

    // The live card: never removed, always last.
    const root = document.createElement('div');
    root.className = 'cortx-bv-seg cortx-bv-live';
    const body = document.createElement('div');
    body.className = 'cortx-bv-body';
    const clip = document.createElement('div');
    clip.className = 'cortx-bv-clip';
    const meta = document.createElement('div');
    meta.className = 'cortx-bv-meta';
    root.append(body, clip, meta);
    list.appendChild(root);
    this.clip = clip;
    this.live = {
      root,
      head: null,
      promptRows: null,
      body,
      fold: null,
      tools: null,
      meta,
      filterBox: null,
      filterInput: null,
      filterCount: null,
      chunks: new Map(),
      promptKey: '',
      seg: this.emptySeg('live'),
    };

    // A native scrollbar takes its width from the list (or, with a stable
    // gutter, keeps a strip free for it): the blocks would stop short of the
    // pane's edge. The list's own is hidden; this one floats over it.
    const bar = document.createElement('div');
    bar.className = 'cortx-bv-bar';
    bar.setAttribute('aria-hidden', 'true');
    const thumb = document.createElement('div');
    thumb.className = 'cortx-bv-thumb';
    bar.appendChild(thumb);
    this.bar = bar;
    this.thumb = thumb;
    bar.addEventListener('pointerdown', this.onBarDown);

    const focused = this.term.element?.contains(document.activeElement) ?? false;
    this.container.classList.add('cortx-bv-on');
    this.container.insertBefore(scroller, this.container.firstChild);
    scroller.after(bar);
    if (this.term.element) clip.appendChild(this.term.element);
    // The universal input editor is laid out over the prompt row; it moves
    // with the live card so it scrolls with the list.
    const editor = this.container.querySelector<HTMLElement>(':scope > .cortx-uinput');
    if (editor) root.appendChild(editor);
    if (focused) this.term.focus();

    scroller.addEventListener('scroll', this.onScroll, { passive: true });
    scroller.addEventListener('mousedown', this.onMouseDown);
    scroller.addEventListener('mouseup', this.onMouseUp);
    scroller.addEventListener('mousemove', this.onMouseMove);
    scroller.addEventListener('mouseleave', this.onMouseLeave);
    scroller.addEventListener('contextmenu', this.onContextMenu);
    scroller.addEventListener('copy', this.onCopy);
    scroller.addEventListener('keydown', this.onScrollerKey);
    // Capture phase, on the clip: xterm 6 scrolls its own viewport from a
    // listener of its scrollable element, which the custom wheel handler does
    // not reach. Stopped here, the event never gets to it, and the browser's
    // default scroll goes to the nearest scrollable box — the list.
    clip.addEventListener('wheel', this.onClipWheel, { capture: true, passive: true });
    this.container.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keydown', this.onModifier, true);
    window.addEventListener('keyup', this.onModifier, true);

    this.stuck = true;
    this.epoch++;
    this.fit();
    this.renderNow();
  }

  private deactivate() {
    if (!this.active) return;
    this.active = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    const focused = this.term.element?.contains(document.activeElement) ?? false;
    const el = this.term.element;
    if (el) {
      el.style.transform = '';
      el.style.height = '';
      el.style.width = '';
      this.container.insertBefore(el, this.container.firstChild);
    }
    const editor = this.live?.root.querySelector<HTMLElement>(':scope > .cortx-uinput');
    if (editor) this.container.appendChild(editor);
    this.scroller?.removeEventListener('scroll', this.onScroll);
    this.container.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keydown', this.onModifier, true);
    window.removeEventListener('keyup', this.onModifier, true);
    this.scroller?.remove();
    this.bar?.remove();
    window.clearTimeout(this.barTimer);
    this.drag = null;
    this.bar = this.thumb = null;
    this.scroller = this.list = this.clip = this.probe = this.linkLine = null;
    this.live = null;
    this.els.clear();
    this.segs = [];
    this.prevLayout.clear();
    this.container.classList.remove('cortx-bv-on', 'cortx-bv-alt');
    this.alt = false;
    if (focused) this.term.focus();
    this.term.scrollToBottom();
  }

  private emptySeg(kind: Seg['kind']): Seg {
    return {
      key: kind,
      kind,
      record: null,
      block: null,
      start: 0,
      promptEnd: 0,
      end: 0,
      rows: null,
      bodyCount: 0,
      outputLines: 0,
      folded: false,
      card: false,
      height: 0,
      top: 0,
      screenTop: 0,
      screenRows: 0,
    };
  }

  // ==========================================================================
  // Block tracking (same rules as the classic layout's controller)
  // ==========================================================================

  private onMarker(data: string) {
    const buf = this.term.buffer.active;
    if (buf.type !== 'normal') return;
    const marker = parseBlockMarker(data);
    if (!marker) return;
    const cursorLine = buf.baseY + buf.cursorY;
    const replayed = this.host.isReplaying();
    switch (marker.kind) {
      case 'A': {
        if (this.current && this.current.status === 'prompt') this.drop(this.current);
        if (this.current && this.current.status === 'running') {
          this.current.status = 'done';
          this.current.end = this.markerAt(boundaryLine(cursorLine, buf.cursorX));
          this.current.finishedAt = this.host.now();
          this.current = null;
        }
        this.current = this.open(cursorLine, replayed);
        break;
      }
      case 'B':
        this.reanchor(cursorLine, replayed);
        break;
      case 'C': {
        const record = this.reanchor(cursorLine, replayed);
        record.status = 'running';
        if (marker.command !== undefined) record.command = marker.command;
        record.output = this.markerAt(boundaryLine(cursorLine, buf.cursorX));
        record.startedAt = this.host.now();
        break;
      }
      case 'D': {
        const record = this.current;
        if (!record) break;
        record.status = 'done';
        record.exitCode = marker.exitCode ?? null;
        record.end = this.markerAt(boundaryLine(cursorLine, buf.cursorX));
        record.finishedAt = this.host.now();
        this.current = null;
        break;
      }
    }
    this.schedule();
  }

  /**
   * The running program erased a row *above* its own block: it has taken
   * the screen over, and what it draws there from now on is its own.
   *
   * Claude Code does it on every resize — such as the one the agent bar makes
   * when it appears under the pane. Through ConPTY that arrives as `CSI H`,
   * then `CSI 2K` on each screen row, then the whole conversation printed
   * again from the top row (no `ED 2`: captured from a real session). An
   * erased line keeps its markers, so the block's start stayed on the row
   * where `claude` had been typed — in the middle of the reprinted
   * conversation — and the card was cut in two there, the part above it
   * drawn as the end of the previous command.
   *
   * So the block starts again at the first row the program erases above it.
   * Only for a running command: a shell redrawing its own prompt never goes
   * above the prompt's first row, and a command that keeps to its own rows
   * (a progress bar) never triggers this.
   */
  private onEraseAbove() {
    const buf = this.term.buffer.active;
    if (buf.type !== 'normal') return;
    const record = this.current;
    if (!record || record.status !== 'running') return;
    const start = record.start;
    if (!start || start.isDisposed) return;
    const line = buf.baseY + buf.cursorY;
    if (line >= start.line) return;
    const was = this.tearingDown;
    this.tearingDown = true;
    start.dispose();
    record.output?.dispose();
    this.tearingDown = was;
    // The command line itself was erased: the block is its output alone.
    record.start = this.markerAt(line);
    record.output = this.markerAt(line);
    // Blocks that started on the rows it takes over are being erased with
    // them: left in place, the one below would pass for the last block and
    // the running one for a finished one above it.
    for (const other of [...this.records]) {
      if (other !== record && other.start && !other.start.isDisposed && other.start.line >= line) this.drop(other);
    }
    // What the program drew before is gone: the card is as tall as what it
    // draws from now on.
    this.liveHigh = null;
    this.schedule();
  }

  private reanchor(cursorLine: number, replayed: boolean): BlockRecord {
    const record = this.current;
    if (record && this.records.includes(record) && record.start && !record.start.isDisposed) return record;
    return (this.current = this.open(cursorLine, replayed));
  }

  private open(line: number, replayed: boolean): BlockRecord {
    const record: BlockRecord = {
      id: nextBlockId++,
      start: this.markerAt(line),
      output: null,
      end: null,
      command: null,
      exitCode: null,
      status: 'prompt',
      folded: false,
      filter: null,
      filterOpen: false,
      startedAt: null,
      finishedAt: null,
      replayed,
    };
    this.records.push(record);
    while (this.records.length > MAX_BLOCKS) {
      const oldest = this.records.shift();
      if (oldest) this.disposeMarkers(oldest);
    }
    return record;
  }

  private markerAt(line: number): IMarker | null {
    const buf = this.term.buffer.active;
    const marker = this.term.registerMarker(line - (buf.baseY + buf.cursorY));
    if (!marker) return null;
    marker.onDispose(() => {
      if (this.tearingDown) return;
      const owner = this.records.find((r) => r.start === marker || r.output === marker || r.end === marker);
      if (owner) this.drop(owner);
    });
    return marker;
  }

  private drop(record: BlockRecord) {
    const i = this.records.indexOf(record);
    if (i >= 0) this.records.splice(i, 1);
    if (this.current === record) this.current = null;
    if (this.selection.delete(record.id)) {
      if (this.anchorId === record.id) this.anchorId = null;
      if (this.headId === record.id) this.headId = null;
    }
    this.disposeMarkers(record);
    this.schedule();
  }

  private disposeMarkers(record: BlockRecord) {
    const was = this.tearingDown;
    this.tearingDown = true;
    record.start?.dispose();
    record.output?.dispose();
    record.end?.dispose();
    record.start = record.output = record.end = null;
    this.tearingDown = was;
  }

  private snapshot(record: BlockRecord): TerminalBlock | null {
    const start = record.start;
    if (!start || start.isDisposed) return null;
    return {
      id: record.id,
      start: start.line,
      outputStart: record.output && !record.output.isDisposed ? record.output.line : null,
      endExclusive: record.end && !record.end.isDisposed ? record.end.line : null,
      command: record.command,
      exitCode: record.exitCode,
      status: record.status,
      folded: record.folded,
    };
  }

  private blocks(): TerminalBlock[] {
    const out: TerminalBlock[] = [];
    for (const r of this.records) {
      const b = this.snapshot(r);
      if (b) out.push(b);
    }
    return out.sort((a, b) => a.start - b.start);
  }

  private recordOf(id: number): BlockRecord | null {
    return this.records.find((r) => r.id === id) ?? null;
  }

  private blockById(id: number): TerminalBlock | null {
    const r = this.recordOf(id);
    return r ? this.snapshot(r) : null;
  }

  // -- Selection of blocks ----------------------------------------------------

  private selectOnly(id: number) {
    this.selection = new Set([id]);
    this.anchorId = id;
    this.headId = id;
  }

  private clearSelection() {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.anchorId = this.headId = null;
    this.schedule();
  }

  private extendTo(id: number) {
    const blocks = this.blocks();
    const a = blocks.findIndex((b) => b.id === this.anchorId);
    const t = blocks.findIndex((b) => b.id === id);
    if (a < 0 || t < 0) {
      this.selectOnly(id);
      return;
    }
    const [lo, hi] = a <= t ? [a, t] : [t, a];
    this.selection = new Set(blocks.slice(lo, hi + 1).map((b) => b.id));
    this.headId = id;
  }

  private selectedBlocks(): TerminalBlock[] {
    if (this.selection.size === 0) return [];
    return this.blocks().filter((b) => this.selection.has(b.id));
  }

  private runOf(block: TerminalBlock): TerminalBlock[] {
    if (this.selection.size < 2 || !this.selection.has(block.id)) return [block];
    const run = this.selectedBlocks();
    return run.length > 1 ? run : [block];
  }

  // -- Reading a block back ---------------------------------------------------

  private liveEnd(): number {
    const buf = this.term.buffer.active;
    return buf.baseY + buf.cursorY + 1;
  }

  private rowsText(from: number, to: number): string {
    const buf = this.term.buffer.active;
    if (to <= from) return '';
    const last = buf.getLine(to - 1);
    return textBetween(
      (y) => buf.getLine(y) as unknown as LineLike | undefined,
      { line: from, col: 0 },
      { line: to - 1, col: last?.length ?? 0 }
    ).replace(/\s+$/, '');
  }

  private commandText(block: TerminalBlock): string {
    if (block.command !== null) return block.command;
    if (block.outputStart === null) return '';
    return this.rowsText(block.start, block.outputStart).trim();
  }

  private outputText(block: TerminalBlock): string {
    if (block.outputStart === null) return '';
    return this.rowsText(block.outputStart, block.endExclusive ?? this.liveEnd());
  }

  private blockText(block: TerminalBlock): string {
    return [this.commandText(block), this.outputText(block)].filter(Boolean).join('\n');
  }

  private commandLine(block: TerminalBlock): string {
    return this.commandText(block).split('\n')[0]?.trim() ?? '';
  }

  private atPrompt(): boolean {
    return this.current === null || this.current.status !== 'running';
  }

  private actionsFor(block: TerminalBlock) {
    const outputLines = block.outputStart === null ? 0 : Math.max(0, (block.endExclusive ?? this.liveEnd()) - block.outputStart);
    return blockActions({
      block,
      hasCommand: this.commandText(block).trim().length > 0,
      hiddenLines: outputLines,
      atPrompt: this.atPrompt(),
      inputEditor: this.host.inputEditor(),
    });
  }

  private run(id: number, action: BlockActionId | 'filter') {
    const block = this.blockById(id);
    const record = this.recordOf(id);
    if (!block || !record) return;
    switch (action) {
      case 'copyCommand':
        this.host.copy(this.commandText(block), 'command');
        break;
      case 'copyOutput':
        this.host.copy(this.outputText(block), 'output');
        break;
      case 'copyBlock': {
        const run = this.runOf(block);
        this.host.copy(joinBlockTexts(run.map((b) => this.blockText(b))), run.length > 1 ? `${run.length} blocks` : 'block');
        break;
      }
      case 'copyMarkdown': {
        const run = this.runOf(block);
        this.host.copy(
          joinBlockTexts(run.map((b) => blockMarkdown(this.commandText(b), this.outputText(b), b.exitCode))),
          run.length > 1 ? `${run.length} blocks as Markdown` : 'block as Markdown'
        );
        break;
      }
      case 'rerun': {
        const command = this.commandLine(block);
        if (command) void this.host.write(`${command}\r`);
        this.stuck = true;
        this.term.focus();
        break;
      }
      case 'reinput': {
        const command = this.commandLine(block);
        if (command) void this.host.write(command).then(() => this.term.focus());
        break;
      }
      case 'fold':
        this.toggleFold(id);
        break;
      case 'filter':
        record.filterOpen = !record.filterOpen;
        if (!record.filterOpen) record.filter = null;
        this.epoch++;
        this.renderNow();
        if (record.filterOpen) this.els.get(`b:${id}`)?.filterInput?.focus();
        break;
      case 'selectText': {
        const el = this.els.get(`b:${id}`);
        if (!el) break;
        const range = document.createRange();
        range.selectNodeContents(el.root);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        break;
      }
      case 'scrollTop':
        this.scrollToBlock(id, 'top');
        break;
      case 'scrollBottom':
        this.scrollToBlock(id, 'bottom');
        break;
    }
  }

  private toggleFold(id: number) {
    const record = this.recordOf(id);
    if (!record) return;
    record.folded = !record.folded;
    const el = this.els.get(`b:${id}`);
    if (el) {
      el.root.classList.add('cortx-bv-animating');
      window.setTimeout(() => el.root.classList.remove('cortx-bv-animating'), 220);
    }
    this.schedule();
  }

  private openMenu(id: number, x: number, y: number) {
    const block = this.blockById(id);
    if (!block) return;
    const header = shortCommand(this.commandText(block)) || blockStatusLabel(block);
    const record = this.recordOf(id);
    const items: BlockMenuItem[] = this.actionsFor(block).map((spec) => ({
      label: spec.label,
      hint: spec.hint,
      disabled: spec.disabled,
      separated: spec.separated,
      icon: spec.id,
      onSelect: () => this.run(id, spec.id),
    }));
    items.splice(items.findIndex((i) => i.icon === 'selectText'), 0, {
      label: record?.filterOpen ? 'Stop filtering' : 'Filter output',
      icon: 'filter',
      disabled: block.outputStart === null,
      onSelect: () => this.run(id, 'filter'),
    });
    this.host.openMenu(x, y, header, items);
  }

  // ==========================================================================
  // Events
  // ==========================================================================

  private readonly onScroll = () => {
    const s = this.scroller;
    if (!s) return;
    this.stuck = s.scrollTop >= s.scrollHeight - s.clientHeight - 2;
    this.updateBar(true);
    this.scheduleScroll();
  };

  /**
   * Place the overlay scrollbar's thumb. `reveal` shows it for a moment (a
   * scroll); hovering the track keeps it shown (CSS).
   */
  private updateBar(reveal = false) {
    const s = this.scroller;
    const bar = this.bar;
    const thumb = this.thumb;
    if (!s || !bar || !thumb) return;
    const viewH = s.clientHeight;
    const range = s.scrollHeight - viewH;
    if (this.alt || range <= 1 || viewH <= 0) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const h = Math.max(MIN_THUMB, Math.round((viewH * viewH) / s.scrollHeight));
    const top = Math.round((Math.min(range, Math.max(0, s.scrollTop)) / range) * (viewH - h));
    thumb.style.height = `${h}px`;
    thumb.style.transform = `translateY(${top}px)`;
    if (reveal) {
      bar.classList.add('cortx-bv-bar-on');
      window.clearTimeout(this.barTimer);
      this.barTimer = window.setTimeout(() => {
        if (!this.drag) this.bar?.classList.remove('cortx-bv-bar-on');
      }, 900);
    }
  }

  private readonly onBarDown = (e: PointerEvent) => {
    const s = this.scroller;
    const thumb = this.thumb;
    if (!s || !thumb || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const viewH = s.clientHeight;
    const range = s.scrollHeight - viewH;
    const h = thumb.offsetHeight;
    const ratio = viewH - h > 0 ? range / (viewH - h) : 0;
    if (e.target !== thumb) {
      // On the track: jump so the thumb's middle lands under the pointer.
      const y = e.clientY - (this.bar?.getBoundingClientRect().top ?? 0);
      s.scrollTop = (y - h / 2) * ratio;
    }
    this.drag = { y: e.clientY, top: s.scrollTop, ratio };
    const bar = this.bar!;
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('cortx-bv-bar-drag');
    const move = (ev: PointerEvent) => {
      if (!this.drag || !this.scroller) return;
      this.scroller.scrollTop = this.drag.top + (ev.clientY - this.drag.y) * this.drag.ratio;
    };
    const up = () => {
      this.drag = null;
      bar.classList.remove('cortx-bv-bar-drag');
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      this.updateBar(true);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  };

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!this.active || e.type !== 'keydown') return;
    // The filter field types into itself, never into the shell.
    if ((e.target as HTMLElement)?.closest?.('.cortx-bv-filter')) return;
    const nav = this.host.navigation(e);
    if (nav) {
      const buf = this.term.buffer.active;
      if (buf.type !== 'normal') return;
      // A program that took the keyboard (Claude Code, fzf) keeps its keys
      // while you are at the bottom.
      if (this.current?.status === 'running' && this.stuck) return;
      if (!this.jump(nav.direction, nav.extend)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === 'Escape' && this.selection.size > 0 && !this.term.hasSelection()) {
      // Esc puts the block selection away — and still reaches the program.
      this.clearSelection();
    }
  };

  /**
   * A key pressed while the list has the focus (right after a page
   * selection): it is still the program's. Copy chords are answered here;
   * anything else drops the selection and goes through xterm's own key
   * handling, the same code path a key in its textarea takes.
   */
  private readonly onScrollerKey = (e: KeyboardEvent) => {
    if (e.target !== this.scroller) return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (e.code === 'KeyC' || e.code === 'Insert')) {
      const text = this.selectionText();
      if (text) {
        e.preventDefault();
        this.host.copy(text, 'selection', true);
        return;
      }
    }
    this.clearPageSelection();
    this.term.focus();
    const core = (this.term as unknown as { _core?: { _keyDown?: (ev: KeyboardEvent) => boolean | undefined } })._core;
    core?._keyDown?.(e);
  };

  private readonly onClipWheel = (e: WheelEvent) => {
    if (e.ctrlKey) return;
    const buf = this.term.buffer.active;
    if (buf.type !== 'normal' || this.term.modes.mouseTrackingMode !== 'none') return;
    e.stopPropagation();
  };

  private readonly onModifier = (e: KeyboardEvent) => {
    if (!this.host.linkModifierHeld(e)) this.clearLink();
  };

  private readonly onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    // A click on the live xterm is xterm's.
    if (this.clip?.contains(e.target as Node)) {
      this.clearPageSelection();
      return;
    }
    if ((e.target as HTMLElement).closest('.cortx-bv-tools, .cortx-bv-fold, .cortx-bv-filter')) return;
    if (this.term.hasSelection()) this.term.clearSelection();
  };

  private readonly onMouseUp = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const down = this.downAt;
    this.downAt = null;
    const target = e.target as HTMLElement;
    if (this.clip?.contains(target)) return;
    if (target.closest('.cortx-bv-tools, .cortx-bv-fold, .cortx-bv-filter')) return;
    // A link opened by modifier+click.
    if (this.linkAt && this.host.isLinkClick(e)) {
      this.linkAt.open(e);
      return;
    }
    const text = this.selectionText();
    if (text) {
      if (this.host.copyOnSelect() && text.trim()) this.host.copy(text, 'selection', true);
      // Focusing xterm's textarea would drop the highlight, so the list keeps
      // the focus and hands every key to xterm (`onScrollerKey`).
      this.scroller?.focus({ preventScroll: true });
      return;
    }
    const moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 : false;
    if (!moved) {
      const segEl = this.segElAt(target);
      const seg = segEl?.seg;
      if (seg?.kind === 'block' && seg.block && e.detail === 1) {
        if (e.shiftKey && this.anchorId !== null) this.extendTo(seg.block.id);
        else if (this.selection.size === 1 && this.selection.has(seg.block.id)) this.clearSelection();
        else this.selectOnly(seg.block.id);
        this.schedule();
      } else if (!seg || seg.kind !== 'block') {
        this.clearSelection();
      }
    }
    // Keys go back to the program; a page selection survives the focus.
    this.term.focus();
  };

  private readonly onContextMenu = (e: MouseEvent) => {
    const text = this.selectionText();
    if (text) {
      e.preventDefault();
      e.stopPropagation();
      this.host.copy(text, 'selection');
      this.clearPageSelection();
      return;
    }
    if (this.clip?.contains(e.target as Node)) return; // the pane's own copy / paste
    e.preventDefault();
    e.stopPropagation();
    const seg = this.segElAt(e.target as HTMLElement)?.seg;
    if (seg?.kind === 'block' && seg.block) {
      if (!this.selection.has(seg.block.id)) this.selectOnly(seg.block.id);
      this.schedule();
      this.openMenu(seg.block.id, e.clientX, e.clientY);
      return;
    }
    this.host.paste();
  };

  private readonly onCopy = (e: ClipboardEvent) => {
    const text = this.selectionText();
    if (!text || !e.clipboardData) return;
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  };

  private readonly onMouseMove = (e: MouseEvent) => {
    if (e.buttons !== 0 || !this.host.linkModifierHeld(e)) {
      if (this.linkAt) this.clearLink();
      return;
    }
    const cell = this.cellAtPoint(e.clientX, e.clientY);
    if (!cell) {
      this.clearLink();
      return;
    }
    void this.resolveLink(cell.line, cell.col, cell.row);
  };

  private readonly onMouseLeave = () => this.clearLink();

  // ==========================================================================
  // Links
  // ==========================================================================

  private clearLink() {
    this.linkAt = null;
    this.linkGen++;
    this.linkLine?.remove();
    this.linkLine = null;
    this.scroller?.classList.remove('cortx-bv-pointer');
  }

  private async resolveLink(line: number, col: number, rowEl: HTMLElement) {
    const gen = ++this.linkGen;
    const buf = this.term.buffer.active;
    // The logical line, rows joined, with the cell of every character.
    let first = line;
    while (first > 0 && buf.getLine(first)?.isWrapped) first--;
    let last = line;
    while (buf.getLine(last + 1)?.isWrapped) last++;
    let text = '';
    const cells: { x: number; y: number }[] = [];
    for (let y = first; y <= last; y++) {
      const l = buf.getLine(y);
      if (!l) break;
      for (let x = 0; x < l.length; x++) {
        const c = l.getCell(x);
        if (!c || c.getWidth() === 0) continue;
        const ch = c.getChars() || ' ';
        for (const _ of ch) {
          void _;
          cells.push({ x, y });
        }
        text += ch;
      }
    }
    const at = cells.findIndex((c) => c.y === line && c.x >= col);
    let found: { from: number; to: number; open: (e: MouseEvent) => void; key: string } | null = null;
    URL_RE.lastIndex = 0;
    for (let m = URL_RE.exec(text); m; m = URL_RE.exec(text)) {
      const url = trimUrl(m[0]);
      if (at >= m.index && at < m.index + url.length) {
        found = { from: m.index, to: m.index + url.length - 1, key: `u:${url}`, open: () => this.host.openUrl(url) };
        break;
      }
    }
    if (!found && this.host.pathLinks) {
      const paths = await this.host.pathLinks(line);
      if (gen !== this.linkGen) return;
      for (const p of paths) {
        const hit = p.cells.some((c) => c.y === line && c.x === col);
        if (!hit) continue;
        const from = cells.findIndex((c) => c.x === p.cells[0].x && c.y === p.cells[0].y);
        const lastCell = p.cells[p.cells.length - 1];
        const to = cells.findIndex((c) => c.x === lastCell.x && c.y === lastCell.y);
        if (from < 0 || to < 0) continue;
        found = { from, to, key: `p:${p.target}`, open: (e) => p.open(e.altKey) };
        break;
      }
    }
    if (gen !== this.linkGen) return;
    if (!found) {
      this.clearLink();
      return;
    }
    if (this.linkAt?.key === found.key) return;
    this.linkLine?.remove();
    this.linkAt = { key: found.key, open: found.open };
    // Underline the part of the link on the hovered row.
    const onRow = cells.slice(found.from, found.to + 1).filter((c) => c.y === line);
    if (onRow.length) {
      const u = document.createElement('i');
      u.className = 'cortx-bv-link';
      u.style.left = `${onRow[0].x * this.cellW}px`;
      u.style.width = `${(onRow[onRow.length - 1].x - onRow[0].x + 1) * this.cellW}px`;
      rowEl.appendChild(u);
      this.linkLine = u;
    }
    this.scroller?.classList.add('cortx-bv-pointer');
  }

  // ==========================================================================
  // DOM position → buffer cell
  // ==========================================================================

  private segElAt(node: HTMLElement | null): SegEl | null {
    const root = node?.closest?.('.cortx-bv-seg') as HTMLElement | null;
    if (!root) return null;
    if (this.live?.root === root) return this.live;
    for (const el of this.els.values()) if (el.root === root) return el;
    return null;
  }

  /** The buffer line of a row element, from its segment's current mapping. */
  private rowLine(row: HTMLElement): number | null {
    const segEl = this.segElAt(row);
    if (!segEl) return null;
    const seg = segEl.seg;
    if (row.dataset.p !== undefined) return seg.start + Number(row.dataset.p);
    if (row.dataset.r === undefined) return null;
    const i = Number(row.dataset.r);
    return seg.rows ? seg.rows[i] ?? null : seg.promptEnd + i;
  }

  private pointToCell(node: Node, offset: number, edge: 'start' | 'end'): { line: number; col: number } | null {
    const el = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)) as HTMLElement | null;
    let row = el?.closest?.('.cortx-bv-r') as HTMLElement | null;
    if (!row) {
      // Outside a row (a header, a gap): the nearest row inside the range.
      const container = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
      const candidates = container
        ? Array.from((container as HTMLElement).querySelectorAll?.('.cortx-bv-r') ?? [])
        : [];
      const child = (node as HTMLElement).childNodes?.[offset] as HTMLElement | undefined;
      row =
        (child?.closest?.('.cortx-bv-r') as HTMLElement | null) ??
        ((edge === 'start' ? candidates[0] : candidates[candidates.length - 1]) as HTMLElement | undefined) ??
        null;
      if (!row) return null;
      const line = this.rowLine(row);
      if (line === null) return null;
      return { line, col: edge === 'start' ? 0 : this.term.cols };
    }
    const line = this.rowLine(row);
    if (line === null) return null;
    if (node.nodeType === Node.TEXT_NODE) {
      const span = node.parentElement?.closest('[data-c]') as HTMLElement | null;
      if (!span) return { line, col: 0 };
      const start = Number(span.dataset.c);
      if (span.classList.contains('w')) return { line, col: offset > 0 ? start + 1 : start };
      return { line, col: columnInRun(start, node.textContent ?? '', offset) };
    }
    // An element boundary: before child `offset`.
    const child = (node as HTMLElement).childNodes[offset] as HTMLElement | undefined;
    const c = child?.dataset?.c;
    if (c !== undefined) return { line, col: Number(c) };
    return { line, col: offset === 0 ? 0 : this.term.cols };
  }

  private cellAtPoint(x: number, y: number): { line: number; col: number; row: HTMLElement } | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const row = el?.closest?.('.cortx-bv-r') as HTMLElement | null;
    if (!row || !this.scroller?.contains(row)) return null;
    const line = this.rowLine(row);
    if (line === null) return null;
    const rect = row.getBoundingClientRect();
    const col = Math.floor((x - rect.left) / this.cellW);
    if (col < 0) return null;
    return { line, col, row };
  }

  // ==========================================================================
  // Scrolling helpers
  // ==========================================================================

  private scrollToBlock(id: number, where: 'top' | 'bottom') {
    this.renderNow();
    const seg = this.segs.find((s) => s.block?.id === id);
    const s = this.scroller;
    if (!seg || !s) return;
    const top = where === 'top' ? seg.top - this.gap / 2 : seg.top + seg.height - s.clientHeight + this.gap / 2;
    s.scrollTop = Math.max(0, top);
    this.stuck = s.scrollTop >= s.scrollHeight - s.clientHeight - 2;
    this.schedule();
  }

  private scrollToLine(line: number) {
    const s = this.scroller;
    if (!s) return;
    for (const seg of this.segs) {
      let row = -1;
      if (seg.kind === 'live') {
        const buf = this.term.buffer.active;
        if (line >= seg.start && line < seg.end) row = line - seg.start;
        else if (line >= buf.baseY) row = seg.end - seg.start + (line - buf.baseY - seg.screenTop);
        if (row < 0) continue;
        const y = seg.top + (seg.card ? this.padTop : 0) + row * this.cellH;
        s.scrollTop = Math.max(0, y - s.clientHeight / 2);
        break;
      }
      if (line < seg.start || line >= seg.end) continue;
      if (line < seg.promptEnd) row = line - seg.start;
      else {
        const i = seg.rows ? seg.rows.indexOf(line) : line - seg.promptEnd;
        if (i < 0) continue;
        row = seg.promptEnd - seg.start + i;
      }
      const y = seg.top + (seg.card ? this.padTop : 0) + row * this.cellH;
      s.scrollTop = Math.max(0, y - s.clientHeight / 2);
      break;
    }
    this.stuck = s.scrollTop >= s.scrollHeight - s.clientHeight - 2;
    this.schedule();
  }

  // ==========================================================================
  // Measuring
  // ==========================================================================

  private measure(): boolean {
    const core = (this.term as unknown as { _core?: { _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } } } })._core;
    let w = core?._renderService?.dimensions?.css?.cell?.width ?? 0;
    let h = core?._renderService?.dimensions?.css?.cell?.height ?? 0;
    if (!(w > 0 && h > 0)) {
      const screen = this.term.element?.querySelector<HTMLElement>('.xterm-screen');
      if (screen && this.term.cols > 0 && this.term.rows > 0) {
        w = screen.clientWidth / this.term.cols;
        h = screen.clientHeight / this.term.rows;
      }
    }
    if (!(w > 0 && h > 0)) return false;
    const opts = this.term.options;
    const fontKey = `${opts.fontFamily}|${opts.fontSize}|${opts.fontWeight}|${opts.letterSpacing}|${w}|${h}`;
    if (fontKey !== this.fontKey || w !== this.cellW || h !== this.cellH) {
      this.fontKey = fontKey;
      this.cellW = w;
      this.cellH = h;
      this.fitsCache.clear();
      this.applyFont();
      this.epoch++;
    }
    return true;
  }

  /** Font, row height and the letter-spacing that puts glyphs on the grid. */
  private applyFont() {
    const s = this.scroller;
    if (!s || !this.probe) return;
    const opts = this.term.options;
    const family = opts.fontFamily ?? 'monospace';
    const size = opts.fontSize ?? 13;
    s.style.setProperty('--cortx-bv-font', family);
    s.style.setProperty('--cortx-bv-size', `${size}px`);
    s.style.setProperty('--cortx-bv-weight', String(opts.fontWeight ?? 'normal'));
    s.style.setProperty('--cortx-bv-bold', String(opts.fontWeightBold ?? 'bold'));
    s.style.setProperty('--cortx-bv-ch', `${this.cellH}px`);
    s.style.setProperty('--cortx-bv-cw', `${this.cellW}px`);
    // The page font's own advance, measured the way xterm measures its cell.
    this.probe.style.letterSpacing = '0px';
    this.probe.textContent = 'W'.repeat(64);
    const natural = this.probe.getBoundingClientRect().width / 64;
    this.natural = natural > 0 ? natural : this.cellW;
    s.style.setProperty('--cortx-bv-ls', `${this.cellW - this.natural}px`);
    const canvas = document.createElement('canvas');
    this.measureCtx = canvas.getContext('2d');
    if (this.measureCtx) this.measureCtx.font = `${opts.fontWeight ?? 'normal'} ${size}px ${family}`;
  }

  private fits = (ch: string): boolean => {
    let ok = this.fitsCache.get(ch);
    if (ok !== undefined) return ok;
    const ctx = this.measureCtx;
    if (!ctx) ok = false;
    else {
      const base = ctx.measureText('W').width;
      const w = ctx.measureText(ch).width;
      ok = base > 0 && Math.abs(w - base) < 0.5;
    }
    this.fitsCache.set(ch, ok);
    return ok;
  };

  private updateSpacing() {
    const preset = SPACING[this.host.spacing()] ?? SPACING.normal;
    const h = this.cellH || 16;
    this.padTop = Math.max(3, Math.round(h * preset.pad));
    this.padBottom = this.padTop;
    this.gap = preset.gap;
    const s = this.scroller;
    if (s) {
      s.style.setProperty('--cortx-bv-pt', `${this.padTop}px`);
      s.style.setProperty('--cortx-bv-pb', `${this.padBottom}px`);
      s.style.setProperty('--cortx-bv-gap', `${this.gap}px`);
      s.style.setProperty('--cortx-bv-pl', `${PAD_LEFT}px`);
      s.style.setProperty('--cortx-bv-pr', `${PAD_RIGHT}px`);
    }
  }

  /** Palette and plate colours, from the terminal theme. */
  private updatePalette(): RowContext {
    const theme = this.term.options.theme ?? {};
    const surface = this.host.surface();
    const key = JSON.stringify([theme, surface, this.term.options.minimumContrastRatio, this.term.options.drawBoldTextInBrightColors, this.cellW, this.cellH]);
    if (key === this.paletteKey && this.rowCtx) return this.rowCtx;
    this.paletteKey = key;
    this.epoch++;
    const palette = buildPalette(theme, {
      surface,
      boldBright: this.term.options.drawBoldTextInBrightColors !== false,
      minContrast: this.term.options.minimumContrastRatio ?? 1,
    });
    const bgOpaque = colorAlpha(theme.background) > 0.5 ? parseColor(theme.background) : null;
    const base = bgOpaque ?? surface;
    const fg = palette.fg;
    const translucent = this.host.translucent() && !bgOpaque;
    // Warp's blocks have no plate of their own: they sit on the pane, one
    // rule between two. Hover lifts a block a little, selection frames it.
    // Every colour comes from the terminal's palette, never the app accent.
    const plate = mix(base, fg, 0.07);
    const s = this.scroller;
    if (s) {
      s.style.setProperty('--cortx-bv-fg', css(fg));
      s.style.setProperty('--cortx-bv-plate', 'transparent');
      // The pinned command needs an opaque ground, or the output scrolling
      // under it would show through.
      s.style.setProperty('--cortx-bv-plate-solid', css(mix(base, fg, 0.04)));
      s.style.setProperty('--cortx-bv-plate-hover', css(fg, translucent ? 0.05 : 0.035));
      s.style.setProperty('--cortx-bv-edge', css(fg, 0.13));
      s.style.setProperty('--cortx-bv-edge-strong', css(fg, 0.38));
      s.style.setProperty('--cortx-bv-select', css(palette.ansi[4], 0.85));
      s.style.setProperty('--cortx-bv-select-wash', css(palette.ansi[4], 0.07));
      s.style.setProperty('--cortx-bv-muted', css(fg, 0.55));
      s.style.setProperty('--cortx-bv-ok', css(palette.ansi[2]));
      s.style.setProperty('--cortx-bv-fail', css(palette.ansi[1]));
      s.style.setProperty('--cortx-bv-fail-wash', css(palette.ansi[1], 0.1));
      void plate;
      s.style.setProperty('--cortx-bv-match', css(palette.ansi[3], 0.35));
      s.style.setProperty('--cortx-bv-match-active', css(palette.ansi[3], 0.7));
      const selection = this.term.options.theme?.selectionBackground ?? css(fg, 0.25);
      s.style.setProperty('--cortx-bv-selection', selection);
    }
    this.rowCtx = {
      palette,
      cellWidth: this.cellW,
      cellHeight: this.cellH,
      cell: this.term.buffer.active.getNullCell() as unknown as CellLike,
      fits: this.fits,
      styles: new Map(),
    };
    return this.rowCtx;
  }

  /** Follow xterm's top-of-buffer trims, so cached rows keep their identity. */
  private trackTrims() {
    const core = (this.term as unknown as { _core?: { _bufferService?: { buffers?: { normal?: { lines?: { onTrim?: (cb: (n: number) => void) => IDisposable } } } } } })._core;
    const lines = core?._bufferService?.buffers?.normal?.lines;
    if (lines && lines !== this.trimSource && typeof lines.onTrim === 'function') {
      this.trimSub?.dispose();
      this.trimSource = lines;
      this.trimSub = lines.onTrim((n: number) => {
        this.trimmed += n;
      });
      this.epoch++;
    }
    const buf = this.term.buffer.normal;
    // A buffer that got shorter was cleared (`clear`, Ctrl+L on some shells,
    // `term.clear()`): the same line numbers now hold different text.
    if (buf.length < this.lastLength) this.epoch++;
    // Without the trim event, a full buffer that keeps scrolling can't be
    // told apart from one that doesn't: give up caching while it is full.
    if (!this.trimSub && buf.length >= this.term.options.scrollback! + this.term.rows) this.epoch++;
    this.lastLength = buf.length;
    if (this.term.cols !== this.lastCols) {
      this.lastCols = this.term.cols;
      this.epoch++;
    }
  }

  // ==========================================================================
  // Layout
  // ==========================================================================

  private schedule() {
    this.layoutDirty = true;
    this.scheduleScroll();
  }

  /** A frame for a scroll alone: the layout is the last one, only repainted. */
  private scheduleScroll() {
    if (!this.active || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private renderNow() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.layoutDirty = true;
    this.render();
  }

  private line(y: number): IBufferLine | undefined {
    return this.term.buffer.active.getLine(y);
  }

  private blank(y: number, cell: CellLike): boolean {
    return lineIsBlank(this.line(y) as unknown as LineLike | undefined, cell);
  }

  /** The segments for the current buffer, in order, heights not yet set. */
  private computeSegments(ctx: RowContext): Seg[] {
    const buf = this.term.buffer.active;
    const cursorLine = buf.baseY + buf.cursorY;
    const blocks = this.blocks();
    const cell = ctx.cell;

    // Where the live part starts.
    const last = blocks[blocks.length - 1];
    let liveStart: number;
    let liveBlock: TerminalBlock | null = null;
    if (last && last.status !== 'done') {
      liveStart = last.start;
      liveBlock = last;
    } else if (last) {
      liveStart = last.endExclusive ?? cursorLine;
    } else {
      liveStart = 0;
    }
    liveStart = Math.max(0, Math.min(liveStart, cursorLine));

    const out: Seg[] = [];
    const pushLoose = (from: number, to: number) => {
      // Trim blank rows at both ends; an all-blank gap is the space between
      // two cards, which the layout already draws.
      while (from < to && this.blank(from, cell)) from++;
      while (to > from && this.blank(to - 1, cell)) to--;
      if (to <= from) return;
      const seg = this.emptySeg('loose');
      seg.key = `l:${from + this.trimmed}`;
      seg.start = seg.promptEnd = from;
      seg.end = to;
      seg.bodyCount = to - from;
      out.push(seg);
    };

    let cursor = 0;
    const frozen = blocks.filter((b) => b !== liveBlock && b.start < liveStart);
    frozen.forEach((b, i) => {
      const next = frozen[i + 1];
      const record = this.recordOf(b.id)!;
      let start = Math.max(b.start, cursor);
      let end = Math.min(b.endExclusive ?? next?.start ?? liveStart, next?.start ?? liveStart, liveStart);
      if (end <= start) return;
      if (start > cursor) pushLoose(cursor, start);
      cursor = end;
      // Blank rows a prompt opens with (starship's `add_newline`) and the
      // ones after the output are padding the card already has.
      while (start < end - 1 && this.blank(start, cell)) start++;
      while (end > start + 1 && this.blank(end - 1, cell)) end--;
      let promptEnd = b.outputStart === null ? end : Math.max(start, Math.min(b.outputStart, end));
      if (promptEnd - start > MAX_PROMPT_ROWS) promptEnd = start + MAX_PROMPT_ROWS;
      const seg = this.emptySeg('block');
      seg.key = `b:${b.id}`;
      seg.record = record;
      seg.block = b;
      seg.card = true;
      seg.start = start;
      seg.promptEnd = promptEnd;
      seg.end = end;
      seg.outputLines = end - promptEnd;
      seg.folded = record.folded && seg.outputLines > 0;
      if (record.filter) {
        seg.rows = this.filterRows(promptEnd, end, record.filter);
        seg.bodyCount = seg.rows.length;
      } else {
        seg.bodyCount = end - promptEnd;
      }
      out.push(seg);
    });
    if (liveStart > cursor) pushLoose(cursor, liveStart);

    // The live part: page rows for what scrolled off the screen, then the
    // screen rows the block uses.
    const live = this.emptySeg('live');
    live.key = 'live';
    live.block = liveBlock;
    live.record = liveBlock ? this.recordOf(liveBlock.id) : null;
    live.start = liveStart;
    live.end = Math.max(liveStart, buf.baseY);
    live.promptEnd = live.start;
    live.bodyCount = live.end - live.start;
    live.screenTop = Math.max(liveStart, buf.baseY) - buf.baseY;
    let lastRow = buf.cursorY;
    for (let y = this.term.rows - 1; y > lastRow; y--) {
      if (!this.blank(buf.baseY + y, cell)) {
        lastRow = y;
        break;
      }
    }
    if (liveBlock?.status === 'running') {
      const high = this.liveHigh?.id === liveBlock.id ? Math.min(this.liveHigh.row, this.term.rows - 1) : -1;
      lastRow = Math.max(lastRow, high);
      this.liveHigh = { id: liveBlock.id, row: lastRow };
    } else {
      this.liveHigh = null;
    }
    live.screenRows = Math.max(1, lastRow - live.screenTop + 1);
    live.card = liveBlock !== null;
    out.push(live);
    return out;
  }

  /** Output rows whose logical line contains `query` (case-insensitive). */
  private filterRows(from: number, to: number, query: string): number[] {
    const q = query.toLowerCase();
    const rows: number[] = [];
    let y = from;
    while (y < to) {
      let end = y + 1;
      while (end < to && this.line(end)?.isWrapped) end++;
      let text = '';
      for (let k = y; k < end; k++) text += this.line(k)?.translateToString(true) ?? '';
      if (!q || text.toLowerCase().includes(q)) for (let k = y; k < end; k++) rows.push(k);
      y = end;
    }
    return rows;
  }

  private segHeight(seg: Seg): number {
    const h = this.cellH;
    if (seg.kind === 'live') {
      const rows = seg.bodyCount + seg.screenRows;
      return rows * h + (seg.card ? this.padTop + this.padBottom : 0);
    }
    if (seg.kind === 'loose') return seg.bodyCount * h + this.gap;
    const prompt = (seg.promptEnd - seg.start) * h;
    const filter = seg.record?.filterOpen ? Math.max(24, h + 8) : 0;
    const body = seg.folded ? this.foldHeight() : seg.bodyCount * h;
    return this.padTop + prompt + filter + body + this.padBottom + this.gap;
  }

  private foldHeight(): number {
    return Math.max(20, Math.round(this.cellH + 6));
  }

  // ==========================================================================
  // Rendering
  // ==========================================================================

  private render() {
    if (!this.active || !this.scroller || !this.list || !this.live || !this.container.isConnected) return;
    const full = this.layoutDirty;
    this.layoutDirty = false;
    // A scroll alone changes nothing but what is in view: no segments to
    // rebuild, no scroll position to set — the browser already has it, and
    // writing it back mid-gesture is what made the list jerk.
    if (!full && !this.alt && this.segs.length > 0 && this.term.buffer.active.type === 'normal') {
      this.paintScroll();
      return;
    }
    if (!this.measure()) {
      this.schedule();
      return;
    }
    this.updateSpacing();
    this.scroller.classList.toggle('cortx-bv-nodividers', !this.host.dividers());
    this.trackTrims();
    const ctx = this.updatePalette();
    const buf = this.term.buffer.active;
    const scroller = this.scroller;

    // -- The alternate screen: the live card takes the pane, nothing else.
    const alt = buf.type === 'alternate';
    if (alt !== this.alt) {
      this.alt = alt;
      this.container.classList.toggle('cortx-bv-alt', alt);
      this.epoch++;
    }
    // The list scrolls, xterm's viewport stays at the bottom.
    if (buf.type === 'normal' && buf.viewportY !== buf.baseY) this.term.scrollToBottom();
    const el = this.term.element;
    if (el) {
      el.style.width = `${this.term.cols * this.cellW}px`;
      el.style.height = `${this.term.rows * this.cellH}px`;
    }
    if (alt) {
      scroller.scrollTop = 0;
      this.lastListH = -1;
      this.updateBar();
      if (el) el.style.transform = '';
      if (this.clip) this.clip.style.height = `${this.term.rows * this.cellH}px`;
      this.host.onLayout?.();
      return;
    }

    // -- Scroll anchor, from the previous frame's layout.
    let anchor: { key: string; offset: number } | null = null;
    if (!this.stuck) {
      const top = scroller.scrollTop;
      for (const seg of this.segs) {
        if (seg.top + seg.height > top) {
          anchor = { key: seg.key, offset: top - seg.top };
          break;
        }
      }
    }

    const segs = this.computeSegments(ctx);
    let total = 0;
    for (const seg of segs) {
      seg.height = this.segHeight(seg);
      total += seg.height;
    }
    const viewH = scroller.clientHeight;
    const filler = this.host.bottomAligned() ? Math.max(0, viewH - total) : 0;
    let y = filler;
    for (const seg of segs) {
      seg.top = y;
      y += seg.height;
    }
    this.segs = segs;
    this.list.style.paddingTop = `${filler}px`;
    this.list.style.height = `${y}px`;

    // -- Where the view will be, to know what to draw. The position is only
    // ever moved to follow the content (it grew under a view pinned to the
    // bottom, or moved under the row the view was on); a position the user
    // scrolled to is theirs — a view past the end (a rubber band) included.
    const current = scroller.scrollTop;
    let scrollTop = current;
    let move = false;
    if (this.stuck) {
      const bottom = Math.max(0, y - viewH);
      if (current < bottom - 0.5 || y !== this.lastListH) {
        scrollTop = bottom;
        move = true;
      }
    } else if (anchor) {
      const seg = segs.find((s) => s.key === anchor!.key);
      const prev = this.prevLayout.get(anchor.key);
      if (seg && (!prev || prev.top !== seg.top)) {
        scrollTop = Math.max(0, seg.top + anchor.offset);
        move = true;
      }
    }
    this.lastListH = y;
    const winTop = scrollTop - viewH;
    const winBottom = scrollTop + viewH * 2;

    // -- Reconcile the frozen segments' elements (the live one is last).
    const wanted = new Set<string>();
    let before: HTMLElement = this.live.root;
    for (let i = segs.length - 2; i >= 0; i--) {
      const seg = segs[i];
      wanted.add(seg.key);
      let segEl = this.els.get(seg.key);
      if (!segEl || segEl.root.classList.contains('cortx-bv-card') !== seg.card) {
        segEl?.root.remove();
        segEl = this.createSegEl(seg);
        this.els.set(seg.key, segEl);
      }
      if (segEl.root.nextSibling !== before) this.list.insertBefore(segEl.root, before);
      before = segEl.root;
      segEl.seg = seg;
      this.paintSeg(segEl, seg, ctx, winTop, winBottom, scrollTop);
    }
    this.shown.clear();
    for (let i = 0; i < segs.length - 1; i++) {
      if (segs[i].top + segs[i].height > winTop && segs[i].top < winBottom) this.shown.add(segs[i].key);
    }
    for (const [key, segEl] of this.els) {
      if (!wanted.has(key)) {
        segEl.root.remove();
        this.els.delete(key);
      }
    }

    // -- The live card.
    const liveSeg = segs[segs.length - 1];
    this.live.seg = liveSeg;
    this.paintLive(liveSeg, ctx, winTop, winBottom);

    // -- Scroll.
    if (move && Math.abs(scroller.scrollTop - scrollTop) > 0.5) scroller.scrollTop = scrollTop;
    this.prevLayout.clear();
    for (const seg of segs) this.prevLayout.set(seg.key, { top: seg.top, height: seg.height });
    this.updateBar();
    this.host.onLayout?.();
  }

  /**
   * A frame for a scroll alone: the segments of the last layout, painted
   * around the new position. Only the ones in the window — and the ones that
   * just left it, to put their rows away and unpin their head — are touched,
   * so a list of hundreds of blocks scrolls at the cost of the few in view.
   */
  private paintScroll() {
    const scroller = this.scroller!;
    const ctx = this.rowCtx;
    if (!ctx) return;
    const segs = this.segs;
    const scrollTop = scroller.scrollTop;
    const viewH = scroller.clientHeight;
    const winTop = scrollTop - viewH;
    const winBottom = scrollTop + viewH * 2;
    // First segment that reaches into the window (they are in order).
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid].top + segs[mid].height > winTop) hi = mid;
      else lo = mid + 1;
    }
    const inView = new Set<string>();
    for (let i = lo; i < segs.length - 1 && segs[i].top < winBottom; i++) {
      const seg = segs[i];
      const segEl = this.els.get(seg.key);
      if (!segEl) continue;
      inView.add(seg.key);
      this.paintSeg(segEl, seg, ctx, winTop, winBottom, scrollTop);
    }
    for (const key of this.shown) {
      if (inView.has(key)) continue;
      const segEl = this.els.get(key);
      if (segEl) this.paintSeg(segEl, segEl.seg, ctx, winTop, winBottom, scrollTop);
    }
    this.shown = inView;
    const live = segs[segs.length - 1];
    if (this.live && live) {
      const bodyTop = live.top + (live.card ? this.padTop : 0);
      this.paintChunks(this.live, live, ctx, bodyTop, winTop, winBottom);
    }
    // What is laid out over the live card (the editor's completion list) is
    // placed in viewport coordinates.
    this.host.onLayout?.();
  }

  private createSegEl(seg: Seg): SegEl {
    const root = document.createElement('div');
    root.className = `cortx-bv-seg ${seg.card ? 'cortx-bv-card' : 'cortx-bv-loose'}`;
    const body = document.createElement('div');
    body.className = 'cortx-bv-body';
    const segEl: SegEl = {
      root,
      head: null,
      promptRows: null,
      body,
      fold: null,
      tools: null,
      meta: null,
      filterBox: null,
      filterInput: null,
      filterCount: null,
      chunks: new Map(),
      promptKey: '',
      seg,
    };
    if (seg.card) {
      const head = document.createElement('div');
      head.className = 'cortx-bv-head';
      const promptRows = document.createElement('div');
      promptRows.className = 'cortx-bv-prompt';
      const meta = document.createElement('div');
      meta.className = 'cortx-bv-meta';
      head.append(promptRows, meta);
      const fold = document.createElement('button');
      fold.type = 'button';
      fold.className = 'cortx-bv-fold';
      fold.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = segEl.seg.block?.id;
        if (id !== undefined) this.toggleFold(id);
      });
      root.append(head, body, fold);
      segEl.head = head;
      segEl.promptRows = promptRows;
      segEl.meta = meta;
      segEl.fold = fold;
    } else {
      root.append(body);
    }
    return segEl;
  }

  private ensureTools(segEl: SegEl) {
    if (segEl.tools || !segEl.head) return;
    const tools = document.createElement('div');
    tools.className = 'cortx-bv-tools';
    const button = (icon: BlockIconId, label: string, act: (e: MouseEvent) => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cortx-bv-tool';
      b.dataset.icon = icon;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.appendChild(blockIconSvg(icon));
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        act(e);
      });
      tools.appendChild(b);
      return b;
    };
    // Status and timing sit with the actions, at the card's top-right.
    if (segEl.meta) tools.appendChild(segEl.meta);
    const idOf = () => segEl.seg.block?.id;
    button('copyCommand', 'Copy command', () => idOf() !== undefined && this.run(idOf()!, 'copyCommand'));
    button('copyOutput', 'Copy output', () => idOf() !== undefined && this.run(idOf()!, 'copyOutput'));
    button('copyBlock', 'Copy command and output', () => idOf() !== undefined && this.run(idOf()!, 'copyBlock'));
    button('rerun', 'Run again', () => idOf() !== undefined && this.run(idOf()!, 'rerun'));
    button('filter', 'Filter output', () => idOf() !== undefined && this.run(idOf()!, 'filter'));
    button('fold', 'Fold output', () => idOf() !== undefined && this.run(idOf()!, 'fold'));
    button('more', 'More', (e) => {
      const id = idOf();
      if (id === undefined) return;
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this.openMenu(id, r.left, r.bottom + 4);
    });
    segEl.head.appendChild(tools);
    segEl.tools = tools;
  }

  private ensureFilter(segEl: SegEl) {
    if (segEl.filterBox || !segEl.head) return;
    const box = document.createElement('div');
    box.className = 'cortx-bv-filter';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Filter output…';
    input.spellcheck = false;
    const count = document.createElement('span');
    count.className = 'cortx-bv-filter-count';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'cortx-bv-filter-close';
    close.textContent = '×';
    close.title = 'Stop filtering';
    box.append(input, count, close);
    input.addEventListener('input', () => {
      const record = segEl.seg.record;
      if (!record) return;
      record.filter = input.value || null;
      this.epoch++;
      this.schedule();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && !input.value)) {
        const id = segEl.seg.block?.id;
        if (id !== undefined) this.run(id, 'filter');
        this.term.focus();
      } else if (e.key === 'Enter') {
        this.term.focus();
      }
    });
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = segEl.seg.block?.id;
      if (id !== undefined) this.run(id, 'filter');
      this.term.focus();
    });
    segEl.head.insertBefore(box, segEl.promptRows?.nextSibling ?? null);
    segEl.filterBox = box;
    segEl.filterInput = input;
    segEl.filterCount = count;
  }

  private paintSeg(segEl: SegEl, seg: Seg, ctx: RowContext, winTop: number, winBottom: number, scrollTop: number) {
    const root = segEl.root;
    // The gap is a margin, so the plate stops where the card does.
    root.style.height = `${seg.height - this.gap}px`;
    root.style.marginBottom = `${this.gap}px`;
    const visible = seg.top + seg.height > winTop && seg.top < winBottom;
    const buf = this.term.buffer.active;

    if (seg.card && seg.block && seg.record) {
      const b = seg.block;
      const r = seg.record;
      const failed = b.exitCode !== null && b.exitCode !== 0;
      root.classList.toggle('cortx-bv-failed', failed);
      root.classList.toggle('cortx-bv-ok', b.exitCode === 0);
      root.classList.toggle('cortx-bv-wash', failed && this.host.failedWash());
      root.classList.toggle('cortx-bv-sel', this.selection.has(b.id));
      root.classList.toggle('cortx-bv-folded', seg.folded);
      root.classList.toggle('cortx-bv-sticky', this.host.stickyHeader() && seg.bodyCount > 0 && !seg.folded);
      // Stuck header: its own plate must be opaque, or the output scrolling
      // under it would show through.
      const headTop = seg.top + this.padTop;
      root.classList.toggle('cortx-bv-stuck', scrollTop > headTop + 1 && scrollTop < seg.top + seg.height - this.padBottom);
      if (!visible) {
        this.clearContent(segEl);
        return;
      }
      if (this.host.actionBar()) this.ensureTools(segEl);
      if (segEl.tools) segEl.tools.hidden = !this.host.actionBar();
      const foldBtn = segEl.tools?.querySelector<HTMLElement>('[data-icon="fold"]');
      if (foldBtn) {
        foldBtn.hidden = seg.outputLines === 0;
        foldBtn.title = r.folded ? 'Unfold output' : 'Fold output';
      }
      const filterBtn = segEl.tools?.querySelector<HTMLElement>('[data-icon="filter"]');
      if (filterBtn) filterBtn.hidden = seg.outputLines === 0;
      // Prompt rows.
      const promptKey = `${this.epoch}|${this.searchGen}|${seg.start + this.trimmed}|${seg.promptEnd - seg.start}|${seg.promptEnd > buf.baseY ? performance.now() : ''}`;
      if (promptKey !== segEl.promptKey && segEl.promptRows) {
        segEl.promptKey = promptKey;
        let html = '';
        for (let i = 0; i < seg.promptEnd - seg.start; i++) html += this.rowHtml(seg.start + i, ctx, `data-p="${i}"`);
        segEl.promptRows.innerHTML = html;
        this.paintImages(segEl.promptRows, (i) => seg.start + i, '[data-p]');
      }
      // Meta: status and timing.
      if (segEl.meta) {
        const parts: string[] = [];
        if (failed) parts.push(`exit ${b.exitCode}`);
        if (r.startedAt !== null && r.finishedAt !== null && !r.replayed) parts.push(formatDuration(Math.max(0, r.finishedAt - r.startedAt)));
        const text = parts.join(' · ');
        if (segEl.meta.textContent !== text) segEl.meta.textContent = text;
      }
      // Filter.
      if (r.filterOpen) {
        this.ensureFilter(segEl);
        if (segEl.filterBox) segEl.filterBox.hidden = false;
        if (segEl.filterInput && segEl.filterInput.value !== (r.filter ?? '') && document.activeElement !== segEl.filterInput) {
          segEl.filterInput.value = r.filter ?? '';
        }
        if (segEl.filterCount) segEl.filterCount.textContent = r.filter ? `${seg.bodyCount} of ${seg.outputLines}` : '';
      } else if (segEl.filterBox) {
        segEl.filterBox.hidden = true;
      }
      // Fold strip.
      if (segEl.fold) {
        segEl.fold.hidden = !seg.folded;
        if (seg.folded) segEl.fold.textContent = `${foldLabel(seg.outputLines)} — click to unfold`;
      }
    } else if (!visible) {
      this.clearContent(segEl);
      return;
    }

    // Body rows, in chunks, only around the view.
    const body = segEl.body;
    const bodyH = seg.folded ? 0 : seg.bodyCount * this.cellH;
    body.style.height = `${bodyH}px`;
    if (seg.folded) {
      this.dropChunks(segEl, new Set());
      return;
    }
    const bodyTop = seg.top + (seg.card ? this.padTop + (seg.promptEnd - seg.start) * this.cellH + (seg.record?.filterOpen ? Math.max(24, this.cellH + 8) : 0) : 0);
    this.paintChunks(segEl, seg, ctx, bodyTop, winTop, winBottom);
  }

  private paintChunks(segEl: SegEl, seg: Seg, ctx: RowContext, bodyTop: number, winTop: number, winBottom: number) {
    const buf = this.term.buffer.active;
    const count = seg.bodyCount;
    const first = Math.max(0, Math.floor((winTop - bodyTop) / (CHUNK * this.cellH)));
    const last = Math.min(Math.ceil(count / CHUNK) - 1, Math.floor((winBottom - bodyTop) / (CHUNK * this.cellH)));
    const keep = new Set<number>();
    const lineOf = (i: number) => (seg.rows ? seg.rows[i] : seg.promptEnd + i);
    for (let c = first; c <= last; c++) {
      keep.add(c);
      const from = c * CHUNK;
      const to = Math.min(count, from + CHUNK);
      const firstLine = lineOf(from);
      const lastLine = lineOf(to - 1);
      // Rows still on the xterm screen can change under us: never cached.
      const live = lastLine >= buf.baseY ? `|${performance.now()}` : '';
      const key = `${this.epoch}|${this.searchGen}|${firstLine + this.trimmed}|${to - from}|${seg.rows ? 'f' : ''}${live}`;
      let chunk = segEl.chunks.get(c);
      if (chunk && chunk.key === key) continue;
      if (!chunk) {
        const el = document.createElement('div');
        el.className = 'cortx-bv-chunk';
        segEl.body.appendChild(el);
        chunk = { el, key: '' };
        segEl.chunks.set(c, chunk);
      }
      chunk.key = key;
      chunk.el.style.top = `${from * this.cellH}px`;
      let html = '';
      for (let i = from; i < to; i++) html += this.rowHtml(lineOf(i), ctx, `data-r="${i}"`);
      chunk.el.innerHTML = html;
      this.paintImages(chunk.el, (i) => lineOf(i), '[data-r]');
    }
    this.dropChunks(segEl, keep);
  }

  private dropChunks(segEl: SegEl, keep: Set<number>) {
    for (const [c, chunk] of segEl.chunks) {
      if (keep.has(c)) continue;
      chunk.el.remove();
      segEl.chunks.delete(c);
    }
  }

  private clearContent(segEl: SegEl) {
    this.dropChunks(segEl, new Set());
    if (segEl.promptRows && segEl.promptKey) {
      segEl.promptRows.textContent = '';
      segEl.promptKey = '';
    }
  }

  /** One row: its runs, search highlights and the attribute it is found by. */
  private rowHtml(y: number, ctx: RowContext, attr: string): string {
    const line = this.line(y) as unknown as LineLike | undefined;
    let html = renderRow(line, ctx, this.term.cols);
    if (this.searchRe && line) html = this.matchHtml(line, y) + html;
    return `<div class="cortx-bv-r" ${attr}>${html}</div>`;
  }

  private matchHtml(line: LineLike, y: number): string {
    const re = this.searchRe!;
    // Column of every character (wide cells make the two differ).
    const cols: number[] = [];
    let text = '';
    const cell = this.rowCtx!.cell;
    for (let x = 0; x < line.length; x++) {
      const c = line.getCell(x, cell);
      if (!c || c.getWidth() === 0) continue;
      const ch = c.getChars() || ' ';
      for (let k = 0; k < ch.length; k++) cols.push(x);
      text += ch;
    }
    cols.push(line.length);
    let out = '';
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const from = cols[m.index];
      const to = cols[Math.min(cols.length - 1, m.index + m[0].length)];
      const active = this.activeMatch && this.activeMatch.line === y && this.activeMatch.col === from;
      out += `<i class="cortx-bv-m${active ? ' cortx-bv-m-on' : ''}" style="left:${from * this.cellW}px;width:${Math.max(1, to - from) * this.cellW}px"></i>`;
    }
    return out;
  }

  /** Inline images: one cell-sized tile per cell that has one. */
  private paintImages(container: HTMLElement, lineOf: (i: number) => number, selector: string) {
    if (!this.host.imageTile || !this.host.hasImages?.()) return;
    const rows = container.querySelectorAll<HTMLElement>(`.cortx-bv-r${selector}`);
    rows.forEach((row) => {
      const i = Number(row.dataset.p ?? row.dataset.r);
      const y = lineOf(i);
      let canvas: HTMLCanvasElement | null = null;
      let g: CanvasRenderingContext2D | null = null;
      for (let x = 0; x < this.term.cols; x++) {
        const tile = this.host.imageTile!(x, y);
        if (!tile) continue;
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvas.className = 'cortx-bv-img';
          const dpr = window.devicePixelRatio || 1;
          canvas.width = Math.round(this.term.cols * this.cellW * dpr);
          canvas.height = Math.round(this.cellH * dpr);
          canvas.style.width = `${this.term.cols * this.cellW}px`;
          canvas.style.height = `${this.cellH}px`;
          g = canvas.getContext('2d');
        }
        g?.drawImage(tile, Math.round(x * this.cellW * (canvas.width / (this.term.cols * this.cellW))), 0, Math.round(this.cellW * (canvas.width / (this.term.cols * this.cellW))), canvas.height);
      }
      if (canvas) row.appendChild(canvas);
    });
  }

  private paintLive(seg: Seg, ctx: RowContext, winTop: number, winBottom: number) {
    const live = this.live!;
    const root = live.root;
    root.style.height = `${seg.height}px`;
    root.classList.toggle('cortx-bv-card', seg.card);
    const b = seg.block;
    root.classList.toggle('cortx-bv-running', b?.status === 'running');
    const bodyTop = seg.top + (seg.card ? this.padTop : 0);
    live.body.style.height = `${seg.bodyCount * this.cellH}px`;
    this.paintChunks(live, seg, ctx, bodyTop, winTop, winBottom);
    const el = this.term.element;
    if (this.clip) this.clip.style.height = `${seg.screenRows * this.cellH}px`;
    if (el) el.style.transform = seg.screenTop ? `translateY(${-seg.screenTop * this.cellH}px)` : '';
  }
}
