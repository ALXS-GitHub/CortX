/**
 * The order of the rail's project sections, once the user has dragged one
 * (ticket #50).
 *
 * Same discipline as `sectionFold.ts`: pure decisions, **no imports at all**,
 * so `sectionOrder.test.ts` runs them on plain Node.
 *
 * **What is stored.** A list of workspace ids (`project:<id>`, or the free
 * workspace) in the order the user wants them — never indices, for the reason
 * the folds give: an id follows its project through a close, a rename and a
 * restart, and an id nothing answers to any more simply matches nothing. It
 * lives in the layout document (`TerminalWindowLayout.sectionOrder`), which is
 * what makes it one order for every Terminal window and for everything that
 * counts tabs: the rail draws it, and Ctrl+1…9, Ctrl+Tab and the palette read
 * the very same list through `visibleTabOrder`.
 *
 * **What it is not.** It is not the whole order. Nothing is written until the
 * first drag, and a section the list does not mention — a project whose first
 * tab opens tomorrow — still has to land somewhere sensible. "Sensible" is
 * where it would be without the list: next to the section that comes before it
 * in the default order (projects in sidebar order, "No project" last), so a new
 * project shows up beside its sidebar neighbour rather than at the far end.
 *
 * **Why the list keeps ids it cannot see.** A window shows its own tabs, so
 * its rail holds only some of the sections the list knows; another window may
 * hold the rest, and a project with no tab open today should come back to its
 * place when it gets one. A move therefore rearranges the full list and the
 * sections out of sight keep theirs — see `moveSection`.
 */

/**
 * `saved` completed with every id of `shown` it does not mention, each placed
 * next to its neighbour in `shown`: right after the one before it, or — for
 * the first — right before the first one after it the list already holds.
 * Ids of `saved` that `shown` lacks are kept, in place. No id twice.
 *
 * With nothing saved, this is `shown` itself: no drag yet means no change.
 */
export function mergeSectionOrder(saved: readonly string[] | undefined, shown: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of saved ?? []) if (id && !out.includes(id)) out.push(id);
  shown.forEach((id, i) => {
    if (out.includes(id)) return;
    if (i > 0) {
      // Everything before `id` in `shown` is placed by now, this one included.
      out.splice(out.indexOf(shown[i - 1]) + 1, 0, id);
      return;
    }
    const next = shown.slice(1).find((other) => out.includes(other));
    if (next) out.splice(out.indexOf(next), 0, id);
    else out.push(id);
  });
  return out;
}

/**
 * The sections in the order the rail draws them: `groups` arrive in the
 * default order, and come out in the saved one. Pure reorder — the same
 * objects, none added, none lost.
 */
export function orderSections<T extends { workspaceId: string }>(groups: readonly T[], saved: readonly string[] | undefined): T[] {
  if (!saved || saved.length === 0) return groups.slice();
  const rank = new Map(mergeSectionOrder(saved, groups.map((g) => g.workspaceId)).map((id, i) => [id, i]));
  return groups.slice().sort((a, b) => (rank.get(a.workspaceId) ?? 0) - (rank.get(b.workspaceId) ?? 0));
}

/**
 * The order to save once `activeId` is dropped on `overId`.
 *
 * `shown` is the rail as the user sees it. The move happens in the *full*
 * list (`mergeSectionOrder`), not in `shown`: moving the dragged id to the
 * slot of the one it was dropped on there gives, read back through `shown`,
 * exactly what the sortable drew — before `overId` when it went up, after it
 * when it went down — while the sections this rail cannot see keep their
 * places relative to everything they did not jump over.
 *
 * An unknown id, or a drop on itself, saves the list as it stands.
 */
export function moveSection(
  saved: readonly string[] | undefined,
  shown: readonly string[],
  activeId: string,
  overId: string
): string[] {
  const full = mergeSectionOrder(saved, shown);
  const from = full.indexOf(activeId);
  const to = full.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return full;
  full.splice(to, 0, ...full.splice(from, 1));
  return full;
}
