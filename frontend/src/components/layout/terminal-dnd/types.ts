import type { ServiceStatus, ScriptStatus, LogEntry } from '@/types';

export type TerminalType = 'service' | 'script' | 'global-script';

export interface TerminalItem {
  id: string;
  type: TerminalType;
  name: string;
  projectName: string;
  projectId: string;
  status: ServiceStatus | ScriptStatus;
  logs: LogEntry[];
  detectedPort?: number;
  activeMode?: string;
  lastExitCode?: number;
  lastSuccess?: boolean;
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
