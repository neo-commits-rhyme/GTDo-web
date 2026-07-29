/**
 * The composed app, not the units: this repo's recurring failure mode is that
 * the logic is right while the wiring is wrong. These mount RootShell and drive
 * it the way a user does.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within, cleanup, act } from '@testing-library/react'
import { AppStore } from '../../core/store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { BuiltIn } from '../../core/models'
import { StoreContext } from '../useStore'
import { UndoContext } from '../undo/useUndo'
import { UndoCenter } from '../../core/undo'
import { RootShell } from '../RootShell'

const NOW = new Date(2026, 6, 28, 9, 0, 0)

async function mount() {
  window.innerWidth = 1280
  window.location.hash = ''
  const store = await AppStore.create({
    adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f(),
  })
  render(
    <StoreContext.Provider value={store}>
      <UndoContext.Provider value={new UndoCenter(() => {})}>
        <RootShell />
      </UndoContext.Provider>
    </StoreContext.Provider>,
  )
  return { store }
}

const nav = () => screen.getByRole('navigation', { name: 'Lists' })

/** A sidebar row's accessible name absorbs its count span ("Kitchen remodel 1"),
 *  and the reorder buttons are named "Move <list> up". Anchoring at the start
 *  picks the row itself in both cases. */
const rowNamed = (name: string) => new RegExp(`^${name}\\b`)

beforeEach(() => { cleanup(); window.location.hash = '' })

describe('Completed projects, composed', () => {
  it('offersTheRowInTheSidebar', async () => {
    await mount()
    expect(within(nav()).getAllByRole('button', { name: /Completed projects/ })).toHaveLength(1)
  })

  /** Verified on the EMPTY default document, per the standing note that demo
   *  data has twice hidden an inert change. */
  it('showsItsEmptyStateOnAFreshDocument', async () => {
    await mount()
    act(() => { within(nav()).getByRole('button', { name: /Completed projects/ }).click() })
    expect(screen.getByRole('heading', { name: 'Completed projects' })).toBeDefined()
    expect(screen.getByText(/Nothing finished yet/)).toBeDefined()
  })

  it('listsAFinishedProjectAndOpensItAgain', async () => {
    const { store } = await mount()
    let projectID = ''
    act(() => {
      const p = store.addList('Kitchen remodel', BuiltIn.projectsGroup)!
      projectID = p.id
      store.addTask('tile the splashback', { kind: 'list', id: p.id })
      store.completeList(p.id)
    })

    act(() => { within(nav()).getByRole('button', { name: /Completed projects/ }).click() })
    const row = screen.getByRole('button', { name: /Kitchen remodel/ })
    expect(row.textContent).toContain('1 task')

    // Opening it navigates to the project itself.
    act(() => { row.click() })
    expect(screen.getByRole('heading', { name: rowNamed('Kitchen remodel') })).toBeDefined()
    expect(store.selection).toEqual({ kind: 'list', id: projectID })
  })

  it('dropsTheProjectOutOfTheSidebarAndTheProjectsCount', async () => {
    const { store } = await mount()
    act(() => {
      store.addList('Live one', BuiltIn.projectsGroup)
      const done = store.addList('Finished one', BuiltIn.projectsGroup)!
      store.completeList(done.id)
    })
    expect(within(nav()).queryAllByRole('button', { name: rowNamed('Finished one') })).toHaveLength(0)
    expect(within(nav()).getAllByRole('button', { name: rowNamed('Live one') })).toHaveLength(1)
    // The Projects heading carries the live count, and only the live count.
    expect(within(nav()).getByRole('heading', { name: /Projects/ }).textContent).toContain('1')
  })

  it('hidesTheProjectsHeadingCountWhenThereAreNone', async () => {
    await mount()
    const heading = within(nav()).getByRole('heading', { name: /Projects/ })
    expect(heading.textContent?.replace(/\s/g, '')).toBe('Projects')
  })

  it('unCompletingPutsItBackInTheSidebar', async () => {
    const { store } = await mount()
    act(() => {
      const p = store.addList('Kitchen remodel', BuiltIn.projectsGroup)!
      store.addTask('tile the splashback', { kind: 'list', id: p.id })
      store.completeList(p.id)
    })
    act(() => { within(nav()).getByRole('button', { name: /Completed projects/ }).click() })
    act(() => { screen.getByRole('button', { name: 'Un-complete' }).click() })

    expect(within(nav()).getAllByRole('button', { name: rowNamed('Kitchen remodel') })).toHaveLength(1)
    expect(screen.getByText(/Nothing finished yet/)).toBeDefined()
  })
})

