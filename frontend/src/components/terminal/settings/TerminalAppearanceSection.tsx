import { useEffect, useMemo, type ReactNode } from 'react';
import { Minus, Palette, RectangleHorizontal, TextCursor, Underline } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Segmented } from '@/components/ui/Segmented';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ThemePicker, ThemeSwatches } from '@/components/terminal/theme/ThemePicker';
import { useTerminalThemeStore } from '@/stores/terminalThemeStore';
import { useAppStore } from '@/stores/appStore';
import {
  DEFAULT_THEME_DARK,
  DEFAULT_THEME_LIGHT,
  clampOpacity,
  isAppDark,
  mix,
  rgba,
  themeAccentCss,
  themeCanvasCss,
} from '@/lib/terminalTheme';
import type { TerminalConfig, TerminalThemeSummary } from '@/types';

const IS_WINDOWS = /Windows/i.test(navigator.userAgent);
const IS_MAC = /Mac/i.test(navigator.userAgent);

type WindowEffect = NonNullable<TerminalConfig['windowEffect']>;

const EFFECT_OPTIONS: { value: WindowEffect; label: string; hint: string }[] = IS_WINDOWS
  ? [
      { value: 'none', label: 'None', hint: 'Plain window; the opacity alone lets the desktop through.' },
      { value: 'acrylic', label: 'Acrylic', hint: 'Frosted blur tinted with the theme colour (Windows 10 1809+).' },
      { value: 'mica', label: 'Mica', hint: 'Desktop wallpaper tint, no blur (Windows 11).' },
    ]
  : IS_MAC
    ? [
        { value: 'none', label: 'None', hint: 'Plain window; the opacity alone lets the desktop through.' },
        { value: 'vibrancy', label: 'Vibrancy', hint: 'macOS translucent material behind the window.' },
      ]
    : [{ value: 'none', label: 'None', hint: 'Backdrop effects are not available on this platform.' }];

