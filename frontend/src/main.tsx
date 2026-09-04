import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './index.css'
// Terminal styles are kept out of index.css (which the design system
// regenerates and truncates); importing here guarantees they load.
import './styles/terminal-window.css'
import App from './App.tsx'
import { TerminalWindow } from './windows/TerminalWindow.tsx'

// The dedicated Terminal window (DEV-13) loads the same bundle; the window
// label decides which root renders.
const isTerminalWindow = (() => {
  try {
    const label = getCurrentWindow().label;
    // `terminal`, plus `terminal-2`, `terminal-3`… for the windows a tab was
    // detached into (ticket #20).
    return label === 'terminal' || label.startsWith('terminal-');
  } catch {
    return false;
  }
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isTerminalWindow ? <TerminalWindow /> : <App />}
  </StrictMode>,
)
