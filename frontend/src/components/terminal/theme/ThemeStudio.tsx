/**
 * The theme studio: make a theme, or change one, without opening the yaml.
 *
 * ## Why it exists
 *
 * Editing a theme meant finding `data/terminal/themes`, opening a file, and
 * knowing that `details` is what lifts the surfaces and that `accent` is also
 * painted as text. Nobody knows the second one — the theme that shipped with
 * CortX did not, and neither did the app's own accent presets: both had a
 * colour sitting at 2.1:1 against its own background.
 *
 * So the studio is not a form over the yaml. It is the form **plus the
 * audit**: every colour is checked against the canvas it will land on, the
 * failures are named next to the field that caused them, and `details` is
 * derived from the background rather than asked for.
 *
 * ## One surface for "new" and "edit"
 *
 * They differ by what the form opens with and by nothing else, so they are
 * the same component and the same dialog — `studioKey` in the theme store is
 * the theme being edited, or null. It opens from the picker and hands the
 * picker back when it closes, so "choose a theme" stays the quick dialog it
 * was and "work on a theme" is the big surface.
 *
 * ## The five variants
 *
 * Warp offers a handful of readings of a dropped image rather than one, and
 * that is the right shape: a photograph does not have *a* theme in it. Here
 * they come from `terminalThemeGen`, which guarantees each is legible before
 * it is ever shown — see that file for the floors.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Image as ImageIcon, Loader2, Palette, Trash2, Wand2, X } from 'lucide-react';
import { toast } from 'sonner';
import { open } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/Segmented';
import { ColorField } from '@/components/ui/ColorField';
import { getTerminalTheme, readTerminalThemeImage } from '@/lib/tauri';
import { parseHex, type Rgb } from '@/lib/color';
import { auditTheme, paletteFromColor, quantize, variants, VARIANTS, type AnsiSet, type Swatch } from '@/lib/terminalThemeGen';
import { useTerminalThemeStore } from '@/stores/terminalThemeStore';
import { cn } from '@/lib/utils';
import type { TerminalThemeImageFit } from '@/types';
import {
  applyGenerated,
  blankDraft,
  draftFromTheme,
  draftToTheme,
  loadImage,
  resolvedDetails,
  wallpaperStyle,
  type Draft,
} from './themeDraft';

const ANSI_ORDER: Array<keyof AnsiSet> = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

const IMAGE_FILTER = { name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] };

/** A labelled row of the form. */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">{label}</div>
        {hint && <div className="text-[11px] leading-snug text-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--rad-md)] border border-border bg-card p-3">
      <h3 className="eyebrow mb-1.5">{title}</h3>
      {children}
    </section>
  );
}

/**
 * What the theme looks like: a canvas, its wallpaper, a prompt, a run of
 * output in the sixteen colours, and a tab row.
 *
 * The prompt line is the one that matters and it is deliberately the shape of
 * the bug that started this work — a tab title with a **running command
 * underneath in the accent**, which is where a near-black accent on a dark
 * canvas becomes visible as the mistake it is.
 */
