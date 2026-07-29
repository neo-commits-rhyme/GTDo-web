/**
 * The composed app, not the query: this repo's bugs live in wiring, so the
 * mirror has to be checked where it renders — a real RootShell, navigated the
 * way a user navigates, on the default empty document.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppStore } from '../../core/store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { BuiltIn } from '../../core/models'
import { StoreContext } from '../useStore'
import { RootShell } from '../RootShell'
import { UndoContext } from '../undo/useUndo'
import { UndoCenter } from '../../core/undo'
import { atNoon } from '../../core/calendar'

const NOW = new Date(2026, 6, 28, 9, 0, 0)
const DUE = atNoon(new Date(2026, 6, 30))

/** Seeds before rendering: a store mutated after mount does not repaint the
 *  sidebar on its own, and the tests here navigate by clicking it. */
async function mount(seed: (s: AppStore) => void = () => {}) {
  window.innerWidth = 1280
  window.location.hash = ''
  const store = await AppStore.create({
    adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f(),
  })
  seed(store)
  render(
    <StoreContext.Provider value={store}>
      <UndoContext.Provider value={new UndoCenter(() => {})}>
        <RootShell />
      </UndoContext.Provider>
    </StoreContext.Provider>,
  )
  return store
}

/** Seeds a project with one deadlined task and one without. */
function seedProject(store: AppStore, name = 'Website', colorHex: string | null = '#34C759') {
  const project = store.addList(name, BuiltIn.projectsGroup)!
  if (colorHex !== null) store.setListColor(project.id, colorHex)
  const dated = store.addTask('wireframes', { kind: 'list', id: project.id })!
  store.setDueDate(dated.id, DUE)
  store.addTask('pick a palette', { kind: 'list', id: project.id })
  return project
}

/** The first match: a customisable list also has a “⋯” button whose accessible
 *  name carries the list name. */
const navTo = async (user: ReturnType<typeof userEvent.setup>, name: string | RegExp) => {
  const nav = screen.getByRole('navigation', { name: 'Lists' })
  await user.click(within(nav).getAllByRole('button', { name })[0]!)
}

// A regex, not the exact string: the row carries a count badge, so its
// accessible name is “Next actions 1” once the mirror has something in it.
const openNextActions = (user: ReturnType<typeof userEvent.setup>) =>
  navTo(user, /^Next actions/)

beforeEach(() => { cleanup(); window.location.hash = '' })

describe('the Next actions mirror, rendered', () => {
  it('shows a deadlined project task under Next actions, tagged with its project', async () => {
    const user = userEvent.setup()
    await mount((s) => seedProject(s))
    await openNextActions(user)

    expect(screen.getByText('wireframes')).toBeTruthy()
    // The tag names the project…
    expect(screen.getByTitle('From the project “Website”')).toBeTruthy()
    // …and the undated project task is not mirrored at all.
    expect(screen.queryByText('pick a palette')).toBeNull()
  })

  it('paints the tag in the project list’s own colour', async () => {
    const user = userEvent.setup()
    await mount((s) => seedProject(s, 'Website', '#34C759'))
    await openNextActions(user)

    const tag = screen.getByTitle('From the project “Website”')
    expect(tag.style.color).toBe('rgb(52, 199, 89)')
  })

  it('leaves the tag uncoloured when the project list has no colour', async () => {
    const user = userEvent.setup()
    await mount((s) => seedProject(s, 'Ремонт', null))
    await openNextActions(user)

    expect(screen.getByTitle('From the project “Ремонт”').style.color).toBe('')
  })

  it('counts the mirror in the sidebar badge', async () => {
    const user = userEvent.setup()
    await mount((s) => {
      seedProject(s)
      const own = s.addTask('call the bank', { kind: 'list', id: BuiltIn.nextActions })!
      s.setDueDate(own.id, DUE)
    })
    const nav = screen.getByRole('navigation', { name: 'Lists' })
    // One of its own plus the one mirrored project task — a badge that
    // disagrees with the list it opens reads as a bug.
    expect(within(nav).getAllByRole('button', { name: /^Next actions/ })[0]!.textContent)
      .toContain('2')
    await openNextActions(user)
    expect(document.querySelectorAll('.row').length).toBe(2)
  })

  it('does not tag rows in the project’s own list', async () => {
    const user = userEvent.setup()
    await mount((s) => seedProject(s))
    await navTo(user, /Website/)

    expect(screen.getByText('wireframes')).toBeTruthy()
    expect(screen.queryByTitle('From the project “Website”')).toBeNull()
  })

  it('completes a mirrored task from Next actions, in both places', async () => {
    const user = userEvent.setup()
    let project!: ReturnType<typeof seedProject>
    const store = await mount((s) => { project = seedProject(s) })
    await openNextActions(user)

    await user.click(screen.getByRole('checkbox', { name: 'Complete wireframes' }))

    // Ticked in the project, not just in the view it was ticked from.
    expect(store.completedTasksIn(project.id).map((t) => t.title)).toEqual(['wireframes'])
    // And still on screen, under Completed, rather than vanishing.
    const completed = screen.getByRole('heading', { name: 'Completed' }).parentElement!
    expect(within(completed).getByText('wireframes')).toBeTruthy()
  })
})

describe('importing a task list, rendered', () => {
  it('offers the import button on an empty Inbox', async () => {
    const user = userEvent.setup()
    await mount()
    await navTo(user, /^Inbox/)

    expect(screen.getByText('Import tasks from a file…')).toBeTruthy()
  })

  it('imports a chosen file into the Inbox and reports the count', async () => {
    const user = userEvent.setup()
    const store = await mount()
    await navTo(user, /^Inbox/)

    const file = new File(['1. один\n2. два\n3. три'], 'list.txt', { type: 'text/plain' })
    await user.upload(screen.getByText('Import tasks from a file…').querySelector('input')!, file)

    expect(await screen.findByText('Added 3 tasks to the Inbox.')).toBeTruthy()
    expect(store.incompleteTasks(BuiltIn.inbox).map((t) => t.title)).toEqual(['один', 'два', 'три'])
    // The rows are on screen, not just in the store.
    expect(screen.getByText('один')).toBeTruthy()
  })

  it('turns away a file that is not a list of text lines', async () => {
    const user = userEvent.setup()
    const store = await mount()
    await navTo(user, /^Inbox/)

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3])
    const file = new File([png], 'photo.png', { type: 'image/png' })
    await user.upload(screen.getByText('Import tasks from a file…').querySelector('input')!, file)

    expect(await screen.findByText(/Skipped photo\.png/)).toBeTruthy()
    expect(store.data.tasks).toEqual([])
  })
})
