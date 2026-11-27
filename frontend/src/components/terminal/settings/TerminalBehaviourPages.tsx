/**
 * The terminal's behaviour and text, one component per settings page
 * (ticket #64): Shell & sessions, Text, Blocks, Input & completion, Keyboard &
 * mouse, Tabs, History. They used to be the groups of one card,
 * "Integrated terminal", thirty-odd controls deep.
 *
 * Every page is store-backed (`useTerminalSettings`), so the Settings screen
 * and the Terminal window's panel edit the very same `settings.terminal`. A
 * page renders all of its `Group`s; each one is skipped when a search filters
 * it out (see `components/settings/settingsNav.ts`).
 *
 * Which group a setting belongs to — and so which "N changed" counts it — is
 * `terminalDefaults.ts`'s call; moving a control between pages means moving
 * its block here *and* its `group` there, and `terminalDefaults.test.ts`
 * catches a group left empty.
 */
import { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { BetaBadge } from '@/components/ui/BetaBadge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Code, SectionNote, SettingRow } from '@/components/settings/SettingsPrimitives';
import { Group, NumberField, SelectField, SwitchField, TextField } from './controls';
import { useTerminalSettings } from './useTerminalSettings';
import { getPlatform, TERMINAL_FONT_SUGGESTIONS } from './meta';
import { DEFAULT_MAC_OPTION_AS_META, DEFAULT_SHIFT_ENTER, DEFAULT_SMOOTH_SCROLL_DURATION } from '@/lib/terminalKeys';
import { DEFAULT_FONT_SIZE, DEFAULT_INPUT_POSITION } from './terminalDefaults';
import {
  DEFAULT_MINIMUM_CONTRAST,
  DEFAULT_HISTORY_MAX_MB,
  DEFAULT_SCROLLBACK_LINES,
  MAX_SCROLLBACK_LINES,
  MIN_SCROLLBACK_LINES,
  SCROLLBACK_WARN_LINES,
  fontFamilyResolves,
} from '@/lib/terminalSessions';
import { resolveTabDisplay } from '@/components/terminal/model';
import { redactCommandHistory, type RedactionReport } from '@/lib/tauri';
import type {
  CompletionMenuKey,
  MacOptionAsMeta,
  ShiftEnterKey,
  SuggestionConfidence,
  TabIndexDisplay,
  TerminalBlockSpacing,
  TerminalCtrlTabBehavior,
  TerminalInputPosition,
  TerminalOsc52Access,
  TerminalTargetSurface,
} from '@/types';

const SHELL_INTEGRATION_NEEDED = 'Needs shell integration (Terminal › Shell & sessions).';

// ===========================================================================
// Shell & sessions
// ===========================================================================

export function TerminalShellPage() {
  const { terminal, patch } = useTerminalSettings();
  const off = !terminal;
  const restoreSessions = terminal?.restoreSessions ?? true;
  const restoreScrollback = terminal?.restoreScrollback ?? true;

  return (
    <>
      <Group group="shell">
        <TextField
          k="integratedShell"
          id="integrated-shell"
          label="Shell"
          wide
          hint={
            <>
              The command line a new tab runs, e.g. <Code>pwsh -NoLogo</Code>, <Code>nu</Code> or{' '}
              <Code>/bin/zsh -l</Code>. Empty = auto-detect. Applies to tabs opened from now on.
            </>
          }
          value={terminal?.integratedShell ?? ''}
          onCommit={(v) => patch({ integratedShell: v.trim() || undefined })}
          placeholder={
            navigator.userAgent.includes('Windows') ? 'Auto (pwsh -NoLogo, falls back to powershell)' : 'Auto ($SHELL)'
          }
          disabled={off}
        />
        <SwitchField
          k="shellIntegration"
          id="shell-integration"
          label="Shell integration"
          hint={
            <>
              <Code>cortx init</Code> makes the shell report its directory, running command and exit codes (OSC 7 / OSC
              133), inside CortX terminals only. Tab titles, blocks, suggestions and the command history depend on it.
            </>
          }
          checked={terminal?.shellIntegration ?? true}
          onChange={(v) => patch({ shellIntegration: v })}
          disabled={off}
        />
      </Group>

      <Group group="sessions">
        <SwitchField
          k="restoreSessions"
          id="restore-sessions"
          label="Restore sessions on start"
          hint="Your tabs come back where you left them when the Terminal window opens: shells in their last directory, nothing re-run."
          checked={restoreSessions}
          onChange={(v) => patch({ restoreSessions: v })}
          disabled={off}
        />
        <SwitchField
          k="restoreScrollback"
          id="restore-scrollback"
          label="Restore scrollback"
          hint="Seed each restored shell with the end of its previous output."
          checked={restoreScrollback}
          onChange={(v) => patch({ restoreScrollback: v })}
          disabled={off || !restoreSessions}
          indent
        />
        <NumberField
          k="restoreScrollbackLines"
          id="restore-scrollback-lines"
          label="Lines replayed on start"
          hint="A one-off seed, not the size of the live buffer (that is Scrollback, under History)."
          value={terminal?.restoreScrollbackLines ?? 200}
          min={20}
          max={2000}
          onCommit={(v) => patch({ restoreScrollbackLines: v ?? 200 })}
          disabled={off || !restoreSessions || !restoreScrollback}
          indent
        />
        <SwitchField
          k="confirmCloseRunning"
          id="confirm-close-running"
          label="Ask before closing a busy terminal"
          hint="Closing a tab, a pane or CortX while a command runs asks first and names what would be killed. A terminal at its prompt closes straight away."
          checked={terminal?.confirmCloseRunning ?? true}
          onChange={(v) => patch({ confirmCloseRunning: v })}
          disabled={off}
        />
      </Group>

      <Group group="targets">
        <SelectField<TerminalTargetSurface>
          k="openProcessesIn"
          id="open-processes-in"
          label="Services and scripts open in"
          hint="Where a service or a script started from the app shows up."
          value={terminal?.openProcessesIn ?? 'dock'}
          options={[
            { value: 'dock', label: 'Dock (main window)' },
            { value: 'window', label: 'Terminal window' },
          ]}
          onChange={(v) => patch({ openProcessesIn: v })}
          disabled={off}
        />
        <SelectField<TerminalTargetSurface>
          k="openDevSessionsIn"
          id="open-dev-sessions-in"
          label="Dev sessions open in"
          hint="Launch configurations. One can still pick its own target."
          value={terminal?.openDevSessionsIn ?? 'window'}
          options={[
            { value: 'window', label: 'Terminal window' },
            { value: 'dock', label: 'Dock (main window)' },
          ]}
          onChange={(v) => patch({ openDevSessionsIn: v })}
          disabled={off}
        />
      </Group>
    </>
  );
}

// ===========================================================================
// Text
// ===========================================================================

/** Why a font the user typed did not resolve, per platform (issues 34, 49). */
function FontMissing() {
  const platform = getPlatform();
  return (
    <div className="mt-2 space-y-1 text-xs">
      <p className="text-destructive">The terminal cannot use this font, so it falls back to the default stack.</p>
      {/* Issue 49: on macOS the usual cause is not a typo. A WKWebView does
          not see `~/Library/Fonts`, which is where Font Book installs by
          default, so a font you can pick in every other app is invisible here. */}
      {platform === 'macos' && (
        <p className="text-muted-foreground">
          Check the spelling, then where it is installed: the terminal cannot see fonts installed for your user only (
          <Code>~/Library/Fonts</Code>, Font Book&apos;s default). Reinstall it with <em>Install for: All Users</em>.
          Apple&apos;s <Code>SF Mono</Code> is not offered under that name: leave the field empty to get it.
        </p>
      )}
      {platform === 'linux' && (
        <p className="text-muted-foreground">
          Check the spelling, then where it is installed: a font in <Code>~/.local/share/fonts</Code> may not be
          visible; put it in <Code>/usr/local/share/fonts</Code> and run <Code>fc-cache -f</Code>.
        </p>
      )}
      {platform === 'windows' && (
        <p className="text-muted-foreground">
          Check the spelling: it is the <em>family</em> name the font&apos;s preview window shows, not the file name. A
          font installed for the current user only may need reinstalling for all users.
        </p>
      )}
    </div>
  );
}

export function TerminalTextPage() {
  const { terminal, patch } = useTerminalSettings();
  const off = !terminal;
  const platform = getPlatform();
  const renderer = terminal?.renderer ?? 'canvas';
  const fontFamily = terminal?.fontFamily ?? '';
  // Mirrors `defaultLineHeight` in `lib/terminalSessions.ts`: with no value
  // stored, the browser renderer runs at 1.0 so powerline separators stay
  // joined (ticket #39).
  const defaultLineHeight = renderer === 'dom' ? 1 : 1.2;
  // Issue 34: a family CSS cannot resolve falls back to the default stack in
  // silence — `Hack NF` is a real family on Windows and on no Mac at all.
  const fontMissing = useMemo(() => fontFamily.trim() !== '' && !fontFamilyResolves(fontFamily), [fontFamily]);

  return (
    <>
      <Group group="text">
        <TextField
          k="fontFamily"
          id="terminal-font"
          label="Font"
          wide
          hint={
            <>
              Any installed monospace font, e.g. <Code>{TERMINAL_FONT_SUGGESTIONS[platform][0]}</Code> or{' '}
              <Code>{TERMINAL_FONT_SUGGESTIONS[platform][1]}</Code>. With a Nerd Font, pick its{' '}
              <Code>… Nerd Font Mono</Code> build: its added glyphs are one cell wide instead of two.
            </>
          }
          value={fontFamily}
          onCommit={(v) => patch({ fontFamily: v.trim() || undefined })}
          placeholder="Default monospace stack"
          list="terminal-font-suggestions"
          disabled={off}
        >
          <datalist id="terminal-font-suggestions">
            {TERMINAL_FONT_SUGGESTIONS[platform].map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {fontMissing && <FontMissing />}
        </TextField>
        <NumberField
          k="fontSize"
          id="terminal-font-size"
          label="Size"
          value={terminal?.fontSize ?? DEFAULT_FONT_SIZE}
          min={8}
          max={32}
          unit="px"
          onCommit={(v) => patch({ fontSize: v ?? DEFAULT_FONT_SIZE })}
          disabled={off}
        />
        <NumberField
          k="lineHeight"
          id="terminal-line-height"
          label="Line height"
          hint={renderer === 'dom' ? '1.0 keeps powerline separators joined with the browser renderer.' : undefined}
          value={terminal?.lineHeight ?? defaultLineHeight}
          min={1}
          max={2}
          step={0.05}
          onCommit={(v) => patch({ lineHeight: v ?? defaultLineHeight })}
          disabled={off}
        />
        <NumberField
          k="fontWeight"
          id="terminal-font-weight"
          label="Text weight"
          hint="400 is regular, 300 lighter."
          value={terminal?.fontWeight ?? 400}
          min={100}
          max={900}
          step={100}
          onCommit={(v) => patch({ fontWeight: v ?? 400 })}
          disabled={off}
        />
        <NumberField
          k="fontWeightBold"
          id="terminal-font-weight-bold"
          label="Bold weight"
          hint="700 by default; 600 is calmer."
          value={terminal?.fontWeightBold ?? 700}
          min={100}
          max={900}
          step={100}
          onCommit={(v) => patch({ fontWeightBold: v ?? 700 })}
          disabled={off}
        />
        <NumberField
          k="letterSpacing"
          id="terminal-letter-spacing"
          label="Letter spacing"
          hint="Empty = automatic: compensates fonts whose advance is not a whole pixel."
          value={terminal?.letterSpacing}
          min={-2}
          max={6}
          step={0.5}
          unit="px"
          allowEmpty
          placeholder="Auto"
          onCommit={(v) => patch({ letterSpacing: v })}
          disabled={off}
        />
        <SwitchField
          k="ligatures"
          id="terminal-ligatures"
          label="Font ligatures"
          hint={
            <>
              Draws <Code>!=</Code>, <Code>=&gt;</Code> or <Code>-&gt;</Code> as one glyph, in fonts that have them
              (JetBrains Mono, Fira Code, Cascadia Code). Off by default: it inspects every rendered row.
            </>
          }
          checked={terminal?.ligatures ?? false}
          onChange={(v) => patch({ ligatures: v })}
          disabled={off}
        />
        <SelectField<'dom' | 'webgl' | 'canvas'>
          k="renderer"
          id="terminal-renderer"
          label="Renderer"
          hint="Canvas and GPU draw box and powerline characters themselves, so they always line up. The browser renderer can leave hairlines between cells."
          value={renderer}
          options={[
            { value: 'canvas', label: 'Canvas (default)' },
            { value: 'webgl', label: 'GPU' },
            { value: 'dom', label: 'Browser' },
          ]}
          onChange={(v) => patch({ renderer: v })}
          disabled={off}
        />
      </Group>

      {/* Issue 52: two xterm options that were sitting at their default —
          one that makes unreadable colours readable, one without which the
          terminal is silent to a screen reader. */}
      <Group group="accessibility">
        <SelectField<string>
          k="minimumContrastRatio"
          id="terminal-min-contrast"
          label="Minimum text contrast"
          hint="Raises text that falls below the ratio, against the background actually behind it. Off keeps the theme's colours exactly."
          value={String(terminal?.minimumContrastRatio ?? DEFAULT_MINIMUM_CONTRAST)}
          options={[
            { value: '1', label: 'Off (default)' },
            { value: '3', label: '3:1, large text' },
            { value: '4.5', label: '4.5:1, WCAG AA' },
            { value: '7', label: '7:1, WCAG AAA' },
            { value: '21', label: 'Maximum' },
          ]}
          onChange={(v) => patch({ minimumContrastRatio: Number(v) })}
          disabled={off}
        />
        <SwitchField
          k="screenReaderMode"
          id="terminal-screen-reader"
          label="Screen reader support"
          hint="Mirrors the rows into the page so VoiceOver, NVDA and Narrator can read them. Off by default: the mirror is kept up to date on every render."
          checked={terminal?.screenReaderMode ?? false}
          onChange={(v) => patch({ screenReaderMode: v })}
          disabled={off}
        />
      </Group>
    </>
  );
}

// ===========================================================================
// Blocks
// ===========================================================================

type BlockMode = 'off' | 'overlay' | 'layout';

const BLOCK_MODE_HINT: Record<BlockMode, string> = {
  off: 'Commands and their output stay plain scrollback.',
  overlay:
    'Drawn over the terminal grid, so no line moves. Hover a block for its actions; Ctrl+↑ / Ctrl+↓ jump between prompts.',
  layout:
    'Like Warp: every finished command becomes a block of text in the page, with real spacing, folds and native selection. A full-screen program still gets the whole pane.',
};

export function TerminalBlocksPage() {
  const { terminal, patch } = useTerminalSettings();
  const shellIntegration = terminal?.shellIntegration ?? true;
  // `blocks` (on / off) and `blockLayout` (how) are one choice on screen:
  // "Block layout" was a select that only meant anything with blocks on.
  const mode: BlockMode = !(terminal?.blocks ?? true) ? 'off' : terminal?.blockLayout === 'blocks' ? 'layout' : 'overlay';
  const off = !terminal || !shellIntegration || mode === 'off';
  const overlayOnly = off || mode !== 'overlay';
  const overlayHint = mode === 'layout' ? ' Overlay mode only.' : '';

  return (
    <Group group="blocks">
      <SelectField<BlockMode>
        k={['blocks', 'blockLayout']}
        id="terminal-block-mode"
        label="Command blocks"
        hint={shellIntegration ? BLOCK_MODE_HINT[mode] : SHELL_INTEGRATION_NEEDED}
        value={mode}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'overlay', label: 'Overlay (default)' },
          { value: 'layout', label: 'Block layout' },
        ]}
        onChange={(v) =>
          patch(v === 'off' ? { blocks: false } : { blocks: true, blockLayout: v === 'layout' ? 'blocks' : 'classic' })
        }
        disabled={!terminal || !shellIntegration}
      />
      <SelectField<TerminalBlockSpacing>
        k="blockSpacing"
        id="terminal-block-spacing"
        label="Block spacing"
        hint="Air between two blocks. Applies to terminals opened from now on: the shell integration adds it."
        value={terminal?.blockSpacing ?? 'comfortable'}
        options={[
          { value: 'comfortable', label: 'Comfortable (default)' },
          { value: 'normal', label: 'Normal' },
          { value: 'compact', label: 'Compact' },
        ]}
        onChange={(v) => patch({ blockSpacing: v })}
        disabled={off}
        indent
      />
      <SwitchField
        k="blockDividers"
        id="terminal-block-dividers"
        label="Block dividers"
        hint="A faint rule across the pane at the top of every block."
        checked={terminal?.blockDividers ?? true}
        onChange={(v) => patch({ blockDividers: v })}
        disabled={off}
        indent
      />
      <SwitchField
        k="blockActions"
        id="terminal-block-actions"
        label="Block actions on hover"
        hint="A small toolbar on the block under the pointer: copy the command or the output, run it again, fold it, and more."
        checked={terminal?.blockActions ?? true}
        onChange={(v) => patch({ blockActions: v })}
        disabled={off}
        indent
      />
      <SwitchField
        k="blockFailedWash"
        id="terminal-block-failed-wash"
        label="Tint failed blocks"
        hint="A light wash of the theme's own red behind a block whose command failed."
        checked={terminal?.blockFailedWash ?? true}
        onChange={(v) => patch({ blockFailedWash: v })}
        disabled={off}
        indent
      />
      <SwitchField
        k="blockStickyHeader"
        id="terminal-block-sticky-header"
        label="Pin the command while scrolling"
        hint="Once a command has scrolled off the top, it stays pinned there; click it to go back to it."
        checked={terminal?.blockStickyHeader ?? true}
        onChange={(v) => patch({ blockStickyHeader: v })}
        disabled={off}
        indent
      />
      <SwitchField
        k="blockGutter"
        id="terminal-block-gutter"
        label="Block gutter"
        hint={`A thin bar in the left padding, green or red by exit code: click to select the block, double-click to fold it.${overlayHint}`}
        checked={terminal?.blockGutter ?? true}
        onChange={(v) => patch({ blockGutter: v })}
        disabled={overlayOnly}
        indent
      />
      <SwitchField
        k="blockCards"
        id="terminal-block-cards"
        label="Block cards"
        hint={`A plate behind each block. Terminal window only: the dock's canvas is opaque.${overlayHint}`}
        checked={terminal?.blockCards ?? true}
        onChange={(v) => patch({ blockCards: v })}
        disabled={overlayOnly}
        indent
      />
      <SwitchField
        k="blockJumpToBottom"
        id="terminal-block-jump-to-bottom"
        label="Jump to the end of a block"
        hint={`A button on a block whose output runs past the bottom of the pane.${overlayHint}`}
        checked={terminal?.blockJumpToBottom ?? true}
        onChange={(v) => patch({ blockJumpToBottom: v })}
        disabled={overlayOnly}
        indent
      />
    </Group>
  );
}

