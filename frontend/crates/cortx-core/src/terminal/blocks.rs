//! Command blocks cut out of the PTY stream, one grid per block (CORT-57).
//!
//! Today the GUI draws blocks as layers over a single xterm.js grid (see
//! `frontend/src/lib/terminalBlocks.ts`): every row is exactly one row tall,
//! so the space between two blocks can only be whole blank lines, a fold
//! cannot give its rows back, and the card plate needs a transparent canvas.
//! The way out is the one Warp takes — each block owns its own grid — and
//! this module is that half of it, headless, in Rust:
//!
//! - [`BlockSplitter`] runs a real terminal emulator (`alacritty_terminal`)
//!   over the same bytes xterm.js gets, and starts a **fresh grid at every
//!   `OSC 133;A`** (prompt start). The block in progress is the *live* one;
//!   when the next prompt starts, it is **frozen** into a [`BlockSnapshot`]:
//!   logical lines of styled runs, independent of the width (a renderer
//!   re-wraps them, which is the "nearly free reflow").
//! - `133;C` marks where the command's output starts inside the block (so
//!   "copy the output" and folding never need to guess), `133;D` its exit
//!   code, `OSC 7` its directory.
//! - It is a pure observer, like [`super::osc::OscScanner`]: it never writes
//!   to the PTY. Queries the program sends (cursor position, colours) are
//!   answered by xterm.js; the emulator here drops its own answers
//!   ([`VoidListener`]).
//!
//! The edge cases the ticket lists, and what this half does about them:
//!
//! - **No markers** (ssh, tmux, a shell without `cortx init`): there is never
//!   an `A`, so everything stays one live block — a classic terminal.
//! - **`clear` / `reset`**: `CSI 3 J` (erase scrollback, which `clear` sends)
//!   and `ESC c` (RIS) drop every frozen block and bump the
//!   [`generation`](BlockSnapshot::generation) — Warp's behaviour, and the
//!   only one that matches what the user just asked for. A plain `CSI 2 J`
//!   (Ctrl+L) only clears the live block's screen, as it does in xterm.
//! - **The cursor moving above the command** (a program redrawing "upward"):
//!   a block's grid starts empty at its prompt, so the cursor stops at the
//!   block's first row instead of overwriting the block before. That is a
//!   real difference from a single grid, and the same one Warp has.
//! - **The alternate screen** (vim, htop, less): handled by the emulator;
//!   [`BlockEvent::AltScreen`] tells the renderer to hand the whole pane to a
//!   live xterm, and the frozen block keeps the primary screen.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use alacritty_terminal::event::VoidListener;
use alacritty_terminal::grid::{Dimensions, Row};
use alacritty_terminal::index::{Column, Line};
use alacritty_terminal::term::cell::{Cell, Flags};
use alacritty_terminal::term::{Config, TermMode};
use alacritty_terminal::vte::ansi::{Color, NamedColor, Processor};
use alacritty_terminal::Term;
use parking_lot::Mutex;
use serde::Serialize;

use super::osc::{OscScanner, ShellEvent};

/// Lines of history the live block's grid keeps. A block that prints more
/// keeps its last lines and is marked [`truncated`](BlockSnapshot::truncated).
pub const DEFAULT_BLOCK_HISTORY_LINES: usize = 5_000;
/// Total lines kept across the frozen blocks of one terminal.
pub const DEFAULT_FROZEN_LINES: usize = 20_000;
/// Frozen blocks kept per terminal, whatever their size (the GUI's own cap,
/// `MAX_BLOCKS` in `terminalBlocks.ts`, is the same).
pub const MAX_FROZEN_BLOCKS: usize = 400;

// ============================================================================
// Snapshot types (what crosses the IPC)
// ============================================================================

/// A colour as the shell asked for it. Palette colours stay indices so the
/// renderer applies the *terminal theme* (and bold-as-bright) itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(untagged)]
pub enum TermColor {
    /// 0–255; 0–15 are the theme's ANSI colours.
    Index(u8),
    /// Truecolour, `[r, g, b]`.
    Rgb([u8; 3]),
}

/// Bits of [`CellStyle::flags`].
pub mod style_flags {
    pub const BOLD: u16 = 1;
    pub const DIM: u16 = 1 << 1;
    pub const ITALIC: u16 = 1 << 2;
    pub const UNDERLINE: u16 = 1 << 3;
    pub const INVERSE: u16 = 1 << 4;
    pub const HIDDEN: u16 = 1 << 5;
    pub const STRIKEOUT: u16 = 1 << 6;
    pub const DOUBLE_UNDERLINE: u16 = 1 << 7;
    pub const UNDERCURL: u16 = 1 << 8;
}

/// The look of a run of cells. `None` colours are the theme's default
/// foreground / background.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Default)]
pub struct CellStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fg: Option<TermColor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bg: Option<TermColor>,
    #[serde(skip_serializing_if = "is_zero")]
    pub flags: u16,
}

fn is_zero(v: &u16) -> bool {
    *v == 0
}

fn is_false(v: &bool) -> bool {
    !*v
}

/// One row of a block. `wrapped` means the next row continues this one (the
/// program did not print a newline, the grid simply ran out of columns), so
/// a renderer joins the two and re-wraps them at its own width.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BlockLine {
    /// `(style index into BlockSnapshot::styles, text)`.
    pub runs: Vec<(u16, String)>,
    #[serde(skip_serializing_if = "is_false")]
    pub wrapped: bool,
}

