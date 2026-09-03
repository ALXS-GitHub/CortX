import { useRef } from 'react';
import { Copy, CopyPlus, FolderOpen, Palette, Pencil, Pin, PinOff, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import type { TerminalTab } from '@/lib/terminalLayout';
import { comboLabelFor } from '@/lib/keybindings';
import { ACCENT_PRESETS } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { copyTerminalCwd, duplicateTab, openTerminalCwd, terminalCwd } from './actions';
import { activeLeafOf } from './model';

/**
 * The pieces a terminal tab shares between the tab strip and the sessions
 * rail: the rename field, the colour swatches and the right-click menu
 * (rename / pin / duplicate / path / colour / close). The hooks live in
 * `useTabMenu.ts`.
 */

/** Colour swatches of the context menu (theme accent presets, or none). */
export function ColorRow({ current, onPick }: { current: string | null; onPick: (color: string | null) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5">
      <button
        type="button"
        onClick={() => onPick(null)}
        title="No colour"
        aria-label="No colour"
        className={cn(
          'grid size-4 place-items-center rounded-full border border-border-strong text-faint transition-colors hover:border-foreground',
          current === null && 'ring-2 ring-ring/60 ring-offset-1 ring-offset-background'
        )}
      >
        <X className="size-2.5" />
      </button>
      {ACCENT_PRESETS.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onPick(c.value)}
          title={c.name}
          aria-label={c.name}
          className={cn(
            'size-4 rounded-full transition-transform hover:scale-110',
            current === c.value && 'ring-2 ring-ring/60 ring-offset-1 ring-offset-background'
          )}
          style={{ backgroundColor: c.value }}
        />
      ))}
    </div>
  );
}

/**
 * The rename field. Enter commits, Escape cancels, leaving the field commits.
 * Pointer events stop here so the surrounding tab neither selects nor starts
 * a drag while typing; a `done` flag keeps the blur that follows Escape from
 * committing anyway.
 */
export function TabRenameInput({
  value,
  onChange,
  onCommit,
  onCancel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit();
    else onCancel();
  };
  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
        e.stopPropagation();
      }}
      onBlur={() => finish(true)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      className={cn('h-6 rounded-[var(--rad-xs)] px-1.5 text-xs shadow-none', className)}
      aria-label="Tab title"
    />
  );
}

interface TabContextMenuProps {
  tab: TerminalTab;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pointer position relative to the (positioned) tab element. */
  pos: { x: number; y: number };
  onRename: () => void;
  onClose: () => void;
}

/**
 * Right-click menu of a tab. Render it inside the tab element (which must be
 * `relative`): the trigger never receives pointer events, so it cannot fight
 * the drag sensor, and events from the portaled content are stopped so they
 * do not bubble back into the tab (select, rename, drag).
 */
export function TabContextMenu({ tab, open, onOpenChange, pos, onRename, onClose }: TabContextMenuProps) {
  const togglePinTab = useTerminalLayoutStore((s) => s.togglePinTab);
  const setTabColor = useTerminalLayoutStore((s) => s.setTabColor);
  const keybindings = useAppStore((s) => s.settings?.terminal.keybindings);
  const terminalId = activeLeafOf(tab).terminalId;
  // Read at open time only: the cwd is live state, the menu a snapshot.
  const cwd = open ? terminalCwd(terminalId) ?? activeLeafOf(tab).cwd ?? null : null;
  const shortcut = (label: string | null) => (label ? <DropdownMenuShortcut>{label}</DropdownMenuShortcut> : null);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <span className="pointer-events-none absolute size-0" style={{ left: pos.x, top: pos.y }} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-52"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <DropdownMenuItem onClick={onRename}>
          <Pencil />
          Rename
          {shortcut(comboLabelFor('tab.rename', keybindings))}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => togglePinTab(tab.id)}>
          {tab.pinned ? <PinOff /> : <Pin />}
          {tab.pinned ? 'Unpin' : 'Pin'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void duplicateTab(tab.id)}>
          <CopyPlus />
          Duplicate tab
          {shortcut(comboLabelFor('tab.duplicate', keybindings))}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!cwd} onClick={() => void copyTerminalCwd(terminalId)}>
          <Copy />
          Copy path
          {shortcut(comboLabelFor('terminal.copyCwd', keybindings))}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!cwd} onClick={() => void openTerminalCwd(terminalId)}>
          <FolderOpen />
          Open in Explorer
          {shortcut(comboLabelFor('terminal.openCwd', keybindings))}
        </DropdownMenuItem>
        {cwd && <p className="truncate px-2 pb-1 font-mono text-[10.5px] text-faint">{cwd}</p>}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2">
          <Palette className="size-3.5 text-muted-foreground" />
          Colour
        </DropdownMenuLabel>
        <ColorRow
          current={tab.color}
          onPick={(color) => {
            setTabColor(tab.id, color);
            onOpenChange(false);
          }}
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onClose}>
          <X />
          Close
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
