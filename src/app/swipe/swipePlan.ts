import type { SidebarItem } from '../../core/models'

/**
 * Which commits a screen offers to a full swipe.
 *
 * Pure, so the rule that matters is testable without a gesture: **Completed
 * and Trash offer none**. The only commits available there are un-complete,
 * which is already one tap, and permanent deletion — and a reflex must never
 * do something unrecoverable.
 *
 * Unlike iOS this is not configurable. On iPhone swipe is the primary
 * interaction and six per-context preferences earn their keep; on the web it is
 * a secondary accelerator over drag, menus and the keyboard.
 */
export type SwipePlan = {
  leading: 'complete' | null
  trailing: 'trash' | null
}

export const NO_SWIPE: SwipePlan = { leading: null, trailing: null }

export function swipeActionsFor(selection: SidebarItem | null): SwipePlan {
  if (selection === null) return NO_SWIPE
  if (selection.kind === 'smart' && (selection.view === 'completed' || selection.view === 'trash')) {
    return NO_SWIPE
  }
  return { leading: 'complete', trailing: 'trash' }
}

/** How far a row must travel before a release commits rather than snapping back. */
export const SWIPE_COMMIT_PX = 72

export function swipeCommit(dx: number, plan: SwipePlan): 'complete' | 'trash' | null {
  if (dx >= SWIPE_COMMIT_PX) return plan.leading
  if (dx <= -SWIPE_COMMIT_PX) return plan.trailing
  return null
}