describe('Per-list sort, composed', () => {
  it('reordersTheRenderedRowsAndRestoresManual', async () => {
    const { store } = await mount()
    act(() => {
      const later = store.addTask('later', { kind: 'list', id: BuiltIn.inbox })!
      const sooner = store.addTask('sooner', { kind: 'list', id: BuiltIn.inbox })!
      store.setDueDate(later.id, new Date(2026, 7, 20))
      store.setDueDate(sooner.id, new Date(2026, 6, 30))
    })
    act(() => { within(nav()).getByRole('button', { name: rowNamed('Inbox') }).click() })

    const rowTitles = () =>
      screen.getAllByRole('listitem').map((li) => li.textContent ?? '').filter((t) => /later|sooner/.test(t))

    expect(rowTitles()[0]).toContain('later') // manual: creation order

    const select = screen.getByRole('combobox', { name: /Sort/ }) as HTMLSelectElement
    act(() => {
      select.value = 'dueDate'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(rowTitles()[0]).toContain('sooner')

    act(() => {
      select.value = 'manual'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(rowTitles()[0]).toContain('later')
  })

  it('offersNoSortControlOnASmartView', async () => {
    await mount()
    expect(screen.queryByRole('combobox', { name: /Sort/ })).toBeNull()
  })
})

describe('Add to Today, composed', () => {
  it('datesTheTaskTodayAndThenSaysSo', async () => {
    const { store } = await mount()
    let taskID = ''
    act(() => { taskID = store.addTask('buy milk', { kind: 'list', id: BuiltIn.inbox })!.id })
    act(() => { within(nav()).getByRole('button', { name: rowNamed('Inbox') }).click() })
    act(() => { store.setSelectedTask(taskID) })

    act(() => { screen.getByRole('button', { name: 'Add to Today' }).click() })

    expect(store.task(taskID)?.dueDate).not.toBeNull()
    // Now inert, and it says why rather than doing nothing.
    const again = screen.getByRole('button', { name: 'Added to Today' }) as HTMLButtonElement
    expect(again.disabled).toBe(true)
  })
})

describe('User groups, composed', () => {
  it('createsRenamesAndCollapsesAGroup', async () => {
    const { store } = await mount()
    act(() => {
      const g = store.addGroup('Home')!
      store.addList('Garden', g.id)
    })

    // The group header carries its live count and its member is nested under it.
    expect(within(nav()).getByRole('button', { name: /^Home/ }).textContent).toContain('1')
    expect(within(nav()).getAllByRole('button', { name: rowNamed('Garden') })).toHaveLength(1)

    // Collapsing hides the members without touching the document.
    act(() => { within(nav()).getByRole('button', { name: /^Home/ }).click() })
    expect(within(nav()).queryAllByRole('button', { name: rowNamed('Garden') })).toHaveLength(0)
    expect(store.listsInGroup(store.userGroups()[0]!.id)).toHaveLength(1)
  })

  it('deletingAGroupKeepsItsLists', async () => {
    const { store } = await mount()
    let groupID = ''
    act(() => {
      const g = store.addGroup('Home')!
      groupID = g.id
      store.addList('Garden', g.id)
    })
    act(() => { store.deleteGroup(groupID) })

    expect(store.userGroups()).toHaveLength(0)
    // The list survives, ungrouped — which is what the confirmation promises.
    expect(store.data.lists.some((l) => l.name === 'Garden' && l.groupID === null)).toBe(true)
    expect(within(nav()).getAllByRole('button', { name: rowNamed('Garden') })).toHaveLength(1)
  })

  it('showsAnEmptyGroupAsEmptyRatherThanBlank', async () => {
    const { store } = await mount()
    act(() => { store.addGroup('Empty one') })
    expect(screen.getByText('No lists in this group.')).toBeDefined()
    // Zero renders no count, the same rule the row badges follow.
    expect(within(nav()).getByRole('button', { name: /^Empty one/ }).textContent?.trim())
      .toBe('▾Empty one')
  })
})
