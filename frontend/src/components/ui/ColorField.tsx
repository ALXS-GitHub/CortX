/**
 * A colour picker CortX owns.
 *
 * Two things existed before this file and neither was one:
 *
 * - `Settings.tsx` used `<input type="color">`, which opens the **operating
 *   system's** dialog. On Windows that is a 1990s grid with a "Custom
 *   colours" drawer; it does not know the app's theme, cannot do alpha, and
 *   drops the user out of the window to pick a colour for that window.
 * - the terminal's selection colour was a plain text field: you had to know
 *   and type a hex string, with a swatch next to it that told you afterwards
 *   whether you had guessed right.
 *
 * So: a saturation/value square, a hue rail, an optional alpha rail, the hex
 * in a field that accepts every length, the eyedropper when the platform has
 * one, and a row of swatches the caller supplies — in practice the colours of
 * the theme being edited, because the colour you want is nearly always one
 * already on screen.
 *
 * ## Alpha is not decoration
 *
 * A selection wash and a `cortx.selection` entry are both `#rrggbbaa`, and
 * the eight-digit form is exactly what the theme file wants. `allowAlpha`
 * defaults to false so a field that must stay opaque — a background, an
 * accent — cannot be handed a transparent colour by accident.
 *
 * ## Why the HSV lives here and not in the value
 *
 * Hue survives in the state but not in the colour: black, white and every
 * grey are the same RGB whatever hue produced them, so a picker that
 * recomputes HSV from its own output on every render makes the square jump
 * to red the moment you drag the thumb into a corner. The component keeps the
 * coordinates it is being dragged by and only re-reads them from the value
 * when the value changed from the outside.
 */
import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { Check, Pipette } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { hsvToRgb, parseHex, rgbToHsv, toHex, type Hsv, type Rgb } from '@/lib/color';
import { cn } from '@/lib/utils';

/** Chromium's eyedropper, absent on some platforms and in every test. */
interface EyeDropperApi {
  open(): Promise<{ sRGBHex: string }>;
}
function eyeDropper(): EyeDropperApi | null {
  const ctor = (window as unknown as { EyeDropper?: new () => EyeDropperApi }).EyeDropper;
  return ctor ? new ctor() : null;
}

/** The grey chequerboard that says "this is see-through". */
const CHECKER =
  'repeating-conic-gradient(var(--muted-foreground) 0% 25%, transparent 0% 50%) 50% / 8px 8px';

/**
 * Drag on a box, in fractions of its own size.
 *
 * Pointer capture rather than window listeners: the pointer keeps reporting
 * to the element it was pressed on even once it leaves, which is what makes
 * a slider keep tracking when the cursor runs off the popover.
 */
function useDrag(onMove: (x: number, y: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const move = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const box = ref.current?.getBoundingClientRect();
      if (!box || !box.width || !box.height) return;
      onMove((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height);
    },
    [onMove]
  );
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.focus({ preventScroll: true });
      move(e);
    },
    [move]
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      move(e);
    },
    [move]
  );
  return { ref, onPointerDown, onPointerMove };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Saturation across, value down — the square every picker opens with. */
function SvSquare({ hsv, onChange }: { hsv: Hsv; onChange: (patch: Partial<Hsv>) => void }) {
  const drag = useDrag((x, y) => onChange({ s: clamp01(x), v: 1 - clamp01(y) }));
  const step = (dx: number, dy: number) => onChange({ s: clamp01(hsv.s + dx), v: clamp01(hsv.v + dy) });
  return (
    <div
      {...drag}
      role="application"
      aria-label="Saturation and brightness"
      tabIndex={0}
      onKeyDown={(e) => {
        const big = e.shiftKey ? 0.1 : 0.02;
        const moves: Record<string, [number, number]> = {
          ArrowLeft: [-big, 0],
          ArrowRight: [big, 0],
          ArrowUp: [0, big],
          ArrowDown: [0, -big],
        };
        const m = moves[e.key];
        if (!m) return;
        e.preventDefault();
        step(m[0], m[1]);
      }}
      className="relative h-32 w-full cursor-crosshair touch-none rounded-[var(--rad-sm)] outline-none ring-offset-2 ring-offset-[var(--popover)] focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)`,
      }}
    >
      <span
        className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.5)]"
        style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: toHex(hsvToRgb({ ...hsv, a: 1 })) }}
      />
    </div>
  );
}

