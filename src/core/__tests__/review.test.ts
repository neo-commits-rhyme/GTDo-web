import { describe, it, expect } from 'vitest'
import {
  ReviewQueue, isTerminal, parentStep, railFor, stepTarget,
  type ReviewChoice, type ReviewStep,
} from '../review'

const STEPS: ReviewStep[] = ['root', 'defer', 'nextActions', 'doIt', 'delegate']

describe('Review steps', () => {
  it('backLandsOneStepCloserToTheRoot', () => {
    expect(parentStep('root')).toBeNull() // no dead button at the root
    expect(parentStep('defer')).toBe('root')
    expect(parentStep('nextActions')).toBe('root')
    expect(parentStep('doIt')).toBe('nextActions')
    expect(parentStep('delegate')).toBe('nextActions')
  })

  it('everyStepIsReachableFromTheRoot', () => {
    const reachable = new Set<ReviewStep>(['root'])
    let added = true
    while (added) {
      added = false
      for (const step of [...reachable]) {
        for (const rail of railFor(step)) {
          const target = stepTarget(rail.choice)
          if (target !== null && !reachable.has(target)) {
            reachable.add(target)
            added = true
          }
        }
      }
    }
    expect([...reachable].sort()).toEqual([...STEPS].sort())
  })
})

describe('Terminal classification', () => {
  it('aStepAdvanceIsNotTerminal', () => {
    // Same task, new question — the card stays put.
    for (const c of ['goToDefer', 'goToNextActions', 'goToDoIt', 'goToDelegate'] as ReviewChoice[]) {
      expect(isTerminal(c), c).toBe(false)
      expect(stepTarget(c), c).not.toBeNull()
    }
    expect(isTerminal('back')).toBe(false)
  })

  it('everythingThatRemovesTheCardIsTerminal', () => {
    for (const c of ['projects', 'delete', 'someday', 'notes', 'commitDeadline'] as ReviewChoice[]) {
      expect(isTerminal(c), c).toBe(true)
    }
  })

  it('noChoiceIsBothTerminalAndAStepAdvance', () => {
    const all = STEPS.flatMap((s) => railFor(s).map((r) => r.choice)).concat('back')
    for (const c of all) {
      expect(isTerminal(c) && stepTarget(c) !== null, c).toBe(false)
    }
  })
})

describe('Rails match the macOS sheet', () => {
  it('theRootOffersDeferNextActionsAndProjects', () => {
    // Not the iPhone rail — no File…, no Make it a project…, no Skip.
    expect(railFor('root').map((r) => r.title)).toEqual(['Defer', 'Next Actions', 'Projects'])
  })

  it('deferOffersDeleteSomedayAndNotesInThatOrder', () => {
    // Delete is FIRST on the Mac and carries key 1. That is safe here in a way
    // a swipe would not be: it moves the task to Trash, not out of existence.
    expect(railFor('defer').map((r) => r.title)).toEqual(['Delete', 'Someday', 'Notes'])
    expect(railFor('defer')[0]!.destructive).toBe(true)
  })

  it('nextActionsOffersDoItAndDelegateIt', () => {
    expect(railFor('nextActions').map((r) => r.title)).toEqual(['Do It', 'Delegate It'])
  })

  it('theTwoDeadlineStepsNameTheirDestination', () => {
    expect(railFor('doIt')[0]!.title).toBe('Set deadline & move to Next Actions')
    expect(railFor('delegate')[0]!.title).toBe('Set deadline & move to Waiting For')
  })

  it('deleteIsTheOnlyDestructiveChoice', () => {
    const destructive = STEPS.flatMap((s) => railFor(s)).filter((r) => r.destructive)
    expect(destructive.map((r) => r.choice)).toEqual(['delete'])
  })

  it('everyChoiceCarriesAnIcon', () => {
    for (const step of STEPS) {
      for (const r of railFor(step)) expect(r.icon, r.title).not.toBe('')
    }
  })

  it('noStepOffersMoreThanThreeChoicesSoTheKeysStayOneDigit', () => {
    for (const step of STEPS) expect(railFor(step).length, step).toBeLessThanOrEqual(3)
  })
})

