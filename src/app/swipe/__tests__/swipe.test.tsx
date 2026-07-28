import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { AppStore } from '../../../core/store'
import { MemoryAdapter } from '../../../storage/memoryAdapter'
import { UndoCenter } from '../../../core/undo'
import { StoreContext } from '../../useStore'
import { UndoContext } from '../../undo/useUndo'
import { RootShell } from '../../RootShell'
import { SWIPE_COMMIT_PX } from '../swipePlan'

const NOW = new Date(2026, 6, 28, 9, 0, 0)

async function mount() {
  window.innerWidth = 1280
  window.location.hash = ''
  const store = await AppStore.create({
    adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f(),
  })
  const undo = new UndoCenter(() => {})
  render(
    <StoreContext.Provider value={store}>
      <UndoContext.Provider value={undo}>
        <RootShell />
      </UndoContext.Provider>
    </StoreContext.Provider>,
  )
  return { store, undo }
}

/**
 * jsdom has no PointerEvent, so fireEvent silently drops pointerType — and the
 * production guard (correctly) rejects anything that is not a touch. Build the
 * event by hand so the property actually arrives.
 */
function pointer(type: string, clientX: number, pointerType: string) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'clientX', { value: clientX })
  Object.defineProperty(e, 'pointerType', { value: pointerType })
  return e
}

/** A full swipe from the row, at a given displacement and pointer type. */
function swipe(row: Element, dx: number, pointerType = 'touch') {
  fireEvent(row, pointer('pointerdown', 0, pointerType))
  fireEvent(row, pointer('pointermove', dx, pointerType))
  fireEvent(row, pointer('pointerup', dx, pointerType))
}

const rowFor = async (title: string) =>
  (await screen.findByText(title)).closest('li') as HTMLElement

beforeEach(() => { cleanup(); window.location.hash = '' })

describe('Swipe', () => {
  it('leadingCompletes', async () => {
    const { store } = await mount()
    const t = store.addTask('buy milk', { kind: 'smart', view: 'today' })!
    store.setSelectedTask(null)
    swipe(await rowFor('buy milk'), SWIPE_COMMIT_PX)
    expect(store.task(t.id)!.isCompleted).toBe(true)
  })

  it('trailingTrashes', async () => {
    const { store } = await mount()
    const t = store.addTask('buy milk', { kind: 'smart', view: 'today' })!
    store.setSelectedTask(null)
    swipe(await rowFor('buy milk'), -SWIPE_COMMIT_PX)
    expect(store.task(t.id)!.isTrashed).toBe(true)
  })

  it('belowTheThresholdCommitsNothing', async () => {
    const { store } = await mount()
    const t = store.addTask('buy milk', { kind: 'smart', view: 'today' })!
    store.setSelectedTask(null)
    swipe(await rowFor('buy milk'), SWIPE_COMMIT_PX - 10)
    expect(store.task(t.id)!.isCompleted).toBe(false)
    expect(store.task(t.id)!.isTrashed).toBe(false)
  })

  it('ignoresAMouseDrag', async () => {
    // A mouse drag is a drag; overloading it would make reordering ambiguous.
    const { store } = await mount()
    const t = store.addTask('buy milk', { kind: 'smart', view: 'today' })!
    store.setSelectedTask(null)
    swipe(await rowFor('buy milk'), SWIPE_COMMIT_PX, 'mouse')
    expect(store.task(t.id)!.isCompleted).toBe(false)
  })

  it('everySwipeIsUndoable', async () => {
    const { store, undo } = await mount()
    const t = store.addTask('buy milk', { kind: 'smart', view: 'today' })!
    store.setSelectedTask(null)
    swipe(await rowFor('buy milk'), -SWIPE_COMMIT_PX)
    expect(undo.pending).not.toBeNull()
    undo.undo(store)
    expect(store.task(t.id)!.isTrashed).toBe(false)
  })

  it('noSwipeCommitsInTrash', async () => {
    const { store } = await mount()
    const t = store.addTask('doomed', { kind: 'smart', view: 'today' })!
    store.trashTask(t.id)
    store.setSelection({ kind: 'smart', view: 'trash' })

    swipe(await rowFor('doomed'), -SWIPE_COMMIT_PX)
    // Still there: permanent deletion must never be a reflex.
    expect(store.task(t.id)).not.toBeNull()
  })

  it('noSwipeCommitsInCompleted', async () => {
    const { store } = await mount()
    const t = store.addTask('done thing', { kind: 'smart', view: 'today' })!
    store.toggleCompleted(t.id)
    store.setSelection({ kind: 'smart', view: 'completed' })

    swipe(await rowFor('done thing'), SWIPE_COMMIT_PX)
    expect(store.task(t.id)!.isCompleted).toBe(true) // un-complete is already one tap
  })
})
