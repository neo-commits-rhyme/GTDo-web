import { describe, it, expect } from 'vitest'
import { dragID, resolveDrop, toOnMoveDestination, type DropContext } from '../resolve'

const LIST = '00000000-0000-0000-0000-000000000005'
const OTHER = '00000000-0000-0000-0000-000000000002'

const ctx = (over: Partial<DropContext> = {}): DropContext => ({
  taskOrder: ['a', 'b', 'c'],
  listID: LIST,
  gtdOrder: ['g1', 'g2', 'g3'],
  userOrder: ['u1', 'u2'],
  groupMembers: { areas: ['m1', 'm2', 'm3'] },
  reorderable: true,
  ...over,
})

describe('toOnMoveDestination', () => {
  it('convertsASortableIndexToOnMoveSemantics', () => {
    // Moving item 0 down one is destination 2 — the index is resolved before
    // the item is removed, which is what the store expects.
    expect(toOnMoveDestination(0, 1)).toBe(2)
    expect(toOnMoveDestination(0, 2)).toBe(3)
    // Moving upward needs no adjustment.
    expect(toOnMoveDestination(2, 0)).toBe(0)
    expect(toOnMoveDestination(2, 1)).toBe(1)
  })
})

describe('resolveDrop', () => {
  it('aDropOnNothingIsANoOpNotAMoveToTheEnd', () => {
    expect(resolveDrop(dragID.task('a'), null, ctx())).toBeNull()
  })

  it('aDropOnItselfIsANoOp', () => {
    expect(resolveDrop(dragID.task('a'), dragID.task('a'), ctx())).toBeNull()
  })

  it('resolvesATaskDroppedOnAnotherTaskAsAReorder', () => {
    expect(resolveDrop(dragID.task('a'), dragID.task('c'), ctx())).toEqual({
      kind: 'reorder-task', listID: LIST, from: 0, to: 3,
    })
  })

  it('resolvesATaskDroppedOnASidebarListAsAMove', () => {
    expect(resolveDrop(dragID.task('a'), dragID.listDrop(OTHER), ctx())).toEqual({
      kind: 'move-task', taskID: 'a', listID: OTHER,
    })
  })

  it('droppingATaskOnItsOwnListChangesNothing', () => {
    expect(resolveDrop(dragID.task('a'), dragID.listDrop(LIST), ctx())).toBeNull()
    // And is case-insensitive, since ids may arrive in either case.
    expect(resolveDrop(dragID.task('a'), dragID.listDrop(LIST.toLowerCase()), ctx())).toBeNull()
  })

  it('refusesToReorderInASmartViewThatOwnsNoList', () => {
    // Today and Calendar draw from many lists; reordering there is meaningless.
    expect(resolveDrop(dragID.task('a'), dragID.task('b'), ctx({ listID: null }))).toBeNull()
  })

  it('ignoresATaskThatIsNotInTheVisibleOrder', () => {
    expect(resolveDrop(dragID.task('zz'), dragID.task('b'), ctx())).toBeNull()
  })

  it('resolvesASidebarEntryWithinItsOwnScope', () => {
    expect(resolveDrop(dragID.sidebar('gtd', 'g1'), dragID.sidebar('gtd', 'g3'), ctx())).toEqual({
      kind: 'reorder-sidebar', scope: 'gtd', from: 0, to: 3,
    })
  })

  it('refusesToDragASidebarEntryAcrossScopes', () => {
    // The GTD block and My Lists are separate orders in the data model.
    expect(resolveDrop(dragID.sidebar('gtd', 'g1'), dragID.sidebar('user', 'u1'), ctx())).toBeNull()
  })

  it('resolvesAGroupMemberWithinItsOwnGroup', () => {
    expect(resolveDrop(dragID.groupMember('areas', 'm3'), dragID.groupMember('areas', 'm1'), ctx()))
      .toEqual({ kind: 'reorder-in-group', groupID: 'areas', from: 2, to: 0 })
  })

  it('refusesToDragAMemberIntoAnotherGroup', () => {
    expect(resolveDrop(dragID.groupMember('areas', 'm1'), dragID.groupMember('other', 'x'), ctx()))
      .toBeNull()
  })

  it('ignoresUnknownIdShapes', () => {
    expect(resolveDrop('nonsense', 'alsononsense', ctx())).toBeNull()
    expect(resolveDrop(dragID.task('a'), 'nonsense', ctx())).toBeNull()
  })
})


describe('a date sort refuses reorders', () => {
  it('returns null for a task dropped on another task', () => {
    // The reorder would redistribute `order` to match date order, silently
    // destroying the arrangement the user dragged by hand.
    expect(resolveDrop(dragID.task('a'), dragID.task('c'), ctx({ reorderable: false }))).toBeNull()
  })

  it('still allows moving the task to another list', () => {
    expect(resolveDrop(dragID.task('a'), dragID.listDrop(OTHER), ctx({ reorderable: false })))
      .toEqual({ kind: 'move-task', taskID: 'a', listID: OTHER })
  })
})

describe('sidebar drop targets', () => {
  it('dates a task dropped on Today', () => {
    expect(resolveDrop(dragID.task('a'), dragID.smartDrop('today'), ctx()))
      .toEqual({ kind: 'date-today', taskID: 'a' })
  })

  it('trashes a task dropped on Trash', () => {
    expect(resolveDrop(dragID.task('a'), dragID.smartDrop('trash'), ctx()))
      .toEqual({ kind: 'trash-task', taskID: 'a' })
  })

  /** Calendar, Completed and Completed projects are computed from fields a
   *  drop cannot meaningfully set. */
  it('refuses the computed smart views', () => {
    for (const view of ['calendar', 'completed', 'completedProjects']) {
      expect(resolveDrop(dragID.task('a'), dragID.smartDrop(view), ctx())).toBeNull()
    }
  })

  it('converts a task dropped on the Projects header', () => {
    expect(resolveDrop(dragID.task('a'), dragID.projectsHeaderDrop(), ctx()))
      .toEqual({ kind: 'convert-to-project', taskID: 'a' })
  })

  /** A date sort refuses reorders, but these are field changes, not reorders. */
  it('still accepts them while the list is date-sorted', () => {
    expect(resolveDrop(dragID.task('a'), dragID.smartDrop('today'), ctx({ reorderable: false })))
      .toEqual({ kind: 'date-today', taskID: 'a' })
  })
})
