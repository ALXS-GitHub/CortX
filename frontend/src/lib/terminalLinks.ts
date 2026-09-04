/**
 * Clickable file paths in the terminal (DEV-13).
 *
 * `WebLinksAddon` only ever underlines URLs. Compiler and linter output is
 * full of paths instead — `src/main.rs:42:7`, `C:\dev\x\build.log`,
 * `./scripts/build.ts` — and those are what you actually want to click.
 *
 * How it stays cheap: this is an xterm **link provider**, so it only ever
 * looks at the one logical line under the pointer, never at the buffer. The
 * only disk access is an `exists()` per distinct candidate, memoised for a
 * few seconds — a path that does not resolve is not underlined at all, which
 * is what keeps every word with a slash in it from becoming a link.
 *
 * Relative paths are resolved against the terminal's live directory, which
 * shell integration reports over OSC 7 (`TerminalShellState.cwd`).
 *
 * Click opens the file in the editor CortX already uses elsewhere
 * (`open_in_vscode`); a directory opens in the file manager. Alt- or
 * Shift-click reveals the containing folder instead.
 */
import type { IDisposable, ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { exists, readDir } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';
import * as api from '@/lib/tauri';
import { useAppStore } from '@/stores/appStore';

/** A run of non-space characters holding at least one separator. */
const CANDIDATE = /[^\s"'`<>|]*[\\/][^\s"'`<>|]*/g;
/** The position compilers and linters append: `:12`, `:12:34`, `:12,34`, `(12,34)`. */
const POSITION = /[:(](\d+)(?:[:,](\d+))?\)?$/;
/** Trailing punctuation that belongs to the sentence, not to the path. */
const TRAILING = /[.,;:!?'"`)\]}>]+$/;
const LEADING = /^[('"`[{<]+/;

const IS_WINDOWS = /Windows/i.test(navigator.userAgent);

/** Longest candidate we bother checking (a base64 blob is not a path). */
const MAX_PATH = 512;
const CACHE_TTL_MS = 8000;
const CACHE_MAX = 500;

const existsCache = new Map<string, { at: number; ok: boolean }>();

async function pathExists(path: string): Promise<boolean> {
  const now = Date.now();
  const hit = existsCache.get(path);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.ok;
  let ok = false;
  try {
    ok = await exists(path);
  } catch {
    ok = false;
  }
  if (existsCache.size >= CACHE_MAX) existsCache.clear();
  existsCache.set(path, { at: now, ok });
  return ok;
}

let homeDirCache: string | null = null;
async function home(): Promise<string | null> {
  if (homeDirCache === null) {
    try {
      homeDirCache = (await homeDir()).replace(/[\\/]+$/, '');
    } catch {
      homeDirCache = '';
    }
  }
  return homeDirCache || null;
}

/** Live cwd of a terminal (OSC 7), else the directory its shell opened in. */
function terminalDirectory(terminalId: string): string | undefined {
  const app = useAppStore.getState();
  const live = app.terminalStates.get(terminalId)?.cwd;
  if (live) return live;
  if (terminalId.startsWith('shell:')) return app.shellRuntimes.get(terminalId.slice('shell:'.length))?.cwd;
  return undefined;
}

function isAbsolute(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/');
}

function joinPath(base: string, rel: string): string {
  const sep = IS_WINDOWS && /[\\]/.test(base) ? '\\' : '/';
  return `${base.replace(/[\\/]+$/, '')}${sep}${rel}`;
}

export interface ParsedPath {
  /** The path as written, without the `:line:col` suffix. */
  raw: string;
  line?: number;
  column?: number;
  /** Offset and length of the whole match (path + position) inside the line. */
  index: number;
  length: number;
}

/**
 * Split one candidate into the path and the position a compiler appended.
 * Exported for the tests in `scripts/`.
 */
export function parseCandidate(text: string, index: number): ParsedPath | null {
  let raw = text;
  let start = index;
  const lead = LEADING.exec(raw);
  if (lead) {
    raw = raw.slice(lead[0].length);
    start += lead[0].length;
  }
  if (!raw || raw.length > MAX_PATH) return null;
  // A URL is the WebLinksAddon's job, and `--flag/x` is not a path.
  if (raw.includes('://') || raw.startsWith('-')) return null;

  // Peel one trailing punctuation mark at a time until a position suffix
  // shows up (`main.cpp(12,5):` has to lose its colon before `(12,5)` can be
  // seen) or there is nothing left to peel.
  let line: number | undefined;
  let column: number | undefined;
  let suffix = '';
  for (let guard = 0; guard < 4; guard++) {
    const pos = POSITION.exec(raw);
    if (pos) {
      line = Number(pos[1]);
      column = pos[2] === undefined ? undefined : Number(pos[2]);
      suffix = raw.slice(pos.index);
      raw = raw.slice(0, pos.index);
      break;
    }
    if (!TRAILING.test(raw.slice(-1))) break;
    raw = raw.slice(0, -1);
  }
  raw = raw.replace(TRAILING, '');

  // `C:\x` keeps its drive colon; anything else with a colon left in it is
  // not a path we can trust (`http:`, `key:value/other`).
  const afterDrive = /^[A-Za-z]:/.test(raw) ? raw.slice(2) : raw;
  if (afterDrive.includes(':')) return null;
  if (!raw || !/[\\/]/.test(raw)) return null;
  // Bare `/` or `//` — not worth a link.
  if (/^[\\/]+$/.test(raw)) return null;
  return { raw, line, column, index: start, length: raw.length + suffix.length };
}

/** Absolute path a candidate points at, or null when it cannot be resolved. */
export async function resolveCandidate(raw: string, cwd: string | undefined): Promise<string | null> {
  if (raw.startsWith('~')) {
    const h = await home();
    if (!h) return null;
    return raw.length === 1 ? h : joinPath(h, raw.slice(2));
  }
  if (isAbsolute(raw)) return raw;
  if (!cwd) return null;
  return joinPath(cwd, raw.replace(/^\.[\\/]/, ''));
}

/**
 * The whole logical line `y` belongs to, with the buffer cell every character
 * came from. Walking the cells (instead of `translateToString` + modulo) is
 * what keeps the ranges right on a line holding a wide glyph, whose second
 * cell contributes no character.
 */
function logicalLine(term: Terminal, y: number): { text: string; cells: { x: number; y: number }[] } | null {
  const buffer = term.buffer.active;
  let startY = y;
  while (startY > 0 && buffer.getLine(startY)?.isWrapped) startY--;
  let endY = y;
  while (endY + 1 < buffer.length && buffer.getLine(endY + 1)?.isWrapped) endY++;
  const cell = buffer.getNullCell();
  const cells: { x: number; y: number }[] = [];
  let text = '';
  for (let i = startY; i <= endY; i++) {
    const line = buffer.getLine(i);
    if (!line) return null;
    for (let x = 0; x < line.length; x++) {
      line.getCell(x, cell);
      if (cell.getWidth() === 0) continue; // spacer of a wide glyph
      const chars = cell.getChars() || ' ';
      for (let k = 0; k < chars.length; k++) cells.push({ x, y: i });
      text += chars;
    }
  }
  return { text, cells };
}

/**
 * Open what was clicked. A file goes to the editor **at the line the output
 * pointed at** — landing on line 1 would throw away the very information that
 * made `src/main.rs:42:7` worth clicking. A directory opens in the file
 * manager, and `reveal` (Alt / Shift) shows the parent folder instead.
 */
async function activate(path: string, reveal: boolean, line?: number, column?: number) {
  try {
    if (reveal) {
      const parent = path.replace(/[\\/][^\\/]*$/, '');
      await api.openInExplorer(parent || path);
      return;
    }
    let directory = false;
    try {
      await readDir(path);
      directory = true;
    } catch {
      directory = false;
    }
    if (directory) await api.openInExplorer(path);
    else await api.openInEditor(path, line, column);
  } catch (err) {
    console.error('Failed to open path from the terminal:', err);
  }
}

/**
 * Underline existing file paths on the hovered line and open them on click.
 * Register it *after* the WebLinksAddon so URLs keep their own handler.
 */
export function registerFileLinkProvider(term: Terminal, terminalId: string): IDisposable {
  const provider: ILinkProvider = {
    provideLinks(bufferLineNumber, callback) {
      if (useAppStore.getState().settings?.terminal.filePathLinks === false) {
        callback(undefined);
        return;
      }
      const logical = logicalLine(term, bufferLineNumber - 1);
      if (!logical) {
        callback(undefined);
        return;
      }
      const cwd = terminalDirectory(terminalId);
      const candidates: ParsedPath[] = [];
      CANDIDATE.lastIndex = 0;
      for (let m = CANDIDATE.exec(logical.text); m; m = CANDIDATE.exec(logical.text)) {
        if (!m[0]) {
          CANDIDATE.lastIndex++;
          continue;
        }
        const parsed = parseCandidate(m[0], m.index);
        if (parsed) candidates.push(parsed);
        if (candidates.length >= 24) break;
      }
      if (!candidates.length) {
        callback(undefined);
        return;
      }
      void Promise.all(
        candidates.map(async (candidate) => {
          const resolved = await resolveCandidate(candidate.raw, cwd);
          if (!resolved || !(await pathExists(resolved))) return null;
          const first = logical.cells[candidate.index];
          const last = logical.cells[candidate.index + candidate.length - 1];
          if (!first || !last) return null;
          const link: ILink = {
            text: resolved,
            range: {
              start: { x: first.x + 1, y: first.y + 1 },
              end: { x: last.x + 1, y: last.y + 1 },
            },
            activate: (event) =>
              void activate(resolved, event.altKey || event.shiftKey, candidate.line, candidate.column),
          };
          return link;
        })
      ).then((links) => {
        const found = links.filter((l): l is ILink => l !== null);
        callback(found.length ? found : undefined);
      });
    },
  };
  return term.registerLinkProvider(provider);
}
