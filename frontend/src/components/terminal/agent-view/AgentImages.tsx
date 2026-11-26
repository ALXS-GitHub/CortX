import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ImageOff, Maximize, Minus, Plus, X } from 'lucide-react';
import { readFile } from '@tauri-apps/plugin-fs';
import { cn } from '@/lib/utils';
import { AgentCwdContext, useLightbox, type ViewerImage } from './agentImageStore';

/**
 * Images in the agent view (ticket CORT-62), the way the Claude desktop app
 * shows them: small in the conversation, opened full size in a viewer on a
 * click — zoom with the wheel or the buttons, drag to move, ← → between the
 * images of the same message.
 */

/** A row of thumbnails; a click opens the viewer on that image. */
export function Thumbnails({ images, className }: { images: ViewerImage[]; className?: string }) {
  const open = useLightbox((s) => s.open);
  if (images.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {images.map((img, i) => (
        <button
          key={i}
          type="button"
          onClick={() => open(images, i)}
          className="group/thumb relative overflow-hidden rounded-xl border border-border bg-muted/40 shadow-soft transition-transform hover:-translate-y-0.5 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none"
          title={img.alt || 'Open the image'}
        >
          <img src={img.src} alt={img.alt ?? ''} className="block max-h-40 max-w-[16rem] object-contain" loading="lazy" draggable={false} />
          <span className="absolute right-1.5 bottom-1.5 grid size-6 place-items-center rounded-md bg-background/80 text-foreground opacity-0 shadow-soft transition-opacity group-hover/thumb:opacity-100">
            <Maximize className="size-3.5" />
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local images in the agent's markdown (`![](./shot.png)`, an absolute path)
// ---------------------------------------------------------------------------

const localUrls = new Map<string, Promise<string>>();

function isRemote(src: string): boolean {
  return /^(https?:|data:|blob:|asset:)/i.test(src);
}

function resolvePath(src: string, cwd: string): string {
  const path = decodeURI(src.replace(/^file:\/\//i, ''));
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(path) || !cwd) return path;
  const sep = cwd.includes('\\') ? '\\' : '/';
  return `${cwd.replace(/[\\/]+$/, '')}${sep}${path.replace(/^\.[\\/]/, '')}`;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };

function localUrl(path: string): Promise<string> {
  let url = localUrls.get(path);
  if (!url) {
    url = readFile(path).then((bytes) => {
      const type = MIME[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'image/png';
      return URL.createObjectURL(new Blob([bytes], { type }));
    });
    url.catch(() => localUrls.delete(path));
    localUrls.set(path, url);
  }
  return url;
}

/** The `img` of the agent's markdown: a thumbnail, local files read from disk. */
export function MarkdownImage({ src, alt }: { src?: string | Blob; alt?: string }) {
  const cwd = useContext(AgentCwdContext);
  const raw = typeof src === 'string' ? src : '';
  const [url, setUrl] = useState<string | null>(() => (raw && isRemote(raw) ? raw : null));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!raw || isRemote(raw)) return;
    let alive = true;
    localUrl(resolvePath(raw, cwd))
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [raw, cwd]);
  if (failed || !raw) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
        <ImageOff className="size-3" />
        {alt || raw || 'image'}
      </span>
    );
  }
  if (!url) return <span className="inline-block h-24 w-36 animate-pulse rounded-xl bg-muted/60" />;
  return <Thumbnails images={[{ src: url, alt }]} className="my-2" />;
}

// ---------------------------------------------------------------------------
// The viewer
// ---------------------------------------------------------------------------

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

/** Mounted once per view; draws over everything while an image is open. */
export function ImageLightbox() {
  const { images, index, close, step } = useLightbox();
  const image = images[index];
  if (!image) return null;
  // Keyed by the image: a new one starts fitted, not at the last one's zoom.
  return createPortal(
    <Stage key={`${index}:${image.src.length}`} image={image} index={index} count={images.length} close={close} step={step} />,
    document.body
  );
}

function Stage({
  image,
  index,
  count,
  close,
  step,
}: {
  image: ViewerImage;
  index: number;
  count: number;
  close: () => void;
  step: (delta: number) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const reset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(MAX_ZOOM, z * 1.25));
      else if (e.key === '-') setZoom((z) => Math.max(MIN_ZOOM, z / 1.25));
      else if (e.key === '0') {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, step]);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/80 backdrop-blur-sm animate-in fade-in-0"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="flex h-12 shrink-0 items-center gap-1 px-3 text-white/80">
        <span className="min-w-0 flex-1 truncate text-xs">
          {image.alt}
          {count > 1 && (
            <span className="ml-2 text-white/50">
              {index + 1} / {count}
            </span>
          )}
        </span>
        <ViewerButton label="Zoom out (-)" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.25))}>
          <Minus className="size-4" />
        </ViewerButton>
        <button type="button" onClick={reset} className="h-8 min-w-14 rounded-md px-2 font-mono text-xs hover:bg-white/10" title="Fit (0)">
          {Math.round(zoom * 100)}%
        </button>
        <ViewerButton label="Zoom in (+)" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.25))}>
          <Plus className="size-4" />
        </ViewerButton>
        <ViewerButton label="Close (Esc)" onClick={close}>
          <X className="size-4" />
        </ViewerButton>
      </div>
      <div
        className={cn('relative min-h-0 flex-1 overflow-hidden', zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in')}
        onWheel={(e) => {
          const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
          setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)));
        }}
        onMouseDown={(e) => {
          if (e.target !== e.currentTarget && (e.target as HTMLElement).tagName !== 'IMG') return;
          drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
        }}
        onMouseMove={(e) => {
          const d = drag.current;
          if (!d) return;
          setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y });
        }}
        onMouseUp={(e) => {
          const d = drag.current;
          drag.current = null;
          // A click without a drag: toggle between fit and 2×.
          if (d && Math.abs(e.clientX - d.x) < 3 && Math.abs(e.clientY - d.y) < 3 && (e.target as HTMLElement).tagName === 'IMG') {
            if (zoom === 1) setZoom(2);
            else reset();
          }
        }}
        onMouseLeave={() => {
          drag.current = null;
        }}
      >
        <img
          src={image.src}
          alt={image.alt ?? ''}
          draggable={false}
          className="absolute top-1/2 left-1/2 max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] select-none object-contain shadow-2xl transition-transform duration-75"
          style={{ transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})` }}
        />
        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              className="absolute top-1/2 left-3 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white/90 hover:bg-black/70"
              aria-label="Previous image"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              className="absolute top-1/2 right-3 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white/90 hover:bg-black/70"
              aria-label="Next image"
            >
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ViewerButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="grid size-8 place-items-center rounded-md hover:bg-white/10">
      {children}
    </button>
  );
}
