/**
 * "Prompt pinned to the bottom" — ticket #15, phase U0.
 *
 * xterm draws a grid of `rows` lines that fills from the top, so while the
 * scrollback is still empty (`buffer.baseY === 0`) the prompt sits at the top
 * of the pane with dead space underneath. Warp calls the two behaviours
 * `waterfall` (what CortX does today) and `pinned_to_bottom`; this module is
 * the second one.
 *
 * **How, and why not otherwise.** The whole effect is one CSS transform on the
 * element xterm renders into: `translateY` by however many blank rows are left
 * below the cursor, clipped by the pane's `overflow: hidden`. `rows` and `cols`
 * never change, so the PTY, the shell and every program under it see exactly
 * what they see today. The two obvious alternatives were rejected in the plan
 * (§3.d) and must not be tried again:
 *
 * - padding the buffer with newlines — on Windows ConPTY keeps its own screen
 *   model and repaints it, so rows injected on the xterm side alone come back
 *   as artefacts;
 * - shrinking `rows` — that resizes the PTY at every prompt (reflow churn, and
 *   full-screen programs that believe they have a short screen).
 *
 * The offset is 0 — the code fully inert — in `flow` mode, in the alternate
 * screen (a TUI owns the whole pane), and as soon as the scrollback has
 * started, which is when xterm is already bottom-aligned by itself.
 *
 * The offset may shrink freely but only grows back at a prompt marker, a
 * resize or a cleared screen: a program that moves the cursor up mid-output
 * would otherwise slide the whole pane down and back on every frame.
 */
import type { IDisposable, Terminal } from '@xterm/xterm';
import { useAppStore } from '@/stores/appStore';

/** `flow` = today's behaviour (output flows down from the top). */
export type TerminalInputPosition = 'flow' | 'bottom';

export const DEFAULT_INPUT_POSITION: TerminalInputPosition = 'flow';

export function inputPositionSetting(): TerminalInputPosition {
  return useAppStore.getState().settings?.terminal.inputPosition ?? DEFAULT_INPUT_POSITION;
}

class InputPositionController {
  term: Terminal;
  /** The element xterm renders into (`.cortx-xterm`), clipped by its host. */
  host: HTMLElement;
  offset = 0;
  /** The offset is allowed to grow on this pass (prompt, resize, clear). */
  grow = true;
  frame = 0;
  disposables: IDisposable[] = [];

  constructor(term: Terminal, host: HTMLElement) {
    this.term = term;
    this.host = host;
    const onPrompt = () => {
      this.grow = true;
      this.schedule();
    };
    this.disposables.push(
      term.parser.registerOscHandler(133, (data) => {
        const kind = data.split(';')[0];
        if (kind === 'A' || kind === 'B' || kind === 'D') onPrompt();
        // Never consumed: the suggestion and editor handlers must see it too.
        return false;
      })
    );
    this.disposables.push(term.onResize(onPrompt));
    this.disposables.push(term.onCursorMove(() => this.schedule()));
    this.disposables.push(term.onWriteParsed(() => this.schedule()));
    this.disposables.push(term.onScroll(() => this.schedule()));
    this.disposables.push(term.buffer.onBufferChange(onPrompt));
    this.schedule();
  }

  dispose() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.offset = 0;
    this.host.style.transform = '';
  }

  /** Let the next pass move the prompt back down (setting changed, remount). */
  invalidate() {
    this.grow = true;
    this.schedule();
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.apply();
    });
  }

  /** Height of one row in CSS px, measured on the screen element. */
  cellHeight(): number {
    const screen = this.term.element?.querySelector('.xterm-screen') as HTMLElement | null;
    if (!screen || this.term.rows < 1) return 0;
    const height = screen.clientHeight / this.term.rows;
    return Number.isFinite(height) && height > 0 ? height : 0;
  }

  target(): number {
    if (inputPositionSetting() !== 'bottom') return 0;
    const buf = this.term.buffer.active;
    // A TUI must have the whole pane; a started scrollback is already
    // bottom-aligned by xterm itself.
    if (buf.type !== 'normal' || buf.baseY > 0) return 0;
    const free = this.term.rows - 1 - buf.cursorY;
    if (free <= 0) return 0;
    const cell = this.cellHeight();
    if (!cell) return 0;
    // Whole pixels only: a fractional transform resamples every glyph.
    return Math.round(free * cell);
  }

  apply() {
    const buf = this.term.buffer.active;
    // A freshly cleared screen (Ctrl+L, the Clear button) starts over.
    if (buf.baseY === 0 && buf.cursorY === 0) this.grow = true;
    const target = this.target();
    const next = this.grow || target <= this.offset ? target : this.offset;
    this.grow = false;
    if (next === this.offset) return;
    this.offset = next;
    this.host.style.transform = next > 0 ? `translateY(${next}px)` : '';
  }
}

const controllers = new Map<string, InputPositionController>();

/**
 * Start pinning the prompt of `terminalId` (idempotent). `host` is the element
 * xterm renders into; its parent must clip (`.cortx-xterm-host` does).
 */
export function attachInputPosition(terminalId: string, term: Terminal, host: HTMLElement): IDisposable {
  const existing = controllers.get(terminalId);
  if (existing) return { dispose: () => detach(terminalId) };
  controllers.set(terminalId, new InputPositionController(term, host));
  return { dispose: () => detach(terminalId) };
}

function detach(terminalId: string) {
  const controller = controllers.get(terminalId);
  if (!controller) return;
  controllers.delete(terminalId);
  controller.dispose();
}

/** Re-run every pane after the setting changed (or a pane was re-mounted). */
export function refreshInputPositions() {
  for (const c of controllers.values()) c.invalidate();
}
