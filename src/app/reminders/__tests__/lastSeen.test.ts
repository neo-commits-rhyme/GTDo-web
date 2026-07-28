import { describe, it, expect, beforeEach } from 'vitest'
import { LAST_SEEN_KEY, readLastSeen, writeLastSeen } from '../lastSeen'

const NOW = new Date(2026, 6, 28, 12, 0, 0)

beforeEach(() => localStorage.clear())

describe('The lastSeen stamp', () => {
  it('roundTripsThroughLocalStorage', () => {
    writeLastSeen(NOW)
    expect(readLastSeen()?.getTime()).toBe(NOW.getTime())
  })

  it('isNullWhenAbsent', () => {
    expect(readLastSeen()).toBeNull()
  })

  it('isNullWhenTheStoredValueIsJunk', () => {
    localStorage.setItem(LAST_SEEN_KEY, 'not a date')
    expect(readLastSeen()).toBeNull()
  })
})