impl BlockLine {
    pub fn text(&self) -> String {
        self.runs.iter().map(|(_, t)| t.as_str()).collect()
    }
}

/// A block as the renderer and the MCP see it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockSnapshot {
    /// Increasing per terminal; never reused.
    pub id: u64,
    /// Bumped by `clear` / `reset`: blocks of an older generation are gone.
    pub generation: u64,
    /// `false` for the block before the first prompt (a MOTD) and for the one
    /// big block of a terminal that never sends markers.
    pub has_prompt: bool,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub exit_code: Option<i32>,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    /// Index in `lines` of the first output row; `lines.len()` when the
    /// command printed nothing, `0` when there is no prompt in the block.
    pub output_start: usize,
    /// The block outgrew its grid's history and lost its first rows.
    pub truncated: bool,
    /// Still the live block (only in [`BlockSplitter::live_snapshot`]).
    pub live: bool,
    pub styles: Vec<CellStyle>,
    pub lines: Vec<BlockLine>,
}

impl BlockSnapshot {
    /// Every row, wrapped rows joined back into the line the program wrote.
    pub fn text(&self) -> String {
        join_lines(&self.lines)
    }

    /// The prompt and the command line as drawn.
    pub fn prompt_text(&self) -> String {
        join_lines(&self.lines[..self.output_start.min(self.lines.len())])
    }

    /// What the command printed.
    pub fn output_text(&self) -> String {
        join_lines(&self.lines[self.output_start.min(self.lines.len())..])
    }
}

fn join_lines(lines: &[BlockLine]) -> String {
    let mut out = String::new();
    for (i, line) in lines.iter().enumerate() {
        out.push_str(&line.text());
        if !line.wrapped && i + 1 < lines.len() {
            out.push('\n');
        }
    }
    out
}

/// A pane's blocks at one point in time ([`BlockRegistry::view`]).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlocksView {
    pub generation: u64,
    pub alt_screen: bool,
    pub frozen: Vec<BlockSnapshot>,
    pub live: BlockSnapshot,
}

/// What one [`BlockSplitter::feed`] changed.
#[derive(Debug, Clone)]
pub enum BlockEvent {
    /// A new prompt started: the previous live block is final.
    Frozen(BlockSnapshot),
    /// `clear` / `reset`: every frozen block is gone.
    Cleared { generation: u64 },
    /// The live program entered (`true`) or left the alternate screen.
    AltScreen(bool),
}

// ============================================================================
// Clear / reset detection
// ============================================================================

/// What of the stream, besides OSC 133, ends or wipes blocks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Wipe {
    /// `CSI 3 J` — erase the scrollback (`clear` sends it).
    EraseScrollback,
    /// `ESC c` — full reset.
    Reset,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CsiState {
    Ground,
    Esc,
    /// Inside `CSI`; `param` is the single parameter read so far.
    Csi,
}

/// Tiny CSI watcher for [`Wipe`]s, chunk-boundary safe. OSC payloads can't
/// fool it into much: an `ESC c` or `ESC [ 3 J` inside one would need an ESC,
/// which terminates the OSC anyway.
struct WipeScanner {
    state: CsiState,
    param: Vec<u8>,
}

impl WipeScanner {
    fn new() -> Self {
        Self {
            state: CsiState::Ground,
            param: Vec::new(),
        }
    }

    fn feed(&mut self, chunk: &[u8]) -> Vec<(usize, Wipe)> {
        let mut out = Vec::new();
        for (i, &b) in chunk.iter().enumerate() {
            match self.state {
                CsiState::Ground => {
                    if b == 0x1b {
                        self.state = CsiState::Esc;
                    }
                }
                CsiState::Esc => match b {
                    b'[' => {
                        self.param.clear();
                        self.state = CsiState::Csi;
                    }
                    b'c' => {
                        out.push((i + 1, Wipe::Reset));
                        self.state = CsiState::Ground;
                    }
                    0x1b => {}
                    _ => self.state = CsiState::Ground,
                },
                CsiState::Csi => match b {
                    0x30..=0x3f => {
                        if self.param.len() < 8 {
                            self.param.push(b);
                        }
                    }
                    0x20..=0x2f => {}
                    0x40..=0x7e => {
                        if b == b'J' && self.param == b"3" {
                            out.push((i + 1, Wipe::EraseScrollback));
                        }
                        self.state = CsiState::Ground;
                    }
                    0x1b => self.state = CsiState::Esc,
                    _ => self.state = CsiState::Ground,
                },
            }
        }
        out
    }
}

// ============================================================================
// The splitter
// ============================================================================

struct Size {
    cols: usize,
    rows: usize,
}

impl Dimensions for Size {
    fn total_lines(&self) -> usize {
        self.rows
    }
    fn screen_lines(&self) -> usize {
        self.rows
    }
    fn columns(&self) -> usize {
        self.cols
    }
}

/// Metadata of the block in progress.
#[derive(Debug, Clone, Default)]
struct LiveMeta {
    id: u64,
    has_prompt: bool,
    command: Option<String>,
    cwd: Option<String>,
    exit_code: Option<i32>,
    started_at: Option<i64>,
    finished_at: Option<i64>,
    /// Absolute row (history + screen) of the first output row.
    output_start: Option<usize>,
}

