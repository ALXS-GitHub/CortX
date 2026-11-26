import { writeTerminal } from '@/lib/tauri';
import { KEY_ENTER, keysToOption, type AgentMenu, type AgentMenuOption } from '../agentMenu';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Keys sent one at a time, a moment apart: a TUI reading a chunk as one key would miss the rest. */
async function sendKeys(terminalId: string, keys: string[]) {
  for (const key of keys) {
    await writeTerminal(terminalId, key);
    await sleep(35);
  }
}

/**
 * Pick an option of the agent's menu: the arrows from where its pointer is
 * to the option, then Enter — what you would have typed in the terminal. For
 * a free-text option ("Type something"), the text is typed into it first.
 * The agent decides what comes next; the view reads it off the screen.
 */
export async function pickMenuOption(terminalId: string, menu: AgentMenu, option: AgentMenuOption, text?: string) {
  await sendKeys(terminalId, keysToOption(menu, option.n));
  if (option.freeText && text) {
    await sleep(60);
    // One line: Enter in that field submits.
    await writeTerminal(terminalId, text.replace(/\s*\n\s*/g, ' '));
    await sleep(80);
  }
  await writeTerminal(terminalId, KEY_ENTER);
}

/** A key of the menu itself (↑ ↓ Enter Esc Tab), forwarded as is. */
export async function sendMenuKey(terminalId: string, key: string) {
  await writeTerminal(terminalId, key);
}
