/**
 * The block context menu (DEV-13 P4, ticket #7).
 *
 * Plain DOM on purpose. The blocks controller lives next to the xterm
 * instance, not inside React, and the same code has to work in the dock of the
 * main window — whose pane component (`layout/TerminalPanel.tsx`) is not ours
 * to mount things into — and in the Terminal window. A popup built here is
 * mounted on `document.body`, so it needs no host component at all, it cannot
 * be clipped by the pane, and it survives the session being re-parented
 * between the two surfaces.
 *
 * It is styled from the design tokens (`--popover`, `--border`…), which the
 * Terminal window rewrites from the active terminal theme — so the menu
 * follows the terminal's palette there and the app skin in the dock, exactly
 * like the rest of the chrome.
 */

import { blockIconSvg, type BlockIconId } from '@/lib/terminalBlockIcons';

export interface BlockMenuItem {
  label: string;
  /** Right-hand hint (a shortcut, a count). */
  hint?: string;
  /** The same glyph the hover toolbar uses, so the two read as one feature. */
  icon?: BlockIconId;
  disabled?: boolean;
  /** A separator is drawn above this item. */
  separated?: boolean;
  onSelect: () => void;
}

let open: { root: HTMLElement; dispose: () => void } | null = null;

/** Close the menu if one is open. Safe to call at any time. */
export function closeBlockMenu() {
  open?.dispose();
}

/**
 * Show `items` at viewport coordinates (`x`, `y`), flipped back inside the
 * window when it would overflow. `header` names the block the menu acts on.
 */
export function openBlockMenu(x: number, y: number, header: string, items: BlockMenuItem[]) {
  closeBlockMenu();
  if (items.length === 0) return;

  const root = document.createElement('div');
  root.className = 'cortx-block-menu';
  root.setAttribute('role', 'menu');

  if (header) {
    const title = document.createElement('div');
    title.className = 'cortx-block-menu-header';
    title.textContent = header;
    root.appendChild(title);
  }

  for (const item of items) {
    if (item.separated) {
      const rule = document.createElement('div');
      rule.className = 'cortx-block-menu-sep';
      root.appendChild(rule);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cortx-block-menu-item';
    button.setAttribute('role', 'menuitem');
    button.disabled = item.disabled === true;
    const left = document.createElement('span');
    left.className = 'cortx-block-menu-label';
    if (item.icon) left.appendChild(blockIconSvg(item.icon));
    const label = document.createElement('span');
    label.textContent = item.label;
    left.appendChild(label);
    button.appendChild(left);
    if (item.hint) {
      const hint = document.createElement('span');
      hint.className = 'cortx-block-menu-hint';
      hint.textContent = item.hint;
      button.appendChild(hint);
    }
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeBlockMenu();
      item.onSelect();
    });
    root.appendChild(button);
  }

  document.body.appendChild(root);

  // Measure, then place: the menu is opened at a pointer that can be anywhere.
  const rect = root.getBoundingClientRect();
  const left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4));
  const top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4));
  root.style.left = `${Math.round(left)}px`;
  root.style.top = `${Math.round(top)}px`;

  const onPointerDown = (e: Event) => {
    if (!root.contains(e.target as Node)) closeBlockMenu();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeBlockMenu();
    }
  };
  const onScroll = () => closeBlockMenu();

  // Capturing, so a click inside a terminal pane closes the menu before the
  // pane's own handlers (selection, focus) run.
  document.addEventListener('mousedown', onPointerDown, true);
  document.addEventListener('contextmenu', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('blur', onScroll);
  window.addEventListener('resize', onScroll);

  const dispose = () => {
    if (open?.root !== root) return;
    open = null;
    document.removeEventListener('mousedown', onPointerDown, true);
    document.removeEventListener('contextmenu', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('blur', onScroll);
    window.removeEventListener('resize', onScroll);
    root.remove();
  };
  open = { root, dispose };
}
