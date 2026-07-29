import { describe, it, expect } from 'vitest'
import { BuiltIn, seededAppData, repeatDisplayName, sidebarItemsEqual, sameID, SMART_VIEWS, CALENDAR_BUCKETS } from '../models'

describe('Models', () => {
  it('testSeededDataHasBuiltInLists', () => {
    const d = seededAppData()
    expect(d.tasks).toEqual([])
    expect(d.lists.map((l) => l.name)).toEqual([
      'Inbox', 'Next actions', 'Waiting for...', 'Someday', 'Notes',
    ])
    expect(d.lists.map((l) => l.order)).toEqual([0, 1, 2, 3, 4])
    expect(d.lists.every((l) => l.isBuiltIn)).toBe(true)
    expect(d.groups).toEqual([
      { id: BuiltIn.projectsGroup, name: 'Projects', isBuiltIn: true, order: 0 },
    ])
    expect(d.gtdOrder).toBeNull()
    expect(d.userOrder).toBeNull()
  })

  it('builtInIDsMatchSwift', () => {
    expect(BuiltIn.inbox).toBe('00000000-0000-0000-0000-000000000001')
    expect(BuiltIn.nextActions).toBe('00000000-0000-0000-0000-000000000002')
    expect(BuiltIn.waitingFor).toBe('00000000-0000-0000-0000-000000000003')
    expect(BuiltIn.someday).toBe('00000000-0000-0000-0000-000000000004')
    expect(BuiltIn.notes).toBe('00000000-0000-0000-0000-000000000005')
    expect(BuiltIn.projectsGroup).toBe('00000000-0000-0000-0000-0000000000AA')
  })

  it('sameIDIsCaseInsensitive', () => {
    // BuiltIn.projectsGroup carries uppercase AA — spec §5.7.
    expect(sameID('00000000-0000-0000-0000-0000000000aa', BuiltIn.projectsGroup)).toBe(true)
    expect(sameID(BuiltIn.inbox, BuiltIn.notes)).toBe(false)
  })

  it('smartViewOrderIsTheSidebarOrder', () => {
    // Completed projects sits beside Completed, as it does on macOS.
    expect(SMART_VIEWS).toEqual(['today', 'calendar', 'completed', 'completedProjects', 'trash'])
  })

  it('calendarBucketsAreCapitalisedLabels', () => {
    // Unlike SmartView's lowercase raw values.
    expect(CALENDAR_BUCKETS).toEqual(['Earlier', 'Today', 'Tomorrow', 'Later'])
  })

  it('repeatDisplayNameWeekdayIgnoresInterval', () => {
    expect(repeatDisplayName({ unit: 'weekday', interval: 3 })).toBe('Weekdays')
    expect(repeatDisplayName({ unit: 'day', interval: 1 })).toBe('Daily')
    expect(repeatDisplayName({ unit: 'week', interval: 1 })).toBe('Weekly')
    expect(repeatDisplayName({ unit: 'month', interval: 1 })).toBe('Monthly')
    expect(repeatDisplayName({ unit: 'year', interval: 1 })).toBe('Yearly')
    expect(repeatDisplayName({ unit: 'day', interval: 3 })).toBe('Every 3 days')
    expect(repeatDisplayName({ unit: 'week', interval: 2 })).toBe('Every 2 weeks')
    expect(repeatDisplayName({ unit: 'month', interval: 2 })).toBe('Every 2 months')
    expect(repeatDisplayName({ unit: 'year', interval: 5 })).toBe('Every 5 years')
  })

  it('sidebarItemsCompareByValue', () => {
    expect(sidebarItemsEqual({ kind: 'list', id: BuiltIn.inbox }, { kind: 'list', id: BuiltIn.inbox })).toBe(true)
    expect(sidebarItemsEqual({ kind: 'smart', view: 'today' }, { kind: 'smart', view: 'today' })).toBe(true)
    expect(sidebarItemsEqual({ kind: 'smart', view: 'today' }, { kind: 'smart', view: 'trash' })).toBe(false)
    expect(sidebarItemsEqual({ kind: 'smart', view: 'today' }, { kind: 'list', id: BuiltIn.inbox })).toBe(false)
    expect(sidebarItemsEqual(null, null)).toBe(true)
    expect(sidebarItemsEqual(null, { kind: 'smart', view: 'today' })).toBe(false)
  })

  it('seededDataIsAFreshCopyEveryCall', () => {
    const a = seededAppData()
    a.lists[0]!.name = 'mutated'
    expect(seededAppData().lists[0]!.name).toBe('Inbox')
  })
})
