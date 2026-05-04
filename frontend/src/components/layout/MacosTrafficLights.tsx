import { useEffect } from 'react';
import { useSidebar } from '@/components/ui/sidebar';
import { setMacosTrafficLightsPosition } from '@/lib/tauri';

// Width of the sidebar when in icon-only (collapsed) mode. Matches
// SIDEBAR_WIDTH_ICON = "3rem" in components/ui/sidebar.tsx.
const SIDEBAR_WIDTH_ICON_PX = 48;

// Padding between the right edge of the sidebar and the leftmost traffic-light.
const LEFT_PAD = 14;

// Top inset for the buttons — tao's title-bar inset uses an offset that
// approximates "px from the top of the window". 50 lands the buttons in
// the second row (the SidebarInset header that sits below our 36px
// custom TitleBar) so they read as part of the right-side top bar.
const Y_INSET = 50;

const isMac = typeof navigator !== 'undefined'
  && /mac/i.test(navigator.platform || (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform || '');

/**
 * Repositions the macOS traffic-light buttons to the left edge of the
 * right-side top bar (i.e. just past the sidebar) whenever the sidebar
 * collapses, expands, or is resized. No-op on Windows/Linux.
 *
 * Renders nothing — meant to be mounted once inside SidebarProvider.
 */
export function MacosTrafficLights() {
  const { state, width } = useSidebar();

  useEffect(() => {
    if (!isMac) return;

    const sidebarPx = state === 'collapsed' ? SIDEBAR_WIDTH_ICON_PX : width;
    const x = sidebarPx + LEFT_PAD;

    setMacosTrafficLightsPosition(x, Y_INSET).catch((err) => {
      console.warn('Failed to reposition macOS traffic lights:', err);
    });
  }, [state, width]);

  return null;
}