enum Boundary {
    Shell(ShellEvent),
    /// `clear` and `reset` are handled the same way: every frozen block goes.
    Wipe,
}

/// One terminal's block splitter. Feed it every PTY chunk, in order.
pub struct BlockSplitter {
    size: (usize, usize),
    history_lines: usize,
    max_frozen_lines: usize,
    osc: OscScanner,
    wipes: WipeScanner,
    parser: Processor,
    live: Term<VoidListener>,
    meta: LiveMeta,
    frozen: VecDeque<BlockSnapshot>,
    frozen_line_count: usize,
    next_id: u64,
    generation: u64,
    cwd: Option<String>,
    alt_screen: bool,
}

fn new_term(cols: usize, rows: usize, history: usize) -> Term<VoidListener> {
    let config = Config {
        scrolling_history: history,
        ..Config::default()
    };
    Term::new(config, &Size { cols, rows }, VoidListener)
}

impl BlockSplitter {
    pub fn new(cols: usize, rows: usize) -> Self {
        Self::with_limits(
            cols,
            rows,
            DEFAULT_BLOCK_HISTORY_LINES,
            DEFAULT_FROZEN_LINES,
        )
    }

    pub fn with_limits(
        cols: usize,
        rows: usize,
        history_lines: usize,
        max_frozen_lines: usize,
    ) -> Self {
        let cols = cols.max(2);
        let rows = rows.max(1);
        Self {
            size: (cols, rows),
            history_lines,
            max_frozen_lines,
            osc: OscScanner::new(),
            wipes: WipeScanner::new(),
            parser: Processor::new(),
            live: new_term(cols, rows, history_lines),
            meta: LiveMeta {
                id: 1,
                ..LiveMeta::default()
            },
            frozen: VecDeque::new(),
            frozen_line_count: 0,
            next_id: 2,
            generation: 0,
            cwd: None,
            alt_screen: false,
        }
    }

    /// Process one PTY chunk. `now_ms` stamps the command's start / end.
    pub fn feed(&mut self, chunk: &[u8], now_ms: i64) -> Vec<BlockEvent> {
        let mut cuts: Vec<(usize, Boundary)> = self
            .osc
            .feed_indexed(chunk)
            .into_iter()
            .map(|(at, ev)| (at, Boundary::Shell(ev)))
            .collect();
        cuts.extend(
            self.wipes
                .feed(chunk)
                .into_iter()
                .map(|(at, _)| (at, Boundary::Wipe)),
        );
        // Stable: an OSC and a CSI can't end on the same byte, but keep the
        // scanners' own order for equal offsets anyway.
        cuts.sort_by_key(|(at, _)| *at);

        let mut events = Vec::new();
        let mut pos = 0;
        for (at, boundary) in cuts {
            if at > pos {
                self.parser.advance(&mut self.live, &chunk[pos..at]);
                pos = at;
            }
            self.apply(boundary, now_ms, &mut events);
        }
        if pos < chunk.len() {
            self.parser.advance(&mut self.live, &chunk[pos..]);
        }
        let alt = self.live.mode().contains(TermMode::ALT_SCREEN);
        if alt != self.alt_screen {
            self.alt_screen = alt;
            events.push(BlockEvent::AltScreen(alt));
        }
        events
    }

    fn apply(&mut self, boundary: Boundary, now_ms: i64, events: &mut Vec<BlockEvent>) {
        match boundary {
            Boundary::Shell(ShellEvent::PromptStart) => {
                // A prompt drawn while a program holds the alternate screen
                // (a shell inside vim's `:terminal`, say) is not ours.
                if self.live.mode().contains(TermMode::ALT_SCREEN) {
                    return;
                }
                let keep =
                    self.meta.has_prompt || self.meta.command.is_some() || !self.live_is_blank();
                if keep {
                    let snapshot = self.snapshot_live(false);
                    self.push_frozen(snapshot.clone());
                    events.push(BlockEvent::Frozen(snapshot));
                }
                let (cols, rows) = self.size;
                self.live = new_term(cols, rows, self.history_lines);
                self.meta = LiveMeta {
                    id: self.next_id,
                    has_prompt: true,
                    cwd: self.cwd.clone(),
                    ..LiveMeta::default()
                };
                self.next_id += 1;
            }
            Boundary::Shell(ShellEvent::PromptEnd) => {}
            Boundary::Shell(ShellEvent::CommandStart { command }) => {
                self.meta.command = command;
                self.meta.started_at = Some(now_ms);
                let grid = self.live.grid();
                let cursor = grid.cursor.point;
                let row = grid.history_size() as i64 + cursor.line.0 as i64;
                // Output starts on the cursor's row when the shell has already
                // moved to a fresh line, on the next one otherwise.
                let row = if cursor.column.0 == 0 { row } else { row + 1 };
                self.meta.output_start = Some(row.max(0) as usize);
            }
            Boundary::Shell(ShellEvent::CommandEnd { exit_code }) => {
                // A `D` with no `C` before it (Ctrl+C at an empty prompt) ends
                // nothing that ran.
                if self.meta.command.is_some() || self.meta.started_at.is_some() {
                    self.meta.exit_code = exit_code;
                    self.meta.finished_at = Some(now_ms);
                }
            }
            Boundary::Shell(ShellEvent::Cwd(path)) => {
                if self.meta.cwd.is_none() {
                    self.meta.cwd = Some(path.clone());
                }
                self.cwd = Some(path);
            }
            Boundary::Wipe => {
                if self.live.mode().contains(TermMode::ALT_SCREEN) {
                    return;
                }
                self.frozen.clear();
                self.frozen_line_count = 0;
                self.generation += 1;
                // The live block's own rows were wiped by the emulator; what
                // it prints from here on is all that block will hold.
                self.meta.output_start = Some(0);
                events.push(BlockEvent::Cleared {
                    generation: self.generation,
                });
            }
        }
    }

