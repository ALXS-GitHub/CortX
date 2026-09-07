/**
 * Command blocks — the xterm half (DEV-13 P4, ticket #7).
 *
 * A block is one command and its output, delimited by the `OSC 133` markers
 * `cortx init` already makes the shell emit. CortX is **not** Warp: the plan
 * (`plans/terminal_mode.md` §9) decided to keep the classic flow and the
 * xterm grid exactly as they are, and to add block *markers* on top. So
 * nothing here writes to the buffer, resizes the PTY or re-renders a line —
 * every pixel this module produces lives in one absolutely-positioned overlay
 * layer that is drawn *over* the grid and never displaces a glyph.
 *
 * What it gives you:
 * - **Dividers**: a 1 px rule the full width of the pane on every block's top
 *   edge. This is what makes a block a thing you *see* rather than a thing the
 *   app knows about — Warp's `appearance.blocks.show_block_dividers`, which is
 *   on by default there and here. It is a *neutral* wash (white on a dark
 *   palette, black on a light one), strong enough to be read as a boundary:
 *   the first pass aimed for "sensed rather than read" and, with real air
 *   around it, a rule that faint simply disappeared and the pane looked like
 *   plain scrollback. It carries no status colour, because a full-width red
 *   rule is the loudest thing on a pane.
 * - **A bracket, not a band**: the block under the pointer (and the selected
 *   one) is shown by its own hairline and the next block's coming up slightly,
 *   so its extent is obvious. Nothing is ever painted *over* a block's rows:
 *   a wash, however faint, recolours the text the shell drew and is the first
 *   thing the eye finds on a themed pane.
 * - **A hover toolbar** near the block's top-right corner: copy the command,
 *   copy the output, copy both, run it again, fold it away, and a `⋯` opening
 *   the full menu. It only ever lands on a row whose right-hand end is empty —
 *   preferably the gap on the divider — so a right-hand prompt (a clock, a git
 *   status) is never covered; when no such row exists it is not drawn at all.
 * - **A clickable gutter** in the pane's left padding: one bar per block,
 *   coloured by the exit code the shell reported. Click selects, double-click
 *   folds, right-click opens the block menu.
 * - **Prompt-to-prompt navigation** (Ctrl+↑ / Ctrl+↓): scrolls the previous /
 *   next prompt to the top of the pane and highlights its block.
 * - **Copy** the command, the output, both, or the whole thing as a Markdown
 *   `console` fence — plus Ctrl+Shift+C when a block is selected and there is
 *   no text selection, which copies nothing today.
 * - **Fold** a block's output behind a "412 lines hidden" strip.
 * - **Run the command again**, or **put it back on the prompt line** to edit
 *   it first (Warp's `terminal:reinput_commands`).
 * - **Scroll to the top / bottom** of a block, and hand its rows to the
 *   terminal's own text selection.
 *
 * ## The one thing the overlay cannot do: make room
 *
 * Warp has a setting for the air between two blocks (`appearance.spacing`)
 * because it draws its blocks itself and can reserve pixels. We draw over
 * xterm's grid, where every row is exactly one row tall: `lineHeight` moves
 * *all* of them, the canvas renderer paints the whole viewport as one bitmap,
 * and the DOM renderer's rows are addressed by `y / rowHeight` everywhere from
 * selection to link hit-testing — pushing one row down with a margin would
 * shift the pane's own idea of where every glyph is. So no overlay, in any
 * renderer, can space two blocks apart.
 *
 * The room therefore has to *exist*, as real blank lines in the buffer, and
 * the only thing that can put them there without lying to the PTY is the
 * shell: `terminal.blockSpacing` makes the shell integration print `normal` =
 * one before a prompt that follows a command, `comfortable` = two (Warp's own
 * air is ~2.1 grid cells, and whole rows are all a grid can express) — see
 * `shell_init.rs`. Everything here only *reads* the result: the divider is
 * centred in the whole run of blank rows, not half a row up, so two of them
 * give a row of padding on each side instead of one and a half below and half
 * above. The action bar is centred on the same offset and therefore lands over
 * nothing anyone wrote. `compact` needs no code of its own — there is simply
 * no such row.
 *
 * ## Why the overlay never takes the mouse
 *
 * A full-width element covering a block would be the obvious way to know what
 * the pointer is over — and it would also swallow every mouse event the grid
 * needs: text selection, the file-path and URL links, the inline images, the
 * scrollbar. So the layer is `pointer-events: none` and the hovered block is
 * worked out from the pointer's *y coordinate* and the cell height. The only
 * three things that accept a click are the gutter bar, the fold cover and the
 * toolbar's own buttons, and each of them stops the event so the pane's
 * copy-on-select and right-click-pastes handlers never see it.
 *
 * ## Why markers, and what breaks them
 *
 * Positions are held by `term.registerMarker`, which is the only thing in
 * xterm that survives the buffer moving under it: the marker's `line` is
 * decremented when the scrollback is trimmed and shifted when reflow inserts
 * or deletes lines. It is disposed — and the block with it — when the line it
 * marks goes away, and that happens in four ways worth knowing about:
 *
 * 1. the scrollback trims it (10 000 lines back);
 * 2. `term.clear()` (`clearAllMarkers`) — the Clear button;
 * 3. any erase that touches the line (`ED` / `EL` → `_resetBufferLine` →
 *    `clearMarkers`), which is how Ctrl+L and a ConPTY repaint of the prompt
 *    line take blocks with them;
 * 4. the alternate buffer is cleared whenever it is left, so a marker that
 *    somehow landed there dies on the way back.
 *
 * All four are correct behaviour — in every one of them the block's text is
 * gone too — so a disposed marker simply drops its block. Case 3 is the one
 * that bites while you are typing (PSReadLine erases and redraws the prompt
 * line), which is why the block's start is re-anchored at `133;B` and at
 * `133;C` if it was lost in the meantime.
 *
 * Drawing is not done with `registerDecoration`. Decorations are one marker
 * each and xterm hides them entirely (`display: none`) as soon as their marker
 * leaves the viewport — a fold cover would therefore *uncover* its output the
 * moment you scrolled past its first line. The overlay computes its own
 * clipping instead (`clipToViewport`), so a fold stays a fold from any scroll
 * position. Decorations' one genuine advantage — being reprojected on scroll,
 * hidden in the alternate buffer and moved on resize — is reproduced here by
 * redrawing from `onRender` / `onScroll` / `onResize` / `onBufferChange`.
 *
 * ## Alignment with the rest of the pane
 *
 * The layer is a child of the session container (`.cortx-xterm`) — the very
 * element the "prompt pinned to the bottom" mode shifts with a `translateY`
 * (`terminalInputPosition.ts`) — so it inherits that offset for free and can
 * never drift from the text. It is re-parented with the session when a
 * terminal moves between the dock and the Terminal window, and it sits below
 * the universal input editor (`z-index`) so the editor keeps the caret.
 *
 * ## Restored sessions
 *
 * A restored session replays a *serialised buffer* (`SerializeAddon`), which
 * carries cells and colours and no OSC at all — the 133 markers are simply not
 * in those bytes. Blocks therefore **start from scratch at the first real
 * prompt after the replay**: everything the replay drew is scrollback with no
 * block on it. Reconstructing blocks from it would mean guessing where prompts
 * were by reading the screen, which is exactly what DEV-13 refused to do.
 * Markers seen while `session.replaying` is true are ignored for the same
 * reason: a snapshot that did contain them would place blocks at lines that no
 * longer mean anything.
 */
