import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppStore } from '../../core/store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { UndoCenter } from '../../core/undo'
import { BuiltIn } from '../../core/models'
import { StoreContext } from '../useStore'
import { UndoContext } from '../undo/useUndo'
import { DetailPane } from '../DetailPane'

const NOW = new Date(2026, 6, 28, 9, 0, 0)

async function mount() {
  const store = await AppStore.create({
    adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f(),
  })
  const t = store.addTask('call the bank', { kind: 'list', id: BuiltIn.inbox })!
  render(
    <StoreContext.Provider value={store}>
      <UndoContext.Provider value={new UndoCenter(() => {})}>
        <DetailPane taskID={t.id} onClose={() => {}} />
      </UndoContext.Provider>
    </StoreContext.Provider>,
  )
  return { store, task: t }
}

beforeEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('The reminder limit is stated where it applies', () => {
  it('saysRemindersOnlyFireWhileOpen', async () => {
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: async () => 'granted' })
    await mount()
    expect(screen.getByText(/only while GTDo is open in a tab/)).toBeTruthy()
  })

  it('explainsPlainlyWhenPermissionIsDenied', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' })
    await mount()
    expect(screen.getByText(/blocked in your browser/)).toBeTruthy()
    // And says catch-up still works, so the feature degrades to something.
    expect(screen.getByText(/still listed next time you open GTDo/)).toBeTruthy()
  })

  it('explainsWhenTheBrowserHasNoNotificationsAtAll', async () => {
    vi.stubGlobal('Notification', undefined)
    await mount()
    expect(screen.getByText(/no notifications/)).toBeTruthy()
  })

  it('requestsPermissionOnTheFirstReminderNotOnLoad', async () => {
    const requestPermission = vi.fn(async () => 'granted')
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    const user = userEvent.setup()
    await mount()
    // Nothing on load.
    expect(requestPermission).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/^Reminder/), '2026-08-05T09:00')
    expect(requestPermission).toHaveBeenCalled()
  })

  it('doesNotAskAgainOnceAnswered', async () => {
    const requestPermission = vi.fn(async () => 'denied')
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission })
    const user = userEvent.setup()
    await mount()
    await user.type(screen.getByLabelText(/^Reminder/), '2026-08-05T09:00')
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('storesTheReminderEvenWhenPermissionIsDenied', async () => {
    // The value is data; the notification is a garnish over it.
    vi.stubGlobal('Notification', { permission: 'denied' })
    const user = userEvent.setup()
    const { store, task } = await mount()
    await user.type(screen.getByLabelText(/^Reminder/), '2026-08-05T09:00')
    expect(store.task(task.id)!.reminderDate).not.toBeNull()
  })
})