// ===========================================================================
// Input & completion
// ===========================================================================

export function TerminalInputPage() {
  const { terminal, patch } = useTerminalSettings();
  const shellIntegration = terminal?.shellIntegration ?? true;
  const suggestions = terminal?.inlineSuggestions ?? true;
  const noSuggestions = !terminal || !suggestions;
  const inputEditor = terminal?.inputEditor ?? false;

  return (
    <>
      <Group group="completion">
        <SwitchField
          k="inlineSuggestions"
          id="inline-suggestions"
          label="Inline suggestions"
          hint={
            shellIntegration
              ? "Ghost text from your command history while you type; → accepts it. PowerShell's own prediction is turned off inside CortX."
              : SHELL_INTEGRATION_NEEDED
          }
          checked={suggestions}
          onChange={(v) => patch({ inlineSuggestions: v })}
          disabled={!terminal || !shellIntegration}
        />
        <SwitchField
          k="suggestionsFromOutput"
          id="suggestions-from-output"
          label="Suggest from the last output"
          hint="When a program spells out what to run next (a resume command, the git push that sets an upstream), offer it."
          checked={terminal?.suggestionsFromOutput ?? true}
          onChange={(v) => patch({ suggestionsFromOutput: v })}
          disabled={noSuggestions}
          indent
        />
        <SelectField<SuggestionConfidence>
          k="suggestionConfidence"
          id="suggestion-confidence"
          label="Suggest only when sure"
          hint="How certain a guess must be before any ghost text is drawn."
          value={terminal?.suggestionConfidence ?? 'balanced'}
          options={[
            { value: 'strict', label: 'Only when certain' },
            { value: 'balanced', label: 'Balanced (default)' },
            { value: 'loose', label: 'Guess more often' },
          ]}
          onChange={(v) => patch({ suggestionConfidence: v })}
          disabled={noSuggestions}
          indent
        />
        <SelectField<CompletionMenuKey>
          k="completionMenu"
          id="completion-menu"
          label="Completion menu"
          hint="Subcommands, flags, git branches and npm scripts. Ctrl+Space by default, since Tab already reaches your shell's own completion."
          value={terminal?.completionMenu ?? 'ctrlSpace'}
          options={[
            { value: 'ctrlSpace', label: 'Ctrl+Space (default)' },
            { value: 'tab', label: 'Tab' },
            { value: 'off', label: 'Off' },
          ]}
          onChange={(v) => patch({ completionMenu: v })}
          disabled={noSuggestions}
          indent
        />
        <SwitchField
          k="completionSpecs"
          id="completion-specs"
          label="Learn a command's flags"
          hint="Runs a program's own --help once, in the background. Only for a program on your PATH, and never one that reads input (ssh, sudo, python…)."
          checked={terminal?.completionSpecs ?? true}
          onChange={(v) => patch({ completionSpecs: v })}
          disabled={noSuggestions}
          indent
        />
        <SwitchField
          k="completionContext"
          id="completion-context"
          label="Complete from the directory"
          hint="Git branches, package.json scripts and file paths, read from the terminal's working directory."
          checked={terminal?.completionContext ?? true}
          onChange={(v) => patch({ completionContext: v })}
          disabled={noSuggestions}
          indent
        />
      </Group>

      <Group group="inputLine">
        <SelectField<TerminalInputPosition>
          k="inputPosition"
          id="input-position"
          label="Input line position"
          hint="Pinned to the bottom keeps the line you type against the bottom edge, like Warp. The terminal itself is not resized."
          value={terminal?.inputPosition ?? DEFAULT_INPUT_POSITION}
          options={[
            { value: 'bottom', label: 'Pinned to the bottom (default)' },
            { value: 'flow', label: 'Follow the output' },
          ]}
          onChange={(v) => patch({ inputPosition: v })}
          disabled={!terminal}
        />
        <SwitchField
          k="inputEditor"
          id="input-editor"
          label={
            <>
              Universal input editor <BetaBadge />
            </>
          }
          hint={
            shellIntegration ? (
              <>
                Type commands in a CortX editor instead of the shell&apos;s own: accents and dead keys behave, a
                multi-line paste never runs by accident. Only at a prompt the shell announced, so <Code>ssh</Code> or a
                REPL keep today&apos;s behaviour.
              </>
            ) : (
              SHELL_INTEGRATION_NEEDED
            )
          }
          checked={inputEditor}
          onChange={(v) => patch({ inputEditor: v })}
          disabled={!terminal || !shellIntegration}
        />
        <SwitchField
          k="inputEditorHandoff"
          id="input-editor-handoff"
          label="Hand unknown keys back to the shell"
          hint="Tab, Ctrl+R, ↑ and ↓ pass what you typed to the shell and let it take the key, so its own completion and search still work."
          checked={terminal?.inputEditorHandoff ?? true}
          onChange={(v) => patch({ inputEditorHandoff: v })}
          disabled={!terminal || !inputEditor}
          indent
        />
      </Group>
    </>
  );
}