describe('The frozen queue', () => {
  it('walksTheListAndReportsAOneBasedPosition', () => {
    let q = new ReviewQueue(['a', 'b', 'c'])
    expect(q.current).toBe('a')
    expect(q.position).toBe(1)
    expect(q.total).toBe(3)
    expect(q.isFinished).toBe(false)

    q = q.advance()
    expect(q.current).toBe('b')
    expect(q.position).toBe(2)
    expect(q.total).toBe(3)
  })

  it('finishesAfterTheLastTask', () => {
    const q = new ReviewQueue(['a']).advance()
    expect(q.isFinished).toBe(true)
    expect(q.current).toBeNull()
  })

  it('advancingPastTheEndIsSafe', () => {
    const q = new ReviewQueue(['a']).advance().advance()
    expect(q.isFinished).toBe(true)
    expect(q.current).toBeNull()
    expect(q.position).toBe(1) // clamped, never past the total
  })

  it('anEmptyQueueIsFinishedImmediately', () => {
    const q = new ReviewQueue([])
    expect(q.isFinished).toBe(true)
    expect(q.total).toBe(0)
  })

  it('isImmutableSoAStaleReferenceCannotCorruptThePosition', () => {
    const first = new ReviewQueue(['a', 'b'])
    first.advance()
    expect(first.current).toBe('a')
  })

  it('theTotalNeverChangesAsYouWalk', () => {
    // The count is the queue captured at open, not what is left in the Inbox.
    let q = new ReviewQueue(['a', 'b', 'c'])
    for (let i = 0; i < 3; i += 1) {
      expect(q.total).toBe(3)
      q = q.advance()
    }
    expect(q.total).toBe(3)
  })
})

describe('The store half', () => {
  it('reviewDoItDatesThenMovesToNextActions', async () => {
    const { AppStore } = await import('../store')
    const { MemoryAdapter } = await import('../../storage/memoryAdapter')
    const { BuiltIn } = await import('../models')
    const now = new Date(2026, 6, 28, 9, 0, 0)
    const s = await AppStore.create({
      adapter: new MemoryAdapter(), now: () => now, scheduler: (_m, f) => f(),
    })
    const t = s.addTask('thing', { kind: 'list', id: BuiltIn.inbox })!
    s.reviewDoIt(t.id, new Date(2026, 7, 5))
    expect(s.task(t.id)!.listID).toBe(BuiltIn.nextActions)
    // Next actions preserves the deadline — only Someday strips it.
    expect(s.task(t.id)!.dueDate!.getDate()).toBe(5)
  })

  it('reviewDelegateDatesThenMovesToWaitingFor', async () => {
    const { AppStore } = await import('../store')
    const { MemoryAdapter } = await import('../../storage/memoryAdapter')
    const { BuiltIn } = await import('../models')
    const now = new Date(2026, 6, 28, 9, 0, 0)
    const s = await AppStore.create({
      adapter: new MemoryAdapter(), now: () => now, scheduler: (_m, f) => f(),
    })
    const t = s.addTask('thing', { kind: 'list', id: BuiltIn.inbox })!
    s.reviewDelegate(t.id, new Date(2026, 7, 9))
    expect(s.task(t.id)!.listID).toBe(BuiltIn.waitingFor)
    expect(s.task(t.id)!.dueDate!.getDate()).toBe(9)
  })

  it('theQueueIsInboxOnlyAndExcludesCompletedAndTrashed', async () => {
    const { AppStore } = await import('../store')
    const { MemoryAdapter } = await import('../../storage/memoryAdapter')
    const { BuiltIn } = await import('../models')
    const now = new Date(2026, 6, 28, 9, 0, 0)
    const s = await AppStore.create({
      adapter: new MemoryAdapter(), now: () => now, scheduler: (_m, f) => f(),
    })
    const open = s.addTask('open', { kind: 'list', id: BuiltIn.inbox })!
    const done = s.addTask('done', { kind: 'list', id: BuiltIn.inbox })!
    const gone = s.addTask('gone', { kind: 'list', id: BuiltIn.inbox })!
    s.addTask('elsewhere', { kind: 'list', id: BuiltIn.notes })
    s.toggleCompleted(done.id)
    s.trashTask(gone.id)
    expect(s.inboxReviewQueue().map((t) => t.id)).toEqual([open.id])
  })
})