    fn push_frozen(&mut self, snapshot: BlockSnapshot) {
        self.frozen_line_count += snapshot.lines.len();
        self.frozen.push_back(snapshot);
        while self.frozen.len() > MAX_FROZEN_BLOCKS
            || (self.frozen_line_count > self.max_frozen_lines && self.frozen.len() > 1)
        {
            if let Some(old) = self.frozen.pop_front() {
                self.frozen_line_count -= old.lines.len();
            }
        }
    }

    fn live_is_blank(&self) -> bool {
        let grid = self.live.grid();
        let mut line = grid.topmost_line();
        while line <= grid.bottommost_line() {
            if !row_is_blank(&grid[line]) {
                return false;
            }
            line += 1;
        }
        true
    }

    /// The pane has a new size. Only the live block's grid cares: frozen
    /// blocks are logical lines and get re-wrapped by whoever draws them.
    pub fn resize(&mut self, cols: usize, rows: usize) {
        let cols = cols.max(2);
        let rows = rows.max(1);
        if (cols, rows) == self.size {
            return;
        }
        self.size = (cols, rows);
        self.live.resize(Size { cols, rows });
    }

    /// The "Clear" button: forget every frozen block, as `clear` would.
    pub fn clear(&mut self) -> u64 {
        self.frozen.clear();
        self.frozen_line_count = 0;
        self.generation += 1;
        self.generation
    }

    /// Lines the live grid may keep, applied from the next block on.
    pub fn set_history_lines(&mut self, lines: usize) {
        self.history_lines = lines.max(100);
    }

