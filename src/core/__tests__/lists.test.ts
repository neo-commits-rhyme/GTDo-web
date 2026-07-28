import { describe, it, expect } from 'vitest'
import { AppStore, DEADLINE_REQUIRED_LISTS } from '../store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { BuiltIn, type TaskItem } from '../models'
import { atNoon } from '../calendar'
import { SampleIDs } from '../seed'

/**
 * Ports SomedayRuleTests.swift, DeadlineMoveTests.swift,
 * ProjectConversionTests.swift, the core half of ListCustomizationTests.swift,
 * and SampleAndResetTests.swift.
 */

const NOW = new Date(2026, 6, 28, 9, 0, 0)
const day = (y: number, m: number, d: number) => atNoon(new Date(y, m - 1, d))

const store = async () =>
  AppStore.create({ adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f() })

let seq = 0
function task(over: Partial<TaskItem> = {}): TaskItem {
  seq += 1
  return {
    id: `20000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
    title: `task ${seq}`, note: '', dueDate: null, reminderDate: null,
    listID: BuiltIn.inbox, isCompleted: false, completedAt: null, isTrashed: false,
    createdAt: NOW, order: seq, repeatRule: null, trashedAt: null,
    ...over,
  }
}

describe('The Someday rule', () => {
  it('movingIntoSomedayStripsDeadlineAndRepeat', async () => {
    const s = await store()
    const t = task({ dueDate: day(2026, 8, 1), repeatRule: { unit: 'week', interval: 1 } })
    s.data.tasks = [t]
    s.moveTask(t.id, BuiltIn.someday)
    expect(s.task(t.id)!.listID).toBe(BuiltIn.someday)
    expect(s.task(t.id)!.dueDate).toBeNull()
    expect(s.task(t.id)!.repeatRule).toBeNull()
  })

  it('noOtherListMutatesFieldsOnMove', async () => {
    const s = await store()
    const rule = { unit: 'week' as const, interval: 1 }
    for (const target of [BuiltIn.notes, BuiltIn.nextActions, BuiltIn.waitingFor, BuiltIn.inbox]) {
      const t = task({ dueDate: day(2026, 8, 1), repeatRule: rule })
      s.data.tasks = [t]
      s.moveTask(t.id, target)
      expect(s.task(t.id)!.dueDate).not.toBeNull()
      expect(s.task(t.id)!.repeatRule).toEqual(rule)
    }
  })

  it('moveTaskDoesNotEnforceDeadlineRequiredLists', async () => {
    // A programmatic move into Next actions with no deadline is allowed and
    // produces an undated task there — enforcement lives in requestMove.
    const s = await store()
    const t = task()
    s.data.tasks = [t]
    s.moveTask(t.id, BuiltIn.nextActions)
    expect(s.task(t.id)!.listID).toBe(BuiltIn.nextActions)
    expect(s.task(t.id)!.dueDate).toBeNull()
    expect(s.pendingDeadline).toBeNull()
  })

  it('moveTaskRefusesTrashedTasks', async () => {
    const s = await store()
    const t = task({ isTrashed: true, trashedAt: NOW })
    s.data.tasks = [t]
    s.moveTask(t.id, BuiltIn.someday)
    expect(s.task(t.id)!.listID).toBe(BuiltIn.inbox) // restore destination intact
  })
})

describe('Deadline-required moves', () => {
  it('somedayIsNotADeadlineRequiredList', () => {
    expect(DEADLINE_REQUIRED_LISTS).toEqual([BuiltIn.nextActions, BuiltIn.waitingFor])
    expect(DEADLINE_REQUIRED_LISTS).not.toContain(BuiltIn.someday)
  })

  it('requestMoveIntoNextActionsRaisesThePrompt', async () => {
    const s = await store()
    const t = task()
    s.data.tasks = [t]
    s.requestMove([t.id], BuiltIn.nextActions)
    expect(s.pendingDeadline).toEqual({ kind: 'move', taskIDs: [t.id], target: BuiltIn.nextActions })
    expect(s.task(t.id)!.listID).toBe(BuiltIn.inbox) // not moved yet
  })

  it('requestMoveMovesTasksThatAlreadyHaveADeadline', async () => {
    const s = await store()
    const dated = task({ dueDate: day(2026, 8, 1) })
    const undated = task()
    s.data.tasks = [dated, undated]
    s.requestMove([dated.id, undated.id], BuiltIn.waitingFor)
    expect(s.task(dated.id)!.listID).toBe(BuiltIn.waitingFor)
    expect(s.pendingDeadline).toEqual({ kind: 'move', taskIDs: [undated.id], target: BuiltIn.waitingFor })
  })

  it('requestMoveIntoAnUnconstrainedListMovesImmediately', async () => {
    const s = await store()
    const t = task()
    s.data.tasks = [t]
    s.requestMove([t.id], BuiltIn.notes)
    expect(s.task(t.id)!.listID).toBe(BuiltIn.notes)
    expect(s.pendingDeadline).toBeNull()
  })

  it('requestMoveIgnoresTrashedTasks', async () => {
    const s = await store()
    const t = task({ isTrashed: true, trashedAt: NOW })
    s.data.tasks = [t]
    s.requestMove([t.id], BuiltIn.nextActions)
    expect(s.pendingDeadline).toBeNull()
  })

  it('completePendingDeadlineFinishesTheMove', async () => {
    const s = await store()
    const t = task()
    s.data.tasks = [t]
    s.requestMove([t.id], BuiltIn.nextActions)
    s.completePendingDeadline(new Date(2026, 7, 5))
    expect(s.task(t.id)!.listID).toBe(BuiltIn.nextActions)
    expect(s.task(t.id)!.dueDate!.getDate()).toBe(5)
    expect(s.task(t.id)!.dueDate!.getHours()).toBe(12)
    expect(s.pendingDeadline).toBeNull()
  })

  it('cancelPendingDeadlineDiscardsTheMoveEntirely', async () => {
    const s = await store()
    const t = task()
    s.data.tasks = [t]
    s.requestMove([t.id], BuiltIn.nextActions)
    s.cancelPendingDeadline()
    expect(s.pendingDeadline).toBeNull()
    expect(s.task(t.id)!.listID).toBe(BuiltIn.inbox)
    expect(s.task(t.id)!.dueDate).toBeNull()
  })

  it('submitNewTaskStoresTheTrimmedTitleInPendingDeadline', async () => {
    const s = await store()
    const created = s.submitNewTask('  plan trip  ', { kind: 'list', id: BuiltIn.nextActions })
    expect(created).toBeNull() // nothing created yet
    expect(s.pendingDeadline).toEqual({ kind: 'create', title: 'plan trip', target: BuiltIn.nextActions })
    expect(s.data.tasks).toEqual([])
  })

  it('submitNewTaskWithADeadlineCreatesAndDatesInOneCall', async () => {
    const s = await store()
    const created = s.submitNewTask('plan trip', { kind: 'list', id: BuiltIn.nextActions }, new Date(2026, 7, 9))
    expect(created).not.toBeNull()
    expect(created!.dueDate!.getDate()).toBe(9)
    expect(s.pendingDeadline).toBeNull()
  })

  it('completePendingDeadlineFinishesTheCreate', async () => {
    const s = await store()
    s.submitNewTask('plan trip', { kind: 'list', id: BuiltIn.waitingFor })
    s.completePendingDeadline(new Date(2026, 7, 9))
    expect(s.data.tasks.length).toBe(1)
    expect(s.data.tasks[0]!.title).toBe('plan trip')
    expect(s.data.tasks[0]!.listID).toBe(BuiltIn.waitingFor)
    expect(s.data.tasks[0]!.dueDate!.getDate()).toBe(9)
  })

  it('submitNewTaskElsewhereCreatesImmediately', async () => {
    const s = await store()
    expect(s.submitNewTask('note this', { kind: 'list', id: BuiltIn.notes })).not.toBeNull()
    expect(s.pendingDeadline).toBeNull()
  })

  it('blankTitlesNeverRaiseThePrompt', async () => {
    const s = await store()
    expect(s.submitNewTask('   ', { kind: 'list', id: BuiltIn.nextActions })).toBeNull()
    expect(s.pendingDeadline).toBeNull()
  })
})

describe('Project conversion', () => {
  it('movesAndNeverDeletes', async () => {
    const s = await store()
    const t = task({
      note: 'important context', dueDate: day(2026, 8, 1),
      reminderDate: new Date(2026, 7, 1, 8), title: 'Redesign the site',
    })
    s.data.tasks = [t]
    const project = s.convertToProject(t.id)!

    expect(project.name).toBe('Redesign the site')
    expect(project.groupID).toBe(BuiltIn.projectsGroup)
    // Every field survives.
    const after = s.task(t.id)!
    expect(after.listID).toBe(project.id)
    expect(after.note).toBe('important context')
    expect(after.dueDate).not.toBeNull()
    expect(after.reminderDate).not.toBeNull()
  })

  it('isReversibleByMovingBackOut', async () => {
    const s = await store()
    const t = task()
    s.data.tasks = [t]
    const project = s.convertToProject(t.id)!
    s.moveTask(t.id, BuiltIn.inbox)
    expect(s.task(t.id)!.listID).toBe(BuiltIn.inbox)
    expect(s.list(project.id)).not.toBeNull() // the empty project remains
  })

  it('refusesTrashedTasks', async () => {
    const s = await store()
    const t = task({ isTrashed: true, trashedAt: NOW })
    s.data.tasks = [t]
    expect(s.convertToProject(t.id)).toBeNull()
  })

  it('usesTheRawTitleAsTheListName', async () => {
    const s = await store()
    const t = task({ title: '  spaced title  ' })
    s.data.tasks = [t]
    expect(s.convertToProject(t.id)!.name).toBe('  spaced title  ')
  })
})

describe('List and group CRUD', () => {
  it('addListAssignsGlobalMaxOrderPlusOne', async () => {
    const s = await store()
    const a = s.addList('Work', null)!
    const b = s.addList('Home', null)!
    expect(a.order).toBe(5) // built-ins occupy 0..4
    expect(b.order).toBe(6)
    expect(s.addList('   ', null)).toBeNull()
  })

  it('addGroupStartsAtOneBecauseProjectsIsZero', async () => {
    const s = await store()
    expect(s.addGroup('Areas')!.order).toBe(1)
  })

  it('builtInListsCannotBeRenamedRecolouredOrDeleted', async () => {
    const s = await store()
    s.renameList(BuiltIn.inbox, 'Nope')
    s.setListColor(BuiltIn.inbox, '#FF0000')
    s.setListSymbol(BuiltIn.inbox, 'star')
    s.deleteList(BuiltIn.inbox)
    const inbox = s.list(BuiltIn.inbox)!
    expect(inbox.name).toBe('Inbox')
    expect(inbox.colorHex).toBeNull()
    expect(inbox.symbol).toBeNull()
  })

  it('userListsCarryColourAndSymbolThroughTheWireFormat', async () => {
    const s = await store()
    const l = s.addList('Work', null)!
    s.setListColor(l.id, '#007AFF')
    s.setListSymbol(l.id, 'briefcase')
    expect(s.list(l.id)!.colorHex).toBe('#007AFF')
    expect(s.list(l.id)!.symbol).toBe('briefcase')
  })

  it('deletingAListTrashesItsLiveTasks', async () => {
    const s = await store()
    const l = s.addList('Work', null)!
    const live = task({ listID: l.id })
    s.data.tasks = [live]
    s.deleteList(l.id)
    expect(s.task(live.id)!.isTrashed).toBe(true)
    expect(s.task(live.id)!.trashedAt).toEqual(NOW)
    expect(s.list(l.id)).toBeNull()
  })

  it('deletingTheSelectedListFallsBackToToday', async () => {
    const s = await store()
    const l = s.addList('Work', null)!
    s.selection = { kind: 'list', id: l.id }
    s.deleteList(l.id)
    expect(s.selection).toEqual({ kind: 'smart', view: 'today' })
  })

  it('deletingAGroupKeepsItsListsAsUngrouped', async () => {
    const s = await store()
    const g = s.addGroup('Areas')!
    const l = s.addList('Work', g.id)!
    s.deleteGroup(g.id)
    expect(s.list(l.id)!.groupID).toBeNull()
    expect(s.userGroups()).toEqual([])
  })

  it('theProjectsGroupIsBuiltInAndProtected', async () => {
    const s = await store()
    s.deleteGroup(BuiltIn.projectsGroup)
    s.renameGroup(BuiltIn.projectsGroup, 'Nope')
    expect(s.data.groups.find((g) => g.id === BuiltIn.projectsGroup)!.name).toBe('Projects')
  })

  it('sidebarQueriesSortWithinTheirGroupScope', async () => {
    const s = await store()
    const g = s.addGroup('Areas')!
    const work = s.addList('Work', g.id)!
    const home = s.addList('Home', g.id)!
    const loose = s.addList('Reading', null)!
    expect(s.listsInGroup(g.id).map((l) => l.id)).toEqual([work.id, home.id])
    expect(s.ungroupedUserLists().map((l) => l.id)).toEqual([loose.id])
  })
})

describe('Sample data and reset', () => {
  it('resetReturnsToTheSeededDefaults', async () => {
    const s = await store()
    s.addList('Work', null)
    s.data.tasks = [task()]
    s.resetAllData()
    expect(s.data.tasks).toEqual([])
    expect(s.data.lists.length).toBe(5)
    expect(s.selection).toEqual({ kind: 'smart', view: 'today' })
    expect(s.searchQuery).toBe('')
  })

  it('loadSampleDataProducesAReproducibleSet', async () => {
    const s = await store()
    s.loadSampleData()
    const first = s.data.tasks.map((t) => t.id)
    s.loadSampleData()
    expect(s.data.tasks.map((t) => t.id)).toEqual(first) // stable IDs
    expect(s.data.tasks.length).toBe(36)
  })

  it('sampleDataSpansOverdueTodayUpcomingCompletedAndTrashed', async () => {
    const s = await store()
    s.loadSampleData()
    expect(s.overdueTasks.length).toBeGreaterThan(0)
    expect(s.todayTasks.length).toBeGreaterThan(0)
    expect(s.calendarTasks('Later').length).toBeGreaterThan(0)
    expect(s.completedTasks.length).toBeGreaterThan(0)
    expect(s.trashedTasks.length).toBe(2)
  })

  it('sampleDataIncludesUserListsGroupsAndAProject', async () => {
    const s = await store()
    s.loadSampleData()
    expect(s.list(SampleIDs.workList)!.colorHex).toBe('#007AFF')
    expect(s.userGroups().map((g) => g.name)).toEqual(['Areas'])
    expect(s.list(SampleIDs.siteProject)!.groupID).toBe(BuiltIn.projectsGroup)
  })

  it('resetAndLoadSampleClearTheSelectionAndQuery', async () => {
    const s = await store()
    s.selection = { kind: 'list', id: BuiltIn.notes }
    s.selectedTaskID = 'x'
    s.searchQuery = 'q'
    s.loadSampleData()
    expect(s.selection).toEqual({ kind: 'smart', view: 'today' })
    expect(s.selectedTaskID).toBeNull()
    expect(s.searchQuery).toBe('')
  })
})