// ===========================================================================
// Keyboard & mouse
// ===========================================================================

export function TerminalKeyboardPage() {
  const { terminal, patch } = useTerminalSettings();
  const off = !terminal;
  const platform = getPlatform();

  return (
    <>
      <Group group="keys">
        <SelectField<ShiftEnterKey>
          k="shiftEnter"
          id="terminal-shift-enter"
          label="Shift+Enter sends"
          hint="A plain terminal sends the same key for both. ESC + Enter is what Claude Code's /terminal-setup binds, and a new line in zsh and fish."
          value={terminal?.shiftEnter ?? DEFAULT_SHIFT_ENTER}
          options={[
            { value: 'escape-enter', label: 'A new line (ESC + Enter)' },
            { value: 'enter', label: 'The same as Enter' },
          ]}
          onChange={(v) => patch({ shiftEnter: v })}
          disabled={off}
        />
        {platform === 'macos' && (
          <SelectField<MacOptionAsMeta>
            k="macOptionAsMeta"
            id="mac-option-as-meta"
            label="⌥ as the Meta key"
            hint="Meta is Alt+B / Alt+F (word by word) in bash and zsh. The default takes only ⌥B ⌥F ⌥D ⌥V ⌥⌫, so [ ] { } | @ stay typable on French, Swiss and AZERTY keyboards."
            value={terminal?.macOptionAsMeta ?? DEFAULT_MAC_OPTION_AS_META}
            options={[
              { value: 'wordKeys', label: 'Word keys only (default)' },
              { value: 'never', label: 'Never' },
              { value: 'always', label: 'Always' },
            ]}
            onChange={(v) => patch({ macOptionAsMeta: v })}
            disabled={off}
          />
        )}
        <SelectField<TerminalCtrlTabBehavior>
          k="ctrlTabBehavior"
          id="ctrl-tab-behavior"
          label="Ctrl+Tab goes to"
          hint="Recently used works like Alt+Tab: keep Ctrl held and each Tab walks one tab further back."
          value={terminal?.ctrlTabBehavior ?? 'sequential'}
          options={[
            { value: 'sequential', label: 'Next tab' },
            { value: 'recentlyUsed', label: 'Recently used' },
          ]}
          onChange={(v) => patch({ ctrlTabBehavior: v })}
          disabled={off}
        />
      </Group>

      <Group group="mouse">
        <SwitchField
          k="copyOnSelect"
          id="terminal-copy-on-select"
          label="Copy on select"
          hint="A mouse selection is copied straight away, like Warp. Ctrl+C then keeps interrupting the program; Ctrl+Shift+C copies."
          checked={terminal?.copyOnSelect ?? true}
          onChange={(v) => patch({ copyOnSelect: v })}
          disabled={off}
        />
        <SwitchField
          k="smoothScrollDuration"
          id="smooth-scroll"
          label="Smooth scrolling"
          hint="The wheel glides instead of jumping a line at a time. Typing still snaps to the bottom at once."
          checked={(terminal?.smoothScrollDuration ?? DEFAULT_SMOOTH_SCROLL_DURATION) > 0}
          onChange={(v) => patch({ smoothScrollDuration: v ? DEFAULT_SMOOTH_SCROLL_DURATION : 0 })}
          disabled={off}
        />
        <SwitchField
          k="filePathLinks"
          id="file-path-links"
          label="Clickable file paths"
          hint="Paths in the output that exist on disk open in your editor at the line the compiler pointed at. Alt- or Shift-click reveals the folder."
          checked={terminal?.filePathLinks ?? true}
          onChange={(v) => patch({ filePathLinks: v })}
          disabled={off}
        />
        <SwitchField
          k="linkTooltip"
          id="link-tooltip"
          label="Show a link's target on hover"
          hint="A tooltip with the URL or the file path under the pointer."
          checked={terminal?.linkTooltip ?? true}
          onChange={(v) => patch({ linkTooltip: v })}
          disabled={off}
        />
      </Group>

      <Group group="programs">
        <SelectField<TerminalOsc52Access>
          k="osc52"
          id="terminal-osc52"
          label="Clipboard access (OSC 52)"
          hint="Anything that writes to the terminal can send this sequence: a program behind ssh, a file you cat. Reading hands it whatever you last copied. Write only is enough for tmux and neovim."
          value={terminal?.osc52 ?? 'deny'}
          options={[
            { value: 'deny', label: 'Denied (default)' },
            { value: 'writeOnly', label: 'Write only' },
            { value: 'readWrite', label: 'Read and write' },
          ]}
          onChange={(v) => patch({ osc52: v })}
          disabled={off}
        />
        <SwitchField
          k="kittyGraphics"
          id="kitty-graphics"
          label="Kitty graphics"
          hint="A third inline-image protocol, on top of Sixel and iTerm2. Turn it off only if a program draws garbage instead of a picture."
          checked={terminal?.kittyGraphics ?? true}
          onChange={(v) => patch({ kittyGraphics: v })}
          disabled={off}
        />
      </Group>
    </>
  );
}

