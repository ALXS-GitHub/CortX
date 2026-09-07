/**
 * The integrated terminal's behaviour and text rendering. Extracted verbatim
 * from `views/Settings.tsx` (DEV-13 #8) and rebound to the app store, so the
 * Settings page and the Terminal window's own panel edit the very same
 * `settings.terminal` — one source of truth, no mirror state.
 *
 * Notifications used to live here; they now have their own card
 * (`TerminalNotificationsSection`).
 *
 * The controls are grouped under headings (`Group`) rather than stacked in
 * the order they were written — thirty-odd of them in one card is otherwise
 * unreadable, and the block settings end up sitting among the completion
 * settings (ticket #26, first pass). Only the order changed; every control is
 * the one that was here before.
 */
import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Code, Field, Section, ToggleField } from '@/components/settings/SettingsPrimitives';
import { Group, NumberField, TextField } from './controls';
import { useTerminalSettings } from './useTerminalSettings';
import { getPlatform, TERMINAL_FONT_SUGGESTIONS } from './meta';
import { DEFAULT_MAC_OPTION_AS_META, DEFAULT_SMOOTH_SCROLL_DURATION } from '@/lib/terminalKeys';
import { fontFamilyResolves } from '@/lib/terminalSessions';
import { resolveTabDisplay } from '@/components/terminal/model';
import type {
  MacOptionAsMeta,
  SuggestionConfidence,
  TabIndexDisplay,
  CompletionMenuKey,
  TerminalBlockSpacing,
  TerminalInputPosition,
  TerminalTargetSurface,
} from '@/types';

/** The parts of a tab that can be switched off, in the order they are drawn. */
const TAB_DISPLAY_TOGGLES = [
  { key: 'cwd', label: 'Directory', hint: 'Second line: the directory the shell is in.' },
  { key: 'command', label: 'Running command', hint: 'Replaces the directory while a command runs.' },
  { key: 'status', label: 'Status', hint: 'The spinner, the finished pill and the runtime dot.' },
  { key: 'agent', label: 'Agent', hint: 'A detected Claude Code / Codex session: its icon, its title, its own state.' },
] as const;

