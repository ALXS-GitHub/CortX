/**
 * What a history row can be asked to do, and who does it (#39).
 *
 * The three actions a row shares with a command block on screen — run it
 * again, put it back at the prompt, copy it — are not re-declared here: they
 * are pulled out of `blockActions` by id (see `HISTORY_BLOCK_ACTIONS`). That
 * keeps one source of truth for their wording and, more importantly, for when
 * they are refused: "put back at the prompt" is disabled while the shell is
 * busy or while the universal input editor owns the line, and a history row
 * has to obey exactly the same rule — it writes into the same PTY.
 *
 * The two the record adds are its directory, which a live block does not carry
 * as data: copy it, or open it in the file explorer.
 */
import { toast } from 'sonner';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { blockActions, type BlockActionId, type BlockActionSpec } from '@/lib/terminalBlockModel';
import { focusTerminal } from '@/lib/terminalSessions';
import { openInExplorer, writeTerminal, type HistoryRecord } from '@/lib/tauri';
import { useAppStore } from '@/stores/appStore';
import { activeTerminalId } from '../actions';
import {
  HISTORY_BLOCK_ACTIONS,
  historyCommandLabel,
  recordActionContext,
  type HistoryActionId,
} from './historyModel';

export interface HistoryActionSpec extends Omit<BlockActionSpec, 'id'> {
  id: HistoryActionId;
}

/** Where "run again" and "put back at the prompt" would land, and its state. */
export interface HistoryTarget {
  /** The active pane — not the terminal the command originally ran in, which
   *  may well be closed by now. */
  terminalId: string | null;
  /** The target shell is at a prompt (nothing of ours running in it). */
  atPrompt: boolean;
  /** The universal input editor owns the prompt line (ticket #15). */
  inputEditor: boolean;
}

/**
 * The target, as a subscription: the disabled state of half the row's actions
 * depends on whether the active shell is busy, so the view has to re-render
 * when that changes rather than read it once when it opened.
 */
export function useHistoryTarget(open: boolean): HistoryTarget {
  const states = useAppStore((s) => s.terminalStates);
  const inputEditor = useAppStore((s) => s.settings?.terminal.inputEditor === true);
  const terminalId = open ? activeTerminalId() : null;
  return {
    terminalId,
    atPrompt: terminalId ? states.get(terminalId)?.phase !== 'running' : false,
    inputEditor,
  };
}

/**
 * The actions of one row, in the order they are shown. Like the block toolbar,
 * nothing is ever dropped: an action that cannot run right now comes back
 * `disabled` with the hint saying why, so the row does not change shape under
 * the pointer.
 */
export function historyActionSpecs(record: HistoryRecord, target: HistoryTarget): HistoryActionSpec[] {
  const context = recordActionContext(record, target);
  const fromBlock = new Map<BlockActionId, BlockActionSpec>(blockActions(context).map((a) => [a.id, a]));
  const borrowed: HistoryActionSpec[] = HISTORY_BLOCK_ACTIONS.flatMap((id) => {
    const spec = fromBlock.get(id);
    if (!spec) return [];
    // The one reason a *record* cannot be typed back that the block list has
    // no way of knowing: there is no pane to type it into.
    const noTarget = !target.terminalId && (id === 'rerun' || id === 'reinput');
    return [
      {
        ...spec,
        id,
        disabled: spec.disabled || noTarget,
        hint: noTarget ? 'no terminal' : spec.hint,
        separated: false,
      },
    ];
  });
  const hasCwd = Boolean(record.cwd);
  return [
    ...borrowed,
    { id: 'copyCwd', label: 'Copy directory', disabled: !hasCwd, primary: false, separated: true },
    { id: 'openCwd', label: 'Open directory', disabled: !hasCwd, primary: true },
  ];
}

/** The command of a record on one line, ready to be typed into a PTY. */
export function commandLine(record: HistoryRecord): string {
  return (record.command ?? '').split('\n')[0]?.trim() ?? '';
}

/**
 * Run one action against a record. Returns false when nothing was done, so
 * the caller can leave the view open on a failure.
 *
 * `rerun` and `reinput` are the same two writes the block toolbar makes:
 * `command + CR` submits, `command` alone leaves it editable.
 */
export async function runHistoryAction(
  id: HistoryActionId,
  record: HistoryRecord,
  target: HistoryTarget
): Promise<boolean> {
  const command = commandLine(record);
  switch (id) {
    case 'copyCommand': {
      if (!command) return false;
      try {
        await writeText(command);
      } catch (error) {
        toast.error(`Failed to copy: ${String(error)}`);
        return false;
      }
      toast.success('Command copied', { description: historyCommandLabel(command, 64) });
      return true;
    }
    case 'copyCwd': {
      if (!record.cwd) return false;
      try {
        await writeText(record.cwd);
      } catch (error) {
        toast.error(`Failed to copy: ${String(error)}`);
        return false;
      }
      toast.success('Path copied', { description: record.cwd });
      return true;
    }
    case 'openCwd': {
      if (!record.cwd) return false;
      try {
        await openInExplorer(record.cwd);
      } catch (error) {
        toast.error(`Failed to open ${record.cwd}`, { description: String(error) });
        return false;
      }
      return true;
    }
    case 'rerun':
    case 'reinput': {
      const terminalId = target.terminalId;
      if (!command || !terminalId) return false;
      const submit = id === 'rerun';
      try {
        await writeTerminal(terminalId, submit ? `${command}\r` : command);
      } catch (error) {
        toast.error(submit ? 'Could not run the command again' : 'Could not put the command back at the prompt', {
          description: String(error),
        });
        return false;
      }
      focusTerminal(terminalId);
      return true;
    }
  }
}
