/**
 * Inbox Review. Port of Sources/GTDo/Views/InboxReviewView.swift's step machine
 * and ios/GTDoiOS/Support/ReviewFlow.swift.
 *
 * Pure: no React, no store. The two rules most easily broken here — the queue
 * is frozen at open, and Skip rotates rather than consumes — are both invisible
 * from the UI and obvious in a unit test, which is why they live down here.
 */

export type ReviewStep = 'root' | 'defer' | 'nextActions' | 'doIt' | 'delegate'

export type ReviewChoice =
  // root
  | 'goToNextActions' | 'goToDefer' | 'file' | 'makeProject' | 'skip'
  // defer
  | 'someday' | 'notes' | 'delete'
  // next actions
  | 'goToDoIt' | 'goToDelegate'
  // do it / delegate
  | 'commitDeadline'
  | 'back'

/** Back lands one step closer to the root. At the root there is no back button
 *  at all, rather than a dead one. */
export function parentStep(step: ReviewStep): ReviewStep | null {
  switch (step) {
    case 'root': return null
    case 'defer':
    case 'nextActions': return 'root'
    case 'doIt':
    case 'delegate': return 'nextActions'
  }
}

/**
 * True when the card LEAVES the queue, which is exactly when the task leaves
 * the position it is in.
 *
 * A step advance is not terminal — same task, new question. Both cannot be
 * true of one choice, and keeping this a pure function is what stops the two
 * drifting apart.
 */
export function isTerminal(choice: ReviewChoice): boolean {
  switch (choice) {
    case 'goToNextActions':
    case 'goToDefer':
    case 'goToDoIt':
    case 'goToDelegate':
    case 'back':
      return false
    default:
      return true
  }
}

/** Non-nil for exactly the four step advances. */
export function stepTarget(choice: ReviewChoice): ReviewStep | null {
  switch (choice) {
    case 'goToNextActions': return 'nextActions'
    case 'goToDefer': return 'defer'
    case 'goToDoIt': return 'doIt'
    case 'goToDelegate': return 'delegate'
    default: return null
  }
}

export type ReviewRailItem = {
  choice: ReviewChoice
  title: string
  /**
   * Exactly one per step, always the highest-frequency choice — the macOS
   * 1/2/3 ordering surviving as visual weight instead of keycaps.
   */
  prominent: boolean
  destructive: boolean
  /**
   * False for Delete, File… and Make it a project…: a reflex must not reach an
   * unconfirmed delete, and the two pickers need a decision no accelerator can
   * express. They stay reachable by an explicit click or their own key.
   */
  acceleratable: boolean
}

const item = (
  choice: ReviewChoice,
  title: string,
  opts: { prominent?: boolean; destructive?: boolean; acceleratable?: boolean } = {},
): ReviewRailItem => ({
  choice,
  title,
  prominent: opts.prominent ?? false,
  destructive: opts.destructive ?? false,
  acceleratable: opts.acceleratable ?? true,
})

export function railFor(step: ReviewStep): ReviewRailItem[] {
  switch (step) {
    case 'root':
      return [
        item('goToNextActions', 'Next actions', { prominent: true }),
        item('goToDefer', 'Defer'),
        item('file', 'File…', { acceleratable: false }),
        item('makeProject', 'Make it a project…', { acceleratable: false }),
        item('skip', 'Skip'),
      ]
    case 'defer':
      return [
        item('someday', 'Someday', { prominent: true }),
        item('notes', 'Notes'),
        item('delete', 'Delete', { destructive: true, acceleratable: false }),
      ]
    case 'nextActions':
      return [
        item('goToDoIt', 'Do It', { prominent: true }),
        item('goToDelegate', 'Delegate It'),
      ]
    case 'doIt':
      return [item('commitDeadline', 'Set deadline & move to Next actions', { prominent: true })]
    case 'delegate':
      return [item('commitDeadline', 'Set deadline & move to Waiting for', { prominent: true })]
  }
}

/**
 * The queue, frozen at open.
 *
 * Seeded once and never recomputed: the sheet re-renders on every store
 * mutation, and re-deriving a now-smaller queue from the store would corrupt
 * the position.
 *
 * `processed` is a count of terminal actions, NOT an index — Skip rotates
 * rather than consumes, and an index would make the progress readout lie the
 * moment anything is skipped.
 */
export class ReviewQueue {
  private ids: string[]
  private done: number

  constructor(ids: string[], processed = 0) {
    this.ids = [...ids]
    this.done = Math.max(0, processed)
  }

  get current(): string | null {
    return this.ids[0] ?? null
  }

  get pending(): readonly string[] {
    return this.ids
  }

  get processed(): number {
    return this.done
  }

  get total(): number {
    return this.done + this.ids.length
  }

  get isFinished(): boolean {
    return this.ids.length === 0
  }

  /** A terminal action: the card leaves and the counter advances. */
  consume(): ReviewQueue {
    if (this.ids.length === 0) return this
    return new ReviewQueue(this.ids.slice(1), this.done + 1)
  }

  /** Skip: the card goes to the back, and the counter does NOT advance. */
  rotate(): ReviewQueue {
    if (this.ids.length <= 1) return this
    return new ReviewQueue([...this.ids.slice(1), this.ids[0]!], this.done)
  }

  /** A task that vanished — deleted in another tab, or by an undo. Dropped
   *  rather than left to render as a blank card. */
  drop(id: string): ReviewQueue {
    const kept = this.ids.filter((x) => x.toUpperCase() !== id.toUpperCase())
    return kept.length === this.ids.length ? this : new ReviewQueue(kept, this.done)
  }
}