    pub fn alt_screen(&self) -> bool {
        self.alt_screen
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// Frozen blocks with an id above `after` (all of them for `0`).
    pub fn frozen_after(&self, after: u64) -> Vec<BlockSnapshot> {
        self.frozen
            .iter()
            .filter(|b| b.id > after)
            .cloned()
            .collect()
    }

    pub fn frozen(&self) -> impl Iterator<Item = &BlockSnapshot> {
        self.frozen.iter()
    }

    /// The block in progress, as it would be frozen right now.
    pub fn live_snapshot(&self) -> BlockSnapshot {
        self.snapshot_live(true)
    }

    /// The last block that holds a command: the live one while it runs, else
    /// the most recent frozen one with a command.
    pub fn last_command_block(&self) -> Option<BlockSnapshot> {
        if self.meta.command.is_some() {
            return Some(self.live_snapshot());
        }
        self.frozen
            .iter()
            .rev()
            .find(|b| b.command.is_some())
            .cloned()
    }

    /// What the screen shows right now — the alternate screen while a
    /// full-screen program has it — one string per row, trailing blanks cut.
    pub fn screen_text(&self) -> Vec<String> {
        let grid = self.live.grid();
        let mut rows: Vec<String> = (0..grid.screen_lines())
            .map(|i| {
                let (runs, _) = row_runs(&grid[Line(i as i32)], &mut StyleTable::default());
                runs.into_iter().map(|(_, t)| t).collect()
            })
            .collect();
        while rows.last().is_some_and(|r| r.is_empty()) {
            rows.pop();
        }
        rows
    }

    fn snapshot_live(&self, live: bool) -> BlockSnapshot {
        // Always the primary screen: what a full-screen program drew on the
        // alternate one is gone when it exits, in every terminal.
        let grid = if self.live.mode().contains(TermMode::ALT_SCREEN) {
            None
        } else {
            Some(self.live.grid())
        };
        let mut styles = StyleTable::default();
        let mut lines = Vec::new();
        let mut truncated = false;
        let mut output_start = 0;
        if let Some(grid) = grid {
            let history = grid.history_size();
            truncated = history >= self.history_lines;
            let mut last_kept: i64 = -1;
            let total = grid.total_lines();
            let mut all = Vec::with_capacity(total);
            for abs in 0..total {
                let line = Line(abs as i32 - history as i32);
                let row = &grid[line];
                let (runs, wrapped) = row_runs(row, &mut styles);
                if !runs.is_empty() {
                    last_kept = abs as i64;
                }
                all.push(BlockLine { runs, wrapped });
            }
            // Keep up to the last row with text. Blank rows the program
            // printed after it (and the spacing rows `terminal.blockSpacing`
            // asks the shell for) are the renderer's padding to draw.
            all.truncate((last_kept + 1).max(0) as usize);
            if let Some(last) = all.last_mut() {
                last.wrapped = false;
            }
            lines = all;
            output_start = match (self.meta.has_prompt, self.meta.output_start) {
                (false, _) => 0,
                (true, _) if truncated => 0,
                (true, Some(row)) => row.min(lines.len()),
                (true, None) => lines.len(),
            };
        }
        BlockSnapshot {
            id: self.meta.id,
            generation: self.generation,
            has_prompt: self.meta.has_prompt,
            command: self.meta.command.clone(),
            cwd: self.meta.cwd.clone(),
            exit_code: self.meta.exit_code,
            started_at: self.meta.started_at,
            finished_at: self.meta.finished_at,
            output_start,
            truncated,
            live,
            styles: styles.styles,
            lines,
        }
    }
}

// ============================================================================
// Grid → styled runs
// ============================================================================

#[derive(Default)]
struct StyleTable {
    styles: Vec<CellStyle>,
    index: HashMap<CellStyle, u16>,
}

impl StyleTable {
    fn id(&mut self, style: CellStyle) -> u16 {
        if let Some(&id) = self.index.get(&style) {
            return id;
        }
        let id = self.styles.len().min(u16::MAX as usize) as u16;
        self.styles.push(style);
        self.index.insert(style, id);
        id
    }
}

fn color(c: Color, default: NamedColor) -> Option<TermColor> {
    match c {
        Color::Spec(rgb) => Some(TermColor::Rgb([rgb.r, rgb.g, rgb.b])),
        Color::Indexed(i) => Some(TermColor::Index(i)),
        Color::Named(n) if n == default => None,
        Color::Named(n) => {
            let idx = n as usize;
            match n {
                NamedColor::Foreground
                | NamedColor::Background
                | NamedColor::Cursor
                | NamedColor::BrightForeground
                | NamedColor::DimForeground => None,
                // DimBlack.. map onto their base colour; DIM is a flag.
                NamedColor::DimBlack
                | NamedColor::DimRed
                | NamedColor::DimGreen
                | NamedColor::DimYellow
                | NamedColor::DimBlue
                | NamedColor::DimMagenta
                | NamedColor::DimCyan
                | NamedColor::DimWhite => Some(TermColor::Index(
                    (idx - NamedColor::DimBlack as usize) as u8,
                )),
                _ if idx < 16 => Some(TermColor::Index(idx as u8)),
                _ => None,
            }
        }
    }
}

fn cell_style(cell: &Cell) -> CellStyle {
    use style_flags::*;
    let f = cell.flags;
    let mut flags = 0;
    for (from, to) in [
        (Flags::BOLD, BOLD),
        (Flags::DIM, DIM),
        (Flags::ITALIC, ITALIC),
        (Flags::UNDERLINE, UNDERLINE),
        (Flags::INVERSE, INVERSE),
        (Flags::HIDDEN, HIDDEN),
        (Flags::STRIKEOUT, STRIKEOUT),
        (Flags::DOUBLE_UNDERLINE, DOUBLE_UNDERLINE),
        (Flags::UNDERCURL, UNDERCURL),
    ] {
        if f.contains(from) {
            flags |= to;
        }
    }
    CellStyle {
        fg: color(cell.fg, NamedColor::Foreground),
        bg: color(cell.bg, NamedColor::Background),
        flags,
    }
}

/// Does a blank cell still show something (a background, an underline, a
/// reverse-video bar)? Those are kept at the end of a row.
fn cell_visible(cell: &Cell) -> bool {
    (cell.c != ' ' && cell.c != '\0')
        || cell.zerowidth().is_some_and(|z| !z.is_empty())
        || cell_style(cell).bg.is_some()
        || cell
            .flags
            .intersects(Flags::INVERSE | Flags::ALL_UNDERLINES | Flags::STRIKEOUT)
}

fn row_is_blank(row: &Row<Cell>) -> bool {
    (0..row.len()).all(|i| !cell_visible(&row[Column(i)]))
}

/// A row as `(style, text)` runs, trailing blank cells dropped, plus whether
/// it wraps onto the next one.
fn row_runs(row: &Row<Cell>, styles: &mut StyleTable) -> (Vec<(u16, String)>, bool) {
    let cols = row.len();
    let wrapped = cols > 0 && row[Column(cols - 1)].flags.contains(Flags::WRAPLINE);
    let end = (0..cols)
        .rev()
        .find(|&i| cell_visible(&row[Column(i)]))
        .map(|i| i + 1)
        .unwrap_or(0);
    let mut runs: Vec<(u16, String)> = Vec::new();
    for i in 0..end {
        let cell = &row[Column(i)];
        if cell
            .flags
            .intersects(Flags::WIDE_CHAR_SPACER | Flags::LEADING_WIDE_CHAR_SPACER)
        {
            continue;
        }
        let id = styles.id(cell_style(cell));
        let ch = if cell.c == '\0' { ' ' } else { cell.c };
        match runs.last_mut() {
            Some((last, text)) if *last == id => text.push(ch),
            _ => runs.push((id, ch.to_string())),
        }
        if let Some(zw) = cell.zerowidth() {
            if let Some((_, text)) = runs.last_mut() {
                text.extend(zw.iter());
            }
        }
    }
    (runs, wrapped)
}

// ============================================================================
// Registry (one splitter per terminal id)
// ============================================================================

/// Every terminal's [`BlockSplitter`]. The PTY reader thread holds its own
/// `Arc` so feeding never takes the registry lock.
pub struct BlockRegistry {
    splitters: Mutex<HashMap<String, Arc<Mutex<BlockSplitter>>>>,
    history_lines: AtomicUsize,
}

impl Default for BlockRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl BlockRegistry {
    pub fn new() -> Self {
        Self {
            splitters: Mutex::new(HashMap::new()),
            history_lines: AtomicUsize::new(DEFAULT_BLOCK_HISTORY_LINES),
        }
    }

