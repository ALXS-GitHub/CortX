import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HotkeyInputProps {
  /** Current binding in tauri-plugin format, e.g. "CmdOrCtrl+Shift+Space". Empty = disabled. */
  value: string;
  /** Called with the new combo (or empty string to disable). */
  onChange: (combo: string) => void;
  /** Fallback combo used by the "Reset" button. */
  defaultCombo: string;
}

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

/** Translate "CmdOrCtrl+Shift+Space" to display tokens like ["⌘","⇧","Space"]. */
function formatCombo(combo: string): string[] {
  if (!combo) return [];
  return combo.split('+').map((tok) => {
    const t = tok.trim();
    if (t === 'CmdOrCtrl' || t === 'CommandOrControl') return IS_MAC ? '⌘' : 'Ctrl';
    if (t === 'Cmd' || t === 'Command' || t === 'Super' || t === 'Meta') return IS_MAC ? '⌘' : 'Win';
    if (t === 'Ctrl' || t === 'Control') return 'Ctrl';
    if (t === 'Shift') return IS_MAC ? '⇧' : 'Shift';
    if (t === 'Alt' || t === 'Option') return IS_MAC ? '⌥' : 'Alt';
    return t;
  });
}

/** Build a plugin-format combo string from a KeyboardEvent. */
function eventToCombo(e: KeyboardEvent): string | null {
  // Reject events where no non-modifier key was pressed (e.g. user just tapped Shift).
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return null;

  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('CmdOrCtrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');

  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key === 'Escape') return null; // Reserved for "cancel capture"
  else if (key === 'Backspace' || key === 'Delete') return null; // Reserved for "clear"
  else if (key.length === 1) key = key.toUpperCase();
  // Other named keys (F1, ArrowUp, etc.) pass through as-is.

  parts.push(key);
  return parts.join('+');
}

export function HotkeyInput({ value, onChange, defaultCombo }: HotkeyInputProps) {
  const [capturing, setCapturing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const tokens = formatCombo(value);
  const isEmpty = !value || tokens.length === 0;

  const finishCapture = useCallback(() => {
    setCapturing(false);
    containerRef.current?.blur();
  }, []);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels without changing anything.
      if (e.key === 'Escape') {
        finishCapture();
        return;
      }
      // Backspace clears the binding (disables it).
      if (e.key === 'Backspace' || e.key === 'Delete') {
        onChange('');
        finishCapture();
        return;
      }
      const combo = eventToCombo(e);
      if (!combo) return; // Pure modifier or rejected event; wait for next press.
      onChange(combo);
      finishCapture();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, onChange, finishCapture]);

  return (
    <div className="flex items-center gap-2">
      <div
        ref={containerRef}
        tabIndex={0}
        role="button"
        onClick={() => setCapturing(true)}
        onBlur={() => setCapturing(false)}
        className={cn(
          'flex min-h-9 flex-1 cursor-pointer items-center gap-1.5 rounded-sm border border-input bg-[var(--bg-input)] px-3 py-2 text-sm shadow-soft outline-none transition-[border-color,box-shadow]',
          capturing
            ? 'border-accent-border ring-2 ring-ring/40'
            : 'hover:border-border-strong focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-ring/40'
        )}
      >
        {capturing ? (
          <span className="text-xs italic text-muted-foreground">
            Press a key combo… (Esc to cancel, Backspace to clear)
          </span>
        ) : isEmpty ? (
          <span className="text-xs italic text-faint">Disabled — click to set a shortcut</span>
        ) : (
          tokens.map((t, i) => (
            <kbd key={i} className="kbd h-6 min-w-6 px-2 text-[11px] text-foreground">
              {t}
            </kbd>
          ))
        )}
      </div>
      <Button
        variant="outline"
        size="icon"
        type="button"
        onClick={() => onChange(defaultCombo)}
        title="Reset to default"
        aria-label="Reset to default"
      >
        <RotateCcw />
      </Button>
      <Button
        variant="outline"
        size="icon"
        type="button"
        onClick={() => onChange('')}
        title="Clear / disable"
        aria-label="Clear / disable"
        disabled={isEmpty}
      >
        <X />
      </Button>
    </div>
  );
}