import type { IDisposable, IMarker, Terminal } from '@xterm/xterm';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { toast } from 'sonner';
import * as api from '@/lib/tauri';
import { useAppStore } from '@/stores/appStore';
import { comboFromEvent, effectiveCombos } from '@/lib/keybindings';
import { closeBlockMenu, openBlockMenu } from '@/lib/terminalBlockMenu';
import { blockIconSvg } from '@/lib/terminalBlockIcons';
import {
  blockActions,
  blockAtLine,
  blockFailed,
  blockMarkdown,
  blockRange,
  blockStatusLabel,
  blockToolbarWidth,
  boundaryLine,
  clipToViewport,
  dividerOffsetRows,
  foldLabel,
  foldedRange,
  joinBufferRows,
  navigateBlocks,
  parseBlockMarker,
  shortCommand,
  terminalIsDark,
  type BlockActionId,
  type BlockSpacingRow,
  type BlockActionSpec,
  type BufferRowText,
  type BlockStatus,
  type TerminalBlock,
} from '@/lib/terminalBlockModel';

/** Blocks are on unless the user turns them off (see the Settings copy). */
export function blocksEnabled(): boolean {
  return useAppStore.getState().settings?.terminal.blocks !== false;
}

/** The left-hand status bars. Off leaves navigation, copy and folding. */
export function blockGutterEnabled(): boolean {
  return useAppStore.getState().settings?.terminal.blockGutter !== false;
}

/**
 * The hairline between two blocks — the thing that makes blocks *visible*
 * rather than merely tracked. Warp's own `appearance.blocks.show_block_dividers`
 * defaults to on; so does this.
 */
export function blockDividersEnabled(): boolean {
  return useAppStore.getState().settings?.terminal.blockDividers !== false;
}

/** The toolbar that appears at a block's top-right corner on hover. */
export function blockActionBarEnabled(): boolean {
  return useAppStore.getState().settings?.terminal.blockActions !== false;
}

/** The universal input editor owns the prompt line (ticket #15, U1). */
function inputEditorOwnsPrompt(): boolean {
  return useAppStore.getState().settings?.terminal.inputEditor === true;
}

/**
 * How many blocks one terminal remembers. Each is three markers, and a marker
 * is three listeners on the buffer's line list, so this is the one place where
 * a long-lived terminal could accumulate cost.
 */
const MAX_BLOCKS = 400;

/** Visible width of a gutter bar, in px (the click target is wider; see CSS). */
const BAR_WIDTH = 3;

/**
 * Tallest the hover toolbar is ever drawn, in px. It is shrunk to one grid row
 * when the rows are shorter than this, because a toolbar that spills into the
 * row above or below would cover text there (see `placeToolbar`).
 */
const TOOLBAR_HEIGHT = 24;

/** Shortest a toolbar may be squeezed to before it is simply not drawn. */
const TOOLBAR_MIN_HEIGHT = 15;

/**
 * Blank px the toolbar wants past its own width at the right edge of the pane:
 * the CSS inset (10 px, clear of the scrollbar) plus a little air so it never
 * touches the last glyph of the row it lands on.
 */
const TOOLBAR_RIGHT_MARGIN = 16;

/** How far down a block we look for a row the toolbar can sit on. */
const TOOLBAR_SEARCH_ROWS = 24;

/** The grid's geometry inside the session container, in px. */
interface Metrics {
  /** Height of one row. */
  cell: number;
  /** Width of one column (0 when it could not be measured). */
  column: number;
  /** Where the grid starts, relative to the container's top. */
  top: number;
}

interface BlockRecord {
  id: number;
  /** Prompt line. The block is dropped when this marker dies. */
  start: IMarker | null;
  /** First output line; null until `133;C`. */
  output: IMarker | null;
  /** First line after the block; null while it runs. */
  end: IMarker | null;
  command: string | null;
  exitCode: number | null;
  status: BlockStatus;
  folded: boolean;
}

let nextBlockId = 1;

class BlockController {
  private readonly term: Terminal;
  private readonly terminalId: string;
  private readonly container: HTMLElement;
  private readonly isReplaying: () => boolean;
  private readonly disposables: IDisposable[] = [];

  private records: BlockRecord[] = [];
  /** The block the shell is currently at a prompt in / running. */
  private current: BlockRecord | null = null;
  private selectedId: number | null = null;
  /** The block under the pointer: highlighted, and the one the toolbar acts on. */
  private hoveredId: number | null = null;
  /** Viewport row the pointer was last resolved on (mousemove fires per pixel). */
  private hoverRow = -1;
  /**
   * Viewport rows the hover toolbar is standing on. Those rows do not change
   * the hovered block: the toolbar is often placed on the row *above* a block's
   * divider (the one place near the top edge that is usually blank), and
   * without this the pointer would hand the hover to the block above on its way
   * to the buttons — the bar would flee from under the cursor.
   */
  private toolbarRows: number[] = [];

  private layer: HTMLElement | null = null;
  /** Elements of the last render, keyed `<blockId>:<kind>`, for reconciling. */
  private elements = new Map<string, HTMLElement>();
  /**
   * `usedColumns` memo for the frame being drawn, keyed by absolute buffer
   * line. Every block asks about the row above its prompt (is there a spacing
   * line?) and the toolbar asks about the same rows again — and the answer for
   * a blank row costs a full scan of the line, since there is no glyph to stop
   * at. Cleared at the top of every `render`.
   */
  private usedCache = new Map<number, number>();
  private frame = 0;
  /** True while we dispose markers ourselves (their onDispose must not recurse). */
  private tearingDown = false;

  constructor(terminalId: string, term: Terminal, container: HTMLElement, isReplaying: () => boolean) {
    this.terminalId = terminalId;
    this.term = term;
    this.container = container;
    this.isReplaying = isReplaying;

    this.disposables.push(
      term.parser.registerOscHandler(133, (data) => {
        this.onMarker(data);
        // Never consumed: the ghost suggestions, the input editor and the
        // bottom-pinned offset all listen to the same sequence.
        return false;
      })
    );
    const redraw = () => this.schedule();
    this.disposables.push(term.onRender(redraw));
    this.disposables.push(term.onScroll(redraw));
    this.disposables.push(term.onResize(redraw));
    this.disposables.push(term.onWriteParsed(redraw));
    this.disposables.push(term.buffer.onBufferChange(redraw));

    this.container.addEventListener('keydown', this.onKeyDown, true);
    this.container.addEventListener('mousedown', this.onMouseDown, true);
    // Hover is read from the *pointer position*, never from an element under
    // it: a full-width element covering a block would take the mouse away
    // from the grid and there would be no text selection, no link click and
    // no image click left. Nothing of this overlay accepts the pointer except
    // the gutter bar, the fold cover and the toolbar's own buttons.
    this.container.addEventListener('mousemove', this.onMouseMove, true);
    this.container.addEventListener('mouseleave', this.onMouseLeave);
  }

