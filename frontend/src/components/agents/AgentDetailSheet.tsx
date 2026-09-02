import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useAppStore } from '@/stores/appStore';
import type { AgentSession } from '@/types';
import { AgentDetailHeader } from './AgentDetailHeader';
import { AgentDetailAnnotations } from './AgentDetailAnnotations';
import { projectLabel, type AgentActionHandlers } from './agentUtils';

/** Height of `TitleBar` (`h-9`). */
const TITLE_BAR_HEIGHT = '2.25rem';

// The transcript pulls streamdown + shiki: keep them out of the main chunk.
const AgentTranscript = lazy(() => import('./AgentTranscript'));

/** Clicks inside these keep the (non-modal) sheet open; the list handles its own toggling. */
const KEEP_OPEN_SELECTOR = [
  '[data-agents-list]',
  '[data-slot=dropdown-menu-content]',
  '[data-slot=popover-content]',
  '[data-slot=dialog-content]',
  '[data-slot=select-content]',
  '[data-radix-popper-content-wrapper]',
  '[data-sonner-toaster]',
].join(', ');

interface AgentDetailSheetProps {
  session: AgentSession | null;
  onClose: () => void;
  actions: AgentActionHandlers;
  changeToken: number;
}

/**
 * Right-side detail panel. Non-modal so the list stays usable: clicking another
 * row switches, clicking the same row (or the X / Escape) closes.
 */
export function AgentDetailSheet({ session, onClose, actions, changeToken }: AgentDetailSheetProps) {
  const projects = useAppStore((s) => s.projects);

  return (
    <Sheet open={!!session} onOpenChange={(open) => { if (!open) onClose(); }} modal={false}>
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:w-[60vw] data-[side=right]:sm:max-w-none p-0 gap-0 shadow-2xl"
        // Stay below the custom title bar (h-9): the sheet must never cover the
        // window controls / drag region.
        style={{ top: TITLE_BAR_HEIGHT, height: `calc(100% - ${TITLE_BAR_HEIGHT})` }}
        onInteractOutside={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest(KEEP_OPEN_SELECTOR)) e.preventDefault();
        }}
      >
        {session && (
          <>
            <SheetHeader className="border-b p-4 pr-12 gap-3">
              <SheetTitle className="sr-only">{session.title}</SheetTitle>
              <SheetDescription className="sr-only">Agent session details and transcript</SheetDescription>
              <AgentDetailHeader session={session} project={projectLabel(session, projects)} actions={actions} />
              <AgentDetailAnnotations session={session} />
            </SheetHeader>
            <Suspense
              fallback={
                <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading transcript…
                </div>
              }
            >
              <AgentTranscript
                key={session.id}
                sessionId={session.id}
                sessionState={session.state}
                changeToken={changeToken}
              />
            </Suspense>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
