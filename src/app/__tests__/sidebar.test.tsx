import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within, cleanup, act } from '@testing-library/react'
import { AppStore } from '../../core/store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { BuiltIn, sameID, seededAppData, type AppData, type TaskList } from '../../core/models'
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

const groceries: TaskList = {
  id: '11111111-0000-0000-0000-000000000001',
  name: 'Groceries',
  isBuiltIn: false,
  groupID: null,
  order: 0,
  colorHex: null,
  symbol: null,
}

/** An export from a document that lost its Inbox: healingBuiltIns appends the
 *  missing built-in at the END, so lists[0] is a user list. */
function importedWithoutInboxFirst(): AppData {
  const seed = seededAppData()
  return {
    ...seed,
    lists: [groceries, ...seed.lists.filter((l) => !sameID(l.id, BuiltIn.inbox))],
  }
}

beforeEach(() => { cleanup(); window.location.hash = '' })

describe('Sidebar Inbox row', () => {
  it('survivesAnImportWhoseListsDoNotStartWithInbox', async () => {
    const { store } = await mount()
    act(() => { store.importData(importedWithoutInboxFirst()) })

    const nav = screen.getByRole('navigation', { name: 'Lists' })
    const rows = (name: string) => within(nav).queryAllByRole('button', { name }).length
    // A positional Inbox slot rendered lists[0] instead: no Inbox row at all —
    // it is excluded from both sections, so it became unreachable — and the
    // first list rendered twice.
    expect({ inbox: rows('Inbox'), groceries: rows('Groceries') })
      .toEqual({ inbox: 1, groceries: 1 })
  })

  it('theInboxRowStaysReachableAfterSuchAnImport', async () => {
    const { store } = await mount()
    act(() => { store.importData(importedWithoutInboxFirst()) })

    const nav = screen.getByRole('navigation', { name: 'Lists' })
    act(() => { within(nav).getByRole('button', { name: 'Inbox' }).click() })
    expect(store.selection).toEqual({ kind: 'list', id: BuiltIn.inbox })
  })
})
