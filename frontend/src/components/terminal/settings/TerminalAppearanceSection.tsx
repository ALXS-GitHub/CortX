/**
 * Terminal › Theme & window (ticket #64): the theme per mode and the dock,
 * the cursor and the selection, the Terminal window's own look and the
 * wallpaper overrides. Store-backed, like every terminal page.
 *
 * The theme has two editors on purpose: the selects here, and the picker
 * (search, live preview, Warp imports) they open. Both write the same three
 * fields (`themeDark`, `themeLight`, `themeFollowsApp`).
 */
import { useEffect, useMemo } from 'react';
import { Minus, Palette, RectangleHorizontal, TextCursor, Underline } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/Segmented';
import { ColorField } from '@/components/ui/ColorField';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CONTROL_WIDTH, SectionBody } from '@/components/settings/SettingsPrimitives';
import { ThemePicker, ThemeSwatches } from '@/components/terminal/theme/ThemePicker';
import { ThemeStudio } from '@/components/terminal/theme/ThemeStudio';
import { Group, SelectField, SettingField, SliderField, SwitchField, NumberField } from './controls';
import { useTerminalSettings } from './useTerminalSettings';
import { useTerminalThemeStore, useCurrentTerminalTheme } from '@/stores/terminalThemeStore';
import { useAppStore } from '@/stores/appStore';
import {
  DEFAULT_THEME_DARK,
  DEFAULT_THEME_LIGHT,
  clampOpacity,
  dockThemeMode,
  isAppDark,
  mix,
  rgba,
  themeAccentCss,
  themeCanvasCss,
} from '@/lib/terminalTheme';
import type {
  TerminalConfig,
  TerminalCursorInactiveStyle,
  TerminalDockTheme,
  TerminalThemeSummary,
} from '@/types';

const IS_WINDOWS = /Windows/i.test(navigator.userAgent);
const IS_MAC = /Mac/i.test(navigator.userAgent);

type WindowEffect = NonNullable<TerminalConfig['windowEffect']>;
type CursorStyle = NonNullable<TerminalConfig['cursorStyle']>;
type WallpaperFit = 'cover' | 'contain' | 'tile' | 'center';

const EFFECT_OPTIONS: { value: WindowEffect; label: string; hint: string }[] = IS_WINDOWS
  ? [
      { value: 'none', label: 'None', hint: 'A plain window; the opacity alone lets the desktop through.' },
      { value: 'acrylic', label: 'Acrylic', hint: 'Frosted blur tinted with the theme colour (Windows 10 1809+).' },
      { value: 'mica', label: 'Mica', hint: 'Desktop wallpaper tint, no blur (Windows 11).' },
    ]
  : IS_MAC
    ? [
        { value: 'none', label: 'None', hint: 'A plain window; the opacity alone lets the desktop through.' },
        { value: 'vibrancy', label: 'Vibrancy', hint: 'The macOS translucent material behind the window.' },
      ]
    : [{ value: 'none', label: 'None', hint: 'Backdrop effects are not available on this platform.' }];

