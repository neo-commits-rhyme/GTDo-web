import { useMemo, useState, type ReactNode } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { AppStore } from '../../core/store'
import { undoLabel, type UndoCenter } from '../../core/undo'
import { deadlinePromptWillOpen } from '../DeadlinePrompt'
import { resolveDrop, type DropContext, type DropTarget } from './resolve'
import { useStore, useStoreTick } from '../useStore'
import { useUndoCenter } from '../undo/useUndo'

/**
 * What a drop *does*, split out of the handler for the same reason resolve.ts
 * splits out what a drop *means*: the undo bookkeeping is the part that bites,
 * and a call is far easier to test than a synthetic drag in a DOM that has no
 * layout for dnd-kit to measure.
 */
export function applyDrop(
  target: Exclude<DropTarget, null>, context: DropContext, store: AppStore, undo: UndoCenter,
): void {
  switch (target.kind) {
    case 'reorder-task':
      undo.perform(undoLabel('moved', 1), context.taskOrder, store, () => {
        store.moveIncompleteTasks(target.listID, [target.from], target.to)
      })
      break

    case 'move-task': {
      // requestMove, never moveTask: dropping onto Next actions or Waiting
      // for… must raise the deadline prompt rather than silently producing an
      // undated task in a list whose whole point is that everything is dated.
      const move = () => store.requestMove([target.taskID], target.listID)
      // A drop that only raises the prompt has moved nothing yet, so there is
      // nothing to undo; DeadlinePrompt records the move once a deadline is
      // chosen. Offering a bar here made it read “1 task moved” over zero
      // mutations, with an Undo that did nothing.
      if (deadlinePromptWillOpen(store, target.taskID, target.listID)) move()
      else undo.perform(undoLabel('moved', 1), [target.taskID], store, move)
      break
    }

    case 'reorder-sidebar':
      // Sidebar order is not task state, so there is nothing to snapshot.
      if (target.scope === 'gtd') store.moveGTDEntries([target.from], target.to)
      else store.moveUserEntries([target.from], target.to)
      break

    case 'reorder-in-group':
      store.moveListsInGroup(target.groupID, [target.from], target.to)
      break
  }
}

/**
 * Drag, as an accelerator over paths that already work.
 *
 * The KeyboardSensor is not optional garnish: sub-project 1 shipped [ / ] and
 * the up/down menu buttons on the premise that drag would layer over them, and
 * a pointer-only implementation would quietly break that promise.
 *
 * Every mutation routes through UndoCenter.perform, so a mis-drop costs one
 * keystroke rather than a hunt through the trash.
 */
export function DragProvider({
  children, context,
}: {
  children: ReactNode
  context: DropContext
}) {
  useStoreTick()
  const store = useStore()
  const undo = useUndoCenter()
  const [activeID, setActiveID] = useState<string | null>(null)

  const sensors = useSensors(
    // A few pixels of slop: without it every click on a row starts a drag and
    // the completion circle becomes unusable.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragStart = (e: DragStartEvent) => setActiveID(String(e.active.id))

  const onDragEnd = (e: DragEndEvent) => {
    setActiveID(null)
    const target = resolveDrop(String(e.active.id), e.over === null ? null : String(e.over.id), context)
    if (target === null) return // a drop on nothing is a no-op, never a move to the end

    applyDrop(target, context, store, undo)
  }

  const activeLabel = useMemo(() => {
    if (activeID === null || !activeID.startsWith('task:')) return null
    return store.task(activeID.slice('task:'.length))?.title ?? null
  }, [activeID, store])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveID(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {activeLabel === null ? null : <div className="drag-overlay">{activeLabel}</div>}
      </DragOverlay>
    </DndContext>
  )
}