  dispose() {
    this.tearingDown = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.container.removeEventListener('keydown', this.onKeyDown, true);
    this.container.removeEventListener('mousedown', this.onMouseDown, true);
    this.container.removeEventListener('mousemove', this.onMouseMove, true);
    this.container.removeEventListener('mouseleave', this.onMouseLeave);
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    for (const record of this.records) this.disposeMarkers(record);
    this.records = [];
    this.current = null;
    this.selectedId = null;
    this.hoveredId = null;
    this.usedCache.clear();
    this.removeLayer();
    closeBlockMenu();
    this.tearingDown = false;
  }

  /** The setting changed, or the pane moved: redraw (or tear the layer down). */
  invalidate() {
    if (!blocksEnabled()) {
      this.tearingDown = true;
      for (const record of this.records) this.disposeMarkers(record);
      this.records = [];
      this.current = null;
      this.selectedId = null;
      this.hoveredId = null;
      this.tearingDown = false;
      this.removeLayer();
      return;
    }
    this.schedule();
  }

  // -- Model --------------------------------------------------------------

  private onMarker(data: string) {
    if (!blocksEnabled()) return;
    // A replayed snapshot has no markers of its own (see the module comment);
    // anything seen during the replay is stale and would land at a line that
    // no longer means anything.
    if (this.isReplaying()) return;
    const buf = this.term.buffer.active;
    // Markers registered on the alternate buffer are wiped when it is left,
    // and a full-screen program has no blocks to speak of.
    if (buf.type !== 'normal') return;
    const marker = parseBlockMarker(data);
    if (!marker) return;

    const cursorLine = buf.baseY + buf.cursorY;
    switch (marker.kind) {
      case 'A': {
        // A prompt that was drawn and never used (Ctrl+C, a resize redraw) is
        // replaced rather than stacked.
        if (this.current && this.current.status === 'prompt') this.drop(this.current);
        // A command whose `133;D` never arrived (a shell that lost its hooks
        // mid-session) is closed here instead: an open-ended block would keep
        // growing over everything printed below it.
        if (this.current && this.current.status === 'running') {
          this.current.status = 'done';
          this.current.end = this.markerAt(boundaryLine(cursorLine, buf.cursorX));
          this.current = null;
        }
        this.current = this.open(cursorLine);
        break;
      }
      case 'B': {
        // The shell redraws its prompt more often than one would think, and
        // an erase takes the start marker with it (see the module comment).
        this.reanchor(cursorLine);
        break;
      }
      case 'C': {
        const record = this.reanchor(cursorLine);
        record.status = 'running';
        if (marker.command !== undefined) record.command = marker.command;
        record.output = this.markerAt(boundaryLine(cursorLine, buf.cursorX));
        break;
      }
      case 'D': {
        const record = this.current;
        if (!record) break;
        record.status = 'done';
        record.exitCode = marker.exitCode ?? null;
        record.end = this.markerAt(boundaryLine(cursorLine, buf.cursorX));
        this.current = null;
        break;
      }
    }
    this.schedule();
  }

  /**
   * Make sure there is a current block whose start marker is alive, and
   * return it. Used at `133;B` and `133;C`: between the two, PSReadLine
   * erases and redraws the prompt line on every keystroke, and an erase
   * disposes the markers on that line.
   */
  private reanchor(cursorLine: number): BlockRecord {
    const record = this.current;
    // A record whose start marker died was dropped from the list along with
    // it, so "still listed" and "still anchored" are the same question.
    if (record && this.records.includes(record) && record.start && !record.start.isDisposed) return record;
    // `133;C` without a live prompt marker (the prompt line was erased under
    // us, or blocks were switched on mid-command).
    return (this.current = this.open(cursorLine));
  }

  /** A fresh block anchored on `line`, appended to the list. */
  private open(line: number): BlockRecord {
    return this.push({
      id: nextBlockId++,
      start: this.markerAt(line),
      output: null,
      end: null,
      command: null,
      exitCode: null,
      status: 'prompt',
      folded: false,
    });
  }

  /** A marker on an absolute buffer line (`registerMarker` is cursor-relative). */
  private markerAt(line: number): IMarker | null {
    const buf = this.term.buffer.active;
    const marker = this.term.registerMarker(line - (buf.baseY + buf.cursorY));
    if (marker) this.watch(marker);
    return marker ?? null;
  }

  private push(record: BlockRecord): BlockRecord {
    // Markers are watched by `markerAt`, which is the only thing that makes
    // them; watching again here would drop the block twice.
    this.records.push(record);
    while (this.records.length > MAX_BLOCKS) {
      const oldest = this.records.shift();
      if (oldest) this.disposeMarkers(oldest);
    }
    return record;
  }

  /** A marker dies with the line it marks; so does the block that owns it. */
  private watch(marker: IMarker) {
    marker.onDispose(() => {
      if (this.tearingDown) return;
      const owner = this.records.find((r) => r.start === marker || r.output === marker || r.end === marker);
      if (owner) this.drop(owner);
    });
  }

  private drop(record: BlockRecord) {
    const i = this.records.indexOf(record);
    if (i >= 0) this.records.splice(i, 1);
    if (this.current === record) this.current = null;
    if (this.selectedId === record.id) this.selectedId = null;
    if (this.hoveredId === record.id) this.hoveredId = null;
    this.disposeMarkers(record);
    this.schedule();
  }

  private disposeMarkers(record: BlockRecord) {
    const wasTearing = this.tearingDown;
    this.tearingDown = true;
    record.start?.dispose();
    record.output?.dispose();
    record.end?.dispose();
    record.start = record.output = record.end = null;
    this.tearingDown = wasTearing;
  }

  /** The record's current geometry, or null when a marker of its is gone. */
  private snapshot(record: BlockRecord): TerminalBlock | null {
    const start = record.start;
    if (!start || start.isDisposed) return null;
    const output = record.output && !record.output.isDisposed ? record.output.line : null;
    const end = record.end && !record.end.isDisposed ? record.end.line : null;
    return {
      id: record.id,
      start: start.line,
      outputStart: output,
      endExclusive: end,
      command: record.command,
      exitCode: record.exitCode,
      status: record.status,
      folded: record.folded,
    };
  }

  /**
   * Every live block, in buffer order. The records are already in that order
   * (they are appended as the shell announces them and markers shift
   * together), but navigation and the gutter both rely on it, and reflow is
   * the one thing that could disagree — so it is enforced rather than assumed.
   */
  private blocks(): TerminalBlock[] {
    const out: TerminalBlock[] = [];
    for (const record of this.records) {
      const block = this.snapshot(record);
      if (block) out.push(block);
    }
    return out.sort((a, b) => a.start - b.start);
  }