// ===========================================================================
// Tabs
// ===========================================================================

/** The parts of a tab that can be switched off, in the order they are drawn. */
const TAB_DISPLAY_TOGGLES = [
  { key: 'cwd', label: 'Directory', hint: 'Second line: the directory the shell is in.' },
  { key: 'command', label: 'Running command', hint: 'Replaces the directory while a command runs.' },
  { key: 'status', label: 'Status', hint: 'The spinner, the finished pill and the runtime dot.' },
  { key: 'agent', label: 'Agent', hint: 'A detected Claude Code or Codex session: its icon, title and state.' },
  {
    key: 'agentActivity',
    label: 'Agent activity',
    hint: 'Second line of an agent tab: needs you, the tool it runs, your last prompt.',
  },
  {
    key: 'colorBar',
    label: 'Colour bar',
    hint: 'The tab colour as a bar down the left edge. Sessions rail only; the tint already carries the colour.',
  },
] as const;

export function TerminalTabsPage() {
  const { terminal, patch } = useTerminalSettings();
  const off = !terminal;
  const tabDisplay = resolveTabDisplay(terminal?.tabDisplay);

  return (
    <>
      <Group group="tabs">
        <SelectField<'sidebar' | 'top'>
          k="tabsPlacement"
          id="tabs-placement"
          label="Terminal window tabs"
          hint="Where the list of terminals lives in the Terminal window."
          value={terminal?.tabsPlacement ?? 'sidebar'}
          options={[
            { value: 'sidebar', label: 'Sessions rail (left)' },
            { value: 'top', label: 'Tab strip (top)' },
          ]}
          onChange={(v) => patch({ tabsPlacement: v })}
          disabled={off}
        />
        <SwitchField
          k="followProjectOnCd"
          id="follow-project-on-cd"
          label="Tabs follow the working directory"
          hint="cd into another project's folder and the tab moves to that project's group. A tab you placed yourself stays put."
          checked={terminal?.followProjectOnCd ?? true}
          onChange={(v) => patch({ followProjectOnCd: v })}
          disabled={off}
        />
      </Group>

      {/* `tabDisplay` is one object in the file, but it is six decisions on
          screen, so `terminalDefaults.ts` addresses each sub-field as a
          setting of its own, with its own marker and reset. */}
      <Group group="tabContents">
        {TAB_DISPLAY_TOGGLES.map(({ key, label, hint }) => (
          <SwitchField
            key={key}
            k={`tabDisplay.${key}`}
            id={`tab-display-${key}`}
            label={label}
            hint={hint}
            checked={tabDisplay[key]}
            onChange={(v) => patch({ tabDisplay: { ...tabDisplay, [key]: v } })}
            disabled={off}
          />
        ))}
        <SelectField<TabIndexDisplay>
          k="tabDisplay.index"
          id="tab-display-index"
          label="Tab number"
          hint="The number Ctrl+N jumps to."
          value={tabDisplay.index}
          options={[
            { value: 'never', label: 'Never' },
            { value: 'ctrl', label: 'While Ctrl is held' },
            { value: 'always', label: 'Always' },
          ]}
          onChange={(v) => patch({ tabDisplay: { ...tabDisplay, index: v } })}
          disabled={off}
        />
      </Group>
    </>
  );
}

