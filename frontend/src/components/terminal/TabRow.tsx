/**
 * The body of a tab row, written once (ticket #26).
 *
 * Three surfaces draw the same object: the rail's own rows (`SessionRow`), the
 * label row of a tab that holds a split, and the pane rows inside that split's
 * box (`PaneRow`). All three are the same three things in the same order:
 *
 *     [icon]  name            [end slot]
 *             second line
 *
 * with the same type sizes (12.5 px over 10.5 px), the same `leading-tight`
 * column, and the same rule for what the second line is allowed to look like —
 * a path or a command is typed text and reads in mono, "Waiting" and "3 panes"
 * are prose and do not. Two copies of that agreed until they didn't: the pane
 * rows wrote the mono rule as `tone !== 'waiting'` while the rail wrote it as
 * `command || path`, which is the same answer only for as long as nobody adds
 * a fourth tone. (One already exists — `count` — and only the rail can produce
 * it, which is why the divergence had not shown yet.)
 *
 * What stays with the caller is the **skeleton**: the element itself (a button
 * here, a div there), the drag listeners, the plate that says "this is the one
 * you are on", the close button, the rename input, the context menu. This file
 * owns nothing but what goes between the row's edges.
 *
 * It renders a fragment on purpose — no wrapper element of its own — so a row
 * that adopts it keeps exactly the DOM it had.
 */
import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { TabSecondary } from './model';

export function TabRowBody({
  icon,
  title,
  secondary,
  trailing,
  dense,
  strong,
}: {
  /** Type or agent glyph, already sized by the caller (`size-3.5`). */
  icon: ReactNode;
  /** First line: the tab's or the pane's name. */
  title: string;
  /** Second line, with the tone that decides how it is written. */
  secondary?: TabSecondary;
  /** What the body ends with, before the row's own skeleton. */
  trailing?: ReactNode;
  /**
   * The label row of a group: a 24 px row where the name and what follows it
   * share **one** line. Two stacked lines on top of two-line rows is the block
   * ticket #22 got rid of.
   */
  dense?: boolean;
  /** The row is the current one, so its name carries the weight. */
  strong?: boolean;
}) {
  return (
    <>
      {icon}
      <span
        className={cn(
          'pointer-events-none flex min-w-0 flex-1 flex-col leading-tight',
          dense && 'flex-row items-baseline gap-1.5'
        )}
      >
        <span
          className={cn(
            'truncate text-[12.5px]',
            strong && 'font-medium',
            // The name gives way first: what follows it is a count, or the
            // command running -- both short, both useless once cut.
            dense && 'min-w-0 text-[11px] font-medium [flex:0_4_auto]'
          )}
        >
          {title}
        </span>
        {secondary && (
          <span
            className={cn(
              'truncate text-[10.5px]',
              dense && 'text-[10px] [flex:0_1_auto]',
              // A path and a command are typed text; "Waiting" and "3 panes"
              // are prose, and reading them in mono is worse.
              (secondary.tone === 'command' || secondary.tone === 'path') && 'font-mono',
              secondary.tone === 'waiting'
                ? 'text-st-progress'
                : secondary.tone === 'command'
                  ? 'text-primary'
                  : 'text-faint'
            )}
          >
            {secondary.text}
          </span>
        )}
      </span>
      {trailing}
    </>
  );
}
