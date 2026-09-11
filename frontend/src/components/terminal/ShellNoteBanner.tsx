import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info, X } from 'lucide-react';
import { create } from 'zustand';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { terminalShellNote } from '@/lib/tauri';
import type { TerminalSurface } from '@/lib/terminalLayout';

/**
 * "CortX has no shell integration for <shell>" (issue #54).
 *
 * Without the OSC 7 / OSC 133 block a CortX terminal has no blocks, no
 * enriched history, no command-finished notification, no universal input
 * editor, no live tab title and no block spacing — almost everything that
 * makes it more than an xterm. Until now that happened *silently*: a user
 * running `xonsh`, `csh` or `elvish` simply saw a CortX with its features
 * missing and never learned why. The sentence itself comes from the backend
 * (`shell_init::unsupported_shell_note`); this is where it is shown.
 *
 * Three deliberate choices about *when*:
 *
 * - **A banner, not a toast.** The note is the explanation for everything the
 *   terminal will not do for the rest of the session; a thing that vanishes in
 *   four seconds is not an explanation.
 * - **Once per program name, not once per terminal.** Six `xonsh` tabs are one
 *   fact about the user's shell, not six pieces of news.
 * - **Dismissal is remembered on disk** (`localStorage`, `cortx.shellNote.dismissed`)
 *   rather than as a setting: this is something one reads once, and a
 *   preference nobody would ever go back to is a preference not worth adding.
 *
 * The tone matters too. The user chose their shell; the note says what is off
 * and what would work, and neither apologises nor warns.
 */

/** Program names the user has waved away, as a JSON array of strings. */
const STORAGE_KEY = 'cortx.shellNote.dismissed';

/**
 * The shell's name as the user thinks of it — no directory, no extension,
 * case-folded. Mirrors what `Path::file_stem` gives the backend, so
 * `C:\tools\Xonsh.exe` and `/usr/bin/xonsh` are one shell and not three.
 */
function shellProgramName(program: string): string {
  const base = program.trim().split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  // `dot > 0`, never `>= 0`: a leading dot is part of the name, not a suffix.
  return (dot > 0 ? base.slice(0, dot) : base).trim().toLowerCase();
}

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    // Storage can be unavailable or hold something else entirely; a note shown
    // once more is a better failure than a banner that throws.
    return [];
  }
}

interface DismissedState {
  dismissed: string[];
  dismiss: (name: string) => void;
  /** Take the list as it now stands on disk (another window wrote it). */
  adopt: (names: string[]) => void;
}

const useDismissed = create<DismissedState>((set, get) => ({
  dismissed: readDismissed(),
  dismiss: (name) => {
    if (!name || get().dismissed.includes(name)) return;
    const next = [...get().dismissed, name];
    set({ dismissed: next });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Not worth failing the click over: the banner still closes for this session.
    }
  },
  adopt: (names) => set({ dismissed: names }),
}));

// The main window and the Terminal window are two webviews of one origin, so a
// dismissal in either reaches the other through the storage event. Without it
// the user would have to close the same note twice.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === STORAGE_KEY) {
      useDismissed.getState().adopt(readDismissed());
    }
  });
}

/**
 * Answers keyed by program name. The backend's answer depends on the name and
 * nothing else, so one round trip covers every terminal running that shell,
 * for the life of the webview.
 */
const noteCache = new Map<string, string | null>();

/**
 * The chrome both terminal banners wear — this one and the sub-shell offer in
 * `SubshellBanner`. Shared rather than copied on purpose: two banners drawn
 * side by side in the same corner have to stay the same banner.
 */