function Preview({ draft }: { draft: Draft }) {
  const bg = draft.background;
  const fg = draft.foreground;
  const dim = (hex: string, pct: number) => `color-mix(in srgb, ${hex} ${pct}%, transparent)`;
  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden rounded-[var(--rad-md)] border border-border-strong"
      style={{ background: bg, color: fg }}
    >
      {draft.image && <div className="absolute inset-0" style={wallpaperStyle(draft.image)} aria-hidden />}
      <div className="relative flex h-full flex-col">
        {/* A tab row, with the pane's running command under its name. */}
        <div className="flex items-end gap-1 px-2 pt-2" style={{ borderBottom: `1px solid ${dim(fg, 12)}` }}>
          {['pwsh · game', 'pwsh · api'].map((name, i) => (
            <div
              key={name}
              className="min-w-0 rounded-t-[6px] px-2.5 py-1.5"
              style={{ background: i === 0 ? dim(fg, 10) : 'transparent' }}
            >
              <div className="truncate text-[11px]" style={{ color: i === 0 ? fg : dim(fg, 65) }}>
                {name}
              </div>
              <div className="truncate font-mono text-[10px]" style={{ color: draft.accent }}>
                {i === 0 ? 'rojo serve' : 'idle'}
              </div>
            </div>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-3 font-mono text-[11.5px] leading-relaxed">
          <div>
            <span style={{ color: draft.normal.green }}>alexis</span>
            <span style={{ color: dim(fg, 55) }}>@</span>
            <span style={{ color: draft.normal.blue }}>cortx</span>
            <span style={{ color: dim(fg, 55) }}> ~/Perso/CortX </span>
            <span style={{ color: draft.accent }}>git:(</span>
            <span style={{ color: draft.normal.magenta }}>main</span>
            <span style={{ color: draft.accent }}>)</span>
          </div>
          <div>
            <span style={{ color: draft.accent }}>❯ </span>
            <span>npm run build</span>
            <span
              className="ml-1 rounded-[3px] px-1"
              style={{ background: draft.selection || dim(fg, 25), color: fg }}
            >
              selected
            </span>
          </div>
          <div style={{ color: draft.normal.black }}>vite v7.1.0 building for production…</div>
          <div>
            <span style={{ color: draft.normal.green }}>✓</span> 318 modules transformed
          </div>
          <div style={{ color: draft.normal.yellow }}>warning: chunk larger than 500 kB</div>
          <div style={{ color: draft.normal.red }}>error: 1 problem</div>
          <div style={{ color: draft.normal.cyan }}>dist/index.html 0.62 kB</div>
          <div className="mt-1 flex gap-1">
            {ANSI_ORDER.map((k) => (
              <span key={k} className="size-3 rounded-[3px]" style={{ background: draft.normal[k] }} />
            ))}
            {ANSI_ORDER.map((k) => (
              <span key={`b${k}`} className="size-3 rounded-[3px]" style={{ background: draft.bright[k] }} />
            ))}
          </div>
          <div className="mt-1">
            <span style={{ color: draft.accent }}>❯ </span>
            <span
              className="inline-block h-[1.1em] w-[0.55em] align-text-bottom"
              style={{ background: draft.cursor || fg }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ThemeStudio() {
  const open_ = useTerminalThemeStore((s) => s.studioOpen);
  const editingKey = useTerminalThemeStore((s) => s.studioKey);
  const closeStudio = useTerminalThemeStore((s) => s.closeStudio);
  const saveTheme = useTerminalThemeStore((s) => s.save);
  const removeTheme = useTerminalThemeStore((s) => s.remove);

  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [palette, setPalette] = useState<Swatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  // Blob URLs made for a wallpaper preview; revoked when the dialog closes so
  // a session of trying pictures does not leak them all.
  const blobs = useRef<string[]>([]);

  const patch = useCallback((p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p })), []);

  // Fill the form when the dialog opens. A `key` of null is "new", which is
  // the blank draft; anything else is read back from disk rather than from
  // the summary list, because the list carries no ANSI colours.
  //
  // `copy:<key>` is how the picker asks for "duplicate and edit": a bundled
  // theme is compiled into the binary and materialised into the folder, so
  // saving over it would be undone the next time the list is built. The copy
  // opens with no key, which makes Save write a new file.
  useEffect(() => {
    if (!open_) return;
    setPalette(null);
    if (!editingKey) {
      setDraft(blankDraft());
      return;
    }
    const copy = editingKey.startsWith('copy:');
    const key = copy ? editingKey.slice(5) : editingKey;
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        const theme = await getTerminalTheme(key);
        if (!alive || !theme) return;
        const url = theme.background_image ? await readTerminalThemeImage(key) : null;
        if (!alive) return;
        setDraft(draftFromTheme(theme, url, copy));
      } catch (err) {
        toast.error('Could not open the theme', { description: String(err) });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open_, editingKey]);

  useEffect(() => {
    if (open_) return;
    for (const url of blobs.current) URL.revokeObjectURL(url);
    blobs.current = [];
  }, [open_]);

  const warnings = useMemo(
    () =>
      auditTheme({
        background: draft.background,
        foreground: draft.foreground,
        accent: draft.accent,
        details: resolvedDetails(draft),
        normal: draft.normal,
        bright: draft.bright,
      }),
    [draft]
  );

  const generated = useMemo(() => (palette ? variants(palette) : null), [palette]);

  const swatches = useMemo(() => {
    const out = [draft.background, draft.foreground, draft.accent, ...ANSI_ORDER.map((k) => draft.normal[k])];
    return [...new Set(out.filter((c) => parseHex(c)))];
  }, [draft]);

  const chooseImage = useCallback(async () => {
    const picked = await open({ multiple: false, filters: [IMAGE_FILTER] });
    if (typeof picked !== 'string') return;
    setBusy(true);
    try {
      const img = await loadImage(picked);
      blobs.current.push(img.url);
      setPalette(quantize(img.pixels, 12, 1));
      setDraft((d) => ({
        ...d,
        image: { path: img.path, url: img.url, opacity: d.image?.opacity ?? 30, blur: d.image?.blur ?? 0, fit: d.image?.fit ?? 'cover' },
      }));
    } catch (err) {
      toast.error('Could not read that image', { description: String(err) });
    } finally {
      setBusy(false);
    }
  }, []);

  const fromColour = useCallback(() => {
    const seed: Rgb | null = parseHex(draft.background);
    setPalette(paletteFromColor(seed ?? { r: 13, g: 148, b: 136, a: 1 }));
  }, [draft.background]);

  const onSave = useCallback(async () => {
    if (!draft.name.trim()) {
      toast.error('The theme needs a name');
      return;
    }
    setBusy(true);
    const saved = await saveTheme(draftToTheme(draft));
    setBusy(false);
    if (!saved) return;
    toast.success(`Saved "${saved.name}"`);
    closeStudio(true);
  }, [draft, saveTheme, closeStudio]);

  const onDelete = useCallback(async () => {
    if (!draft.key) return;
    setBusy(true);
    const done = await removeTheme(draft.key);
    setBusy(false);
    if (done) closeStudio(true);
  }, [draft.key, removeTheme, closeStudio]);

  const setAnsi = (set: 'normal' | 'bright', name: keyof AnsiSet, hex: string) =>
    setDraft((d) => ({ ...d, [set]: { ...d[set], [name]: hex } }));

  const warningFor = (field: string) => warnings.find((w) => w.field === field);

  return (
    <Dialog open={open_} onOpenChange={(v) => !v && closeStudio(true)}>
      <DialogContent
        className="top-[4%] flex h-[92vh] max-h-[92vh] w-[96vw] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[1240px]"
        showCloseButton={false}
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <Palette className="size-4 shrink-0 text-faint" />
          <div className="min-w-0 shrink-0">
            <DialogTitle className="whitespace-nowrap text-sm">
              {draft.key ? 'Edit theme' : 'New theme'}
            </DialogTitle>
            <DialogDescription className="whitespace-nowrap text-[11px]">
              Saved to data/terminal/themes as Warp-format YAML.
            </DialogDescription>
          </div>
          <Input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Theme name"
            aria-label="Theme name"
            className="ml-2 h-8 w-56"
          />
          <div className="ml-auto flex items-center gap-1.5">
            {draft.key && (
              <Button variant="ghost" size="xs" onClick={() => void onDelete()} disabled={busy}>
                <Trash2 />
                Delete
              </Button>
            )}
            <Button variant="outline" size="xs" onClick={() => closeStudio(true)} disabled={busy}>
              Cancel
            </Button>
            <Button size="xs" onClick={() => void onSave()} disabled={busy || loading}>
              {busy && <Loader2 className="animate-spin" />}
              Save
            </Button>
            <button
              type="button"
              onClick={() => closeStudio(true)}
              aria-label="Close"
              className="ml-1 grid size-6 place-items-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* ---- the form ---- */}
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
            <Group title="Start from">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="xs" onClick={() => void chooseImage()} disabled={busy}>
                  <ImageIcon />
                  An image…
                </Button>
                <Button variant="outline" size="xs" onClick={fromColour} disabled={busy}>
                  <Wand2 />
                  The background colour
                </Button>
                <span className="text-[11px] text-faint">
                  Five readings are offered; every one is checked for contrast before you see it.
                </span>
              </div>
              {generated && (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {generated.map((g, i) => {
                    const meta = VARIANTS[i];
                    const chosen =
                      g.background === draft.background && g.accent === draft.accent && g.foreground === draft.foreground;
                    return (
                      <button
                        key={g.kind}
                        type="button"
                        onClick={() => setDraft((d) => applyGenerated(d, g))}
                        title={meta.hint}
                        className={cn(
                          'overflow-hidden rounded-[var(--rad-sm)] border text-left transition-colors',
                          chosen ? 'border-primary' : 'border-border hover:border-border-strong'
                        )}
                      >
                        <span className="block h-12 p-1.5" style={{ background: g.background }}>
                          <span className="block h-1.5 w-8 rounded-full" style={{ background: g.foreground }} />
                          <span className="mt-1 block h-1.5 w-5 rounded-full" style={{ background: g.accent }} />
                          <span className="mt-1.5 flex gap-0.5">
                            {ANSI_ORDER.slice(1, 7).map((k) => (
                              <span key={k} className="size-1.5 rounded-[2px]" style={{ background: g.normal[k] }} />
                            ))}
                          </span>
                        </span>
                        <span className="block px-1.5 py-1 text-[10.5px]">{meta.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Group>

            <Group title="Core colours">
              <Row label="Background" hint="The canvas everything else is judged against.">
                <ColorField value={draft.background} onChange={(v) => patch({ background: v })} swatches={swatches} className="w-40" aria-label="Background" />
              </Row>
              <Row label="Text" hint={warningFor('foreground')?.message}>
                <ColorField value={draft.foreground} onChange={(v) => patch({ foreground: v })} swatches={swatches} className="w-40" aria-label="Text colour" />
              </Row>
              <Row
                label="Accent"
                hint={warningFor('accent')?.message ?? 'CortX paints it as text too — a running command, an agent glyph.'}
              >
                <ColorField value={draft.accent} onChange={(v) => patch({ accent: v })} swatches={swatches} className="w-40" aria-label="Accent" />
              </Row>
              <Row label="Cursor" hint="Empty = the text colour.">
                <ColorField value={draft.cursor} onChange={(v) => patch({ cursor: v })} swatches={swatches} clearable placeholder="text colour" className="w-40" aria-label="Cursor" />
              </Row>
              <Row label="Selection" hint="A wash: give it an opacity.">
                <ColorField value={draft.selection} onChange={(v) => patch({ selection: v })} swatches={swatches} allowAlpha clearable placeholder="from accent" className="w-40" aria-label="Selection" />
              </Row>
            </Group>

            <Group title="Light or dark">
              <p className="mb-2 text-[11px] leading-snug text-faint">
                This is what decides how far surfaces are lifted towards white — 6 % on a dark theme, 45 % on a light
                one. It does <em>not</em> change the text colour, so a theme that declares the wrong side paints pale
                cards under light text.
              </p>
              <div className="flex items-center gap-2">
                <Segmented
                  size="sm"
                  value={draft.detailsAuto ? 'auto' : draft.details}
                  onChange={(v) =>
                    v === 'auto'
                      ? patch({ detailsAuto: true })
                      : patch({ detailsAuto: false, details: v as 'darker' | 'lighter' })
                  }
                  options={[
                    { value: 'auto', label: 'From the background' },
                    { value: 'darker', label: 'Dark' },
                    { value: 'lighter', label: 'Light' },
                  ]}
                />
                <span className="text-[11px] text-faint">
                  {draft.detailsAuto ? `Derived: ${resolvedDetails(draft)}` : 'Set by hand'}
                </span>
              </div>
            </Group>

            <Group title="Wallpaper">
              {draft.image ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="size-10 shrink-0 rounded-[var(--rad-sm)] border border-border bg-cover bg-center"
                      style={{ backgroundImage: `url("${draft.image.url}")` }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">{draft.image.path}</span>
                    <Button variant="ghost" size="xs" onClick={() => patch({ image: null })}>
                      Remove
                    </Button>
                  </div>
                  <Row label={`Opacity — ${draft.image.opacity}%`}>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={draft.image.opacity}
                      onChange={(e) => patch({ image: { ...draft.image!, opacity: Number(e.target.value) } })}
                      className="w-40"
                      aria-label="Wallpaper opacity"
                    />
                  </Row>
                  <Row label={`Blur — ${draft.image.blur}px`}>
                    <input
                      type="range"
                      min={0}
                      max={40}
                      value={draft.image.blur}
                      onChange={(e) => patch({ image: { ...draft.image!, blur: Number(e.target.value) } })}
                      className="w-40"
                      aria-label="Wallpaper blur"
                    />
                  </Row>
                  <Row label="Fit">
                    <Segmented
                      size="sm"
                      value={draft.image.fit}
                      onChange={(v) => patch({ image: { ...draft.image!, fit: v as TerminalThemeImageFit } })}
                      options={[
                        { value: 'cover', label: 'Cover' },
                        { value: 'contain', label: 'Contain' },
                        { value: 'tile', label: 'Tile' },
                        { value: 'center', label: 'Center' },
                      ]}
                    />
                  </Row>
                </div>
              ) : (
                <Button variant="outline" size="xs" onClick={() => void chooseImage()} disabled={busy}>
                  <ImageIcon />
                  Choose a picture…
                </Button>
              )}
            </Group>

            <Group title="Terminal colours">
              <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-3 gap-y-1">
                <span />
                <span className="eyebrow">Normal</span>
                <span className="eyebrow">Bright</span>
                {ANSI_ORDER.map((name) => (
                  <div key={name} className="contents">
                    <span className="text-[11px] capitalize text-muted-foreground">{name}</span>
                    {(['normal', 'bright'] as const).map((set) => {
                      const w = warningFor(`${set}.${name}`);
                      return (
                        <div key={set} className="flex items-center gap-1">
                          <ColorField
                            value={draft[set][name]}
                            onChange={(v) => setAnsi(set, name, v)}
                            swatches={swatches}
                            className="w-full"
                            aria-label={`${set} ${name}`}
                          />
                          {w && <AlertTriangle className="size-3 shrink-0 text-warning" aria-label={w.message} />}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </Group>
          </div>

          {/* ---- the preview and what is wrong with it ---- */}
          <div className="flex min-h-0 flex-col gap-3">
            <Preview draft={draft} />
            <div className="max-h-[30%] shrink-0 overflow-y-auto rounded-[var(--rad-md)] border border-border bg-card p-3">
              <h3 className="eyebrow mb-1.5">Legibility</h3>
              {warnings.length === 0 ? (
                <p className="text-[11.5px] text-muted-foreground">
                  Every colour clears its contrast floor against the background.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {warnings.map((w) => (
                    <li key={w.field} className="flex items-start gap-1.5 text-[11.5px] leading-snug">
                      <AlertTriangle
                        className={cn('mt-0.5 size-3 shrink-0', w.severity === 'error' ? 'text-destructive' : 'text-warning')}
                      />
                      <span>
                        <span className="font-mono text-[11px]">{w.field}</span> — {w.message}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[10.5px] text-faint">
                Text needs 4.5:1, a glyph 3:1. The accent is held to the text floor because CortX paints it as text.
                {draft.image && ' A wallpaper varies the real contrast by zone, so leave some margin.'}
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
