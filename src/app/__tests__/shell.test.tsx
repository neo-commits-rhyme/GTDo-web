import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppStore } from '../../core/store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { BuiltIn } from '../../core/models'
import { StoreContext } from '../useStore'
import { RootShell } from '../RootShell'
import { UndoContext } from '../undo/useUndo'
import { UndoCenter } from '../../core/undo'
import { breakpointFor } from '../useBreakpoint'
import { deadlineToken } from '../format'
import { parseRoute, routeFor } from '../router'

const NOW = new Date(2026, 6, 28, 9, 0, 0)

/** Fires hold releases by hand so a window can be held open in a test. */
function makeScheduler() {
  const queued: (() => void)[] = []
  return {
    schedule: (_ms: number, fn: () => void) => { queued.push(fn) },
    fireAll: () => { const q = [...queued]; queued.length = 0; q.forEach((f) => f()) },
  }
}

async function mount(opts: { width?: number; scheduler?: (ms: number, fn: () => void) => void } = {}) {
  window.innerWidth = opts.width ?? 1280
  window.location.hash = ''
  const store = await AppStore.create({
    adapter: new MemoryAdapter(),
    now: () => NOW,
    scheduler: opts.scheduler ?? ((_m, f) => f()),
  })
  const view = render(
    <StoreContext.Provider value={store}>
      <UndoContext.Provider value={new UndoCenter(() => {})}>
        <RootShell />
      </UndoContext.Provider>
    </StoreContext.Provider>,
  )
  return { store, view }
}

beforeEach(() => { cleanup(); window.location.hash = '' })

describe('Router', () => {
  it('roundTripsEverySidebarItem', () => {
    const items = [
      { kind: 'smart', view: 'today' }, { kind: 'smart', view: 'calendar' },
      { kind: 'smart', view: 'completed' }, { kind: 'smart', view: 'trash' },
      { kind: 'list', id: BuiltIn.inbox },
    ] as const
    for (const item of items) expect(parseRoute(routeFor(item))).toEqual(item)
  })

  it('unknownRouteParsesAsNull', () => {
    expect(parseRoute('#/nonsense')).toBeNull()
    expect(parseRoute('')).toBeNull()
    expect(parseRoute('#/list/')).toBeNull()
  })

  it('deletedListIDFallsBackToTodayRatherThanAnEmptyPane', async () => {
    window.location.hash = '#/list/99999999-0000-0000-0000-000000000000'
    const { store } = await mount()
    expect(store.selection).toEqual({ kind: 'smart', view: 'today' })
  })
})

