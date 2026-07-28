import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppStore } from '../../core/store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { BuiltIn } from '../../core/models'
import { StoreContext } from '../useStore'
import { RootShell } from '../RootShell'
import { UndoContext } from '../undo/useUndo'
import { UndoCenter } from '../../core/undo'
import { exportBytes, importText, ImportError } from '../transfer'
import { encodeAppData } from '../../core/codec'
import { seededAppData } from '../../core/models'

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
  return store
}

beforeEach(() => { cleanup(); window.location.hash = '' })

describe('Keyboard', () => {
  it('digitsGoToTodayCalendarInbox', async () => {
    const user = userEvent.setup()
    const store = await mount()
    await user.keyboard('2')
    expect(store.selection).toEqual({ kind: 'smart', view: 'calendar' })
    await user.keyboard('3')
    expect(store.selection).toEqual({ kind: 'list', id: BuiltIn.inbox })
    await user.keyboard('1')
    expect(store.selection).toEqual({ kind: 'smart', view: 'today' })
  })

  it('nFocusesTheAddBarAndSlashFocusesSearch', async () => {
    const user = userEvent.setup()
    await mount()
    await user.keyboard('n')
    expect(document.activeElement).toBe(screen.getByLabelText('Add a task'))
    // Blur first: bare keys are suppressed while a field has focus.
    act(() => { (document.activeElement as HTMLElement).blur() })
    await user.keyboard('/')
    expect(document.activeElement).toBe(screen.getByLabelText('Search'))
  })

  it('bareKeysAreIgnoredWhileFocusIsInATextField', async () => {
    const user = userEvent.setup()
    const store = await mount()
    const field = screen.getByLabelText('Add a task')
    await user.click(field)
    await user.keyboard('2')
    // Typed into the field, not treated as "go to Calendar".
    expect(store.selection).toEqual({ kind: 'smart', view: 'today' })
    expect((field as HTMLInputElement).value).toBe('2')
  })

  it('deleteTrashesTheSelectedTask', async () => {
    const user = userEvent.setup()
    const store = await mount()
    const t = store.addTask('doomed', { kind: 'smart', view: 'today' })!
    store.setSelectedTask(t.id)
    await user.keyboard('{Delete}')
    expect(store.task(t.id)!.isTrashed).toBe(true)
  })

  it('escapeClosesTheDetailThenClearsSearch', async () => {
    const user = userEvent.setup()
    const store = await mount()
    const t = store.addTask('thing', { kind: 'smart', view: 'today' })!
    store.setSearchQuery('thing')
    store.setSelectedTask(t.id)

    await user.keyboard('{Escape}')
    expect(store.selectedTaskID).toBeNull()
    expect(store.searchQuery).toBe('thing')

    await user.keyboard('{Escape}')
    expect(store.searchQuery).toBe('')
  })

  it('bracketKeysMoveTheSelectedTaskWithinItsList', async () => {
    const user = userEvent.setup()
    const store = await mount()
    const a = store.addTask('a', { kind: 'list', id: BuiltIn.notes })!
    const b = store.addTask('b', { kind: 'list', id: BuiltIn.notes })!
    store.setSelectedTask(a.id)

    await user.keyboard(']')
    expect(store.incompleteTasks(BuiltIn.notes).map((t) => t.id)).toEqual([b.id, a.id])
    await user.keyboard('[[')
    expect(store.incompleteTasks(BuiltIn.notes).map((t) => t.id)).toEqual([a.id, b.id])
  })

  it('commaOpensSettings', async () => {
    const user = userEvent.setup()
    await mount()
    await user.keyboard(',')
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
  })
})

describe('Accessibility', () => {
  it('everyRowActionIsReachableFromTheKeyboard', async () => {
    const store = await mount()
    store.addTask('reachable', { kind: 'smart', view: 'today' })
    store.setSelectedTask(null)
    // Both the circle and the row body are real buttons, not click handlers on
    // a div, so tab order reaches them.
    expect(await screen.findByRole('checkbox', { name: /reachable/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /reachable/ })).toBeTruthy()
  })

  it('theCompletionHoldReleaseIsAnnouncedPolitely', async () => {
    await mount()
    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
  })

  it('reorderControlsAreLabelledPerList', async () => {
    await mount()
    expect(screen.getByRole('button', { name: 'Move Someday up' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Move Someday down' })).toBeTruthy()
  })
})

describe('Transfer', () => {
  it('exportProducesBytesIdenticalToTheCodec', async () => {
    const store = await mount()
    store.addTask('exported', { kind: 'smart', view: 'today' })
    expect(exportBytes(store)).toBe(encodeAppData(store.data))
  })

  it('importReplacesTheStoreAndHealsBuiltIns', async () => {
    const store = await mount()
    const incoming = seededAppData()
    incoming.lists = incoming.lists.filter((l) => l.id !== BuiltIn.notes)
    incoming.lists.push({
      id: '77777777-2222-3333-4444-555555555555', name: 'Imported',
      isBuiltIn: false, groupID: null, order: 9, colorHex: null, symbol: null,
    })
    importText(store, encodeAppData(incoming))
    expect(store.data.lists.map((l) => l.name)).toContain('Imported')
    expect(store.list(BuiltIn.notes)).not.toBeNull() // healed back
  })

  it('anUndecodableFileLeavesTheStoreUntouched', async () => {
    const store = await mount()
    store.addTask('precious', { kind: 'smart', view: 'today' })
    const before = exportBytes(store)
    expect(() => importText(store, '{ not json')).toThrow(ImportError)
    expect(exportBytes(store)).toBe(before)
  })

  it('importTakesASnapshotFirstSoItIsUndoable', async () => {
    const adapter = new MemoryAdapter()
    const store = await AppStore.create({ adapter, now: () => NOW, scheduler: (_m, f) => f() })
    store.addTask('before import', { kind: 'smart', view: 'today' })
    await store.flushWrites()

    importText(store, encodeAppData(seededAppData()))
    await store.flushWrites()

    const snapshots = await adapter.listSnapshots()
    expect(snapshots.length).toBeGreaterThan(0)
    expect(await adapter.readSnapshot(snapshots[0]!.id)).toContain('before import')
  })
})