export function NoticeBar({
  icon: Icon,
  actions,
  onDismiss,
  dismissLabel = 'Dismiss',
  anchor = 'absolute',
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  actions?: ReactNode;
  onDismiss: () => void;
  dismissLabel?: string;
  /**
   * `absolute` sits in the nearest positioned terminal surface. `fixed` is for
   * a mount point that has no such box — it is rendered through a portal on
   * `document.body`, because a `backdrop-filter` anywhere above would
   * otherwise become its containing block.
   */
  anchor?: 'absolute' | 'fixed';
  children: ReactNode;
}) {
  const bar = (
    <div
      className={cn(
        'pointer-events-none inset-x-0 bottom-3 z-40 flex justify-center px-4',
        anchor === 'fixed' ? 'fixed' : 'absolute'
      )}
    >
      <div className="pointer-events-auto flex max-w-[min(680px,100%)] items-center gap-3 rounded-[var(--rad-md)] border border-border-strong bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
        <Icon className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">{children}</div>
        {actions && <div className="flex shrink-0 items-center">{actions}</div>}
        <button
          type="button"
          className="grid size-5 shrink-0 place-items-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onDismiss}
          title={dismissLabel}
          aria-label={dismissLabel}
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
  if (anchor !== 'fixed') return bar;
  if (typeof document === 'undefined') return null;
  return createPortal(bar, document.body);
}

/**
 * The banner itself. Reads the shells this surface hosts straight from
 * `shellRuntimes` — which already carries the `program` the PTY was started
 * with — so nothing has to be threaded through the session plumbing.
 *
 * `surface` is the one the mount point renders: the dock's banner must not
 * speak about a shell that lives in a Terminal window, and the other way
 * round. It is passed in rather than guessed, because the mount point is the
 * only place that knows for sure.
 */
export function ShellNoteBanner({
  surface = 'window',
  anchor = 'absolute',
}: {
  surface?: TerminalSurface;
  anchor?: 'absolute' | 'fixed';
}) {
  const shells = useAppStore((s) => s.shellRuntimes);
  const surfaces = useAppStore((s) => s.terminalSurfaces);
  const dismissed = useDismissed((s) => s.dismissed);
  const dismiss = useDismissed((s) => s.dismiss);
  // Bumped when a lookup lands: `noteCache` is module state, not React state.
  const [resolved, setResolved] = useState(0);

  // One entry per distinct shell name running on this surface, oldest first.
  const programs = useMemo(() => {
    const out: { name: string; program: string }[] = [];
    for (const [id, rt] of shells) {
      if (rt.status !== 'running' || !rt.program) continue;
      if ((surfaces[`shell:${id}`] ?? 'dock') !== surface) continue;
      const name = shellProgramName(rt.program);
      if (!name || out.some((p) => p.name === name)) continue;
      out.push({ name, program: rt.program });
    }
    return out;
  }, [shells, surfaces, surface]);

  useEffect(() => {
    const missing = programs.filter((p) => !noteCache.has(p.name));
    if (missing.length === 0) return;
    let alive = true;
    void Promise.all(
      missing.map(async (p) => {
        try {
          noteCache.set(p.name, await terminalShellNote(p.program));
        } catch {
          // The command is not there (older build) or refused: say nothing.
          noteCache.set(p.name, null);
        }
      })
    ).then(() => {
      if (alive) setResolved((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [programs]);

  // The most recently started shell that has something to say and has not been
  // waved away. Newest first: it is the one the user just opened.
  const shown = useMemo(() => {
    for (let i = programs.length - 1; i >= 0; i -= 1) {
      const { name } = programs[i];
      const note = noteCache.get(name);
      if (note && !dismissed.includes(name)) return { name, note };
    }
    return null;
    // `resolved` is the dependency that matters for `noteCache`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programs, dismissed, resolved]);

  if (!shown) return null;
  // "…for xonsh." on its own line, the consequences under it.
  const cut = shown.note.indexOf('. ');
  const headline = cut > 0 ? shown.note.slice(0, cut + 1) : shown.note;
  const detail = cut > 0 ? shown.note.slice(cut + 2) : null;

  return (
    <NoticeBar icon={Info} anchor={anchor} onDismiss={() => dismiss(shown.name)} dismissLabel="Got it">
      <p className="font-medium">{headline}</p>
      {detail && <p className="text-[11px] leading-relaxed text-faint">{detail}</p>}
    </NoticeBar>
  );
}
