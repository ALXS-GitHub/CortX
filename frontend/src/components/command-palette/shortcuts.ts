import type { KeyBinding } from './types';

/** Canonical bindings reused across entities so the same verb shares one key. */
export const SHORTCUTS = {
  primary:       { key: 'Enter' } satisfies KeyBinding,
  openInCortx:   { key: 'Enter', meta: true } satisfies KeyBinding,
  openFolder:    { key: 'o', meta: true } satisfies KeyBinding,
  openVSCode:    { key: 'c', meta: true, shift: true } satisfies KeyBinding,
  openConfig:    { key: ',', meta: true } satisfies KeyBinding,
  openHomepage:  { key: 'h', meta: true } satisfies KeyBinding,
  openInstall:   { key: 'o', meta: true } satisfies KeyBinding,
  toggleActions: { key: 'k', meta: true } satisfies KeyBinding,
};

/** True if the keyboard event matches the given binding. */
export function matchesShortcut(e: KeyboardEvent, b: KeyBinding): boolean {
  const wantMeta = !!b.meta;
  const wantShift = !!b.shift;
  const wantAlt = !!b.alt;

  const gotMeta = e.metaKey || e.ctrlKey;
  if (wantMeta !== gotMeta) return false;
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;

  // For letter keys, match case-insensitively. For others, match exact.
  if (b.key.length === 1) {
    return e.key.toLowerCase() === b.key.toLowerCase();
  }
  return e.key === b.key;
}

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

/** Render a shortcut as printable tokens, e.g. ["⌘", "↵"] or ["Ctrl", "Shift", "C"]. */
export function formatShortcut(b: KeyBinding): string[] {
  const parts: string[] = [];
  if (b.meta) parts.push(IS_MAC ? '⌘' : 'Ctrl');
  if (b.shift) parts.push(IS_MAC ? '⇧' : 'Shift');
  if (b.alt) parts.push(IS_MAC ? '⌥' : 'Alt');

  let key = b.key;
  if (key === 'Enter') key = '↵';
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts;
}
