import { useMemo, useState, type ReactNode } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  closestCenter, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { AppStore } from '../../core/store'
import { BuiltIn, sameID } from '../../core/models'
import { undoLabel, type UndoCenter } from '../../core/undo'
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
        // Next actions shows project tasks alongside its own, so its rows do
        // not all belong to one list — the reorder has to run over what is on
        // screen (see queries.ts, the mirror).
        if (sameID(target.listID, BuiltIn.nextActions)) {
          store.moveNextActions([target.from], target.to)
        } else {
          store.moveIncompleteTasks(target.listID, [target.from], target.to)
        }
      })
      break

    case 'move-task': {
      // requestMove, never moveTask: dropping onto Next actions or Waiting
      // for… must raise the deadline prompt rather than silently producing an
      // undated task in a list whose whole point is that everything is dated.
      const move = () => store.requestMove([target.taskID], target.listID)
      // The bar follows what the store will change, not what the drop meant.
      // Three drops change nothing: one that only raises the prompt (the move
      // is recorded by DeadlinePrompt once a deadline is chosen), one of a
      // trashed task, and one onto the list the task already lives in. Asking
      // whether the prompt would open caught only the first, and the other two
      // went on offering “1 task moved” over an untouched task — evicting a
      // live undo from the centre's single slot to do it.
      if (store.movesNow([target.taskID], target.listID).length === 0) move()
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

    // The three sidebar drops that are not a move. Each is a real field change,
    // so each is undoable, and each snapshots the one task it touches.
    case 'date-today':
      undo.perform(undoLabel('moved', 1), [target.taskID], store,
        () => store.addToToday(target.taskID))
      break

    case 'trash-task':
      undo.perform(undoLabel('trashed', 1), [target.taskID], store,
        () => store.trashTask(target.taskID))
      break

    case 'convert-to-project':
      // Not undoable through the task snapshot: converting also CREATES a list,
      // and UndoAction records created lists by id only. The store's own guard
      // (a trashed task returns null) keeps the no-op case clean.
      store.convertToProject(target.taskID)
      break
  }
}

/**
 * Why the dragged thing cannot be dropped anywhere, or null when it can.
 *
 * A trashed task's listID is where Restore puts it back, so the store refuses to
 * move it — the same reason the detail pane disables its List control. The drag
 * was accepted anyway: sidebar rows lit up as targets, the drop mutated nothing,
 * and the only feedback was an undo bar for a move that never happened.
 */
export function dragRefusal(store: AppStore, activeID: string): string | null {
  if (!activeID.startsWith('task:')) return null
  const task = store.task(activeID.slice('task:'.length))
  if (task === null || !task.isTrashed) return null
  return `${task.title} — in the Trash, restore it to file it`
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

  // Nothing collides with a drag the store would refuse, so no row lights up as
  // a target that would swallow the drop and do nothing with it.
  const collisionDetection: CollisionDetection = (args) => (
    dragRefusal(store, String(args.active.id)) === null ? closestCenter(args) : []
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
    const refusal = dragRefusal(store, activeID)
    // The overlay is the only thing following the pointer, so it is where a
    // refusal has to be said — nothing else is where the user is looking.
    return refusal ?? store.task(activeID.slice('task:'.length))?.title ?? null
  }, [activeID, store])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
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
