import type { ServiceStatus, ScriptStatus, LogEntry, TerminalShellState } from '@/types';
import type { TerminalAttention } from '@/stores/appStore';

export type TerminalType = 'service' | 'script' | 'global-script' | 'shell';

export interface TerminalItem {
  id: string;
  type: TerminalType;
  name: string;
  projectName: string;
  projectId: string;
  status: ServiceStatus | ScriptStatus;
  logs: LogEntry[];
  detectedPorts: number[];
  activeMode?: string;
  lastExitCode?: number;
  lastSuccess?: boolean;
  /** Shell tabs: working directory the shell was opened in. */
  cwd?: string;
  /** Live shell-integration state (cwd, running command, last exit code). */
  shell?: TerminalShellState;
  /** A command finished while this tab was not in view. */
  attention?: TerminalAttention;
}

export interface DragData {
  terminalId: string;
  paneId: string;
  terminal: TerminalItem;
}

export interface EdgeDropData {
  type: 'edge';
  position: 'left' | 'right';
  referencePaneId: string;
}

export interface PaneDropData {
  type: 'pane';
  paneId: string;
}

export interface TabDropData {
  type: 'tab';
  terminalId: string;
  paneId: string;
}

export type DropData = EdgeDropData | PaneDropData | TabDropData;
