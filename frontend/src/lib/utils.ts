import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a command for display, replacing {{SCRIPT_FILE}} with {{SCRIPT_FILE:filename}}
 */
export function formatCommandDisplay(command: string, scriptPath?: string | null): string {
  if (!scriptPath || !command.includes('{{SCRIPT_FILE}}')) return command;
  const filename = scriptPath.replace(/\\/g, '/').split('/').pop() || scriptPath;
  return command.replace('{{SCRIPT_FILE}}', `{{SCRIPT_FILE:${filename}}}`);
}
