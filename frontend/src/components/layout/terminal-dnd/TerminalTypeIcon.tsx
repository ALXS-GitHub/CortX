import { FileCode, ScrollText, SquareTerminal, Terminal } from 'lucide-react';
import type { TerminalType } from './types';

/** Icon for a terminal tab kind (service, project script, global script, shell). */
export function TerminalTypeIcon({ type, className }: { type: TerminalType; className?: string }) {
  switch (type) {
    case 'script':
      return <FileCode className={className} />;
    case 'global-script':
      return <ScrollText className={className} />;
    case 'shell':
      return <SquareTerminal className={className} />;
    default:
      return <Terminal className={className} />;
  }
}
