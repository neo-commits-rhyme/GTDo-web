import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { AppStore } from '../../core/store'
import { StaleWriteError } from '../../core/ports'
import { MemoryAdapter, MemoryBacking } from '../../storage/memoryAdapter'
import { UndoCenter } from '../../core/undo'
import { BuiltIn } from '../../core/models'
import { StoreContext } from '../useStore'
import { UndoContext } from '../undo/useUndo'
import { RootShell } from '../RootShell'

const NOW = new Date(2026, 6, 28, 9, 0, 0)
const NOTES = { kind: 'list', id: BuiltIn.notes } as const
const immediate = (_ms: number, fn: () => void) => fn()

/**
 * The race with no fault injection anywhere: two tabs holding the same
 * revision, both typing before either broadcast lands. The second save reads a
 * revision it never saw and is refused — and adoptExternalWrite then declines
 * every later broadcast because saveError is set, so this tab never saves again.
 */
async function tabStuckOnAStaleWrite(): Promise<AppStore> {
  const backing = new MemoryBacking()
  const first = new MemoryAdapter(backing)
  const second = new MemoryAdapter(backing)
  const tab1 = await AppStore.create({ adapter: first, now: () => NOW, scheduler: immediate })
  const tab2 = await AppStore.create({ adapter: second, now: () => NOW, scheduler: immediate })
  // Nothing has been announced to tab 2 yet — the window the race lives in, and
  // the permanent condition of any browser without a BroadcastChannel.
  second.onExternalWrite = null

  tab1.addTask('written by tab one', NOTES)
  await tab1.flushWrites()
  tab2.addTask('written by tab two', NOTES)
  await tab2.flushWrites()
  return tab2
}

async function tabOutOfStorage(): Promise<AppStore> {
  const adapter = new MemoryAdapter()
  vi.spyOn(adapter, 'persist').mockRejectedValue(new Error('QuotaExceededError'))
  const store = await AppStore.create({ adapter, now: () => NOW, scheduler: immediate })
  store.addTask('anything', NOTES)
  await store.flushWrites()
  return store
}

function mount(store: AppStore) {
  window.innerWidth = 1280
  window.location.hash = ''
  render(
    <StoreContext.Provider value={store}>
      <UndoContext.Provider value={new UndoCenter(() => {})}>
        <RootShell />
      </UndoContext.Provider>
    </StoreContext.Provider>,
  )
}

beforeEach(() => { cleanup(); window.location.hash = '' })
afterEach(() => { vi.restoreAllMocks() })

describe('Save failure banner', () => {
  it('twoTabsTypingAtOnceProduceAStaleWrite', async () => {
    // The premise, so a change that stops this reaching the banner is visible
    // here rather than as four confusing failures below.
    expect((await tabStuckOnAStaleWrite()).saveError).toBeInstanceOf(StaleWriteError)
  })

  it('offersTheReloadItsOwnMessageTellsTheUserToPerform', async () => {
    mount(await tabStuckOnAStaleWrite())
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('putsExportAheadOfReload', async () => {
    // Reloading discards the change this tab is still holding, so the way to
    // get it out has to be the first thing under the message.
    mount(await tabStuckOnAStaleWrite())
    const alert = await screen.findByRole('alert')
    const actions = within(alert).getAllByRole('button').map((b) => b.textContent)
    expect(actions).toEqual(['Export now', 'Reload'])
  })

  it('reloadingActuallyReloads', async () => {
    // location.reload is non-writable in jsdom, so the whole accessor is
    // stubbed. A plain object, not a wrapper round the real Location: every
    // other route brand-checks `this` and throws.
    const reload = vi.fn()
    const stub = { hash: window.location.hash, reload } as unknown as Location
    vi.spyOn(window, 'location', 'get').mockReturnValue(stub)
    const user = userEvent.setup()
    mount(await tabStuckOnAStaleWrite())

    await user.click(await screen.findByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalled()
  })

  it('doesNotBlameStorageWhenAnotherTabIsTheProblem', async () => {
    // The generic copy sends the user after quota and private mode, neither of
    // which is what happened.
    mount(await tabStuckOnAStaleWrite())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toContain('Changes are not being saved')
    expect(alert.textContent).toContain('Another tab')
  })

  it('offersNoReloadWhenStorageIsTheProblem', async () => {
    // Reloading a tab that cannot write loses the change and fixes nothing;
    // only a stale write is cured by re-reading the record.
    mount(await tabOutOfStorage())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Changes are not being saved')
    expect(within(alert).queryByRole('button', { name: 'Reload' })).toBeNull()
    expect(within(alert).getByRole('button', { name: 'Export now' })).toBeTruthy()
  })

  it('laysTheSecondActionBesideTheFirstInTheNoticeRow', async () => {
    // The banner once shared the header's grid cell and the bar swallowed its
    // button. jsdom computes no grid, so this checks what it can: the new
    // action is a sibling in the banner's own row, not nested somewhere the
    // bar can cover, and the row is the flex line that puts them side by side.
    mount(await tabStuckOnAStaleWrite())
    const alert = await screen.findByRole('alert')
    expect(alert.classList.contains('banner')).toBe(true)
    expect(alert.closest('.shell__bar')).toBeNull()
    for (const button of within(alert).getAllByRole('button')) {
      expect(button.parentElement).toBe(alert)
      expect(button.classList.contains('banner__action')).toBe(true)
    }
    expect(readFileSync('src/app/styles.css', 'utf8')).toMatch(/\.banner \{[^}]*display: flex/)
  })
})
