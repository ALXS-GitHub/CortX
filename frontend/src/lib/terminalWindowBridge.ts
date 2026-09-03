/**
 * Tiny indirection so `appStore` can hand a terminal over to the Terminal
 * window without importing `terminalLayoutStore` (which imports `appStore`).
 * The layout store registers the handler at module load.
 */
let focusHandler: ((terminalId: string) => void) | null = null;

export function registerFocusInTerminalWindow(handler: (terminalId: string) => void) {
  focusHandler = handler;
}

/** Show `terminalId` in the Terminal window (it already lives there). */
export function focusInTerminalWindow(terminalId: string): boolean {
  if (!focusHandler) return false;
  focusHandler(terminalId);
  return true;
}

let sendHandler: ((terminalId: string, projectId?: string | null) => void) | null = null;

export function registerSendToTerminalWindow(handler: (terminalId: string, projectId?: string | null) => void) {
  sendHandler = handler;
}

/** Place a (new) terminal in the Terminal window instead of the dock. */
export function sendToTerminalWindow(terminalId: string, projectId?: string | null): boolean {
  if (!sendHandler) return false;
  sendHandler(terminalId, projectId);
  return true;
}
