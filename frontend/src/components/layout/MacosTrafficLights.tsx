import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { setMacosTrafficLightsPosition } from '@/lib/tauri';

// Approximate width occupied by the three traffic-light buttons plus the
// trailing right margin we want to leave. 3 * 14 (button) + 2 * 6 (spacing)
// + ~28 (margin) ≈ 82, rounded up.
const RIGHT_OFFSET = 90;

// Top inset for the buttons — tao's helper interprets this as "px from the
// top of the window". 12 centers a ~12px button vertically inside our 36px
// TitleBar, which is the row where the Windows-style hide/max/close buttons
// live on Win/Linux.
const Y_INSET = 12;

const isMac = typeof navigator !== 'undefined'
  && /mac/i.test(navigator.platform || (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform || '');

/**
 * Repositions the macOS traffic-light buttons to the right side of the
 * TitleBar — the same row where the Windows hide/maximize/close buttons
 * are rendered on Win/Linux. The X position depends on the window width,
 * so we re-compute it on every window resize. No-op on Windows/Linux.
 *
 * Renders nothing.
 */
export function MacosTrafficLights() {
  const [innerWidth, setInnerWidth] = useState<number | null>(null);

  useEffect(() => {
    if (!isMac) return;

    const win = getCurrentWindow();
    let cancelled = false;

    // Initial size
    win.innerSize()
      .then((size) => {
        if (cancelled) return;
        // innerSize is in physical pixels; divide by scale factor for logical px.
        return win.scaleFactor().then((sf) => {
          if (cancelled) return;
          setInnerWidth(size.width / sf);
        });
      })
      .catch(console.warn);

    // Update on every resize
    const unlistenPromise = win.onResized(({ payload }) => {
      win.scaleFactor().then((sf) => {
        if (cancelled) return;
        setInnerWidth(payload.width / sf);
      }).catch(console.warn);
    });

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!isMac || innerWidth == null) return;

    const x = Math.max(0, innerWidth - RIGHT_OFFSET);
    setMacosTrafficLightsPosition(x, Y_INSET).catch((err) => {
      console.warn('Failed to reposition macOS traffic lights:', err);
    });
  }, [innerWidth]);

  return null;
}
