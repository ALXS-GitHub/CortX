import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import {
  Bot,
  Check,
  ChevronRight,
  Circle,
  CircleDot,
  Copy,
  FileDiff,
  FilePlus2,
  FolderOpen,
  GitBranch,
  Globe,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  Plug,
  Search,
  SquareTerminal,
  X,
} from 'lucide-react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { agentGuiGitBranch, openAppUrl, openInEditor, openInExplorer } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import type { AgentMessage } from '@/types';
import { dataUrl, useLightbox } from './agentImageStore';
import { contextUsed, sessionPanel, type ItemStatus } from './sessionPanel';
import type { GuiAgentState } from './streamJson';

interface AgentSidePanelProps {
  state: GuiAgentState;
  messages: AgentMessage[];
  busy: boolean;
  cwd: string;
  /** Over the conversation (a narrow pane) rather than beside it. */
  overlay?: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
}

const STORE_KEY = 'cortx.agentPanel.closed';

/** Which sections are folded, remembered in this browser (a convenience). */
function useFolded(): [Set<string>, (id: string) => void] {
  const [folded, setFolded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const toggle = (id: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify([...next]));
      } catch {
        /* private mode: not remembered */
      }
      return next;
    });
  return [folded, toggle];
}

function Section({
  id,
  title,
  icon: Icon,
  count,
  folded,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  count?: ReactNode;
  folded: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border/50 py-2 last:border-b-0">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="flex-1">{title}</span>
        {count !== undefined && <span className="text-[11px] font-normal text-faint tabular-nums">{count}</span>}
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', !folded && 'rotate-90')} />
      </button>
      {!folded && <div className="px-3 pt-1.5 pb-1">{children}</div>}
    </section>
  );
}

function Fact({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 py-0.5 text-xs" title={title}>
      <span className="w-16 shrink-0 text-faint">{label}</span>
      <span className="min-w-0 flex-1 truncate text-foreground">{children}</span>
    </div>
  );
}

function StatusIcon({ status }: { status: ItemStatus | 'stopped' }) {
  if (status === 'running') return <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />;
  if (status === 'done') return <Check className="size-3.5 shrink-0 text-st-done" />;
  if (status === 'stopped') return <Circle className="size-3.5 shrink-0 text-faint" />;
  return <X className="size-3.5 shrink-0 text-st-blocked" />;
}

const MODE_LABEL: Record<string, string> = {
  default: 'Ask permissions',
  acceptEdits: 'Accept edits',
  plan: 'Plan mode',
  bypassPermissions: 'Bypass permissions',
  dontAsk: "Don't ask",
  auto: 'Auto',
};

/**
 * The side panel of the agent view (ticket CORT-62), the way the Claude
 * desktop app has one: the session (model, folder, branch, version), how
 * full its context is, its connectors, and what the agent is working
 * through — the to-do list, the sub-agents, the background commands, the
 * files it changed, the images, the web pages it read.
 */