/** One horizontal rail: hue or alpha. */
function Rail({
  label,
  fraction,
  onChange,
  background,
  thumb,
  max,
}: {
  label: string;
  fraction: number;
  onChange: (f: number) => void;
  background: string;
  thumb: string;
  /** What `aria-valuenow` counts up to (360 for a hue, 100 for a percentage). */
  max: number;
}) {
  const drag = useDrag((x) => onChange(clamp01(x)));
  return (
    <div
      {...drag}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(fraction * max)}
      tabIndex={0}
      onKeyDown={(e) => {
        const d = e.shiftKey ? 0.1 : 1 / max;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          onChange(clamp01(fraction - d));
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          onChange(clamp01(fraction + d));
        }
      }}
      className="relative h-3 w-full cursor-pointer touch-none rounded-full outline-none ring-offset-2 ring-offset-[var(--popover)] focus-visible:ring-2 focus-visible:ring-ring"
      style={{ background }}
    >
      <span
        className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.5)]"
        style={{ left: `${fraction * 100}%`, background: thumb }}
      />
    </div>
  );
}

export interface ColorFieldProps {
  /** Any hex the theme files accept; empty means "not set". */
  value: string;
  onChange: (hex: string) => void;
  /** Offer the alpha rail and emit `#rrggbbaa`. */
  allowAlpha?: boolean;
  /** Colours worth one click — in practice the theme being edited. */
  swatches?: string[];
  /** Shown on the trigger when the value is empty. */
  placeholder?: string;
  /** Let the field be cleared back to empty (an unset theme knob). */
  clearable?: boolean;
  /**
   * Replace the default swatch-and-hex button.
   *
   * The app's accent row wants a round 7 px pip to match the presets beside
   * it; a second picker written for that shape is a second picker to keep in
   * step, so the trigger is the part callers may swap. It must be a single
   * element that forwards a ref and props (Radix's `asChild`).
   */
  trigger?: ReactNode;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

const FALLBACK: Rgb = { r: 13, g: 148, b: 136, a: 1 };

export function ColorField({
  value,
  onChange,
  allowAlpha = false,
  swatches,
  placeholder = 'Pick a colour',
  clearable = false,
  trigger,
  disabled,
  className,
  'aria-label': ariaLabel,
}: ColorFieldProps) {
  const parsed = parseHex(value);
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(parsed ?? FALLBACK));
  const [draft, setDraft] = useState(value);
  const id = useId();