function Row({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

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
      <SelectTrigger id={id} className="w-full">
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

/** A tiny mock of the Terminal window in the theme's colours. */
function PreviewStrip({
  theme,
  opacity,
  cursorStyle,
  padding,
}: {
  theme: TerminalThemeSummary | null;
  opacity: number;
  cursorStyle: NonNullable<TerminalConfig['cursorStyle']>;
  padding: number;
}) {
  if (!theme) {
    return (
      <div className="grid h-28 place-items-center rounded-lg border border-dashed border-border-strong text-xs text-faint">
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
      className="overflow-hidden rounded-lg border border-border-strong font-mono text-[11px] leading-relaxed"
      style={{
        // Checkerboard stands in for the desktop behind a translucent window.
        backgroundImage:
          'linear-gradient(45deg, rgba(128,128,128,.25) 25%, transparent 25%, transparent 75%, rgba(128,128,128,.25) 75%), linear-gradient(45deg, rgba(128,128,128,.25) 25%, transparent 25%, transparent 75%, rgba(128,128,128,.25) 75%)',
        backgroundSize: '12px 12px',
        backgroundPosition: '0 0, 6px 6px',
      }}
    >
      {/* `themeCanvasCss` carries a `{top, bottom}` gradient when the theme has one. */}
      <div style={{ background: themeCanvasCss(theme, alpha), color: theme.foreground }}>
        <div
          className="flex h-6 items-center gap-2 border-b px-2 text-[10px]"
          style={{ background: rgba(card, 0.72 * alpha), borderColor: rgba(theme.foreground, 0.12), color: muted }}
        >
          <span className="size-2 rounded-full" style={{ background: themeAccentCss(theme) }} />
          Terminal — {theme.name}
        </div>
        <div className="flex">
          <div
            className="flex w-20 shrink-0 flex-col gap-1 border-r p-1.5 text-[10px]"
            style={{ background: rgba(card, 0.55 * alpha), borderColor: rgba(theme.foreground, 0.12) }}
          >
            <span className="truncate rounded-[6px] px-1.5 py-0.5" style={{ background: rgba(theme.accent, 0.18) }}>
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

export interface TerminalAppearanceSectionProps {
  value: TerminalConfig;
  onChange: (patch: Partial<TerminalConfig>) => void;
}

/**
 * Settings card "Terminal appearance": themes per mode, cursor, padding,
 * window opacity and backdrop effect. The host owns the draft and saves.
 */
/** Range + number for a look setting; `clearable` offers "theme default" (undefined). */
function LookSlider({
  id,
  label,
  hint,
  value,
  fallback,
  min,
  max,
  unit,
  onChange,
  clearable = true,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number | undefined;
  fallback: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number | undefined) => void;
  clearable?: boolean;
}) {
  const shown = value ?? fallback;
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  return (
    <Row
      label={
        <span className="flex items-center gap-2">
          {label}
          <span className="font-mono text-[11px] text-faint">
            {shown}
            {unit}
            {value === undefined && clearable ? ' · theme' : ''}
          </span>
        </span>
      }
      htmlFor={id}
      hint={hint}
    >
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={1}
          value={shown}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          className="h-1.5 flex-1 cursor-pointer accent-primary"
        />
        <Input
          type="number"
          min={min}
          max={max}
          value={shown}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(clamp(n));
          }}
          className="w-20"
          aria-label={label}
        />
        {clearable && value !== undefined && (
          <Button variant="ghost" size="xs" onClick={() => onChange(undefined)} title="Back to the theme's value">
            Reset
          </Button>
        )}
      </div>
    </Row>
  );
}

export function TerminalAppearanceSection({ value, onChange }: TerminalAppearanceSectionProps) {
  const themes = useTerminalThemeStore((s) => s.themes);
  const loaded = useTerminalThemeStore((s) => s.loaded);
  const loading = useTerminalThemeStore((s) => s.loading);
  const load = useTerminalThemeStore((s) => s.load);
  const openPicker = useTerminalThemeStore((s) => s.openPicker);
  const settings = useAppStore((s) => s.settings);

  useEffect(() => {
    if (!loaded && !loading) void load();
  }, [loaded, loading, load]);

  const follows = value.themeFollowsApp ?? true;
  const dark = isAppDark(settings);
  const cursorStyle = value.cursorStyle ?? 'bar';
  const padding = value.padding ?? 8;
  const opacity = clampOpacity(value.windowOpacity);
  const effect: WindowEffect = value.windowEffect ?? 'none';
  const effectHint = EFFECT_OPTIONS.find((o) => o.value === effect)?.hint;

  const previewKey = follows && !dark ? value.themeLight?.trim() || DEFAULT_THEME_LIGHT : value.themeDark?.trim() || DEFAULT_THEME_DARK;
  const previewTheme = useMemo(() => themes.find((t) => t.key === previewKey) ?? null, [themes, previewKey]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="size-4 text-faint" />
          Terminal appearance
        </CardTitle>
        <CardDescription>
          Themes use Warp&apos;s YAML format — import your Warp themes as they are. In the Terminal window the theme
          colours the whole window (title bar, sessions rail, panes), with its wallpaper behind everything.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <PreviewStrip theme={previewTheme} opacity={opacity} cursorStyle={cursorStyle} padding={padding} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Row label="Theme for dark mode" htmlFor="terminal-theme-dark">
            <ThemeSelect
              id="terminal-theme-dark"
              value={value.themeDark}
              fallback={DEFAULT_THEME_DARK}
              themes={themes}
              onChange={(key) => onChange({ themeDark: key })}
            />
          </Row>
          <Row label="Theme for light mode" htmlFor="terminal-theme-light">
            <ThemeSelect
              id="terminal-theme-light"
              value={value.themeLight}
              fallback={DEFAULT_THEME_LIGHT}
              themes={themes}
              disabled={!follows}
              onChange={(key) => onChange({ themeLight: key })}
            />
          </Row>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={openPicker}>
            <Palette />
            Open picker…
          </Button>
          <span className="text-xs text-muted-foreground">
            Search, preview live, import Warp theme files or a whole folder.{' '}
            <span className="kbd">Ctrl K</span> → &quot;Change theme&quot; in the Terminal window.
          </span>
        </div>

        <ToggleRow
          id="terminal-theme-follows"
          label="Follow the app's light / dark mode"
          hint="Off: the dark-mode theme is used all the time, whatever the app mode."
          checked={follows}
          onCheckedChange={(v) => onChange({ themeFollowsApp: v })}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Row label="Cursor">
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                size="sm"
                value={cursorStyle}
                onChange={(v) => onChange({ cursorStyle: v })}
                options={[
                  { value: 'block', label: 'Block', icon: RectangleHorizontal },
                  { value: 'underline', label: 'Underline', icon: Underline },
                  { value: 'bar', label: 'Bar', icon: TextCursor },
                ]}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground" htmlFor="terminal-cursor-blink">
                <Switch
                  id="terminal-cursor-blink"
                  checked={value.cursorBlink ?? true}
                  onCheckedChange={(v) => onChange({ cursorBlink: v })}
                />
                Blink
              </label>
            </div>
          </Row>
          <Row label="Padding" htmlFor="terminal-padding" hint="Space around the text of every terminal, in px (0–48).">
            <Input
              id="terminal-padding"
              type="number"
              min={0}
              max={48}
              value={padding}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) onChange({ padding: Math.min(48, Math.max(0, Math.round(n))) });
              }}
              className="w-28"
            />
          </Row>
        </div>

        {/* Look: wallpaper and chrome, on top of what the theme file says */}
        <div className="grid gap-4 sm:grid-cols-2">
          <LookSlider
            id="terminal-wallpaper-opacity"
            label="Wallpaper opacity"
            hint="Empty = the theme's own value."
            value={value.wallpaperOpacity}
            fallback={100}
            min={0}
            max={100}
            unit="%"
            onChange={(v) => onChange({ wallpaperOpacity: v })}
          />
          <LookSlider
            id="terminal-wallpaper-blur"
            label="Wallpaper blur"
            hint="Empty = the theme's own value."
            value={value.wallpaperBlur}
            fallback={0}
            min={0}
            max={40}
            unit="px"
            onChange={(v) => onChange({ wallpaperBlur: v })}
          />
          <LookSlider
            id="terminal-wallpaper-dim"
            label="Wallpaper dimming"
            hint="Tones the picture down with the theme colour."
            value={value.wallpaperDim ?? 0}
            fallback={0}
            min={0}
            max={90}
            unit="%"
            onChange={(v) => onChange({ wallpaperDim: v ?? 0 })}
            clearable={false}
          />
          <Row label="Wallpaper fit" htmlFor="terminal-wallpaper-fit" hint="Empty = the theme's own value.">
            <Select
              value={value.wallpaperFit ?? '__theme__'}
              onValueChange={(v) => onChange({ wallpaperFit: v === '__theme__' ? undefined : (v as 'cover' | 'contain' | 'tile' | 'center') })}
            >
              <SelectTrigger id="terminal-wallpaper-fit" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__theme__">Theme default</SelectItem>
                <SelectItem value="cover">Cover</SelectItem>
                <SelectItem value="contain">Contain</SelectItem>
                <SelectItem value="tile">Tile</SelectItem>
                <SelectItem value="center">Center</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <LookSlider
            id="terminal-chrome-opacity"
            label="Title bar & rail opacity"
            hint="Background of the title bar and the sessions rail."
            value={value.chromeOpacity ?? 72}
            fallback={72}
            min={0}
            max={100}
            unit="%"
            onChange={(v) => onChange({ chromeOpacity: v ?? 72 })}
            clearable={false}
          />
          <LookSlider
            id="terminal-chrome-blur"
            label="Title bar & rail blur"
            hint="Frosted-glass blur behind the title bar and the rail."
            value={value.chromeBlur ?? 20}
            fallback={20}
            min={0}
            max={60}
            unit="px"
            onChange={(v) => onChange({ chromeBlur: v ?? 20 })}
            clearable={false}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Row
            label={
              <span className="flex items-center gap-2">
                Window opacity <span className="font-mono text-[11px] text-faint">{opacity}%</span>
              </span>
            }
            htmlFor="terminal-window-opacity"
            hint="Terminal window only. Below 100 % the desktop shows through the theme colour."
          >
            <div className="flex items-center gap-3">
              <input
                id="terminal-window-opacity"
                type="range"
                min={20}
                max={100}
                step={1}
                value={opacity}
                onChange={(e) => onChange({ windowOpacity: clampOpacity(Number(e.target.value)) })}
                className="h-1.5 flex-1 cursor-pointer accent-primary"
              />
              <Input
                type="number"
                min={20}
                max={100}
                value={opacity}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) onChange({ windowOpacity: clampOpacity(n) });
                }}
                className="w-20"
                aria-label="Window opacity"
              />
            </div>
          </Row>
          <Row label="Backdrop effect" htmlFor="terminal-window-effect" hint={effectHint}>
            <Select value={effect} onValueChange={(v) => onChange({ windowEffect: v as WindowEffect })}>
              <SelectTrigger id="terminal-window-effect" className="w-full">
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
          </Row>
        </div>
      </CardContent>
      {/* The picker edits the draft too (both slots), never the saved settings. */}
      <ThemePicker
        config={value}
        onChoose={(key, slot) => onChange({ [slot]: key })}
        onFollowsChange={(v) => onChange({ themeFollowsApp: v })}
      />
    </Card>
  );
}