  /** The line after the last one written — the end of a still-running block. */
  private liveEnd(): number {
    const buf = this.term.buffer.active;
    return buf.baseY + buf.cursorY + 1;
  }

  private recordOf(id: number): BlockRecord | null {
    return this.records.find((r) => r.id === id) ?? null;
  }

  // -- Keyboard -----------------------------------------------------------

  /**
   * Ctrl+↑ / Ctrl+↓. The key only ever stops here when there really is a
   * block to jump to and the pane is showing the normal buffer — otherwise it
   * reaches the shell exactly as it does today, which is what keeps a TUI, a
   * REPL or a session without shell integration untouched.
   *
   * One more case is handed straight back: a command is running *and* the
   * viewport is at the bottom. That is someone typing into a program that took
   * the keyboard without an alternate screen (Claude Code, `fzf` inline), and
   * its keys must not be second-guessed. Scroll up first and navigation is
   * yours again.
   */
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.type !== 'keydown' || !blocksEnabled()) return;
    // Rebindable in Settings > Shortcuts like the rest of the window's keys;
    // `ctrl+up` / `ctrl+down` unless the user changed them. Unlike the window
    // shortcuts this handler also runs in the dock, which has no registry of
    // its own — the overrides are read straight from the settings.
    const combo = comboFromEvent(e);
    if (!combo) return;
    const overrides = useAppStore.getState().settings?.terminal.keybindings;
    const direction = effectiveCombos('block.previous', overrides).includes(combo)
      ? 'previous'
      : effectiveCombos('block.next', overrides).includes(combo)
        ? 'next'
        : null;
    if (!direction) return;
    const buf = this.term.buffer.active;
    if (buf.type !== 'normal') return;
    if (this.current?.status === 'running' && buf.viewportY >= buf.baseY) return;
    if (!this.jump(direction)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  /** Returns true when a block was actually reached (so the key is consumed). */
  jump(direction: 'previous' | 'next'): boolean {
    const blocks = this.blocks();
    if (blocks.length === 0) return false;
    const selected = this.selectedId === null ? null : blocks.find((b) => b.id === this.selectedId) ?? null;
    const anchor = selected ? selected.start : this.term.buffer.active.viewportY;
    const target = navigateBlocks(blocks, anchor, direction);
    if (!target) return false;
    this.selectedId = target.id;
    this.term.scrollToLine(target.start);
    this.schedule();
    return true;
  }

  // -- Mouse --------------------------------------------------------------

  /** A click anywhere in the grid drops the block selection (never the fold). */
  private readonly onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    if (this.layer?.contains(e.target as Node)) return;
    // A drag that ends on the row it started on would otherwise leave the
    // hover cache thinking it is already resolved.
    this.hoverRow = -1;
    if (this.selectedId === null) return;
    this.selectedId = null;
    this.schedule();
  };

  /**
   * Which block the pointer is over. Resolved from the y coordinate and the
   * cell height — the overlay itself is transparent to the mouse, so this is
   * the only way to know, and it costs nothing until the row changes.
   */
  private readonly onMouseMove = (e: MouseEvent) => {
    if (this.records.length === 0) return;
    if (!blocksEnabled() || !blockActionBarEnabled()) {
      this.setHovered(null);
      return;
    }
    // A button is down: the pointer is dragging a text selection (or the
    // scrollbar). Leave everything alone until it is released.
    if (e.buttons !== 0) return;
    // Over the toolbar itself. It straddles the block's top divider, so the
    // row under the pointer can belong to the block *above* — recomputing
    // there would make the bar flee from under the cursor.
    if (this.layer?.contains(e.target as Node)) return;
    const metrics = this.metrics();
    if (!metrics) return;
    const y = e.clientY - this.container.getBoundingClientRect().top - metrics.top;
    const row = Math.floor(y / metrics.cell);
    if (row === this.hoverRow) return;
    this.hoverRow = row;
    // On (or beside) the toolbar: the pointer is on its way to a button.
    if (this.hoveredId !== null && this.toolbarRows.includes(row)) return;
    if (row < 0 || row >= this.term.rows) {
      this.setHovered(null);
      return;
    }
    const buf = this.term.buffer.active;
    if (buf.type !== 'normal') {
      this.setHovered(null);
      return;
    }
    const block = blockAtLine(this.blocks(), buf.viewportY + row, this.liveEnd());
    this.setHovered(block?.id ?? null);
  };

  private readonly onMouseLeave = () => {
    this.hoverRow = -1;
    this.setHovered(null);
  };

  private setHovered(id: number | null) {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    this.schedule();
  }

  private select(id: number) {
    this.selectedId = this.selectedId === id ? null : id;
    this.schedule();
  }

  toggleFold(id: number) {
    const record = this.recordOf(id);
    if (!record) return;
    record.folded = !record.folded;
    this.schedule();
  }

  // -- Reading a block back -----------------------------------------------

  private rows(from: number, toExclusive: number): BufferRowText[] {
    const buf = this.term.buffer.active;
    const out: BufferRowText[] = [];
    for (let y = Math.max(0, from); y < toExclusive; y++) {
      const line = buf.getLine(y);
      if (!line) break;
      out.push({ text: line.translateToString(false), wrapped: line.isWrapped });
    }
    return out;
  }

  /**
   * The command of a block: what the shell told us in `133;C;cmd=`, and
   * failing that whatever is on the grid between the prompt and the output
   * (a shell whose integration predates the `cmd=` parameter).
   */
  private commandText(block: TerminalBlock): string {
    if (block.command !== null) return block.command;
    if (block.outputStart === null) return '';
    return joinBufferRows(this.rows(block.start, block.outputStart));
  }

  private outputText(block: TerminalBlock): string {
    const range = foldedRange(block, this.liveEnd());
    if (!range) return '';
    return joinBufferRows(this.rows(range.start, range.endExclusive));
  }

  private async copy(text: string, what: string) {
    if (!text) {
      toast.info(`Nothing to copy (${what} is empty)`);
      return;
    }
    try {
      await writeText(text);
      toast.success(`Copied the ${what}`);
    } catch (error) {
      toast.error(`Could not copy the ${what}`, { description: String(error) });
    }
  }

  /**
   * Ctrl+Shift+C with a block selected and no text selection. Returns false
   * when there is nothing selected, so the caller keeps today's behaviour.
   */
  copySelected(): boolean {
    const block = this.selectedBlock();
    if (!block) return false;
    void this.copy(this.blockText(block), 'block');
    return true;
  }

  /** Command and output, the way you would have read them off the screen. */
  private blockText(block: TerminalBlock): string {
    return [this.commandText(block), this.outputText(block)].filter(Boolean).join('\n');
  }

  private selectedBlock(): TerminalBlock | null {
    return this.selectedId === null ? null : this.blockById(this.selectedId);
  }

  /** The block's geometry *right now* — never a snapshot kept across a click. */
  private blockById(id: number): TerminalBlock | null {
    const record = this.recordOf(id);
    return record ? this.snapshot(record) : null;
  }

  /** The command of a block on one line, ready to be typed back into the PTY. */
  private commandLine(block: TerminalBlock): string {
    return this.commandText(block).split('\n')[0]?.trim() ?? '';
  }

  /** Re-run a block's command, once the terminal is back at a prompt. */
  private rerun(block: TerminalBlock) {
    const command = this.commandLine(block);
    if (!command) return;
    api.writeTerminal(this.terminalId, `${command}\r`).catch((error) => {
      toast.error('Could not run the command again', { description: String(error) });
    });
  }

  /**
   * Warp's `terminal:reinput_commands`: the command goes back on the prompt
   * line *without* a carriage return, so it can be edited before it runs.
   * Refused while the universal input editor is on — the shell's line and the
   * line CortX shows would then be two different strings (see `blockActions`).
   */
  private reinput(block: TerminalBlock) {
    const command = this.commandLine(block);
    if (!command) return;
    api
      .writeTerminal(this.terminalId, command)
      .then(() => this.term.focus())
      .catch((error) => {
        toast.error('Could not put the command back at the prompt', { description: String(error) });
      });
  }

  /** True while the shell is at a prompt (nothing of ours is running). */
  private atPrompt(): boolean {
    return this.current === null || this.current.status !== 'running';
  }

  /**
   * The actions of one block, right now. Recomputed rather than remembered:
   * output keeps arriving while the toolbar is on screen and the menu is
   * open, and "Copy output" must not stay greyed out because it was empty
   * when the pointer arrived.
   */
  private actionsFor(block: TerminalBlock): BlockActionSpec[] {
    const fold = foldedRange(block, this.liveEnd());
    return blockActions({
      block,
      hasCommand: this.commandText(block).trim().length > 0,
      hiddenLines: fold ? fold.endExclusive - fold.start : 0,
      atPrompt: this.atPrompt(),
      inputEditor: inputEditorOwnsPrompt(),
    });
  }

  /**
   * Run one action on the block `id` names. The block is re-read here and not
   * at the time the button was drawn: the toolbar can be standing over a
   * command that is still printing, and acting on stale geometry would copy
   * the wrong lines.
   */
  private run(id: number, action: BlockActionId) {
    const block = this.blockById(id);
    if (!block) return;
    switch (action) {
      case 'copyCommand':
        void this.copy(this.commandText(block), 'command');
        break;
      case 'copyOutput':
        void this.copy(this.outputText(block), 'output');
        break;
      case 'copyBlock':
        void this.copy(this.blockText(block), 'block');
        break;
      case 'copyMarkdown':
        void this.copy(
          blockMarkdown(this.commandText(block), this.outputText(block), block.exitCode),
          'block as Markdown'
        );
        break;
      case 'rerun':
        this.rerun(block);
        break;
      case 'reinput':
        this.reinput(block);
        break;
      case 'fold':
        this.toggleFold(id);
        break;
      case 'selectText': {
        const full = blockRange(block, this.liveEnd());
        this.term.selectLines(full.start, full.endExclusive - 1);
        break;
      }
      case 'scrollTop':
        this.term.scrollToLine(block.start);
        break;
      case 'scrollBottom': {
        const full = blockRange(block, this.liveEnd());
        this.term.scrollToLine(Math.max(0, full.endExclusive - this.term.rows));
        break;
      }
    }
  }

  /**
   * The block menu — the same list as the hover toolbar, with the actions the
   * toolbar has no room for. Opened from the `⋯` button, from a right-click on
   * a gutter bar or a fold, and from a right-click in a pane whose block is
   * selected.
   */
  private openMenu(id: number, x: number, y: number) {
    const block = this.blockById(id);
    if (!block) return;
    const header = shortCommand(this.commandText(block)) || blockStatusLabel(block);
    openBlockMenu(
      x,
      y,
      header,
      this.actionsFor(block).map((spec) => ({
        label: spec.label,
        hint: spec.hint,
        disabled: spec.disabled,
        separated: spec.separated,
        icon: spec.id,
        onSelect: () => this.run(id, spec.id),
      }))
    );
  }

  // -- Drawing ------------------------------------------------------------

  private schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private ensureLayer(): HTMLElement {
    if (this.layer) return this.layer;
    const layer = document.createElement('div');
    layer.className = 'cortx-blocks';
    this.container.appendChild(layer);
    this.layer = layer;
    return layer;
  }

  private removeLayer() {
    this.layer?.remove();
    this.layer = null;
    this.elements.clear();
  }

  /** Size and top offset of one grid cell, measured on the screen element. */
  private metrics(): Metrics | null {
    const screen = this.term.element?.querySelector('.xterm-screen') as HTMLElement | null;
    if (!screen || this.term.rows < 1 || this.term.cols < 1) return null;
    const cell = screen.clientHeight / this.term.rows;
    const column = screen.clientWidth / this.term.cols;
    if (!Number.isFinite(cell) || cell <= 0) return null;
    // The screen sits at the top of the container in practice, but a renderer
    // or a future addon could inset it; measure rather than assume. Both
    // elements carry the same `translateY` (bottom-pinned mode), so the
    // difference is exactly the inset.
    const top = screen.getBoundingClientRect().top - this.container.getBoundingClientRect().top;
    return {
      cell,
      column: Number.isFinite(column) && column > 0 ? column : 0,
      top: Number.isFinite(top) ? top : 0,
    };
  }

  private render() {
    if (!blocksEnabled() || this.records.length === 0) {
      this.removeLayer();
      return;
    }
    const buf = this.term.buffer.active;
    if (buf.type !== 'normal') {
      // A full-screen program owns the pane; xterm hides its own decorations
      // in the alternate buffer for the same reason.
      if (this.layer) this.layer.hidden = true;
      return;
    }
    const metrics = this.metrics();
    if (!metrics) return;
    const layer = this.ensureLayer();
    layer.hidden = false;
    this.applyPalette(layer);
    // Recomputed below, for the one block that has a toolbar (if any).
    this.toolbarRows = [];
    this.usedCache.clear();

    const blocks = this.blocks();
    const liveEnd = this.liveEnd();
    const viewportY = buf.viewportY;
    const rows = this.term.rows;
    const gutter = blockGutterEnabled();
    const dividers = blockDividersEnabled();
    const toolbars = blockActionBarEnabled();
    const keep = new Set<string>();
    // A hovered / selected block is shown by the two hairlines that *bracket*
    // it — its own, and the one belonging to the block below — never by a
    // wash over its rows: a tint over the grid changes the colour of the text
    // the shell drew, and on a wallpaper theme it is the first thing the eye
    // lands on. The bracket plus the gutter bar say the same thing and cover
    // nothing.
    const bracketed = new Set<number>();
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.id !== this.selectedId && block.id !== this.hoveredId) continue;
      bracketed.add(block.id);
      const below = blocks[i + 1];
      if (below) bracketed.add(below.id);
    }

    for (const block of blocks) {
      const range = blockRange(block, liveEnd);
      const visible = clipToViewport(range, viewportY, rows);
      const selected = block.id === this.selectedId;
      const hovered = block.id === this.hoveredId;

      // The divider that opens the block: a 1 px rule the full width of the
      // pane, drawn on the boundary between the previous block's last output
      // row and this block's prompt row. This is the whole point of the
      // feature — without it a block is a thing the app knows about and the
      // eye does not. `<= rows` and not `< rows`: a block starting on the row
      // just past the bottom still has its top edge on the last pixel line.
      //
      // It carries no status colour: a full-width red or yellow rule is the
      // loudest thing on the pane, and the exit code is already the colour of
      // the gutter bar, which is three pixels wide and in the margin.
      //
      // When the shell left a blank line above the prompt — the spacing
      // `terminal.blockSpacing = normal` asks it for, or a prompt of the
      // user's own that starts on a new line — the rule moves into the middle
      // of it, so there is real padding on both sides of the boundary instead
      // of a hairline pressed against the prompt. Half a row up is only drawn
      // when that row is actually in the viewport; at the very top of the pane
      // the blank line has scrolled off and the top edge is right again.
      const dividerRow = block.start - viewportY;
      // The blank row is only used when it is on screen: at the very top of
      // the pane the spacing line has scrolled off and at the very bottom
      // there is nothing under the last row to move into.
      const spacing = this.spacingRow(block.start);
      // How many blank rows the shell actually left: `comfortable` asks for
      // two, and the rule belongs in the middle of the run rather than half a
      // row above the prompt.
      const blanks = spacing === 'above' ? this.blankRowsAbove(block.start) : 1;
      const usable =
        (spacing === 'above' && dividerRow >= blanks / 2) || (spacing === 'first' && dividerRow < rows);
      const offset = usable ? dividerOffsetRows(spacing, blanks) : 0;
      if (dividers && dividerRow >= 0 && dividerRow <= rows) {
        const rule = this.element(keep, `${block.id}:rule`, 'cortx-blocks-rule', layer);
        rule.style.top = `${Math.round(metrics.top + (dividerRow + offset) * metrics.cell)}px`;
        rule.dataset.active = bracketed.has(block.id) ? 'true' : 'false';
      }

      if (visible && gutter) {
        const bar = this.element(keep, `${block.id}:bar`, 'cortx-blocks-bar', layer);
        bar.style.top = `${Math.round(metrics.top + visible.row * metrics.cell)}px`;
        bar.style.height = `${Math.max(2, Math.round(visible.count * metrics.cell))}px`;
        bar.dataset.status = barStatus(block);
        bar.dataset.selected = selected || hovered ? 'true' : 'false';
        setText(bar, 'title', `${blockStatusLabel(block)}${block.command ? ` · ${shortCommand(block.command)}` : ''}`);
        this.bindBar(bar, block.id);
      }

      // The toolbar, near the block's top-right corner. Only for a block that
      // has run something: the prompt being typed has no command to act on,
      // and that row belongs to the input editor (ticket #15). The selected
      // block gets one too when the pointer is elsewhere, so Ctrl+↑ / Ctrl+↓
      // reach the actions without a mouse — but never two toolbars at once.
      const armed = hovered || (selected && this.hoveredId === null);
      if (visible && toolbars && armed && block.status !== 'prompt') {
        this.toolbar(keep, layer, block, metrics, visible, viewportY, rows, usable ? spacing : null);
      }

      if (block.folded) {
        const fold = foldedRange(block, liveEnd);
        const clipped = fold ? clipToViewport(fold, viewportY, rows) : null;
        if (clipped) {
          const cover = this.element(keep, `${block.id}:fold`, 'cortx-blocks-fold', layer);
          cover.style.top = `${Math.round(metrics.top + clipped.row * metrics.cell)}px`;
          cover.style.height = `${Math.round(clipped.count * metrics.cell)}px`;
          const total = fold ? fold.endExclusive - fold.start : 0;
          setText(cover, 'textContent', foldLabel(total));
          setText(cover, 'title', 'Click to unfold');
          this.bindFold(cover, block.id);
        }
      }
    }

    for (const [key, element] of this.elements) {
      if (keep.has(key)) continue;
      element.remove();
      this.elements.delete(key);
    }
  }

  /** Reuse the element of the previous frame, or make one. */
  private element(keep: Set<string>, key: string, className: string, layer: HTMLElement): HTMLElement {
    keep.add(key);
    let element = this.elements.get(key);
    if (!element) {
      element = document.createElement('div');
      element.className = className;
      layer.appendChild(element);
      this.elements.set(key, element);
    }
    return element;
  }

  /**
   * The hover toolbar of one block: an icon per `primary` action plus a `⋯`
   * that opens the rest. Rebuilt only when the set of actions changes (its
   * signature is stashed on the element) — this runs on every rendered frame,
   * including while a command is printing.
   *
   * Where it goes is decided by `placeToolbar`, and when that answers "nowhere"
   * the bar is simply not drawn: it may never cover a glyph the shell wrote.
   */
  private toolbar(
    keep: Set<string>,
    layer: HTMLElement,
    block: TerminalBlock,
    metrics: Metrics,
    visible: { row: number; count: number },
    viewportY: number,
    rows: number,
    spacing: BlockSpacingRow
  ) {
    const specs = this.actionsFor(block).filter((spec) => spec.primary);
    // `+ 1` for the "More actions" button, which is always there.
    const width = blockToolbarWidth(specs.length + 1);
    const slot = this.placeToolbar(block, metrics, visible, viewportY, rows, width, spacing);
    if (!slot) return;
    this.toolbarRows = slot.rows;

    const bar = this.element(keep, `${block.id}:actions`, 'cortx-blocks-actions', layer);
    bar.style.top = `${Math.round(slot.top)}px`;
    bar.style.height = `${Math.round(slot.height)}px`;

    const signature = specs.map((spec) => `${spec.id}\u0000${spec.label}\u0000${spec.disabled}`).join('\u0001');
    if (bar.dataset.signature === signature) return;
    bar.dataset.signature = signature;
    bar.textContent = '';
    for (const spec of specs) {
      bar.appendChild(this.actionButton(block.id, spec.id, spec.label, spec.hint, spec.disabled));
    }
    bar.appendChild(this.actionButton(block.id, 'more', 'More actions', undefined, false));
  }

  /**
   * Find a place for a block's toolbar that hides nothing.
   *
   * The prompt line is not free real estate: a right-hand prompt — oh-my-posh's
   * clock, a git status, an exit code — sits exactly where a top-right toolbar
   * would go, and covering it is the one thing this overlay must never do. So
   * the bar only ever lands on a row whose right-hand end paints *nothing*, and
   * it is squeezed to a single row's height so it cannot spill into the rows
   * above and below either.
   *
   * Candidates, in the order that reads best:
   *
   * 0. the spacing line the shell left above the prompt, when there is one —
   *    a row that belongs to no block and holds nothing, and the row the
   *    divider is centred in, so the bar sits *on* the boundary the way Warp's
   *    does. This is what `terminal.blockSpacing = normal` buys;
   * 1. straddling the divider, when the row above it and the block's first row
   *    are both free — the empty gap between two blocks, which is where the eye
   *    expects a boundary control;
   * 2. the row just above the divider on its own;
   * 3. the block's first row on its own;
   * 4. failing those, the first free row going down through the block.
   *
   * When every candidate is occupied the toolbar is not drawn at all. The
   * gutter bar still opens the same menu on a right-click, so nothing is lost
   * but the shortcut.
   */
  private placeToolbar(
    block: TerminalBlock,
    metrics: Metrics,
    visible: { row: number; count: number },
    viewportY: number,
    rows: number,
    width: number,
    spacing: BlockSpacingRow
  ): { top: number; height: number; rows: number[] } | null {
    const height = Math.min(TOOLBAR_HEIGHT, Math.floor(metrics.cell));
    if (height < TOOLBAR_MIN_HEIGHT || metrics.column <= 0) return null;

    const need = width + TOOLBAR_RIGHT_MARGIN;
    const free = (row: number) => {
      if (row < 0 || row >= rows) return false;
      return (this.term.cols - this.usedColumns(viewportY + row)) * metrics.column >= need;
    };
    /** A `height`-tall bar centred on one viewport row. */
    const onRow = (row: number) => ({
      top: metrics.top + (row + 0.5) * metrics.cell - height / 2,
      height,
      rows: [row],
    });

    const startRow = block.start - viewportY;
    // The spacing row, when it is on screen: nothing is written there and the
    // divider is drawn through its middle, so this is both the safest and the
    // best-looking place. (`free` re-checks the width for a pane too narrow
    // to hold the bar at all.)
    if (spacing === 'above' && startRow >= 1 && free(startRow - 1)) return onRow(startRow - 1);
    // Same idea when the blank line belongs to the block itself: the prompt is
    // one row lower, so the bar goes on the block's own first row.
    if (spacing === 'first' && free(startRow)) return onRow(startRow);
    const aboveFree = free(startRow - 1);
    const firstFree = free(startRow);
    // Centred on the divider itself: half of it in each of two free rows.
    if (aboveFree && firstFree) {
      return {
        top: metrics.top + startRow * metrics.cell - height / 2,
        height,
        rows: [startRow - 1, startRow],
      };
    }
    if (aboveFree) return onRow(startRow - 1);
    if (firstFree) return onRow(startRow);

    // Nothing at the top edge: walk down the block's visible rows, skipping
    // the first one when that is the row just refused.
    const from = startRow === visible.row ? visible.row + 1 : visible.row;
    const to = Math.min(visible.row + visible.count - 1, rows - 1, from + TOOLBAR_SEARCH_ROWS);
    for (let row = from; row <= to; row++) {
      if (free(row)) return onRow(row);
    }
    return null;
  }

  /**
   * The column after the last cell of an absolute buffer line that paints
   * anything — a glyph *or* a background colour, because a right-hand prompt is
   * usually a run of spaces on a coloured plate and covering that would be just
   * as wrong as covering a letter. `0` for a row that paints nothing at all.
   *
   * Memoised for the frame being drawn: the same rows are asked about twice —
   * once to find the spacing line above a block, once to place its toolbar —
   * and the answer for a blank row costs a scan of the whole line.
   */
  private usedColumns(line: number): number {
    const cached = this.usedCache.get(line);
    if (cached !== undefined) return cached;
    const value = this.measureColumns(line);
    this.usedCache.set(line, value);
    return value;
  }

  /**
   * Is the line just above `start` a *spacing* line — one that belongs to no
   * block and paints nothing?
   *
   * That is what `terminal.blockSpacing = normal` makes the shell print before
   * a prompt that follows a command (`shell_init.rs`), and it is read off the
   * buffer rather than off the setting on purpose: a prompt of the user's own
   * that already opens on a new line gets the same treatment, a session
   * started before the setting changed keeps the layout it actually has, and
   * `compact` needs no special case at all.
   *
   * `start - 1` is an *absolute* buffer line, so a spacing row scrolled just
   * off the top of the viewport is still recognised.
   */
  private spacingRow(start: number): BlockSpacingRow {
    if (start >= 1 && this.usedColumns(start - 1) === 0) return 'above';
    // A prompt that opens on a newline of its own (oh-my-posh, starship's
    // `add_newline`) puts the blank row *inside* the block: `OSC 133;A` lands
    // before the newline. The shell integration adds nothing in that case, so
    // this is the only way to see it.
    if (this.usedColumns(start) === 0) return 'first';
    return null;
  }

  /**
   * How many blank rows sit immediately above `start`, so the divider can be
   * centred in the whole gap. `terminal.blockSpacing = comfortable` leaves
   * two; a prompt that opens on a newline of its own can add one more.
   * Capped: past a handful the run is scrollback, not spacing, and every row
   * costs a measurement.
   */
  private blankRowsAbove(start: number, max = 4): number {
    let n = 0;
    while (n < max && start - 1 - n >= 0 && this.usedColumns(start - 1 - n) === 0) n += 1;
    return Math.max(1, n);
  }

  /** The uncached half of `usedColumns`. */
  private measureColumns(line: number): number {
    const buf = this.term.buffer.active;
    const row = buf.getLine(line);
    if (!row) return 0;
    // One cell object, reused down the row: this runs for a handful of rows on
    // every frame the pointer is inside a block.
    const cell = row.getCell(0);
    for (let x = this.term.cols - 1; x >= 0; x--) {
      const c = cell ? row.getCell(x, cell) : row.getCell(x);
      if (!c) continue;
      const chars = c.getChars();
      if (chars !== '' && chars !== ' ') return x + Math.max(1, c.getWidth());
      // Mode 0 is "the theme's own background", i.e. nothing was painted here.
      if (c.getBgColorMode() !== 0) return x + 1;
    }
    return 0;
  }

  /** One icon button of the toolbar. `more` opens the menu instead of acting. */
  private actionButton(
    id: number,
    action: BlockActionId | 'more',
    label: string,
    hint: string | undefined,
    disabled: boolean
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cortx-blocks-action';
    button.disabled = disabled;
    button.title = hint ? `${label} · ${hint}` : label;
    button.setAttribute('aria-label', label);
    button.appendChild(blockIconSvg(action));
    // Never let a toolbar click start a selection, move the focus, or reach
    // the pane's own "copy on select" / "right-click pastes" handlers.
    button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (action === 'more') {
        const rect = button.getBoundingClientRect();
        this.openMenu(id, rect.left, rect.bottom + 4);
        return;
      }
      this.run(id, action);
    });
    button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openMenu(id, e.clientX, e.clientY);
    });
    return button;
  }

  private bindBar(bar: HTMLElement, id: number) {
    if (bar.dataset.bound === 'true') return;
    bar.dataset.bound = 'true';
    bar.addEventListener('mousedown', (e) => {
      // Never let a gutter click start a text selection in the grid.
      e.preventDefault();
      e.stopPropagation();
    });
    bar.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.detail >= 2) this.toggleFold(id);
      else this.select(id);
    });
    bar.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.selectedId = id;
      this.schedule();
      this.openMenu(id, e.clientX, e.clientY);
    });
  }

  private bindFold(cover: HTMLElement, id: number) {
    if (cover.dataset.bound === 'true') return;
    cover.dataset.bound = 'true';
    cover.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    cover.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleFold(id);
    });
    cover.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openMenu(id, e.clientX, e.clientY);
    });
  }

  /**
   * The gutter follows the *terminal* theme, not the app chrome: the colours
   * come straight off the palette xterm is drawing with, so an imported Warp
   * theme colours the block bars too.
   */
  private applyPalette(layer: HTMLElement) {
    const theme = this.term.options.theme ?? {};
    const set = (name: string, value: string | undefined, fallback: string) => {
      layer.style.setProperty(name, value?.trim() || fallback);
    };
    set('--cortx-block-ok', theme.green, 'var(--st-done, #23d18b)');
    set('--cortx-block-fail', theme.red, 'var(--st-blocked, #f14c4c)');
    set('--cortx-block-run', theme.yellow, 'var(--warning, #f5f543)');
    set('--cortx-block-idle', theme.brightBlack, 'var(--text-faint, #666666)');
    set('--cortx-block-fg', theme.foreground, 'var(--terminal-fg, var(--foreground))');

    // The hairline between two blocks is the one thing on this layer that must
    // never take a *hue*. Mixing the theme's foreground into it — what this
    // used to do — is fine on a plain black or white theme and wrong the moment
    // the theme has a background image: `aespa_wda`'s foreground is pure white
    // and its background `#713d39`, so a 34 % white rule reads as a bright pink
    // stripe pointing straight at the wallpaper's colour. A *neutral* wash has
    // no such opinion: white over a dark ground, black over a light one, both
    // achromatic, both weak enough that you notice the boundary rather than the
    // line. Which of the two is decided from the palette the terminal is
    // actually drawing with, not from the app's light/dark chrome, so an
    // imported Warp theme gets the right one in a window of either mode.
    const dark = terminalIsDark(theme.background, theme.foreground);
    // Strong enough to be *read* as a boundary, not merely sensed. The first
    // pass aimed for "guessed rather than read" and the result was a pane that
    // looked like plain scrollback: with a real gap around it, a rule this
    // faint disappears. Warp's own dividers are plainly visible, including
    // over a background image, which is what these are measured against.
    layer.style.setProperty('--cortx-block-line', dark ? 'rgb(255 255 255 / 0.24)' : 'rgb(0 0 0 / 0.22)');
    layer.style.setProperty(
      '--cortx-block-line-active',
      dark ? 'rgb(255 255 255 / 0.30)' : 'rgb(0 0 0 / 0.32)'
    );
    // The pane's own background, for the toolbar's plate: a themed Terminal
    // window is see-through down to the wallpaper, and icons floating on a
    // photograph are unreadable.
    set('--cortx-block-bg', theme.background, 'var(--terminal-window-solid, var(--card))');
    // The gutter lives in the pane's left padding so the text never moves. A
    // padding of 0 leaves nowhere to put it: it then overlays the first three
    // pixels of column one rather than shifting the grid.
    const padding = terminalPaddingPx();
    layer.style.setProperty('--cortx-block-bar-width', `${BAR_WIDTH}px`);
    layer.style.setProperty('--cortx-block-gutter-x', `${padding >= BAR_WIDTH + 2 ? -(padding - 1) : 0}px`);
  }

  /**
   * Open the menu of the *selected* block at a pointer position. Returns false
   * when nothing is selected, so the pane's right-click keeps meaning "paste".
   */
  menuForSelection(x: number, y: number): boolean {
    const block = this.selectedBlock();
    if (!block) return false;
    this.openMenu(block.id, x, y);
    return true;
  }

  /** Dev diagnostics (CDP). */
  debug() {
    return {
      blocks: this.blocks(),
      selectedId: this.selectedId,
      hoveredId: this.hoveredId,
      liveEnd: this.liveEnd(),
    };
  }
}

