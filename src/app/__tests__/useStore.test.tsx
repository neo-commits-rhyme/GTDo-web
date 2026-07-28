import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppStore } from '../../core/store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { UndoCenter } from '../../core/undo'
import { BuiltIn } from '../../core/models'
import { StoreContext, useStoreTick } from '../useStore'
import { UndoContext } from '../undo/useUndo'
import { RootShell } from '../RootShell'

const NOW = new Date(2026, 6, 28, 9, 0, 0)

function newStore() {
  return AppStore.create({
    adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f(),
  })
}

/** The tick verbatim: a component re-renders exactly when this text changes. */
function TickProbe() {
  return <span data-testid="tick">{useStoreTick()}</span>
}

async function mountProbe() {
  const store = await newStore()
  render(
    <StoreContext.Provider value={store}>
      <TickProbe />
    </StoreContext.Provider>,
  )
  // Every mutation goes through act(), including setup: an unflushed render
  // makes the baseline stale, and the move under test then gets credit for a
  // re-render the setup had already earned.
  return {
    store,
    tick: () => screen.getByTestId('tick').textContent,
    run: <T,>(mutate: () => T): T => {
      let out!: T
      act(() => { out = mutate() })
      return out
    },
  }
}

async function mountShell() {
  window.innerWidth = 1280
  window.location.hash = ''
  const store = await newStore()
  render(
    <StoreContext.Provider value={store}>
      <UndoContext.Provider value={new UndoCenter(() => {})}>
        <RootShell />
      </UndoContext.Provider>
    </StoreContext.Provider>,
  )
  return { store }
}

beforeEach(() => { cleanup(); window.location.hash = '' })

describe('The render fingerprint covers the sidebar order', () => {
  it('movingAGTDEntryBumpsTheTick', async () => {
    // gtdOrder appeared nowhere in the fingerprint, so every sidebar reorder
    // notified subscribers and then rendered the old order.
    const { store, tick, run } = await mountProbe()
    const before = tick()

    run(() => store.moveGTDEntries([0], 2))
    expect(store.gtdSectionItems()[0]).toEqual({ kind: 'list', list: store.list(BuiltIn.waitingFor) })
    expect(tick()).not.toBe(before)
  })

  it('movingAUserEntryBumpsTheTick', async () => {
    const { store, tick, run } = await mountProbe()
    const one = run(() => store.addList('one', null)!)
    const two = run(() => store.addList('two', null)!)
    const before = tick()

    run(() => store.moveUserEntries([0], 2))
    expect(store.userSectionItems().map((e) => (e.kind === 'list' ? e.list.id : e.group.id)))
      .toEqual([two.id, one.id])
    expect(tick()).not.toBe(before)
  })

  it('aPurePermutationOfListOrderBumpsTheTick', async () => {
    // moveListsInGroup renumbers 0..n, so the second move is a permutation of
    // the same slots — the exact shape that a position-blind sum cannot see.
    const { store, tick, run } = await mountProbe()
    const a = run(() => store.addList('a', BuiltIn.projectsGroup)!)
    const b = run(() => store.addList('b', BuiltIn.projectsGroup)!)
    run(() => store.moveListsInGroup(BuiltIn.projectsGroup, [0], 2))
    const orders = store.listsInGroup(BuiltIn.projectsGroup).map((l) => l.order)
    const before = tick()

    run(() => store.moveListsInGroup(BuiltIn.projectsGroup, [0], 2))
    expect(store.listsInGroup(BuiltIn.projectsGroup).map((l) => l.id)).toEqual([a.id, b.id])
    expect(store.listsInGroup(BuiltIn.projectsGroup).map((l) => l.order)).toEqual(orders)
    expect(tick()).not.toBe(before)
  })

  it('theSidebarReorderButtonMovesTheRowOnScreen', async () => {
    const user = userEvent.setup()
    await mountShell()
    const labels = () => Array.from(document.querySelectorAll('.nav__label')).map((e) => e.textContent)
    expect(await screen.findByRole('button', { name: 'Move Waiting for... up' })).toBeTruthy()
    expect(labels()).toContain('Waiting for...')

    await user.click(screen.getByRole('button', { name: 'Move Waiting for... up' }))
    expect(labels().indexOf('Waiting for...')).toBeLessThan(labels().indexOf('Next actions'))
  })
})

describe('The render fingerprint still covers what earlier bugs missed', () => {
  it('changingSelectionBumpsTheTick', async () => {
    const { store, tick, run } = await mountProbe()
    const before = tick()
    run(() => store.setSelection({ kind: 'list', id: BuiltIn.notes }))
    expect(tick()).not.toBe(before)
  })

  it('reorderingTasksBumpsTheTick', async () => {
    const { store, tick, run } = await mountProbe()
    run(() => store.addTask('a', { kind: 'list', id: BuiltIn.notes }))
    run(() => store.addTask('b', { kind: 'list', id: BuiltIn.notes }))
    const before = tick()
    run(() => store.moveIncompleteTasks(BuiltIn.notes, [0], 2))
    expect(tick()).not.toBe(before)
  })

  it('movingATaskBetweenListsBumpsTheTick', async () => {
    const { store, tick, run } = await mountProbe()
    const t = run(() => store.addTask('wanderer', { kind: 'list', id: BuiltIn.notes })!)
    const before = tick()
    run(() => store.moveTask(t.id, BuiltIn.someday))
    expect(tick()).not.toBe(before)
  })

  it('renamingToASameLengthTitleBumpsTheTick', async () => {
    const { store, tick, run } = await mountProbe()
    const t = run(() => store.addTask('aaaa', { kind: 'list', id: BuiltIn.notes })!)
    const before = tick()
    run(() => store.renameTask(t.id, 'bbbb'))
    expect(tick()).not.toBe(before)
  })

  it('anUnchangedStoreDoesNotBumpTheTick', async () => {
    // The other half of the contract: the tick must be stable under Object.is,
    // or useSyncExternalStore re-renders on every notification forever.
    const { store, tick, run } = await mountProbe()
    const before = tick()
    run(() => store.setSearchQuery(''))
    expect(tick()).toBe(before)
  })
})