export function AgentSidePanel({ state, messages, busy, cwd, overlay = false }: AgentSidePanelProps) {
  const [folded, toggle] = useFolded();
  const panel = useMemo(() => sessionPanel(messages, busy), [messages, busy]);
  const openImages = useLightbox((s) => s.open);
  const dir = state.info.cwd ?? cwd;

  // The branch, again after each turn (the agent may have switched it).
  const [branch, setBranch] = useState<string | null>(null);
  useEffect(() => {
    if (!dir || busy) return;
    let alive = true;
    agentGuiGitBranch(dir)
      .then((b) => alive && setBranch(b))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [dir, busy, state.turns]);

  const used = contextUsed(state.usage);
  const ctxWindow = state.contextWindow;
  const pct = ctxWindow ? Math.min(100, Math.round((used / ctxWindow) * 100)) : null;
  const todosDone = panel.todos.filter((t) => t.status === 'completed').length;
  const runningAgents = panel.subagents.filter((a) => a.status === 'running').length;
  const runningBg = panel.background.filter((b) => b.status === 'running').length;
  const connected = state.info.mcpServers.filter((m) => m.status === 'connected').length;

  return (
    <aside
      className={cn(
        'flex h-full w-72 shrink-0 flex-col border-l border-border/60',
        overlay ? 'absolute top-0 right-0 bottom-0 z-20 bg-popover shadow-pop' : 'bg-card/40 backdrop-blur-sm',
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section id="session" title="Environment" icon={SquareTerminal} folded={folded.has('session')} onToggle={toggle}>
          {state.model && <Fact label="Model">{<span className="font-mono text-[11px]">{state.model}</span>}</Fact>}
          <Fact label="Mode">{MODE_LABEL[state.permissionMode ?? 'default'] ?? state.permissionMode}</Fact>
          {dir && (
            <Fact label="Folder" title={dir}>
              <button
                type="button"
                onClick={() => void openInExplorer(dir)}
                className="inline-flex max-w-full items-center gap-1 hover:text-primary"
              >
                <FolderOpen className="size-3 shrink-0" />
                <span className="truncate font-mono text-[11px]">{dir.split(/[\\/]/).filter(Boolean).pop()}</span>
              </button>
            </Fact>
          )}
          {branch && (
            <Fact label="Branch">
              <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                <GitBranch className="size-3 shrink-0" />
                {branch}
              </span>
            </Fact>
          )}
          {state.info.version && <Fact label="Version">Claude Code {state.info.version}</Fact>}
          {state.info.account && <Fact label="Account">{state.info.account}</Fact>}
          {state.sessionId && (
            <Fact label="Session" title={state.sessionId}>
              <button
                type="button"
                onClick={() => void writeText(state.sessionId!)}
                className="inline-flex max-w-full items-center gap-1 font-mono text-[11px] hover:text-primary"
              >
                <Copy className="size-3 shrink-0" />
                <span className="truncate">{state.sessionId.slice(0, 8)}</span>
              </button>
            </Fact>
          )}
        </Section>

        <Section
          id="context"
          title="Context"
          icon={CircleDot}
          count={pct !== null ? `${pct}%` : used ? formatTokens(used) : undefined}
          folded={folded.has('context')}
          onToggle={toggle}
        >
          {used > 0 ? (
            <>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    pct !== null && pct > 85 ? 'bg-st-blocked' : pct !== null && pct > 60 ? 'bg-st-progress' : 'bg-primary',
                  )}
                  style={{ width: `${pct ?? 0}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {formatTokens(used)}
                {ctxWindow ? ` of ${formatTokens(ctxWindow)} tokens` : ' tokens'}
              </p>
            </>
          ) : (
            <p className="text-[11px] text-faint">Nothing used yet.</p>
          )}
          {(state.costUsd !== null || state.turns > 0) && (
            <p className="mt-1 text-[11px] text-faint">
              {state.turns > 0 && `${state.turns} turn${state.turns === 1 ? '' : 's'}`}
              {state.turns > 0 && state.costUsd !== null && ' · '}
              {state.costUsd !== null && `$${state.costUsd.toFixed(2)}`}
            </p>
          )}
        </Section>

        {panel.todos.length > 0 && (
          <Section
            id="todos"
            title="Tasks"
            icon={ListChecks}
            count={`${todosDone}/${panel.todos.length}`}
            folded={folded.has('todos')}
            onToggle={toggle}
          >
            <ul className="space-y-1">
              {panel.todos.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  {t.status === 'completed' ? (
                    <Check className="mt-0.5 size-3.5 shrink-0 text-st-done" />
                  ) : t.status === 'in_progress' ? (
                    <CircleDot className="mt-0.5 size-3.5 shrink-0 animate-pulse text-primary" />
                  ) : (
                    <Circle className="mt-0.5 size-3.5 shrink-0 text-faint" />
                  )}
                  <span
                    className={cn(
                      'min-w-0 break-words',
                      t.status === 'completed' && 'text-muted-foreground line-through',
                      t.status === 'in_progress' && 'font-medium text-foreground',
                    )}
                  >
                    {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {panel.subagents.length > 0 && (
          <Section
            id="agents"
            title="Sub-agents"
            icon={Bot}
            count={runningAgents > 0 ? `${runningAgents} running` : panel.subagents.length}
            folded={folded.has('agents')}
            onToggle={toggle}
          >
            <ul className="space-y-1.5">
              {panel.subagents.map((a) => (
                <li key={a.id} className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5">
                    <StatusIcon status={a.status} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground" title={a.description}>
                      {a.description}
                    </span>
                    {a.kind && <span className="block text-[11px] text-faint">{a.kind}</span>}
                    {a.status === 'running' && state.subagents[a.id] && (
                      <span className="block truncate text-[11px] text-muted-foreground">↳ {state.subagents[a.id]}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {panel.background.length > 0 && (
          <Section
            id="background"
            title="Background"
            icon={SquareTerminal}
            count={runningBg > 0 ? `${runningBg} running` : panel.background.length}
            folded={folded.has('background')}
            onToggle={toggle}
          >
            <ul className="space-y-1.5">
              {panel.background.map((b) => (
                <li key={b.id} className="flex items-start gap-2 text-xs" title={b.command}>
                  <span className="mt-0.5">
                    <StatusIcon status={b.status === 'running' ? 'running' : b.status === 'stopped' ? 'stopped' : 'failed'} />
                  </span>
                  <span className="min-w-0 flex-1">
                    {b.description && <span className="block truncate text-foreground">{b.description}</span>}
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">{b.command}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {panel.changes.length > 0 && (
          <Section
            id="changes"
            title="Changes"
            icon={FileDiff}
            count={panel.changes.length}
            folded={folded.has('changes')}
            onToggle={toggle}
          >
            <ul className="space-y-0.5">
              {panel.changes.map((c) => (
                <li key={c.path}>
                  <button
                    type="button"
                    onClick={() => void openInEditor(c.path)}
                    className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs hover:bg-accent"
                    title={`${c.path} — open in the editor`}
                  >
                    {c.created ? (
                      <FilePlus2 className="size-3.5 shrink-0 text-st-done" />
                    ) : (
                      <FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{c.name}</span>
                    <span className="shrink-0 font-mono text-[10px]">
                      {c.added > 0 && <span className="text-st-done">+{c.added}</span>}
                      {c.removed > 0 && <span className="ml-1 text-st-blocked">−{c.removed}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {panel.images.length > 0 && (
          <Section id="images" title="Images" icon={ImageIcon} count={panel.images.length} folded={folded.has('images')} onToggle={toggle}>
            <div className="grid grid-cols-3 gap-1.5">
              {panel.images.map((img, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() =>
                    openImages(
                      panel.images.map((x) => ({
                        src: dataUrl(x.image),
                        alt: x.label,
                      })),
                      i,
                    )
                  }
                  className="aspect-square overflow-hidden rounded-lg border border-border bg-muted/40 hover:ring-2 hover:ring-primary/50"
                  title={img.label}
                >
                  <img src={dataUrl(img.image)} alt={img.label} className="size-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          </Section>
        )}

        {panel.sources.length > 0 && (
          <Section id="sources" title="Sources" icon={Globe} count={panel.sources.length} folded={folded.has('sources')} onToggle={toggle}>
            <ul className="space-y-0.5">
              {panel.sources.map((src, i) => (
                <li key={i}>
                  {src.url ? (
                    <button
                      type="button"
                      onClick={() => void openAppUrl(src.url!)}
                      className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs hover:bg-accent"
                      title={src.url}
                    >
                      <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-foreground">{src.label}</span>
                    </button>
                  ) : (
                    <span className="flex items-center gap-2 px-1 py-0.5 text-xs text-muted-foreground">
                      <Search className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{src.label}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section
          id="connectors"
          title="Connectors"
          icon={Plug}
          count={state.info.mcpServers.length > 0 ? `${connected}/${state.info.mcpServers.length}` : undefined}
          folded={folded.has('connectors')}
          onToggle={toggle}
        >
          {state.info.mcpServers.length === 0 ? (
            <p className="text-[11px] text-faint">{state.initialized ? 'No MCP server.' : 'Known once Claude has started.'}</p>
          ) : (
            <ul className="space-y-0.5">
              {state.info.mcpServers.map((m) => (
                <li key={m.name} className="flex items-center gap-2 py-0.5 text-xs">
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      m.status === 'connected' ? 'bg-st-done' : m.status === 'pending' ? 'animate-pulse bg-st-progress' : 'bg-st-blocked',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground">{m.name}</span>
                  <span className="text-[11px] text-faint">{m.status}</span>
                </li>
              ))}
            </ul>
          )}
          {(state.info.skills.length > 0 || state.info.plugins.length > 0 || state.info.tools > 0) && (
            <p className="mt-1.5 text-[11px] text-faint">
              {[
                state.info.tools > 0 && `${state.info.tools} tools`,
                state.info.skills.length > 0 && `${state.info.skills.length} skills`,
                state.info.plugins.length > 0 && `${state.info.plugins.length} plugins`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </Section>
      </div>
    </aside>
  );
}