export function IntegratedTerminalSection() {
  const { terminal, patch } = useTerminalSettings();

  const shellIntegration = terminal?.shellIntegration ?? true;
  const renderer = terminal?.renderer ?? 'canvas';
  const restoreSessions = terminal?.restoreSessions ?? true;
  const restoreScrollback = terminal?.restoreScrollback ?? true;
  const selectionColor = terminal?.selectionColor ?? '';
  const blocks = terminal?.blocks ?? true;
  const suggestions = terminal?.inlineSuggestions ?? true;
  const tabDisplay = resolveTabDisplay(terminal?.tabDisplay);
  const platform = getPlatform();

  // Issue 34: a family CSS cannot resolve falls back to the default stack in
  // silence — `Hack NF` is a real family on Windows and on no Mac at all.
  const fontFamily = terminal?.fontFamily ?? '';
  const fontMissing = useMemo(() => fontFamily.trim() !== '' && !fontFamilyResolves(fontFamily), [fontFamily]);

  return (
    <Section
      title="Integrated terminal"
      description='The terminal panel runs every service, script and shell tab in a real PTY. Configure the shell used by the "New terminal" button.'
    >
      <Group title="Shell">
        <TextField
          id="integrated-shell"
          label="Shell"
          hint={
            <>
              Command line of the shell to launch, e.g. <Code>pwsh -NoLogo</Code>, <Code>nu</Code> or{' '}
              <Code>/bin/zsh -l</Code>. Leave empty to auto-detect. Applies to newly opened tabs.
            </>
          }
          value={terminal?.integratedShell ?? ''}
          onCommit={(v) => patch({ integratedShell: v.trim() || undefined })}
          placeholder={
            navigator.userAgent.includes('Windows') ? 'Auto (pwsh -NoLogo, falls back to powershell)' : 'Auto ($SHELL)'
          }
          disabled={!terminal}
        />

        <ToggleField
          id="shell-integration"
          label="Shell integration"
          hint={
            <>
              <Code>cortx init</Code> makes the shell report its directory, running command and exit codes (OSC 7 / OSC
              133) — only inside CortX terminals. Powers the live tab titles, the running spinner and the command
              history.
            </>
          }
        >
          <Switch
            id="shell-integration"
            checked={shellIntegration}
            onCheckedChange={(v) => patch({ shellIntegration: v })}
            disabled={!terminal}
          />
        </ToggleField>
      </Group>

      <Group title="Text">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
          <TextField
            id="terminal-font"
            label="Font"
            hint={
              <>
                Any installed monospace font, e.g. <Code>{TERMINAL_FONT_SUGGESTIONS[platform][0]}</Code> or{' '}
                <Code>{TERMINAL_FONT_SUGGESTIONS[platform][1]}</Code>. A Nerd Font renders the prompt glyphs — pick its{' '}
                <Code>… Nerd Font Mono</Code> build, whose added glyphs are one cell wide instead of two. Applies to
                every terminal, dock and window.
              </>
            }
            value={fontFamily}
            onCommit={(v) => patch({ fontFamily: v.trim() || undefined })}
            placeholder="Default monospace stack"
            list="terminal-font-suggestions"
            disabled={!terminal}
          >
            <datalist id="terminal-font-suggestions">
              {TERMINAL_FONT_SUGGESTIONS[platform].map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {fontMissing && (
              <p className="text-xs text-destructive">
                This font is not installed — falling back to the default stack.
              </p>
            )}
          </TextField>
          <NumberField
            id="terminal-font-size"
            label="Size"
            value={terminal?.fontSize ?? 12}
            min={8}
            max={32}
            onCommit={(v) => patch({ fontSize: v ?? 12 })}
            className="w-24"
            disabled={!terminal}
          />
          <NumberField
            id="terminal-line-height"
            label="Line height"
            hint={renderer === 'dom' ? '1.0 keeps powerline separators joined with this renderer.' : undefined}
            value={terminal?.lineHeight ?? 1.2}
            min={1}
            max={2}
            step={0.05}
            onCommit={(v) => patch({ lineHeight: v ?? 1.2 })}
            className="w-24"
            disabled={!terminal}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <NumberField
            id="terminal-font-weight"
            label="Text weight"
            hint="400 is regular, 300 lighter."
            value={terminal?.fontWeight ?? 400}
            min={100}
            max={900}
            step={100}
            onCommit={(v) => patch({ fontWeight: v ?? 400 })}
            className="w-24"
            disabled={!terminal}
          />
          <NumberField
            id="terminal-font-weight-bold"
            label="Bold weight"
            hint="700 by default; 600 is calmer."
            value={terminal?.fontWeightBold ?? 700}
            min={100}
            max={900}
            step={100}
            onCommit={(v) => patch({ fontWeightBold: v ?? 700 })}
            className="w-24"
            disabled={!terminal}
          />
          <NumberField
            id="terminal-letter-spacing"
            label="Letter spacing"
            hint="px; empty = automatic (compensates fonts whose advance is not a whole pixel)."
            value={terminal?.letterSpacing}
            min={-2}
            max={6}
            step={0.5}
            allowEmpty
            placeholder="auto"
            onCommit={(v) => patch({ letterSpacing: v })}
            className="w-24"
            disabled={!terminal}
          />
          <Field
            label="Selection colour"
            htmlFor="terminal-selection-color"
            hint="Any CSS colour; empty = the theme's."
          >
            <div className="flex items-center gap-2">
              <Input
                id="terminal-selection-color"
                value={selectionColor}
                placeholder="theme"
                onChange={(e) => patch({ selectionColor: e.target.value.trim() || undefined })}
                className="w-32 font-mono text-[12px]"
                disabled={!terminal}
              />
              <span
                aria-hidden
                className="size-6 shrink-0 rounded-[var(--rad-xs)] border border-border"
                style={{ background: selectionColor.trim() || 'var(--terminal-selection, transparent)' }}
              />
            </div>
          </Field>
        </div>

        <Field
          label="Renderer"
          htmlFor="terminal-renderer"
          hint="GPU and Canvas both draw box, block and powerline characters themselves, so they always line up; Canvas rasterises the text through the platform engine, which keeps the letters finer. The browser renderer draws everything as text and can leave hairlines between cells."
        >
          <Select
            value={renderer}
            onValueChange={(v: 'dom' | 'webgl' | 'canvas') => patch({ renderer: v })}
            disabled={!terminal}
          >
            <SelectTrigger id="terminal-renderer" className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="webgl">GPU (fastest on heavy output)</SelectItem>
              <SelectItem value="canvas">Canvas (default: fine text, exact block glyphs)</SelectItem>
              <SelectItem value="dom">Browser (no acceleration)</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <ToggleField
          id="dock-terminal-theme"
          label="Colour the dock terminals with the terminal theme"
          hint="Off: the dock keeps the app skin's palette; the Terminal window always follows the terminal theme."
        >
          <Switch
            id="dock-terminal-theme"
            checked={terminal?.dockUsesTerminalTheme ?? false}
            onCheckedChange={(v) => patch({ dockUsesTerminalTheme: v })}
            disabled={!terminal}
          />
        </ToggleField>
      </Group>

      <Group title="Keyboard and input">
        {platform === 'macos' && (
          <Field
            label="⌥ as the Meta key"
            htmlFor="mac-option-as-meta"
            hint={
              <>
                Meta is what <Code>Alt+B</Code> / <Code>Alt+F</Code> (word by word) and <Code>Alt+⌫</Code> mean in bash
                and zsh. The default reserves only ⌥B, ⌥F, ⌥D, ⌥V and ⌥⌫, so <Code>[ ] {'{ }'} | @</Code> stay typable
                on French, Swiss and AZERTY keyboards, where they live on the ⌥ layer. <Code>Always</Code> gives every ⌥
                chord to the shell and takes that layer away, including the dead keys (⌥E, ⌥U, ⌥I, ⌥N) that put accents
                on letters.
              </>
            }
          >
            <Select
              value={terminal?.macOptionAsMeta ?? DEFAULT_MAC_OPTION_AS_META}
              onValueChange={(v: MacOptionAsMeta) => patch({ macOptionAsMeta: v })}
              disabled={!terminal}
            >
              <SelectTrigger id="mac-option-as-meta" className="w-[320px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="wordKeys">Word keys only — ⌥B ⌥F ⌥D ⌥V ⌥⌫ (default)</SelectItem>
                <SelectItem value="never">Never — macOS composes every ⌥ character</SelectItem>
                <SelectItem value="always">Always — every ⌥ chord is Meta</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}

        <Field
          label="Input line position"
          htmlFor="input-position"
          hint="Where the line you type sits in the pane. Pinned to the bottom keeps it against the bottom edge and stacks the output above it, like Warp; the terminal itself is not resized, so nothing under the PTY can tell the difference."
        >
          <Select
            value={terminal?.inputPosition ?? 'flow'}
            onValueChange={(v: TerminalInputPosition) => patch({ inputPosition: v })}
            disabled={!terminal}
          >
            <SelectTrigger id="input-position" className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flow">Follow the output (default)</SelectItem>
              <SelectItem value="bottom">Pinned to the bottom</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <ToggleField
          id="input-editor"
          label="Universal input editor (beta)"
          hint={
            <>
              Type the command into a CortX editor at the prompt instead of the shell&apos;s own line editor: accents and
              dead keys behave, a multi-line paste can never run by accident, and Ctrl+D stops being able to close the
              shell while you are writing. It only ever appears once the shell has announced its prompt (OSC 133), so{' '}
              <Code>ssh</Code>, a REPL, a full-screen program or a shell without <Code>cortx init</Code> keep today&apos;s
              behaviour exactly.
            </>
          }
        >
          <Switch
            id="input-editor"
            checked={terminal?.inputEditor ?? false}
            onCheckedChange={(v) => patch({ inputEditor: v })}
            disabled={!terminal || !shellIntegration}
          />
        </ToggleField>

        <ToggleField
          id="input-editor-handoff"
          label={<span className="text-xs text-muted-foreground">Hand unknown keys back to the shell</span>}
          hint="Tab, Ctrl+R, ↑ and ↓ write what you have typed to the shell without running it, close the editor and let the shell take the key — so PSReadLine completes and searches exactly as it does today. Off, those keys do nothing while the editor is open."
        >
          <Switch
            id="input-editor-handoff"
            checked={terminal?.inputEditorHandoff ?? true}
            onCheckedChange={(v) => patch({ inputEditorHandoff: v })}
            disabled={!terminal || !(terminal?.inputEditor ?? false)}
          />
        </ToggleField>
      </Group>

      <Group title="Command blocks">
        <ToggleField
          id="terminal-blocks"
          label="Command blocks"
          hint={
            <>
              Each command and its output become a block, from the same OSC 133 markers as the tab titles. A hairline
              separates one block from the next, hovering one shows its actions — copy the command, the output or both,
              run it again, fold it away — and <Code>Ctrl+↑</Code> / <Code>Ctrl+↓</Code> jump from one prompt to the
              previous or next one. It is drawn over the terminal, never in it — no line moves, and a shell without{' '}
              <Code>cortx init</Code> shows nothing at all.
            </>
          }
        >
          <Switch
            id="terminal-blocks"
            checked={blocks}
            onCheckedChange={(v) => patch({ blocks: v })}
            disabled={!terminal || !shellIntegration}
          />
        </ToggleField>

        <Field
          label={<span className="text-xs text-muted-foreground">Block spacing</span>}
          htmlFor="terminal-block-spacing"
          hint={
            <>
              Warp&apos;s <Code>appearance.spacing</Code>. <Code>Comfortable</Code> is the default because it is what
              Warp&apos;s own <Code>normal</Code> comes to: ~2.1 grid cells of air, which a grid can only express as two
              whole rows. The rows are asked of the shell integration — CortX draws its blocks over the terminal grid,
              where every row is exactly one row tall and no amount of CSS can push two of them apart — and the divider
              is then drawn through the middle of the gap. They are only ever added after a command actually ran, never
              before the first prompt of a session, and never when your own prompt already starts on a new line.{' '}
              <Code>Compact</Code> adds nothing. <strong>Applies to terminals opened from now on</strong>: the shell
              integration snippet is generated when a shell starts.
            </>
          }
        >
          <Select
            value={terminal?.blockSpacing ?? 'comfortable'}
            onValueChange={(v: TerminalBlockSpacing) => patch({ blockSpacing: v })}
            disabled={!terminal || !shellIntegration || !blocks}
          >
            <SelectTrigger id="terminal-block-spacing" className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="comfortable">Comfortable (two lines, like Warp — default)</SelectItem>
              <SelectItem value="normal">Normal (one line)</SelectItem>
              <SelectItem value="compact">Compact</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <ToggleField
          id="terminal-block-dividers"
          label={<span className="text-xs text-muted-foreground">Block dividers</span>}
          hint="The 1 px rule across the pane at the top of every block — what makes the blocks visible. It is deliberately faint and colourless, white on a dark palette and black on a light one, so it stays a boundary you sense rather than a line you read, even on a theme with a background image. The rules above and below the block under the pointer come up a little; the exit code is the colour of the gutter bar, not of the rule."
        >
          <Switch
            id="terminal-block-dividers"
            checked={terminal?.blockDividers ?? true}
            onCheckedChange={(v) => patch({ blockDividers: v })}
            disabled={!terminal || !shellIntegration || !blocks}
          />
        </ToggleField>

        <ToggleField
          id="terminal-block-actions"
          label={<span className="text-xs text-muted-foreground">Block actions on hover</span>}
          hint="A small toolbar near the top-right of the block under the pointer: copy the command, copy the output, copy both, run it again, fold the output, and ⋯ for the rest (copy as Markdown, put the command back at the prompt, select the block, scroll to its top or bottom). It prefers a row whose right-hand end is empty, so a right-hand prompt — a clock, a git status — is left alone; when there is no such row it is drawn on an opaque plate over that end of the prompt rather than not at all. The same menu is also a right-click on the gutter bar away."
        >
          <Switch
            id="terminal-block-actions"
            checked={terminal?.blockActions ?? true}
            onCheckedChange={(v) => patch({ blockActions: v })}
            disabled={!terminal || !shellIntegration || !blocks}
          />
        </ToggleField>

        <ToggleField
          id="terminal-block-gutter"
          label={<span className="text-xs text-muted-foreground">Block gutter</span>}
          hint="A thin bar in the pane's left padding for each block, green or red according to the exit code the shell reported. Click it to select the block, double-click to fold its output, right-click for the block menu. Off, the shortcuts and the menu still work."
        >
          <Switch
            id="terminal-block-gutter"
            checked={terminal?.blockGutter ?? true}
            onCheckedChange={(v) => patch({ blockGutter: v })}
            disabled={!terminal || !shellIntegration || !blocks}
          />
        </ToggleField>

        <ToggleField
          id="terminal-block-failed-wash"
          label={<span className="text-xs text-muted-foreground">Tint failed blocks</span>}
          hint="Tints a block whose command failed at 10 % of the theme's own red, and turns its gutter bar to full strength for the whole height of the block. The colour comes from the terminal palette, so an imported theme washes in its own red. The tint is weak enough that the text underneath keeps its colours; the pole is dropped when the block is selected, so the two markings never double up."
        >
          <Switch
            id="terminal-block-failed-wash"
            checked={terminal?.blockFailedWash ?? true}
            onCheckedChange={(v) => patch({ blockFailedWash: v })}
            disabled={!terminal || !shellIntegration || !blocks}
          />
        </ToggleField>
      </Group>

      <Group title="Suggestions and completion">
        <ToggleField
          id="inline-suggestions"
          label="Inline suggestions"
          hint="Ghost text from your command history while you type; → accepts it. Needs shell integration. PowerShell's own prediction is switched off inside CortX to avoid a double suggestion."
        >
          <Switch
            id="inline-suggestions"
            checked={suggestions}
            onCheckedChange={(v) => patch({ inlineSuggestions: v })}
            disabled={!terminal || !shellIntegration}
          />
        </ToggleField>

        <ToggleField
          id="suggestions-from-output"
          label={<span className="text-xs text-muted-foreground">Suggest from the last output</span>}
          hint="When a program tells you what to run next — a resume command, the git push that sets an upstream, a corrected typo — offer it. Only a command the program spelled out is ever suggested; anything merely sitting in the output stays in the Ctrl+Space menu."
        >
          <Switch
            id="suggestions-from-output"
            checked={terminal?.suggestionsFromOutput ?? true}
            onCheckedChange={(v) => patch({ suggestionsFromOutput: v })}
            disabled={!terminal || !suggestions}
          />
        </ToggleField>

        <Field
          label={<span className="text-xs text-muted-foreground">Suggest only when sure</span>}
          htmlFor="suggestion-confidence"
          hint="How certain the guess must be before any ghost text is drawn. A wrong suggestion costs more than none, so the default already stays quiet when two of your habits start the same way."
        >
          <Select
            value={terminal?.suggestionConfidence ?? 'balanced'}
            onValueChange={(v: SuggestionConfidence) => patch({ suggestionConfidence: v })}
            disabled={!terminal || !suggestions}
          >
            <SelectTrigger id="suggestion-confidence" className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="strict">Only when certain</SelectItem>
              <SelectItem value="balanced">Balanced (default)</SelectItem>
              <SelectItem value="loose">Guess more often</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field
          label={<span className="text-xs text-muted-foreground">Completion menu</span>}
          htmlFor="completion-menu"
          hint="A list of subcommands, flags, git branches and npm scripts, on top of the ghost text. Ctrl+Space by default rather than Tab, because Tab already reaches your shell's own completion — with Tab, CortX only takes the key when it has something to offer."
        >
          <Select
            value={terminal?.completionMenu ?? 'ctrlSpace'}
            onValueChange={(v: CompletionMenuKey) => patch({ completionMenu: v })}
            disabled={!terminal || !suggestions}
          >
            <SelectTrigger id="completion-menu" className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ctrlSpace">Ctrl+Space (default)</SelectItem>
              <SelectItem value="tab">Tab</SelectItem>
              <SelectItem value="off">Off</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <ToggleField
          id="completion-specs"
          label={<span className="text-xs text-muted-foreground">Learn a command&apos;s flags</span>}
          hint="Runs a program's own --help once, in the background, to learn its subcommands and flags. Only for a program already found in your PATH, never with anything you typed as an argument, and never for one that reads input (ssh, sudo, python…)."
        >
          <Switch
            id="completion-specs"
            checked={terminal?.completionSpecs ?? true}
            onCheckedChange={(v) => patch({ completionSpecs: v })}
            disabled={!terminal || !suggestions}
          />
        </ToggleField>

        <ToggleField
          id="completion-context"
          label={<span className="text-xs text-muted-foreground">Complete from the directory</span>}
          hint="Git branches, package.json scripts and file paths, read from the terminal's own working directory."
        >
          <Switch
            id="completion-context"
            checked={terminal?.completionContext ?? true}
            onCheckedChange={(v) => patch({ completionContext: v })}
            disabled={!terminal || !suggestions}
          />
        </ToggleField>
      </Group>

      <Group title="Output, links and images">
        <ToggleField
          id="smooth-scroll"
          label="Smooth scrolling"
          hint="The wheel glides instead of jumping a line at a time. Typing still snaps to the bottom instantly, so this costs nothing at the prompt."
        >
          <Switch
            id="smooth-scroll"
            checked={(terminal?.smoothScrollDuration ?? DEFAULT_SMOOTH_SCROLL_DURATION) > 0}
            onCheckedChange={(v) => patch({ smoothScrollDuration: v ? DEFAULT_SMOOTH_SCROLL_DURATION : 0 })}
            disabled={!terminal}
          />
        </ToggleField>

        <ToggleField
          id="file-path-links"
          label="Clickable file paths"
          hint="Underlines the file paths in the output that really exist on disk, and opens them in your editor at the line the compiler pointed at. Alt- or Shift-click reveals the folder instead."
        >
          <Switch
            id="file-path-links"
            checked={terminal?.filePathLinks ?? true}
            onCheckedChange={(v) => patch({ filePathLinks: v })}
            disabled={!terminal}
          />
        </ToggleField>

        <ToggleField
          id="link-tooltip"
          label={<span className="text-xs text-muted-foreground">Show a link&apos;s target on hover</span>}
          hint="A tooltip with the URL or the file path under the pointer, so you know where a link goes before you click it."
        >
          <Switch
            id="link-tooltip"
            checked={terminal?.linkTooltip ?? true}
            onCheckedChange={(v) => patch({ linkTooltip: v })}
            disabled={!terminal}
          />
        </ToggleField>

        <ToggleField
          id="kitty-graphics"
          label="Kitty graphics"
          hint="A third inline-image protocol, on top of Sixel and iTerm2. Turn it off only if a program draws garbage instead of a picture."
        >
          <Switch
            id="kitty-graphics"
            checked={terminal?.kittyGraphics ?? true}
            onCheckedChange={(v) => patch({ kittyGraphics: v })}
            disabled={!terminal}
          />
        </ToggleField>
      </Group>

      <Group title="Tabs and windows">
        <Field
          label="Terminal window · tabs"
          htmlFor="tabs-placement"
          hint="Where the list of terminals lives in the Terminal window: a sessions rail on the left, or a tab strip above the panes. One or the other, never both."
        >
          <Select
            value={terminal?.tabsPlacement ?? 'sidebar'}
            onValueChange={(v: 'sidebar' | 'top') => patch({ tabsPlacement: v })}
            disabled={!terminal}
          >
            <SelectTrigger id="tabs-placement" className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sidebar">Sessions rail (left)</SelectItem>
              <SelectItem value="top">Tab strip (top)</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="What a tab shows"
          hint="The title is always there. Everything around it is up to you."
          htmlFor="tab-display-cwd"
        >
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {TAB_DISPLAY_TOGGLES.map(({ key, label, hint }) => (
              <label key={key} htmlFor={`tab-display-${key}`} className="flex items-center gap-2 text-xs" title={hint}>
                <Switch
                  id={`tab-display-${key}`}
                  checked={tabDisplay[key]}
                  onCheckedChange={(v) => patch({ tabDisplay: { ...tabDisplay, [key]: v } })}
                  disabled={!terminal}
                />
                {label}
              </label>
            ))}
          </div>
        </Field>

        <Field
          label={<span className="text-xs text-muted-foreground">Tab number</span>}
          hint="The number types Ctrl+N jumps to. It only means something while Ctrl is down, which is when it shows by default."
          htmlFor="tab-display-index"
        >
          <Select
            value={tabDisplay.index}
            onValueChange={(v: TabIndexDisplay) => patch({ tabDisplay: { ...tabDisplay, index: v } })}
            disabled={!terminal}
          >
            <SelectTrigger id="tab-display-index" className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="never">Never</SelectItem>
              <SelectItem value="ctrl">While Ctrl is held</SelectItem>
              <SelectItem value="always">Always</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Started services and scripts open in"
            htmlFor="open-processes-in"
            hint="Where a service or script started from the app shows up."
          >
            <Select
              value={terminal?.openProcessesIn ?? 'dock'}
              onValueChange={(v: TerminalTargetSurface) => patch({ openProcessesIn: v })}
              disabled={!terminal}
            >
              <SelectTrigger id="open-processes-in" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dock">Dock (main window)</SelectItem>
                <SelectItem value="window">Terminal window</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Dev sessions (launch configurations) open in"
            htmlFor="open-dev-sessions-in"
            hint="A configuration can still pick its own target."
          >
            <Select
              value={terminal?.openDevSessionsIn ?? 'window'}
              onValueChange={(v: TerminalTargetSurface) => patch({ openDevSessionsIn: v })}
              disabled={!terminal}
            >
              <SelectTrigger id="open-dev-sessions-in" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="window">Terminal window</SelectItem>
                <SelectItem value="dock">Dock (main window)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Group>

      <Group title="Sessions">
        <ToggleField
          id="confirm-close-running"
          label="Ask before closing a busy terminal"
          hint="Closing a tab, a pane or CortX itself while a command is running asks first, and names what would be killed. A terminal sitting at its prompt always closes straight away."
        >
          <Switch
            id="confirm-close-running"
            checked={terminal?.confirmCloseRunning ?? true}
            onCheckedChange={(v) => patch({ confirmCloseRunning: v })}
            disabled={!terminal}
          />
        </ToggleField>

        <ToggleField
          id="restore-sessions"
          label="Restore sessions on start"
          hint="When you open terminal mode, your tabs come back where you left them — shells in their last directory, nothing re-run. Starting CortX never opens the terminal by itself."
        >
          <Switch
            id="restore-sessions"
            checked={restoreSessions}
            onCheckedChange={(v) => patch({ restoreSessions: v })}
            disabled={!terminal}
          />
        </ToggleField>

        <ToggleField
          id="restore-scrollback"
          label={<span className="text-xs text-muted-foreground">Restore scrollback</span>}
          hint="Seeds each restored shell with the tail of its previous output, so you keep the context of what ran."
        >
          <Switch
            id="restore-scrollback"
            checked={restoreScrollback}
            onCheckedChange={(v) => patch({ restoreScrollback: v })}
            disabled={!terminal || !restoreSessions}
          />
        </ToggleField>

        <NumberField
          id="restore-scrollback-lines"
          label={<span className="text-xs text-muted-foreground">Lines</span>}
          value={terminal?.restoreScrollbackLines ?? 200}
          min={20}
          max={2000}
          onCommit={(v) => patch({ restoreScrollbackLines: v ?? 200 })}
          disabled={!terminal || !restoreSessions || !restoreScrollback}
        />
      </Group>
    </Section>
  );
}
