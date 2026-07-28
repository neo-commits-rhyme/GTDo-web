import { describe, it, expect } from 'vitest'
import { AppStore } from '../store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { GTD_BLOCK_IDS, healOrder, moveWithinArray } from '../reorder'
import { BuiltIn } from '../models'

/** Ports ReorderSidebarTests.swift and ReorderTests.swift. */

const NOW = new Date(2026, 6, 28, 9, 0, 0)
const store = async () =>
  AppStore.create({ adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f() })

describe('moveWithinArray', () => {
  it('usesPreRemovalInsertionIndices', () => {
    // SwiftUI onMove: moving item 0 down one requires destination 2.
    expect(moveWithinArray(['a', 'b', 'c'], [0], 2)).toEqual(['b', 'a', 'c'])
    expect(moveWithinArray(['a', 'b', 'c'], [2], 0)).toEqual(['c', 'a', 'b'])
    expect(moveWithinArray(['a', 'b', 'c'], [0], 0)).toEqual(['a', 'b', 'c'])
  })

  it('movesMultipleItemsTogether', () => {
    expect(moveWithinArray(['a', 'b', 'c', 'd'], [0, 1], 4)).toEqual(['c', 'd', 'a', 'b'])
  })

  it('clampsOutOfRangeDestinations', () => {
    expect(moveWithinArray(['a', 'b'], [0], 99)).toEqual(['b', 'a'])
    expect(moveWithinArray(['a', 'b'], [1], -5)).toEqual(['b', 'a'])
  })
})

describe('Sidebar order healing', () => {
  it('inboxIsNotPartOfTheReorderableGTDBlock', () => {
    expect(GTD_BLOCK_IDS).not.toContain(BuiltIn.inbox)
    expect(GTD_BLOCK_IDS).toEqual([
      BuiltIn.nextActions, BuiltIn.waitingFor, BuiltIn.projectsGroup,
      BuiltIn.someday, BuiltIn.notes,
    ])
  })

  it('absentOrderYieldsTheCanonicalOrder', async () => {
    const s = await store()
    expect(s.data.gtdOrder).toBeNull()
    expect(s.healedGTDOrder()).toEqual([...GTD_BLOCK_IDS])
  })

  it('dropsUnknownIDsAndAppendsMissingOnes', () => {
    const healed = healOrder(
      [BuiltIn.notes, '99999999-0000-0000-0000-000000000000', BuiltIn.someday],
      GTD_BLOCK_IDS,
    )
    expect(healed).toEqual([
      BuiltIn.notes, BuiltIn.someday,
      BuiltIn.nextActions, BuiltIn.waitingFor, BuiltIn.projectsGroup,
    ])
  })

  it('healingIsReadTimeOnlyAndDoesNotWriteBack', async () => {
    const s = await store()
    s.data.gtdOrder = ['99999999-0000-0000-0000-000000000000']
    expect(s.healedGTDOrder().length).toBe(5)
    // Stale value still on the model until an explicit reorder rewrites it.
    expect(s.data.gtdOrder).toEqual(['99999999-0000-0000-0000-000000000000'])
  })

  it('healedUserOrderDefaultsToGroupsThenLists', async () => {
    const s = await store()
    const g = s.addGroup('Areas')!
    const loose = s.addList('Reading', null)!
    s.addList('Work', g.id)
    expect(s.healedUserOrder()).toEqual([g.id, loose.id])
  })
})

describe('Sidebar reordering', () => {
  it('moveGTDEntriesWritesTheHealedOrderBack', async () => {
    const s = await store()
    s.moveGTDEntries([0], 2)
    expect(s.data.gtdOrder).toEqual([
      BuiltIn.waitingFor, BuiltIn.nextActions, BuiltIn.projectsGroup,
      BuiltIn.someday, BuiltIn.notes,
    ])
  })

  it('gtdSectionItemsRenderListsAndGroups', async () => {
    const s = await store()
    const items = s.gtdSectionItems()
    expect(items.length).toBe(5)
    expect(items.map((e) => e.kind)).toEqual(['list', 'list', 'group', 'list', 'list'])
  })

  it('moveUserEntriesReordersTopLevel', async () => {
    const s = await store()
    const g = s.addGroup('Areas')!
    const loose = s.addList('Reading', null)!
    s.moveUserEntries([0], 2)
    expect(s.data.userOrder).toEqual([loose.id, g.id])
    expect(s.userSectionItems().map((e) => e.kind)).toEqual(['list', 'group'])
  })

  it('moveListsInGroupRenumbersZeroToNWithinThatGroupOnly', async () => {
    const s = await store()
    const g = s.addGroup('Areas')!
    const work = s.addList('Work', g.id)!
    const home = s.addList('Home', g.id)!
    const outside = s.addList('Reading', null)!
    const outsideOrderBefore = s.list(outside.id)!.order

    s.moveListsInGroup(g.id, [0], 2)
    expect(s.listsInGroup(g.id).map((l) => l.id)).toEqual([home.id, work.id])
    expect(s.listsInGroup(g.id).map((l) => l.order)).toEqual([0, 1])
    // A different group's lists are untouched, even though orders now tie.
    expect(s.list(outside.id)!.order).toBe(outsideOrderBefore)
  })

  it('anEntryWhoseTargetVanishedIsSkippedNotCrashed', async () => {
    const s = await store()
    s.data.userOrder = ['99999999-0000-0000-0000-000000000000']
    expect(s.userSectionItems()).toEqual([])
  })
})