/** Write an attribute only when it changed (this runs on every frame). */
function setText(element: HTMLElement, key: 'title' | 'textContent', value: string) {
  if (element[key] !== value) element[key] = value;
}

/** `--terminal-padding` as a number (see `terminalSessions.applyTerminalPadding`). */
function terminalPaddingPx(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--terminal-padding').trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 8;
}

/** Which colour a bar takes. */
function barStatus(block: TerminalBlock): string {
  if (block.status === 'running') return 'running';
  if (block.status === 'prompt') return 'prompt';
  return blockFailed(block) ? 'failed' : 'ok';
}

const controllers = new Map<string, BlockController>();

if (import.meta.env.DEV) {
  (window as unknown as { __cortxBlocks?: Map<string, BlockController> }).__cortxBlocks = controllers;
}

/**
 * Start tracking blocks for `terminalId` (idempotent). `container` is the
 * session container (`.cortx-xterm`), so the overlay follows the session
 * between the dock and the Terminal window and inherits the bottom-pinned
 * offset. `isReplaying` is the session's replay flag: markers are ignored
 * while a restored snapshot is being parsed.
 */
export function attachBlocks(
  terminalId: string,
  term: Terminal,
  container: HTMLElement,
  isReplaying: () => boolean
): IDisposable {
  if (!controllers.has(terminalId)) {
    controllers.set(terminalId, new BlockController(terminalId, term, container, isReplaying));
  }
  return { dispose: () => detach(terminalId) };
}