// ===========================================================================
// History
// ===========================================================================

/** `1 line` / `12 lines`, because the report is read as a sentence. */
function lines(n: number): string {
  return `${n.toLocaleString('en-US')} line${n === 1 ? '' : 's'}`;
}

/**
 * The one-off pass of the secret filter over the history **already on disk**
 * (ticket #41). A button, not a consequence of the toggle above it: switching
 * masking on must not silently rewrite a file. The rewrite cannot be undone,
 * so it asks first and says no backup is kept (a `.bak` with the secrets in it
 * would defeat the exercise), and the report stays shown afterwards — it is
 * the answer to "did that do anything?".
 */
function RedactExistingHistory() {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<RedactionReport | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      const result = await redactCommandHistory();
      setReport(result);
      toast.success(
        result.redacted > 0
          ? `${lines(result.redacted)} masked, out of ${lines(result.scanned)} examined`
          : `${lines(result.scanned)} examined — nothing in them looked like a secret`
      );
    } catch (error) {
      setReport(null);
      toast.error('Could not mask the existing history', { description: String(error) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <SettingRow
      label="Mask secrets already in the history"
      hint={
        report ? (
          <span role="status">
            {lines(report.scanned)} examined, {report.redacted.toLocaleString('en-US')} masked
            {report.skipped > 0 && <>, {lines(report.skipped)} kept as they were (not readable as records)</>}.
          </span>
        ) : (
          'The switch above only covers new lines. Run the same filter once over the file as it is.'
        )
      }
      indent
    >
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={running}>
        <ShieldCheck />
        {running ? 'Masking…' : 'Mask now…'}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mask the secrets already in the command history?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  CortX reads <Code>command-history.jsonl</Code> and its <Code>.jsonl.1</Code> archive, replaces
                  anything that looks like a token, a password or an API key with bullets, and writes the files back in
                  place. Lines with nothing to hide are kept byte for byte, and the history stays searchable.
                </p>
                <p className="text-foreground">
                  This cannot be undone, and no backup is kept — a copy still holding the secrets would defeat the
                  point. The original command lines are gone for good.
                </p>
                <p>Nothing else is touched: your settings, your open terminals and what is on their screens.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run()}>Mask them</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingRow>
  );
}

