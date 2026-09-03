import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { collectLeaves, findLeaf, type LayoutNode, type SplitNode, type TerminalTab } from '@/lib/terminalLayout';
import { cn } from '@/lib/utils';
import { LeafPane } from './LeafPane';
import type { ItemMap } from './model';

const MIN_FRACTION = 0.1;

interface TreeProps {
  tab: TerminalTab;
  items: ItemMap;
  isActiveTab: boolean;
  multi: boolean;
}

/**
 * A split node: children laid out with flex according to `sizes`, 4 px
 * dividers in between. Dragging a divider updates a local copy of the sizes
 * and commits once on mouse-up (one layout write, not one per pixel).
 */
function SplitView({ node, tab, items, isActiveTab, multi }: TreeProps & { node: SplitNode }) {
  const setSplitSizes = useTerminalLayoutStore((s) => s.setSplitSizes);
  const horizontal = node.direction === 'horizontal';
  const containerRef = useRef<HTMLDivElement>(null);

  // Sizes while a divider is being dragged; null = use the document's. The
  // ref mirrors the latest value so mouse-up can commit outside a setState.
  const [dragSizes, setDragSizes] = useState<number[] | null>(null);
  const latest = useRef<number[] | null>(null);
  const drag = useRef<{ index: number; start: number; sizes: number[]; extent: number } | null>(null);

  const onDividerDown = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.preventDefault();
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      drag.current = {
        index,
        start: horizontal ? e.clientX : e.clientY,
        sizes: node.sizes.slice(),
        extent: horizontal ? rect.width : rect.height,
      };
      latest.current = node.sizes.slice();
      setDragSizes(latest.current);
    },
    [horizontal, node.sizes]
  );

  useEffect(() => {
    if (!dragSizes) return;
    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d || d.extent <= 0) return;
      const delta = ((horizontal ? e.clientX : e.clientY) - d.start) / d.extent;
      const a = d.sizes[d.index];
      const b = d.sizes[d.index + 1];
      // Only the two neighbours of the divider move; both keep a minimum.
      const clamped = Math.max(MIN_FRACTION - a, Math.min(b - MIN_FRACTION, delta));
      const next = d.sizes.slice();
      next[d.index] = a + clamped;
      next[d.index + 1] = b - clamped;
      latest.current = next;
      setDragSizes(next);
    };
    const up = () => {
      if (latest.current) setSplitSizes(tab.id, node.id, latest.current);
      latest.current = null;
      drag.current = null;
      setDragSizes(null);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    // `dragSizes` only matters as "dragging or not".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragSizes !== null, horizontal, node.id, tab.id, setSplitSizes]);

  const sizes = dragSizes ?? node.sizes;

  return (
    <div ref={containerRef} className={cn('flex min-h-0 min-w-0 flex-1', horizontal ? 'flex-row' : 'flex-col')}>
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          <div className="flex min-h-0 min-w-0 flex-col" style={{ flex: `${sizes[i] ?? 1 / node.children.length} 1 0%` }}>
            <SplitTreeNode node={child} tab={tab} items={items} isActiveTab={isActiveTab} multi={multi} />
          </div>
          {i < node.children.length - 1 && (
            <div
              role="separator"
              aria-orientation={horizontal ? 'vertical' : 'horizontal'}
              onMouseDown={(e) => onDividerDown(e, i)}
              className={cn(
                'shrink-0 bg-border transition-colors hover:bg-primary/60',
                horizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
                dragSizes && 'bg-primary'
              )}
            />
          )}
        </Fragment>
      ))}
      {/* While dragging, keep the pointer events away from the xterm canvases. */}
      {dragSizes && <div className={cn('fixed inset-0 z-50', horizontal ? 'cursor-col-resize' : 'cursor-row-resize')} />}
    </div>
  );
}

function SplitTreeNode({ node, tab, items, isActiveTab, multi }: TreeProps & { node: LayoutNode }) {
  if (node.kind === 'leaf') {
    return (
      <LeafPane
        tab={tab}
        leaf={node}
        item={items.get(node.terminalId)}
        isActiveLeaf={tab.activeLeafId === node.id}
        isActiveTab={isActiveTab}
        multi={multi}
      />
    );
  }
  return <SplitView node={node} tab={tab} items={items} isActiveTab={isActiveTab} multi={multi} />;
}

/**
 * Recursive renderer of a tab's split layout. A maximized leaf
 * (`tab.maximizedLeafId`) is shown alone; the other panes keep their
 * sessions and come back with "Restore layout".
 */
export function SplitTree({ tab, items, isActiveTab }: { tab: TerminalTab; items: ItemMap; isActiveTab: boolean }) {
  const multi = collectLeaves(tab.layout).length > 1;
  const maximized = tab.maximizedLeafId ? findLeaf(tab.layout, tab.maximizedLeafId) : null;
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {maximized ? (
        <LeafPane
          tab={tab}
          leaf={maximized}
          item={items.get(maximized.terminalId)}
          isActiveLeaf
          isActiveTab={isActiveTab}
          multi={false}
          maximized
        />
      ) : (
        <SplitTreeNode node={tab.layout} tab={tab} items={items} isActiveTab={isActiveTab} multi={multi} />
      )}
    </div>
  );
}
