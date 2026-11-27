/**
 * The model behind the settings' list / detail layout (ticket #64): pages,
 * the titled sections each page is made of, and the search over them.
 *
 * Both settings surfaces are built from it — the main window's Settings
 * screen and the Terminal window's own panel — so the two navigate and search
 * the same way. Kept out of the `.tsx` files so those only export components.
 *
 * **Why sections are declared here and not discovered from the rendered
 * tree.** The search has to know *before* rendering which pages match (to
 * draw their breadcrumbs, or "No setting matches"), so every `Section` a page
 * renders is listed in its page definition with its search words. The page
 * component then renders all of its sections, and each one asks
 * `SectionFilterContext` whether it is wanted — the same component serves the
 * page view (everything) and the search results (the matching cards only).
 */
import { createContext, useContext } from 'react';
import type { LucideIcon } from 'lucide-react';

/** One titled card of a page, as the search sees it. */
export interface SettingsSectionDef {
  /** Matches the `id` of the `Section` (or the `group` of the `Group`) it renders. */
  id: string;
  title: string;
  /** Extra words the search should find this card by (labels, synonyms). */
  keywords?: string;
}

/** A parent in the list ("Terminal"): a heading whose pages are indented under it. */
export interface SettingsNavParent {
  id: string;
  title: string;
  icon: LucideIcon;
  beta?: boolean;
}

export interface SettingsPageDef {
  id: string;
  title: string;
  /** One line under the page title. */
  description: string;
  icon?: LucideIcon;
  beta?: boolean;
  /** Indented under this parent in the list. Consecutive pages share one heading. */
  parent?: SettingsNavParent;
  sections: SettingsSectionDef[];
}

/** One page with matches, and the ids of its matching sections. */
export interface SettingsSearchHit {
  page: SettingsPageDef;
  sectionIds: string[];
}

/**
 * Every page with at least one section matching `query`.
 *
 * A section matches when every word of the query appears in its haystack:
 * its title, its keywords, its page's title and its parent's. Word by word
 * rather than as one substring, so "dock theme" finds "Theme in the dock".
 */
export function searchSettings(pages: readonly SettingsPageDef[], query: string): SettingsSearchHit[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits: SettingsSearchHit[] = [];
  for (const page of pages) {
    const pageText = `${page.title} ${page.parent?.title ?? ''}`;
    const sectionIds = page.sections
      .filter((s) => {
        const hay = `${pageText} ${s.title} ${s.keywords ?? ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .map((s) => s.id);
    if (sectionIds.length > 0) hits.push({ page, sectionIds });
  }
  return hits;
}

/** The page to show for a remembered id, or the first page. */
export function resolvePage(pages: readonly SettingsPageDef[], id: string | null): SettingsPageDef | undefined {
  return pages.find((p) => p.id === id) ?? pages[0];
}

/** sessionStorage, with the failures it can throw swallowed. */
/** sessionStorage key of the main window's Settings page (the open page). */
export const SETTINGS_PAGE_KEY = 'cortx-settings-page';

export function readStoredPage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storePage(key: string, id: string): void {
  try {
    sessionStorage.setItem(key, id);
  } catch {
    // sessionStorage unavailable: the page just isn't remembered
  }
}

// ---------------------------------------------------------------------------
// Which sections are on screen
// ---------------------------------------------------------------------------

/**
 * The section ids a page should draw. `null` = all of them (the page view);
 * a set = only those (search results).
 */
export const SectionFilterContext = createContext<ReadonlySet<string> | null>(null);

/** Should the section `id` be drawn? A section with no id always is. */
export function useSectionVisible(id: string | undefined): boolean {
  const visible = useContext(SectionFilterContext);
  return !id || !visible || visible.has(id);
}
