import { useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { useAppStore } from '@/stores/appStore';
import { TabDragOverlay } from './TabDragOverlay';
import type { TerminalItem, DragData, EdgeDropData, PaneDropData, TabDropData } from './types';

// Custom collision detection that prioritizes edge zones based on pointer position
// This eliminates gaps where tabs might "win" over edge zones with closestCenter
// Edge zones only activate below the tabs bar (top ~36px) to allow tab reordering
const TABS_BAR_HEIGHT = 36; // Approximate height of the tabs bar in pixels

const edgePriorityCollisionDetection: CollisionDetection = (args) => {
  const { droppableContainers, pointerCoordinates } = args;

  if (!pointerCoordinates) {
    return closestCenter(args);
  }

  // Find all pane containers and their edge zones
  const paneContainers = Array.from(droppableContainers).filter(
    (container) => String(container.id).startsWith('pane-drop-')
  );

  // Check each pane to see if pointer is in its edge zones
  for (const paneContainer of paneContainers) {
    const paneRect = paneContainer.rect.current;
    if (!paneRect) continue;

    const paneId = String(paneContainer.id).replace('pane-drop-', '');
    const relativeY = pointerCoordinates.y - paneRect.top;

    // Check if pointer is within this pane's bounds AND below the tabs bar
    // This allows tab reordering in the tabs area without triggering edge zones
    if (
      pointerCoordinates.x >= paneRect.left &&
      pointerCoordinates.x <= paneRect.right &&
      pointerCoordinates.y >= paneRect.top &&
      pointerCoordinates.y <= paneRect.bottom &&
      relativeY > TABS_BAR_HEIGHT // Only trigger edge zones below tabs bar
    ) {
      const relativeX = pointerCoordinates.x - paneRect.left;
      const paneWidth = paneRect.width;

      // Left 25% of pane -> left edge zone
      if (relativeX <= paneWidth * 0.25) {
        const leftEdgeContainer = Array.from(droppableContainers).find(
          (c) => String(c.id) === `edge-left-${paneId}`
        );
        if (leftEdgeContainer) {
          return [{ id: leftEdgeContainer.id, data: { droppableContainer: leftEdgeContainer } }];
        }
      }

      // Right 25% of pane -> right edge zone
      if (relativeX >= paneWidth * 0.75) {
        const rightEdgeContainer = Array.from(droppableContainers).find(
          (c) => String(c.id) === `edge-right-${paneId}`
        );
        if (rightEdgeContainer) {
          return [{ id: rightEdgeContainer.id, data: { droppableContainer: rightEdgeContainer } }];
        }
      }
    }
  }

  // Fall back to closestCenter for tabs and pane center
  return closestCenter(args);
};

interface TerminalDndContextProps {
  children: React.ReactNode;
  allTerminals: TerminalItem[];
}

export function TerminalDndContext({ children, allTerminals: _allTerminals }: TerminalDndContextProps) {
  const {
    terminalPanes,
    addPane,
    moveTerminalToPane,
    reorderTerminalInPane,
  } = useAppStore();

  const [activeTerminal, setActiveTerminal] = useState<TerminalItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Start drag after moving 8px
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const data = active.data.current as DragData | undefined;

    if (data?.terminal) {
      setActiveTerminal(data.terminal);
    }
  }, []);

  const handleDragOver = useCallback((_event: DragOverEvent) => {
    // We can use this for additional visual feedback if needed
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    setActiveTerminal(null);

    if (!over) return;

    const activeData = active.data.current as DragData | undefined;
    const overData = over.data.current as EdgeDropData | PaneDropData | TabDropData | undefined;

    if (!activeData || !overData) return;

    const draggedTerminalId = activeData.terminalId;
    const sourcePaneId = activeData.paneId;

    // Scenario 1: Dropped on edge -> Create new pane
    if (overData.type === 'edge') {
      const newPaneId = addPane(overData.position, overData.referencePaneId);
      moveTerminalToPane(draggedTerminalId, newPaneId);
      return;
    }

    // Scenario 2: Dropped on different pane -> Move to that pane
    if (overData.type === 'pane' && overData.paneId !== sourcePaneId) {
      moveTerminalToPane(draggedTerminalId, overData.paneId);
      return;
    }

    // Scenario 3: Dropped on a tab in the same pane -> Reorder
    if (overData.type === 'tab') {
      const targetPaneId = overData.paneId;

      if (targetPaneId !== sourcePaneId) {
        // Moving to a different pane at specific position
        moveTerminalToPane(draggedTerminalId, targetPaneId);
        // Then reorder to the correct position
        const targetPane = terminalPanes.find(p => p.id === targetPaneId);
        if (targetPane) {
          const overIndex = targetPane.terminalIds.indexOf(overData.terminalId);
          if (overIndex !== -1) {
            // The terminal was just added at the end, move it to the right position
            reorderTerminalInPane(targetPaneId, draggedTerminalId, overIndex);
          }
        }
      } else if (active.id !== over.id) {
        // Reordering within the same pane
        const pane = terminalPanes.find(p => p.id === sourcePaneId);
        if (pane) {
          const oldIndex = pane.terminalIds.indexOf(draggedTerminalId);
          const newIndex = pane.terminalIds.indexOf(overData.terminalId);
          if (oldIndex !== -1 && newIndex !== -1) {
            reorderTerminalInPane(sourcePaneId, draggedTerminalId, newIndex);
          }
        }
      }
    }
  }, [terminalPanes, addPane, moveTerminalToPane, reorderTerminalInPane]);

  const handleDragCancel = useCallback(() => {
    setActiveTerminal(null);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={edgePriorityCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      modifiers={[restrictToWindowEdges]}
    >
      {children}
      <DragOverlay dropAnimation={{
        duration: 200,
        easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
      }}>
        <TabDragOverlay terminal={activeTerminal} />
      </DragOverlay>
    </DndContext>
  );
}