    /// The splitter for `id`, created at `cols × rows` if there is none.
    pub fn get_or_create(&self, id: &str, cols: u16, rows: u16) -> Arc<Mutex<BlockSplitter>> {
        let history = self.history_lines.load(Ordering::Relaxed);
        self.splitters
            .lock()
            .entry(id.to_string())
            .or_insert_with(|| {
                Arc::new(Mutex::new(BlockSplitter::with_limits(
                    cols as usize,
                    rows as usize,
                    history,
                    DEFAULT_FROZEN_LINES.max(history * 4),
                )))
            })
            .clone()
    }

    pub fn get(&self, id: &str) -> Option<Arc<Mutex<BlockSplitter>>> {
        self.splitters.lock().get(id).cloned()
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) {
        if let Some(s) = self.get(id) {
            s.lock().resize(cols as usize, rows as usize);
        }
    }

    pub fn remove(&self, id: &str) {
        self.splitters.lock().remove(id);
    }

    pub fn clear(&self, id: &str) {
        if let Some(s) = self.get(id) {
            s.lock().clear();
        }
    }

    /// Everything a renderer needs to (re)build a pane's block list: frozen
    /// blocks with an id above `after`, plus the live one.
    pub fn view(&self, id: &str, after: u64) -> Option<BlocksView> {
        let s = self.get(id)?;
        let s = s.lock();
        Some(BlocksView {
            generation: s.generation(),
            alt_screen: s.alt_screen(),
            frozen: s.frozen_after(after),
            live: s.live_snapshot(),
        })
    }

