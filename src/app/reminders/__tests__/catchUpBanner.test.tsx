import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppStore } from '../../../core/store'
import { MemoryAdapter } from '../../../storage/memoryAdapter'
import { BuiltIn } from '../../../core/models'
import { StoreContext } from '../../useStore'
import { CatchUpBanner } from '../CatchUpBanner'
import {
  LAST_SEEN_KEY, markReported, readLastSeen, resetLastSeenSession,
} from '../lastSeen'

const NOW = new Date(2026, 6, 28, 12, 0, 0)
const at = (h: number) => new Date(2026, 6, 28, h, 0, 0)

async function mount(setup: (s: AppStore) => void) {
  const store = await AppStore.create({
    adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f(),
  })
  setup(store)
  render(
    <StoreContext.Provider value={store}>
      <CatchUpBanner />
    </StoreContext.Provider>,
  )
  return store
}

beforeEach(() => { cleanup(); localStorage.clear(); resetLastSeenSession() })

describe('Catch-up banner', () => {
  it('namesWhatCameDueWhileClosed', async () => {
    localStorage.setItem(LAST_SEEN_KEY, at(9).toISOString())
    await mount((s) => {
      const t = s.addTask('call the bank', { kind: 'list', id: BuiltIn.inbox })!
      s.setReminder(t.id, at(10))
    })
    const banner = screen.getByRole('status', { name: 'Missed reminders' })
    expect(banner.textContent).toContain('1 reminder came due while GTDo was closed')
    expect(within(banner).getByText('call the bank')).toBeTruthy()
  })

  it('isPoliteNotAnAlert', () => {
    // These already happened; interrupting for them would be worse than the
    // notification that never fired.
    localStorage.setItem(LAST_SEEN_KEY, at(9).toISOString())
    return mount((s) => {
      const t = s.addTask('x', { kind: 'list', id: BuiltIn.inbox })!
      s.setReminder(t.id, at(10))
    }).then(() => {
      expect(screen.getByRole('status', { name: 'Missed reminders' }).getAttribute('aria-live'))
        .toBe('polite')
    })
  })

  it('doesNotRenderWhenNothingWasMissed', async () => {
    localStorage.setItem(LAST_SEEN_KEY, at(9).toISOString())
    await mount((s) => { s.addTask('no reminder', { kind: 'list', id: BuiltIn.inbox }) })
    expect(screen.queryByRole('status', { name: 'Missed reminders' })).toBeNull()
  })

  it('dismissingAdvancesTheStampSoItDoesNotReappear', async () => {
    localStorage.setItem(LAST_SEEN_KEY, at(9).toISOString())
    const user = userEvent.setup()
    await mount((s) => {
      const t = s.addTask('x', { kind: 'list', id: BuiltIn.inbox })!
      s.setReminder(t.id, at(10))
    })
    await user.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('status', { name: 'Missed reminders' })).toBeNull()
    expect(readLastSeen()!.getTime()).toBe(NOW.getTime())
  })

  it('summarisesWhenThereAreManyRatherThanListingThemAll', async () => {
    localStorage.setItem(LAST_SEEN_KEY, at(9).toISOString())
    await mount((s) => {
      for (let i = 0; i < 8; i += 1) {
        const t = s.addTask(`task ${i}`, { kind: 'list', id: BuiltIn.inbox })!
        s.setReminder(t.id, at(10))
      }
    })
    const banner = screen.getByRole('status', { name: 'Missed reminders' })
    expect(banner.textContent).toContain('8 reminders came due')
    expect(within(banner).getByText('and 3 more')).toBeTruthy()
  })

  it('staysQuietAboutAReminderThatFiredLiveDuringTheLastSession', async () => {
    // The one that bit us: the stamp only ever moved on dismissal, so a
    // reminder that fired as a live notification with the app open in front of
    // the user was re-announced next launch as "missed while GTDo was closed"
    // — and for anyone who had never dismissed a banner, on every launch after
    // that too. Delivery is what settles it now, so the previous session is
    // represented by the notification it actually showed.
    markReported(at(10))
    resetLastSeenSession()
    await mount((s) => {
      const t = s.addTask('the one that already rang', { kind: 'list', id: BuiltIn.inbox })!
      s.setReminder(t.id, at(10))
    })
    expect(screen.queryByRole('status', { name: 'Missed reminders' })).toBeNull()
  })

  it('stillReportsAReminderThatFiredButWasNeverShown', async () => {
    // A reminder whose timer ran while notifications were blocked was never
    // shown, so nothing advanced the stamp past it and the banner is the only
    // way the user hears about it at all.
    localStorage.setItem(LAST_SEEN_KEY, at(9).toISOString())
    await mount((s) => {
      const t = s.addTask('call the bank', { kind: 'list', id: BuiltIn.inbox })!
      s.setReminder(t.id, at(10))
    })
    const banner = screen.getByRole('status', { name: 'Missed reminders' })
    expect(banner.textContent).toContain('1 reminder came due while GTDo was closed')
  })

  it('needsNoNotificationPermission', async () => {
    // The whole point: this still works for anyone who denied notifications.
    localStorage.setItem(LAST_SEEN_KEY, at(9).toISOString())
    await mount((s) => {
      const t = s.addTask('x', { kind: 'list', id: BuiltIn.inbox })!
      s.setReminder(t.id, at(10))
    })
    expect(typeof Notification).toBe('undefined')
    expect(screen.getByRole('status', { name: 'Missed reminders' })).toBeTruthy()
  })
})
