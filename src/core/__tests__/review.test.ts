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
    for (const c of ['goToNextActions', 'goToDefer', 'goToDoIt', 'goToDelegate'] as ReviewChoice[]) {
      expect(isTerminal(c), c).toBe(false)
      expect(stepTarget(c), c).not.toBeNull()
    }
    expect(isTerminal('back')).toBe(false)
  })

  it('everythingThatRemovesTheCardIsTerminal', () => {
    for (const c of ['file', 'makeProject', 'skip', 'someday', 'notes', 'delete', 'commitDeadline'] as ReviewChoice[]) {
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

describe('Rails', () => {
  it('everyStepHasExactlyOneProminentChoice', () => {
    for (const step of STEPS) {
      const prominent = railFor(step).filter((r) => r.prominent)
      expect(prominent.length, step).toBe(1)
      // Always first: the highest-frequency choice leads.
      expect(railFor(step)[0]!.prominent, step).toBe(true)
    }
  })

  it('deleteIsTheOnlyDestructiveChoice', () => {
    const destructive = STEPS.flatMap((s) => railFor(s)).filter((r) => r.destructive)
    expect(destructive.map((r) => r.choice)).toEqual(['delete'])
  })

  it('deleteAndTheTwoPickersHaveNoAccelerator', () => {
    // A reflex must not reach an unconfirmed delete, and the pickers need a
    // decision no accelerator can express.
    const barred = STEPS.flatMap((s) => railFor(s)).filter((r) => !r.acceleratable)
    expect(barred.map((r) => r.choice).sort()).toEqual(['delete', 'file', 'makeProject'])
  })

  it('everyOtherChoiceIsAcceleratable', () => {
    const ok = STEPS.flatMap((s) => railFor(s)).filter((r) => r.acceleratable)
    expect(ok.length).toBeGreaterThan(0)
    for (const r of ok) expect(['delete', 'file', 'makeProject']).not.toContain(r.choice)
  })

  it('theTwoDeadlineStepsNameTheirDestination', () => {
    // "Set deadline & move" is ambiguous when the two steps look identical.
    expect(railFor('doIt')[0]!.title).toContain('Next actions')
    expect(railFor('delegate')[0]!.title).toContain('Waiting for')
  })
})

describe('The frozen queue', () => {
  it('startsAtTheFrontWithNothingProcessed', () => {
    const q = new ReviewQueue(['a', 'b', 'c'])
    expect(q.current).toBe('a')
    expect(q.processed).toBe(0)
    expect(q.total).toBe(3)
    expect(q.isFinished).toBe(false)
  })

  it('consumeAdvancesTheCounter', () => {
    const q = new ReviewQueue(['a', 'b']).consume()
    expect(q.current).toBe('b')
    expect(q.processed).toBe(1)
    expect(q.total).toBe(2)
  })

  it('skipRotatesWithoutAdvancingTheCounter', () => {
    // An index-based counter would lie the moment anything is skipped.
    const q = new ReviewQueue(['a', 'b', 'c']).rotate()
    expect(q.current).toBe('b')
    expect(q.pending).toEqual(['b', 'c', 'a'])
    expect(q.processed).toBe(0)
    expect(q.total).toBe(3)
  })

  it('theCounterSurvivesAnySequenceOfSkips', () => {
    let q = new ReviewQueue(['a', 'b', 'c'])
    q = q.rotate().rotate().rotate().rotate()
    expect(q.total).toBe(3)
    expect(q.processed).toBe(0)
    q = q.consume()
    expect(q.processed).toBe(1)
    expect(q.total).toBe(3)
  })

  it('rotatingASingleCardIsANoOp', () => {
    // Otherwise Skip on the last task would spin forever looking like progress.
    const q = new ReviewQueue(['a'])
    expect(q.rotate().pending).toEqual(['a'])
  })

  it('finishesOnlyWhenNothingPends', () => {
    const q = new ReviewQueue(['a']).consume()
    expect(q.isFinished).toBe(true)
    expect(q.current).toBeNull()
    expect(q.processed).toBe(1)
    expect(q.total).toBe(1)
  })

  it('consumingAnEmptyQueueIsSafe', () => {
    const q = new ReviewQueue([]).consume()
    expect(q.isFinished).toBe(true)
    expect(q.processed).toBe(0)
  })

  it('dropsATaskThatVanishedMidReview', () => {
    // Deleted in another tab, or removed by an undo.
    const q = new ReviewQueue(['a', 'b', 'c']).drop('b')
    expect(q.pending).toEqual(['a', 'c'])
    expect(q.total).toBe(2)
  })

  it('droppingIsCaseInsensitiveAndSafeForUnknownIDs', () => {
    const q = new ReviewQueue(['AAAA-1', 'b'])
    expect(q.drop('aaaa-1').pending).toEqual(['b'])
    expect(q.drop('nope').pending).toEqual(['AAAA-1', 'b'])
  })

  it('isImmutableSoAStaleReferenceCannotCorruptThePosition', () => {
    const first = new ReviewQueue(['a', 'b'])
    first.consume()
    expect(first.current).toBe('a') // untouched
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