    /// Follow `terminal.scrollbackLines` for the live grids.
    pub fn set_history_lines(&self, lines: usize) {
        self.history_lines.store(lines.max(100), Ordering::Relaxed);
        for s in self.splitters.lock().values() {
            s.lock().set_history_lines(lines);
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    const A: &str = "\x1b]133;A\x07";
    const B: &str = "\x1b]133;B\x07";

    fn c(cmd: &str) -> String {
        let b64 = base64::engine::general_purpose::STANDARD.encode(cmd);
        format!("\x1b]133;C;cmd={}\x07", b64)
    }

    fn d(code: i32) -> String {
        format!("\x1b]133;D;{}\x07", code)
    }

    /// One prompt + command + output + end, the way zsh draws it.
    fn command(cmd: &str, output: &str, code: i32) -> String {
        format!("{A}$ {B}{cmd}\r\n{}{output}{}", c(cmd), d(code))
    }

    fn frozen(events: &[BlockEvent]) -> Vec<&BlockSnapshot> {
        events
            .iter()
            .filter_map(|e| match e {
                BlockEvent::Frozen(b) => Some(b),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn splits_at_each_prompt() {
        let mut s = BlockSplitter::new(40, 10);
        let mut stream = command("ls", "a\r\nb\r\n", 0);
        stream += &command("false", "", 1);
        stream += A;
        stream += "$ ";
        let events = s.feed(stream.as_bytes(), 1000);
        let blocks = frozen(&events);
        assert_eq!(blocks.len(), 2);

        assert_eq!(blocks[0].command.as_deref(), Some("ls"));
        assert_eq!(blocks[0].exit_code, Some(0));
        assert_eq!(blocks[0].prompt_text(), "$ ls");
        assert_eq!(blocks[0].output_text(), "a\nb");

        assert_eq!(blocks[1].command.as_deref(), Some("false"));
        assert_eq!(blocks[1].exit_code, Some(1));
        assert_eq!(blocks[1].output_text(), "");
        assert_eq!(blocks[1].output_start, blocks[1].lines.len());

        let live = s.live_snapshot();
        assert!(live.live);
        assert_eq!(live.text(), "$");
        assert!(live.command.is_none());
    }

    #[test]
    fn markers_split_across_chunks() {
        let mut s = BlockSplitter::new(40, 10);
        let stream = command("echo hi", "hi\r\n", 0) + A;
        let bytes = stream.as_bytes();
        let mut all = Vec::new();
        for chunk in bytes.chunks(3) {
            all.extend(s.feed(chunk, 0));
        }
        let blocks = frozen(&all);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].output_text(), "hi");
    }

    #[test]
    fn preamble_without_prompt_is_its_own_block() {
        let mut s = BlockSplitter::new(40, 10);
        let events = s.feed(format!("Welcome!\r\n{A}$ ").as_bytes(), 0);
        let blocks = frozen(&events);
        assert_eq!(blocks.len(), 1);
        assert!(!blocks[0].has_prompt);
        assert_eq!(blocks[0].output_start, 0);
        assert_eq!(blocks[0].text(), "Welcome!");
    }

    #[test]
    fn blank_preamble_is_dropped() {
        let mut s = BlockSplitter::new(40, 10);
        let events = s.feed(format!("\r\n\r\n{A}$ ").as_bytes(), 0);
        assert!(frozen(&events).is_empty());
    }

    #[test]
    fn no_markers_means_one_live_block() {
        let mut s = BlockSplitter::new(40, 5);
        let mut events = Vec::new();
        for i in 0..50 {
            events.extend(s.feed(format!("line {i}\r\n").as_bytes(), 0));
        }
        assert!(frozen(&events).is_empty());
        let live = s.live_snapshot();
        assert_eq!(live.lines.len(), 50);
        assert_eq!(live.lines[49].text(), "line 49");
    }

    #[test]
    fn long_lines_wrap_and_join_back() {
        let mut s = BlockSplitter::new(10, 5);
        let long = "x".repeat(25);
        let events = s.feed(
            (command("cat", &format!("{long}\r\n"), 0) + A).as_bytes(),
            0,
        );
        let block = frozen(&events)[0];
        // 25 chars on 10 columns: three rows, the first two marked wrapped.
        let out = &block.lines[block.output_start..];
        assert_eq!(out.len(), 3);
        assert!(out[0].wrapped && out[1].wrapped && !out[2].wrapped);
        assert_eq!(block.output_text(), long);
    }

    #[test]
    fn styles_are_kept_as_palette_indices() {
        let mut s = BlockSplitter::new(40, 5);
        let out = "\x1b[1;31merr\x1b[0m ok \x1b[38;2;1;2;3mrgb\x1b[0m\r\n";
        let events = s.feed((command("x", out, 0) + A).as_bytes(), 0);
        let block = frozen(&events)[0];
        let line = &block.lines[block.output_start];
        assert_eq!(line.text(), "err ok rgb");
        let style = |i: usize| block.styles[line.runs[i].0 as usize];
        assert_eq!(style(0).fg, Some(TermColor::Index(1)));
        assert_eq!(style(0).flags, style_flags::BOLD);
        assert_eq!(style(1), CellStyle::default());
        assert_eq!(style(2).fg, Some(TermColor::Rgb([1, 2, 3])));
    }

    #[test]
    fn wide_chars_are_not_doubled() {
        let mut s = BlockSplitter::new(20, 5);
        let events = s.feed((command("x", "日本語!\r\n", 0) + A).as_bytes(), 0);
        let block = frozen(&events)[0];
        assert_eq!(block.output_text(), "日本語!");
    }

    #[test]
    fn clear_drops_frozen_blocks() {
        let mut s = BlockSplitter::new(40, 10);
        s.feed(command("ls", "a\r\n", 0).as_bytes(), 0);
        s.feed(A.as_bytes(), 0);
        assert_eq!(s.frozen().count(), 1);
        // What `clear` prints with ncurses' E3 capability.
        let events = s.feed(
            format!("$ {B}clear\r\n{}\x1b[H\x1b[2J\x1b[3J{}", c("clear"), d(0)).as_bytes(),
            0,
        );
        assert!(events
            .iter()
            .any(|e| matches!(e, BlockEvent::Cleared { generation: 1 })));
        assert_eq!(s.frozen().count(), 0);
        let events = s.feed(format!("{A}$ ").as_bytes(), 0);
        let blocks = frozen(&events);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].generation, 1);
        assert_eq!(blocks[0].text(), "");
    }

    #[test]
    fn ctrl_l_does_not_drop_blocks() {
        let mut s = BlockSplitter::new(40, 10);
        s.feed((command("ls", "a\r\n", 0) + A).as_bytes(), 0);
        let events = s.feed(b"\x1b[H\x1b[2J$ ", 0);
        assert!(events.is_empty());
        assert_eq!(s.frozen().count(), 1);
    }

    #[test]
    fn alt_screen_is_reported_and_not_frozen() {
        let mut s = BlockSplitter::new(40, 10);
        s.feed(format!("{A}$ {B}vim\r\n{}", c("vim")).as_bytes(), 0);
        let events = s.feed(b"\x1b[?1049h\x1b[Hfull screen", 0);
        assert!(events
            .iter()
            .any(|e| matches!(e, BlockEvent::AltScreen(true))));
        assert!(s.alt_screen());
        assert_eq!(s.screen_text(), vec!["full screen".to_string()]);
        // A prompt marker on the alternate screen is not a block boundary.
        assert!(frozen(&s.feed(A.as_bytes(), 0)).is_empty());
        let events = s.feed(format!("\x1b[?1049l{}{A}$ ", d(0)).as_bytes(), 0);
        assert!(events
            .iter()
            .any(|e| matches!(e, BlockEvent::AltScreen(false))));
        let block = frozen(&events)[0];
        assert_eq!(block.command.as_deref(), Some("vim"));
        assert_eq!(block.text(), "$ vim");
    }

    #[test]
    fn cursor_up_stops_at_the_block_top() {
        let mut s = BlockSplitter::new(40, 10);
        s.feed((command("ls", "first\r\n", 0) + A).as_bytes(), 0);
        // A program that moves 5 rows up and overwrites: in one shared grid it
        // would land on the previous block.
        let events = s.feed(
            format!("$ {B}x\r\n{}\x1b[5Aover\r\n{}{A}", c("x"), d(0)).as_bytes(),
            0,
        );
        let blocks = frozen(&events);
        assert_eq!(blocks[0].text(), "over");
        assert_eq!(s.frozen().next().unwrap().output_text(), "first");
    }

    #[test]
    fn resize_reflows_the_live_block() {
        let mut s = BlockSplitter::new(10, 5);
        s.feed(
            format!("{A}$ {B}cat\r\n{}{}\r\n", c("cat"), "y".repeat(15)).as_bytes(),
            0,
        );
        assert_eq!(s.live_snapshot().output_text(), "y".repeat(15));
        s.resize(40, 5);
        let live = s.live_snapshot();
        assert_eq!(live.output_text(), "y".repeat(15));
        assert_eq!(live.lines.len() - live.output_start, 1);
    }

    #[test]
    fn oversized_block_is_truncated() {
        let mut s = BlockSplitter::with_limits(20, 5, 100, 10_000);
        let mut out = String::new();
        for i in 0..300 {
            out += &format!("{i}\r\n");
        }
        let events = s.feed((command("seq", &out, 0) + A).as_bytes(), 0);
        let block = frozen(&events)[0];
        assert!(block.truncated);
        assert_eq!(block.output_start, 0);
        assert_eq!(block.lines.last().unwrap().text(), "299");
        assert!(block.lines.len() <= 105);
    }

    #[test]
    fn frozen_budget_evicts_oldest() {
        let mut s = BlockSplitter::with_limits(20, 5, 100, 10);
        for i in 0..10 {
            s.feed(
                (command(&format!("c{i}"), "1\r\n2\r\n3\r\n", 0)).as_bytes(),
                0,
            );
        }
        s.feed(A.as_bytes(), 0);
        let kept: Vec<_> = s.frozen().map(|b| b.command.clone().unwrap()).collect();
        assert_eq!(kept.last().unwrap(), "c9");
        assert!(kept.len() <= 3);
        assert!(s.frozen_after(0).iter().all(|b| b.id > 1));
    }

    #[test]
    fn cwd_and_timestamps() {
        let mut s = BlockSplitter::new(40, 10);
        s.feed(b"\x1b]7;file://host/tmp/x\x07", 0);
        s.feed(format!("{A}$ {B}ls\r\n{}", c("ls")).as_bytes(), 100);
        let events = s.feed(format!("{}{A}", d(2)).as_bytes(), 250);
        let block = frozen(&events)[0];
        assert_eq!(block.cwd.as_deref(), Some("/tmp/x"));
        assert_eq!(block.started_at, Some(100));
        assert_eq!(block.finished_at, Some(250));
        assert_eq!(block.exit_code, Some(2));
    }

    #[test]
    fn last_command_block_prefers_the_running_one() {
        let mut s = BlockSplitter::new(40, 10);
        s.feed((command("ls", "a\r\n", 0) + A).as_bytes(), 0);
        assert_eq!(
            s.last_command_block().unwrap().command.as_deref(),
            Some("ls")
        );
        s.feed(format!("$ {B}top\r\n{}busy", c("top")).as_bytes(), 0);
        let last = s.last_command_block().unwrap();
        assert!(last.live);
        assert_eq!(last.output_text(), "busy");
    }

    #[test]
    fn snapshot_serialises_compactly() {
        let mut s = BlockSplitter::new(40, 10);
        let events = s.feed((command("ls", "a\r\n", 0) + A).as_bytes(), 0);
        let json = serde_json::to_string(frozen(&events)[0]).unwrap();
        assert!(json.contains(r#""runs":[[0,"a"]]"#), "{json}");
        assert!(!json.contains("wrapped"));
    }
}

/// `cargo test -p cortx-core --release --lib blocks::bench -- --ignored --nocapture`
/// — what the splitter costs the PTY reader thread (CORT-57, point 4).
#[cfg(test)]
mod bench {
    use super::*;
    use std::time::Instant;

    fn run(label: &str, line: &[u8], total: usize) {
        let mut chunk = Vec::with_capacity(64 * 1024);
        while chunk.len() + line.len() <= 64 * 1024 {
            chunk.extend_from_slice(line);
        }
        let n = total / chunk.len();
        let mut s = BlockSplitter::new(160, 50);
        let t = Instant::now();
        for _ in 0..n {
            s.feed(&chunk, 0);
        }
        let el = t.elapsed();
        let mb = (n * chunk.len()) as f64 / 1e6;
        println!(
            "{label:<28} {mb:>6.0} MB in {:>6.2} s = {:>6.0} MB/s",
            el.as_secs_f64(),
            mb / el.as_secs_f64()
        );
        let t = Instant::now();
        let mut osc = OscScanner::new();
        for _ in 0..n {
            osc.feed(&chunk);
        }
        let el = t.elapsed();
        println!(
            "{:<28} {mb:>6.0} MB in {:>6.2} s = {:>6.0} MB/s",
            "  (OscScanner alone)",
            el.as_secs_f64(),
            mb / el.as_secs_f64()
        );
    }

    #[test]
    #[ignore]
    fn throughput() {
        run(
            "plain 80-col log lines",
            format!(
                "{}\r\n",
                "2026-11-24 12:00:00 INFO request handled in 12ms path=/api/x".repeat(1)
            )
            .as_bytes(),
            200_000_000,
        );
        run("coloured (ls --color)", b"\x1b[0m\x1b[01;34mdir\x1b[0m  \x1b[01;32mexec.sh\x1b[0m  file.txt  \x1b[38;2;200;100;50mtruecolor\x1b[0m\r\n", 200_000_000);
        run("TUI redraw (cursor moves)", b"\x1b[?2026h\x1b[12;1H\x1b[2K\x1b[38;5;208m\xe2\xa0\x8b Thinking\xe2\x80\xa6\x1b[0m (esc to interrupt)\x1b[13;1H\x1b[2K> \x1b[?2026l", 200_000_000);
    }
}