function detach(terminalId: string) {
  const controller = controllers.get(terminalId);
  if (!controller) return;
  controllers.delete(terminalId);
  controller.dispose();
}

/** Redraw every pane (the setting changed, or a pane was re-mounted). */
export function refreshBlocks() {
  for (const controller of controllers.values()) controller.invalidate();
}

/**
 * Ctrl+Shift+C over a pane with a selected block and no text selection:
 * copies the block. Returns false when there is no selected block, so the
 * caller keeps doing exactly what it does today.
 */
export function copySelectedBlock(terminalId: string): boolean {
  return controllers.get(terminalId)?.copySelected() ?? false;
}

/** Jump to the previous / next prompt of a pane (for the command palette). */
export function jumpToBlock(terminalId: string, direction: 'previous' | 'next'): boolean {
  return controllers.get(terminalId)?.jump(direction) ?? false;
}

/**
 * Right-click inside a pane with a block selected: open that block's menu.
 * False when no block is selected — the caller then keeps today's behaviour
 * (copy the selection, else paste), so right-click only ever changes meaning
 * after the user has deliberately selected a block.
 */
export function openSelectedBlockMenu(terminalId: string, x: number, y: number): boolean {
  return controllers.get(terminalId)?.menuForSelection(x, y) ?? false;
}
