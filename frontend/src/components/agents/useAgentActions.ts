import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import { getAgentResumeCommand, openInExplorer, resumeAgentSession } from '@/lib/tauri';
import type { AgentSession } from '@/types';
import type { AgentActionHandlers } from './agentUtils';

/**
 * Row / detail actions bound to the store. `onRename` is owned by the view so a
 * single rename dialog can serve every row.
 */
export function useAgentActions(onRename: (session: AgentSession) => void): AgentActionHandlers {
  const updateAgentAnnotations = useAppStore((s) => s.updateAgentAnnotations);

  const patch = async (session: AgentSession, changes: Partial<AgentSession['annotations']>, okMessage?: string) => {
    try {
      await updateAgentAnnotations(session.id, {
        ...session.annotations,
        ...changes,
        updatedAt: new Date().toISOString(),
      });
      if (okMessage) toast.success(okMessage);
    } catch (e) {
      toast.error('Failed to update session', { description: String(e) });
    }
  };

  const launch = async (session: AgentSession, fork: boolean) => {
    try {
      await resumeAgentSession(session.id, fork);
      toast.success(fork ? 'Forked session in a new terminal' : 'Resumed session in a new terminal', {
        description: session.title,
      });
    } catch (e) {
      toast.error(fork ? 'Failed to fork session' : 'Failed to resume session', { description: String(e) });
    }
  };

  return {
    resume: (session) => void launch(session, false),
    fork: (session) => void launch(session, true),
    copyResumeCommand: async (session) => {
      try {
        const cmd = await getAgentResumeCommand(session.id, false);
        await navigator.clipboard.writeText(cmd);
        toast.success('Resume command copied', { description: cmd });
      } catch (e) {
        toast.error('Failed to copy resume command', { description: String(e) });
      }
    },
    togglePin: (session) => void patch(session, { pinned: !session.annotations.pinned }),
    toggleHidden: (session) =>
      void patch(
        session,
        { hidden: !session.annotations.hidden },
        session.annotations.hidden ? 'Session unhidden' : 'Session hidden',
      ),
    rename: onRename,
    openFolder: (session) => {
      openInExplorer(session.cwd).catch((e) => toast.error('Failed to open folder', { description: String(e) }));
    },
  };
}