describe('Breakpoints', () => {
  it('picksTheThreeShapes', () => {
    expect(breakpointFor(1280)).toBe('wide')
    expect(breakpointFor(1100)).toBe('wide')
    expect(breakpointFor(1099)).toBe('medium')
    expect(breakpointFor(700)).toBe('medium')
    expect(breakpointFor(699)).toBe('narrow')
    expect(breakpointFor(375)).toBe('narrow')
  })

  it('below700RendersStackedNavigationWithAListsToggle', async () => {
    await mount({ width: 375 })
    expect(screen.getByRole('button', { name: 'Lists' })).toBeTruthy()
    // The sidebar is not on screen alongside the list at this width.
    expect(screen.queryByRole('navigation', { name: 'Lists' })).toBeNull()
  })

  it('atOrAbove1100TheSidebarAndListAreBothPresent', async () => {
    await mount({ width: 1280 })
    expect(screen.getByRole('navigation', { name: 'Lists' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Today', level: 1 })).toBeTruthy()
  })
})

describe('Deadline token', () => {
  it('overdueChangesTheWordNotJustTheColour', () => {
    expect(deadlineToken(new Date(2026, 6, 25), NOW)).toEqual({ text: '3d late', overdue: true })
    expect(deadlineToken(new Date(2026, 6, 28), NOW)).toEqual({ text: 'Today', overdue: false })
    expect(deadlineToken(new Date(2026, 6, 29), NOW)).toEqual({ text: 'Tomorrow', overdue: false })
    expect(deadlineToken(null, NOW)).toBeNull()
  })

  it('aCompletedTaskIsNeverLate', () => {
    // However long ago it was due — "40d late" on a struck-through row reads
    // as an unresolved problem.
    expect(deadlineToken(new Date(2026, 5, 18), NOW, true)).toEqual({ text: 'Jun 18', overdue: false })
    expect(deadlineToken(new Date(2026, 5, 18), NOW, false)).toEqual({ text: '40d late', overdue: true })
  })
})

describe('Shell', () => {
  it('rendersTheFourSmartViewsInCaseIterableOrder', async () => {
    await mount()
    const nav = screen.getByRole('navigation', { name: 'Lists' })
    const labels = within(nav).getAllByRole('button').map((b) => b.textContent)
    expect(labels.slice(0, 4)).toEqual(['Today', 'Calendar', 'Completed', 'Trash'])
  })

  it('rendersTheGTDBlockAndMyListsSections', async () => {
    await mount()
    const nav = screen.getByRole('navigation', { name: 'Lists' })
    expect(within(nav).getByText('GTD')).toBeTruthy()
    expect(within(nav).getByText('My lists')).toBeTruthy()
    for (const name of ['Inbox', 'Next actions', 'Waiting for...', 'Someday', 'Notes', 'Projects']) {
      expect(within(nav).getByText(name)).toBeTruthy()
    }
  })

  it('addingATaskInTodayShowsItImmediately', async () => {
    const user = userEvent.setup()
    await mount()
    await user.type(screen.getByLabelText('Add a task'), 'buy milk')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('buy milk')).toBeTruthy()
  })

  it('completionCircleIsACheckboxWithAriaChecked', async () => {
    const user = userEvent.setup()
    const { store } = await mount()
    store.addTask('buy milk', { kind: 'smart', view: 'today' })
    store.setSelectedTask(null) // force a render

    const circle = await screen.findByRole('checkbox', { name: 'Complete buy milk' })
    expect(circle.getAttribute('aria-checked')).toBe('false')
    await user.click(circle)
    expect(screen.getByRole('checkbox', { name: 'Un-complete buy milk' })).toBeTruthy()
  })

  it('tappingTheCircleHoldsTheRowInPlaceUntilTheWindowCloses', async () => {
    const user = userEvent.setup()
    const sched = makeScheduler()
    const { store } = await mount({ scheduler: sched.schedule })
    store.addTask('buy milk', { kind: 'smart', view: 'today' })
    store.setSelectedTask(null)

    await user.click(await screen.findByRole('checkbox', { name: 'Complete buy milk' }))
    // Still above the Completed heading — the row has not migrated.
    expect(screen.queryByText('Completed')).toBeTruthy() // sidebar entry exists
    expect(store.todayTasks.length).toBe(1)

    sched.fireAll()
    expect(store.todayTasks.length).toBe(0)
  })

  it('overdueRowsAreLabelledNotOnlyColoured', async () => {
    const { store } = await mount()
    const t = store.addTask('late thing', { kind: 'smart', view: 'today' })!
    store.setDueDate(t.id, new Date(2026, 6, 25))
    store.setSelectedTask(null)
    expect(await screen.findByText('3d late')).toBeTruthy()
  })

  it('completedAndTrashHaveNoAddBar', async () => {
    const user = userEvent.setup()
    await mount()
    const nav = screen.getByRole('navigation', { name: 'Lists' })
    await user.click(within(nav).getByRole('button', { name: 'Completed' }))
    expect(screen.queryByLabelText('Add a task')).toBeNull()
    await user.click(within(nav).getByRole('button', { name: 'Trash' }))
    expect(screen.queryByLabelText('Add a task')).toBeNull()
  })

  it('searchReplacesTheListWithResults', async () => {
    const user = userEvent.setup()
    const { store } = await mount()
    store.addTask('buy milk', { kind: 'smart', view: 'today' })
    store.addTask('walk dog', { kind: 'smart', view: 'today' })
    store.setSelectedTask(null)

    await user.type(screen.getByLabelText('Search'), 'milk')
    expect(screen.getByRole('heading', { name: 'Search', level: 1 })).toBeTruthy()
    expect(screen.getByText('1 result for “milk”')).toBeTruthy()
  })
})

describe('Detail pane', () => {
  it('opensOnRowClickAndClosesBack', async () => {
    const user = userEvent.setup()
    const { store } = await mount()
    store.addTask('buy milk', { kind: 'smart', view: 'today' })
    store.setSelectedTask(null)

    await user.click(await screen.findByRole('button', { name: /buy milk/ }))
    expect(screen.getByRole('complementary', { name: 'Task detail' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Close detail' }))
    expect(screen.queryByRole('complementary', { name: 'Task detail' })).toBeNull()
  })

  it('theRepeatControlIsAbsentWithoutADeadline', async () => {
    const { store } = await mount()
    const t = store.addTask('undated', { kind: 'list', id: BuiltIn.notes })!
    store.setSelectedTask(t.id)
    expect(screen.queryByText('Repeat')).toBeNull()

    store.setDueDate(t.id, NOW)
    store.setSelectedTask(t.id)
    expect(await screen.findByText('Repeat')).toBeTruthy()
  })

  it('movingIntoNextActionsOpensTheDeadlinePrompt', async () => {
    const user = userEvent.setup()
    const { store } = await mount()
    const t = store.addTask('undated', { kind: 'list', id: BuiltIn.notes })!
    store.setSelectedTask(t.id)

    await user.selectOptions(await screen.findByLabelText('List'), BuiltIn.nextActions)
    expect(screen.getByRole('dialog', { name: 'Choose a deadline' })).toBeTruthy()
    expect(store.task(t.id)!.listID).toBe(BuiltIn.notes) // not moved yet
  })

  it('cancellingTheDeadlinePromptPerformsNoMove', async () => {
    const user = userEvent.setup()
    const { store } = await mount()
    const t = store.addTask('undated', { kind: 'list', id: BuiltIn.notes })!
    store.requestMove([t.id], BuiltIn.nextActions)
    store.setSelectedTask(null)

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(store.task(t.id)!.listID).toBe(BuiltIn.notes)
    expect(store.task(t.id)!.dueDate).toBeNull()
  })
})

describe('Save failure', () => {
  it('bannerAppearsWithAnExportEscapeHatch', async () => {
    const adapter = new MemoryAdapter()
    vi.spyOn(adapter, 'persist').mockRejectedValue(new Error('QuotaExceededError'))
    const store = await AppStore.create({
      adapter, now: () => NOW, scheduler: (_m, f) => f(),
    })
    render(
      <StoreContext.Provider value={store}>
        <UndoContext.Provider value={new UndoCenter(() => {})}>
          <RootShell />
        </UndoContext.Provider>
      </StoreContext.Provider>,
    )
    store.addTask('anything', { kind: 'smart', view: 'today' })
    await store.flushWrites()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Changes are not being saved')
    expect(within(alert).getByRole('button', { name: 'Export now' })).toBeTruthy()
  })
})
