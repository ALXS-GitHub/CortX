import { getCurrentWindow } from '@tauri-apps/api/window';

/** This window, for the custom title bars (main and Terminal windows). */
export const appWindow = getCurrentWindow();

// macOS draws its own traffic-light buttons (see `trafficLightPosition` in
// tauri.conf.json); we hide our custom minimize/maximize/close there.
export const isMac = typeof navigator !== 'undefined'
  && /mac/i.test(navigator.platform || (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform || '');