  // `seen` is both "the value we last rendered" and "the value we last sent":
  // every emit stores its own hex here, so when the parent echoes it back the
  // comparison below is already equal and the coordinates are left alone.
  // That is what keeps the hue from snapping to red when the thumb is dragged
  // into a corner (see the header) — without a ref, which may not be read
  // during render.
  //
  // Adjusting state *during* render rather than in an effect is the pattern
  // React sanctions for "a prop changed and local state must follow": it
  // costs no second paint, and an effect would rightly trip
  // `react-hooks/set-state-in-effect` — nothing here is an external system.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
    const next = parseHex(value);
    if (next) setHsv(rgbToHsv(next));
  }

  const emit = useCallback(
    (next: Hsv) => {
      setHsv(next);
      const hex = toHex(hsvToRgb(allowAlpha ? next : { ...next, a: 1 }));
      setSeen(hex);
      setDraft(hex);
      onChange(hex);
    },
    [allowAlpha, onChange]
  );

  const patch = useCallback((p: Partial<Hsv>) => emit({ ...hsv, ...p }), [emit, hsv]);

  /**
   * Take a typed or pasted colour, **without rewriting what is in the field**.
   *
   * Rewriting it is the obvious thing to do and it makes the input unusable:
   * a hex is parsed on every keystroke, and the fourth character of `#0c161f`
   * makes `#0c1` — a legal three-digit colour. Committing that *and* putting
   * its expansion back in the box left the user typing the rest of their
   * colour onto the end of `#00cc11`, which is how `#0c161f` came out as
   * `#00cc11`. So the text belongs to whoever is typing until they leave the
   * field (`onBlur` normalises it) or the value changes from elsewhere.
   */
  const commitText = useCallback(
    (text: string) => {
      const next = parseHex(text);
      if (!next) return;
      const hex = toHex(allowAlpha ? next : { ...next, a: 1 });
      setSeen(hex);
      setHsv(rgbToHsv(next));
      onChange(hex);
    },
    [allowAlpha, onChange]
  );

  const pick = useCallback(async () => {
    const dropper = eyeDropper();
    if (!dropper) return;
    try {
      const { sRGBHex } = await dropper.open();
      commitText(sRGBHex);
      setDraft(sRGBHex);
    } catch {
      // The user pressed Escape; nothing to report.
    }
  }, [commitText]);

  const solid = toHex(hsvToRgb({ ...hsv, a: 1 }));
  const current = toHex(hsvToRgb(allowAlpha ? hsv : { ...hsv, a: 1 }));

  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger ?? (
        <button
          type="button"
          aria-label={ariaLabel ?? 'Pick a colour'}
          className={cn(
            'inline-flex h-9 min-w-0 items-center gap-2 rounded-[var(--rad-sm)] border border-border bg-[var(--bg-input)] px-2 text-left text-xs transition-colors hover:border-border-strong disabled:pointer-events-none disabled:opacity-50',
            className
          )}
        >
          <span
            className="size-5 shrink-0 rounded-[5px] border border-border-strong"
            style={{ background: parsed ? CHECKER : undefined }}
          >
            <span className="block size-full rounded-[4px]" style={{ background: parsed ? value : 'transparent' }} />
          </span>
          <span className={cn('truncate font-mono', !parsed && 'text-faint')}>
            {parsed ? value.toLowerCase() : placeholder}
          </span>
        </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-3">
        <SvSquare hsv={hsv} onChange={patch} />

        <div className="flex items-center gap-2">
          <span
            className="size-8 shrink-0 rounded-[var(--rad-sm)] border border-border-strong"
            style={{ background: CHECKER }}
          >
            <span className="block size-full rounded-[5px]" style={{ background: current }} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Rail
              label="Hue"
              max={360}
              fraction={hsv.h / 360}
              onChange={(f) => patch({ h: f * 360 })}
              thumb={`hsl(${hsv.h} 100% 50%)`}
              background="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
            />
            {allowAlpha && (
              <Rail
                label="Opacity"
                max={100}
                fraction={hsv.a}
                onChange={(f) => patch({ a: f })}
                thumb={solid}
                background={`linear-gradient(to right, transparent, ${solid}), ${CHECKER}`}
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            id={id}
            value={draft}
            spellCheck={false}
            aria-label="Hex value"
            onChange={(e) => {
              setDraft(e.target.value);
              commitText(e.target.value);
            }}
            onBlur={() => setDraft(current)}
            className="h-8 min-w-0 flex-1 rounded-[var(--rad-sm)] border border-border bg-[var(--bg-input)] px-2 font-mono text-xs outline-none focus-visible:border-border-strong"
          />
          {eyeDropper() && (
            <button
              type="button"
              onClick={() => void pick()}
              title="Pick a colour from the screen"
              aria-label="Pick a colour from the screen"
              className="grid size-8 shrink-0 place-items-center rounded-[var(--rad-sm)] border border-border text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
            >
              <Pipette className="size-3.5" />
            </button>
          )}
        </div>

        {swatches && swatches.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {swatches.map((s, i) => {
              const on = parseHex(s) && parseHex(value) && toHex(parseHex(s)!) === toHex(parseHex(value)!);
              return (
                <button
                  key={`${s}-${i}`}
                  type="button"
                  title={s}
                  aria-label={s}
                  onClick={() => {
                    commitText(s);
                    setDraft(s);
                  }}
                  className="grid size-5 place-items-center rounded-[5px] border border-border-strong"
                  style={{ background: s }}
                >
                  {on && <Check className="size-3 text-white mix-blend-difference" />}
                </button>
              );
            })}
          </div>
        )}

        {clearable && (
          <button
            type="button"
            onClick={() => {
              setSeen('');
              setDraft('');
              onChange('');
            }}
            className="text-left text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Use the theme's own colour
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
