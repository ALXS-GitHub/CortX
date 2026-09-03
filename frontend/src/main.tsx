import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './index.css'
import App from './App.tsx'
import { TerminalWindow } from './windows/TerminalWindow.tsx'

// The dedicated Terminal window (DEV-13) loads the same bundle; the window
// label decides which root renders.
const isTerminalWindow = (() => {
  try {
    return getCurrentWindow().label === 'terminal';
  } catch {
    return false;
  }
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isTerminalWindow ? <TerminalWindow /> : <App />}
  </StrictMode>,
)
