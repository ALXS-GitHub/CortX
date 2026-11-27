/**
 * The list / detail layout of the settings (ticket #64), shared by the main
 * window's Settings screen and the Terminal window's settings panel.
 *
 * Left: a search field and the list of pages, a parent ("Terminal") drawn as
 * a heading with its pages indented under it. Right: the selected page — its
 * title, description and action, then its cards — or, while searching, every
 * matching card under the name of the page it belongs to.
 *
 * Pages are data (`SettingsPageDef`, see `settingsNav.ts`); the host renders
 * them through `renderPage`, and each `Section` inside decides whether it is
 * wanted through `SectionFilterContext`.
 */
import { Fragment, useEffect, useMemo, useRef, type ReactNode, type Ref } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { BetaBadge } from '@/components/ui/BetaBadge';
import { cn } from '@/lib/utils';
import { PageHeading } from './SettingsPrimitives';
import { SectionFilterContext, searchSettings, type SettingsPageDef } from './settingsNav';

export interface SettingsLayoutProps {
  pages: readonly SettingsPageDef[];
  selected: string;
  onSelect: (id: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** The page's cards. Called for the page view and for search results alike. */
  renderPage: (id: string) => ReactNode;
  /** Shown on the right of the page title (e.g. "3 changed"). */
  renderPageAction?: (id: string) => ReactNode;
  searchRef?: Ref<HTMLInputElement>;
  searchPlaceholder?: string;
  className?: string;
}

export function SettingsLayout({
  pages,
  selected,
  onSelect,
  query,
  onQueryChange,
  renderPage,
  renderPageAction,
  searchRef,
  searchPlaceholder = 'Search settings…',
  className,
}: SettingsLayoutProps) {
  const searching = query.trim() !== '';
  const hits = useMemo(() => searchSettings(pages, query), [pages, query]);
  const page = pages.find((p) => p.id === selected) ?? pages[0];
  // A new page, or a new search, starts at the top.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [page?.id, searching]);

  return (
    <div className={cn('flex h-full min-h-0', className)}>
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-border">
        <div className="p-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-8"
              aria-label="Search settings"
            />
          </div>
        </div>
        <nav aria-label="Settings pages" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <ul className="flex flex-col gap-0.5">
            {pages.map((p, i) => {
              const parent = p.parent;
              const firstOfParent = parent && pages[i - 1]?.parent?.id !== parent.id;
              const current = !searching && p.id === page?.id;
              const ParentIcon = parent?.icon;
              const Icon = p.icon;
              return (
                <Fragment key={p.id}>
                  {firstOfParent && ParentIcon && (
                    <li>
                      <button
                        type="button"
                        className={cn('zn-nav', page?.parent?.id === parent.id && !searching && 'text-foreground')}
                        onClick={() => {
                          onQueryChange('');
                          onSelect(p.id);
                        }}
                      >
                        <ParentIcon className="size-4 shrink-0" />
                        <span className="truncate">{parent.title}</span>
                        {parent.beta && <BetaBadge className="ml-auto" />}
                      </button>
                    </li>
                  )}
                  <li>
                    <button
                      type="button"
                      className={cn('zn-nav', parent && 'pl-8')}
                      aria-current={current ? 'page' : undefined}
                      onClick={() => {
                        onQueryChange('');
                        onSelect(p.id);
                      }}
                    >
                      {Icon && !parent && <Icon className="size-4 shrink-0" />}
                      <span className="truncate">{p.title}</span>
                      {p.beta && <BetaBadge className="ml-auto" />}
                    </button>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </nav>
      </aside>

      <div ref={scrollRef} className="settings-sections min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-8 py-6">
          {searching ? (
            hits.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No setting matches “{query.trim()}”.</p>
            ) : (
              <div className="space-y-10">
                {hits.map(({ page: hit, sectionIds }) => (
                  <div key={hit.id} className="space-y-4">
                    <button
                      type="button"
                      className="eyebrow hover:text-foreground"
                      onClick={() => {
                        onQueryChange('');
                        onSelect(hit.id);
                      }}
                      title={`Open ${hit.title}`}
                    >
                      {hit.parent ? `${hit.parent.title} › ${hit.title}` : hit.title}
                    </button>
                    <SectionFilterContext.Provider value={new Set(sectionIds)}>
                      <div className="space-y-8">{renderPage(hit.id)}</div>
                    </SectionFilterContext.Provider>
                  </div>
                ))}
              </div>
            )
          ) : (
            page && (
              // Keyed by page: a page switch must not carry a half-typed field
              // or a scroll position over from the previous one.
              <div key={page.id} className="animate-in-soft">
                <PageHeading
                  title={page.parent ? `${page.parent.title} › ${page.title}` : page.title}
                  description={page.description}
                  action={renderPageAction?.(page.id)}
                />
                <div className="space-y-8">{renderPage(page.id)}</div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
