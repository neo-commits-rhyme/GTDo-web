import { describe, it, expect } from 'vitest'
import { BuiltIn } from '../../../core/models'
import { NO_SWIPE, SWIPE_COMMIT_PX, swipeActionsFor, swipeCommit } from '../swipePlan'

describe('Swipe plan', () => {
  it('leadingCompletesAndTrailingTrashes', () => {
    expect(swipeActionsFor({ kind: 'smart', view: 'today' }))
      .toEqual({ leading: 'complete', trailing: 'trash' })
    expect(swipeActionsFor({ kind: 'list', id: BuiltIn.notes }))
      .toEqual({ leading: 'complete', trailing: 'trash' })
  })

  it('noFullSwipeInCompletedOrTrash', () => {
    // The only commits there are un-complete (already one tap) and permanent
    // deletion. A reflex must never do something unrecoverable.
    expect(swipeActionsFor({ kind: 'smart', view: 'completed' })).toEqual(NO_SWIPE)
    expect(swipeActionsFor({ kind: 'smart', view: 'trash' })).toEqual(NO_SWIPE)
  })

  it('offersNothingWithNoSelection', () => {
    expect(swipeActionsFor(null)).toEqual(NO_SWIPE)
  })

  it('commitsOnlyPastTheThreshold', () => {
    const plan = swipeActionsFor({ kind: 'smart', view: 'today' })
    expect(swipeCommit(SWIPE_COMMIT_PX, plan)).toBe('complete')
    expect(swipeCommit(-SWIPE_COMMIT_PX, plan)).toBe('trash')
    expect(swipeCommit(SWIPE_COMMIT_PX - 1, plan)).toBeNull()
    expect(swipeCommit(-SWIPE_COMMIT_PX + 1, plan)).toBeNull()
    expect(swipeCommit(0, plan)).toBeNull()
  })

  it('aBarredScreenCommitsNothingHoweverFarYouSwipe', () => {
    expect(swipeCommit(500, NO_SWIPE)).toBeNull()
    expect(swipeCommit(-500, NO_SWIPE)).toBeNull()
  })
})