function ThemeSelect({
  id,
  value,
  fallback,
  themes,
  disabled,
  onChange,
}: {
  id: string;
  value: string | undefined;
  fallback: string;
  themes: TerminalThemeSummary[];
  disabled?: boolean;
  onChange: (key: string) => void;
}) {
  const bundled = themes.filter((t) => t.source === 'bundled');
  const imported = themes.filter((t) => t.source !== 'bundled');
  const current = value?.trim() || fallback;
  const known = themes.some((t) => t.key === current);
  const item = (t: TerminalThemeSummary) => (
    <SelectItem key={t.key} value={t.key}>
      <span className="flex items-center gap-2">
        <ThemeSwatches theme={t} />
        {t.name}
      </span>
    </SelectItem>
  );
  return (
    <Select value={current} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className={CONTROL_WIDTH}>
        <SelectValue placeholder="Choose a theme" />
      </SelectTrigger>
      <SelectContent>
        {!known && (
          <SelectItem value={current}>
            <span className="text-muted-foreground">{current} (missing)</span>
          </SelectItem>
        )}
        {bundled.length > 0 && (
          <SelectGroup>
            <SelectLabel>Bundled</SelectLabel>
            {bundled.map(item)}
          </SelectGroup>
        )}
        {imported.length > 0 && (
          <SelectGroup>
            <SelectLabel>Imported</SelectLabel>
            {imported.map(item)}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

/**
 * A tiny mock of the Terminal window in the theme's colours. Its colours are
 * the theme's, not the app's: it is a picture of the terminal, the one place
 * on this page where a hex value is the point. The checkerboard stands in for
 * the desktop behind a translucent window.
 */
function PreviewStrip({
  theme,
  opacity,
  cursorStyle,
  padding,
}: {
  theme: TerminalThemeSummary | null;
  opacity: number;
  cursorStyle: CursorStyle;
  padding: number;
}) {
  if (!theme) {
    return (
      <div className="grid h-28 place-items-center rounded-sm border border-dashed border-border-strong text-xs text-faint">
        Theme preview
      </div>
    );
  }
  const dark = theme.details !== 'lighter';
  const alpha = clampOpacity(opacity) / 100;
  const card = dark ? mix(theme.background, '#ffffff', 0.06) : mix(theme.background, '#ffffff', 0.45);
  const muted = mix(theme.foreground, theme.background, 0.35);
  const [black, red, green, yellow, blue, magenta, cyan] = theme.swatches;
  const cursor: React.CSSProperties =
    cursorStyle === 'block'
      ? { display: 'inline-block', width: '0.6em', height: '1.1em', background: theme.foreground, verticalAlign: 'text-bottom' }
      : cursorStyle === 'underline'
        ? { display: 'inline-block', width: '0.6em', height: '1.1em', borderBottom: `2px solid ${theme.foreground}`, verticalAlign: 'text-bottom' }
        : { display: 'inline-block', width: '2px', height: '1.1em', background: theme.foreground, verticalAlign: 'text-bottom' };
  return (
    <div
      className="overflow-hidden rounded-sm border border-border-strong font-mono text-[11px] leading-relaxed"
      style={{
        backgroundImage:
          'linear-gradient(45deg, rgba(128,128,128,.25) 25%, transparent 25%, transparent 75%, rgba(128,128,128,.25) 75%), linear-gradient(45deg, rgba(128,128,128,.25) 25%, transparent 25%, transparent 75%, rgba(128,128,128,.25) 75%)',
        backgroundSize: '12px 12px',
        backgroundPosition: '0 0, 6px 6px',
      }}
    >
      {/* `themeCanvasCss` carries a `{top, bottom}` gradient when the theme has one. */}
      <div style={{ background: themeCanvasCss(theme, alpha), color: theme.foreground }}>
        <div
          className="flex h-6 items-center gap-2 border-b px-2"
          style={{ background: rgba(card, 0.72 * alpha), borderColor: rgba(theme.foreground, 0.12), color: muted }}
        >
          <span className="size-2 rounded-full" style={{ background: themeAccentCss(theme) }} />
          Terminal — {theme.name}
        </div>
        <div className="flex">
          <div
            className="flex w-20 shrink-0 flex-col gap-1 border-r p-1.5"
            style={{ background: rgba(card, 0.55 * alpha), borderColor: rgba(theme.foreground, 0.12) }}
          >
            <span className="truncate rounded-xs px-1.5 py-0.5" style={{ background: rgba(theme.accent, 0.18) }}>
              pwsh
            </span>
            <span className="truncate px-1.5 py-0.5" style={{ color: muted }}>
              bun dev
            </span>
            <span className="truncate px-1.5 py-0.5" style={{ color: muted }}>
              claude
            </span>
          </div>
          <pre className="m-0 min-w-0 flex-1 overflow-hidden whitespace-pre" style={{ padding: `${Math.min(padding, 16)}px` }}>
            <span style={{ color: green }}>~/cortx</span> <span style={{ color: theme.accent }}>❯</span> git status{'\n'}
            <span style={{ color: red }}>red</span> <span style={{ color: green }}>green</span>{' '}
            <span style={{ color: yellow }}>yellow</span> <span style={{ color: blue }}>blue</span>{' '}
            <span style={{ color: magenta }}>magenta</span> <span style={{ color: cyan }}>cyan</span>{' '}
            <span style={{ color: black }}>black</span>{'\n'}
            <span style={{ color: green }}>~/cortx</span> <span style={{ color: theme.accent }}>❯</span> <span style={cursor} />
          </pre>
        </div>
      </div>
    </div>
  );
}

/** "Follows the theme" under a slider whose value is still the theme's. */
function themeValueHint(value: number | undefined): string | undefined {
  return value === undefined ? "The theme's own value, until you move it." : undefined;
}

export function TerminalThemePage() {
  const { terminal, patch } = useTerminalSettings();
  const themes = useTerminalThemeStore((s) => s.themes);
  const loaded = useTerminalThemeStore((s) => s.loaded);
  const loading = useTerminalThemeStore((s) => s.loading);
  const load = useTerminalThemeStore((s) => s.load);
  const openPicker = useTerminalThemeStore((s) => s.openPicker);
  const settings = useAppStore((s) => s.settings);

  useEffect(() => {
    if (!loaded && !loading) void load();
  }, [loaded, loading, load]);

  // The colour you want for a selection is almost always one already in the
  // theme, at an opacity — so the picker opens with the theme's own palette.
  const currentTheme = useCurrentTerminalTheme();
  const selectionSwatches = useMemo(() => {
    if (!currentTheme) return undefined;
    const c = currentTheme.terminal_colors;
    return [
      currentTheme.accent,
      currentTheme.foreground,
      currentTheme.background,
      c?.normal.blue,
      c?.normal.magenta,
      c?.normal.cyan,
      c?.bright.black,
    ].filter((x): x is string => typeof x === 'string' && x.length > 0);
  }, [currentTheme]);

  const value = terminal ?? ({} as TerminalConfig);
  const off = !terminal;
  const follows = value.themeFollowsApp ?? true;
  const dark = isAppDark(settings);
  const cursorStyle: CursorStyle = value.cursorStyle ?? 'bar';
  const padding = value.padding ?? 8;
  const opacity = clampOpacity(value.windowOpacity);
  const effect: WindowEffect = value.windowEffect ?? 'none';
  const effectHint = EFFECT_OPTIONS.find((o) => o.value === effect)?.hint;
  const previewKey =
    follows && !dark ? value.themeLight?.trim() || DEFAULT_THEME_LIGHT : value.themeDark?.trim() || DEFAULT_THEME_DARK;
  const previewTheme = useMemo(() => themes.find((t) => t.key === previewKey) ?? null, [themes, previewKey]);

  return (
    <>
      <Group group="theme">
        <SectionBody className="space-y-3">
          <PreviewStrip theme={previewTheme} opacity={opacity} cursorStyle={cursorStyle} padding={padding} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button variant="outline" size="sm" onClick={openPicker}>
              <Palette />
              Choose theme…
            </Button>
            <span className="text-xs text-muted-foreground">
              Search, preview live, import Warp theme files or a whole folder.
            </span>
          </div>
        </SectionBody>
        <SwitchField
          k="themeFollowsApp"
          id="terminal-theme-follows"
          label="Follow the app's light / dark mode"
          hint="Off: the dark-mode theme is used all the time."
          checked={follows}
          onChange={(v) => patch({ themeFollowsApp: v })}
          disabled={off}
        />
        <SettingField k="themeDark" label={follows ? 'Theme in dark mode' : 'Theme'} htmlFor="terminal-theme-dark">
          <ThemeSelect
            id="terminal-theme-dark"
            value={value.themeDark}
            fallback={DEFAULT_THEME_DARK}
            themes={themes}
            disabled={off}
            onChange={(key) => patch({ themeDark: key })}
          />
        </SettingField>
        {follows && (
          <SettingField k="themeLight" label="Theme in light mode" htmlFor="terminal-theme-light">
            <ThemeSelect
              id="terminal-theme-light"
              value={value.themeLight}
              fallback={DEFAULT_THEME_LIGHT}
              themes={themes}
              disabled={off}
              onChange={(key) => patch({ themeLight: key })}
            />
          </SettingField>
        )}
        <SelectField<TerminalDockTheme>
          k="dockTheme"
          id="terminal-dock-theme"
          label="In the dock, the theme colours"
          hint="The Terminal window always wears the whole theme. The dock is a panel of the app, so it is a choice."
          value={dockThemeMode(value)}
          options={[
            { value: 'app', label: 'Nothing (default)' },
            { value: 'canvas', label: 'The terminals only' },
            { value: 'chrome', label: 'The whole dock' },
          ]}
          onChange={(v) => patch({ dockTheme: v })}
          disabled={off}
        />
      </Group>

      <Group group="cursor">
        <SettingField k="cursorStyle" label="Cursor">
          <Segmented<CursorStyle>
            size="sm"
            value={cursorStyle}
            onChange={(v) => patch({ cursorStyle: v })}
            options={[
              { value: 'block', label: 'Block', icon: RectangleHorizontal },
              { value: 'underline', label: 'Underline', icon: Underline },
              { value: 'bar', label: 'Bar', icon: TextCursor },
            ]}
          />
        </SettingField>
        <SwitchField
          k="cursorBlink"
          id="terminal-cursor-blink"
          label="Blink"
          checked={value.cursorBlink ?? true}
          onChange={(v) => patch({ cursorBlink: v })}
          disabled={off}
          indent
        />
        {/* Issue 52: with splits open, the cursor is the cheapest answer to
            "which pane are my keys going to". */}
        <SelectField<TerminalCursorInactiveStyle>
          k="cursorInactiveStyle"
          id="terminal-cursor-inactive"
          label="In a pane without the focus"
          hint="With splits open, it shows which pane your keys go to."
          value={value.cursorInactiveStyle ?? 'outline'}
          options={[
            { value: 'outline', label: 'Outline (default)' },
            { value: 'none', label: 'Nothing' },
            { value: 'bar', label: 'Bar' },
            { value: 'block', label: 'Block' },
            { value: 'underline', label: 'Underline' },
          ]}
          onChange={(v) => patch({ cursorInactiveStyle: v })}
          disabled={off}
          indent
        />
        <NumberField
          k="padding"
          id="terminal-padding"
          label="Padding"
          hint="Space around the text of every terminal."
          value={padding}
          min={0}
          max={48}
          unit="px"
          onCommit={(v) => patch({ padding: Math.round(v ?? 8) })}
          disabled={off}
        />
        <SettingField
          k="selectionColor"
          label="Selection colour"
          hint="Empty = the theme's own. A selection is a wash, so it wants an opacity."
        >
          <ColorField
            value={value.selectionColor ?? ''}
            onChange={(hex) => patch({ selectionColor: hex || undefined })}
            allowAlpha
            clearable
            placeholder="Theme"
            swatches={selectionSwatches}
            disabled={off}
            aria-label="Selection colour"
            className={CONTROL_WIDTH}
          />
        </SettingField>
      </Group>

      <Group group="window">
        <SliderField
          k="windowOpacity"
          id="terminal-window-opacity"
          label="Window opacity"
          hint="Below 100 % the desktop shows through the theme colour."
          value={opacity}
          min={20}
          max={100}
          unit="%"
          onChange={(v) => patch({ windowOpacity: clampOpacity(v) })}
          disabled={off}
        />
        <SettingField k="windowEffect" label="Backdrop effect" htmlFor="terminal-window-effect" hint={effectHint}>
          <Select value={effect} onValueChange={(v) => patch({ windowEffect: v as WindowEffect })} disabled={off}>
            <SelectTrigger id="terminal-window-effect" className={CONTROL_WIDTH}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EFFECT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
              {!EFFECT_OPTIONS.some((o) => o.value === effect) && (
                <SelectItem value={effect}>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Minus className="size-3" /> {effect} (other platform)
                  </span>
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </SettingField>
        <SliderField
          k="chromeOpacity"
          id="terminal-chrome-opacity"
          label="Title bar and rail opacity"
          hint="Background of the title bar and the sessions rail."
          value={value.chromeOpacity ?? 72}
          min={0}
          max={100}
          unit="%"
          onChange={(v) => patch({ chromeOpacity: v })}
          disabled={off}
        />
        <SliderField
          k="chromeBlur"
          id="terminal-chrome-blur"
          label="Title bar and rail blur"
          hint="Blur behind the title bar and the rail."
          value={value.chromeBlur ?? 20}
          min={0}
          max={60}
          unit="px"
          onChange={(v) => patch({ chromeBlur: v })}
          disabled={off}
        />
      </Group>

      <Group group="wallpaper">
        <SliderField
          k="wallpaperOpacity"
          id="terminal-wallpaper-opacity"
          label="Opacity"
          hint={themeValueHint(value.wallpaperOpacity)}
          value={value.wallpaperOpacity ?? 100}
          min={0}
          max={100}
          unit="%"
          onChange={(v) => patch({ wallpaperOpacity: v })}
          disabled={off}
        />
        <SliderField
          k="wallpaperBlur"
          id="terminal-wallpaper-blur"
          label="Blur"
          hint={themeValueHint(value.wallpaperBlur)}
          value={value.wallpaperBlur ?? 0}
          min={0}
          max={40}
          unit="px"
          onChange={(v) => patch({ wallpaperBlur: v })}
          disabled={off}
        />
        <SliderField
          k="wallpaperDim"
          id="terminal-wallpaper-dim"
          label="Dimming"
          hint="Tones the picture down with the theme colour."
          value={value.wallpaperDim ?? 0}
          min={0}
          max={90}
          unit="%"
          onChange={(v) => patch({ wallpaperDim: v })}
          disabled={off}
        />
        <SelectField<WallpaperFit | 'theme'>
          k="wallpaperFit"
          id="terminal-wallpaper-fit"
          label="Fit"
          value={(value.wallpaperFit as WallpaperFit | undefined) ?? 'theme'}
          options={[
            { value: 'theme', label: "The theme's (default)" },
            { value: 'cover', label: 'Cover' },
            { value: 'contain', label: 'Contain' },
            { value: 'tile', label: 'Tile' },
            { value: 'center', label: 'Centre' },
          ]}
          onChange={(v) => patch({ wallpaperFit: v === 'theme' ? undefined : v })}
          disabled={off}
        />
      </Group>

      {/* The picker edits the same three fields as the selects above. */}
      <ThemePicker
        config={value}
        onChoose={(key, slot) => patch({ [slot]: key })}
        onFollowsChange={(v) => patch({ themeFollowsApp: v })}
      />
      {/* Mounted beside the picker rather than inside it: the studio outlives
          the picker (opening it closes the picker, closing it brings the
          picker back), so it cannot be a child of what it replaces. */}
      <ThemeStudio />
    </>
  );
}