export function TerminalHistoryPage() {
  const { terminal, patch } = useTerminalSettings();
  const off = !terminal;
  const scrollbackLines = terminal?.scrollbackLines ?? DEFAULT_SCROLLBACK_LINES;

  return (
    <>
      <Group group="scrollback">
        <NumberField
          k="scrollbackLines"
          id="terminal-scrollback-lines"
          label="Lines kept per terminal"
          hint="Paid per terminal: twenty tabs hold twenty buffers. It is also how far back the blocks reach: one trimmed off the top can no longer be navigated or folded. Lowering it trims the open terminals at once."
          value={scrollbackLines}
          min={MIN_SCROLLBACK_LINES}
          max={MAX_SCROLLBACK_LINES}
          step={1000}
          onCommit={(v) => patch({ scrollbackLines: v ?? DEFAULT_SCROLLBACK_LINES })}
          disabled={off}
        />
        {scrollbackLines > SCROLLBACK_WARN_LINES && (
          <SectionNote tone="warning">
            Above {SCROLLBACK_WARN_LINES.toLocaleString('en-US')} lines the memory starts to show: every cell of every
            row is held, in every open terminal at once.
          </SectionNote>
        )}
      </Group>

      <Group group="history">
        <NumberField
          k="historyMaxMb"
          id="history-max-mb"
          label="Size cap"
          hint="Past it, the file is rewritten keeping its most recent half. At about 250 bytes a command, 10 MB is some 40 000 of them."
          value={terminal?.historyMaxMb ?? DEFAULT_HISTORY_MAX_MB}
          min={1}
          max={200}
          step={5}
          unit="MB"
          onCommit={(v) => patch({ historyMaxMb: v ?? DEFAULT_HISTORY_MAX_MB })}
          disabled={off}
        />
        <SwitchField
          k="redactSecrets"
          id="terminal-redact-secrets"
          label="Mask secrets"
          hint="Before a command reaches the file, replace what looks like a token, a password or an API key with bullets. The screen is never touched."
          checked={terminal?.redactSecrets ?? true}
          onChange={(v) => patch({ redactSecrets: v })}
          disabled={off}
        />
        <RedactExistingHistory />
      </Group>
    </>
  );
}
