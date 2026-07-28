/**
 * Inbox Review. Port of Sources/GTDo/Views/InboxReviewView.swift.
 *
 * The macOS flow, not the iPhone one. The iPhone rail adds File…, Make it a
 * project… and Skip because a thumb needs more escape hatches than a keyboard
 * does; the Mac sheet is three buttons and a number key, and that is the shape
 * this ports.
 *
 * Pure: no React, no store.
 */

export type ReviewStep = 'root' | 'defer' | 'nextActions' | 'doIt' | 'delegate'

export type ReviewChoice =
  // root
  | 'goToDefer' | 'goToNextActions' | 'projects'
  // defer
  | 'delete' | 'someday' | 'notes'
  // next actions
  | 'goToDoIt' | 'goToDelegate'
  // do it / delegate
  | 'commitDeadline'
  | 'back'

/**
 * Back lands one step closer to the root, and the two deadline steps return to
 * nextActions rather than all the way out. At the root there is no Back button
 * at all — Esc dismisses instead.
 */
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
 * the Inbox.
 *
 * A step advance is not terminal — same task, new question. Both cannot be
 * true of one choice, and keeping this pure is what stops the two drifting.
 */
export function isTerminal(choice: ReviewChoice): boolean {
  switch (choice) {
    case 'goToDefer':
    case 'goToNextActions':
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
    case 'goToDefer': return 'defer'
    case 'goToNextActions': return 'nextActions'
    case 'goToDoIt': return 'doIt'
    case 'goToDelegate': return 'delegate'
    default: return null
  }
}

export type ReviewRailItem = {
  choice: ReviewChoice
  title: string
  /** Matches the SF Symbol the Mac uses, so the two read as the same control. */
  icon: string
  destructive: boolean
}

const item = (
  choice: ReviewChoice, title: string, icon: string, destructive = false,
): ReviewRailItem => ({ choice, title, icon, destructive })

/**
 * Keys are positional: 1, 2, 3 in button order, so the same key backs a
 * different action on each step — exactly the macOS defaults.
 *
 * Delete carries a key here, unlike the iPhone, and that is correct: it moves
 * the task to Trash rather than destroying it, and a Mac user pressing 1 on a
 * labelled button is not making the reflex the iPhone rule guards against.
 */
export function railFor(step: ReviewStep): ReviewRailItem[] {
  switch (step) {
    case 'root':
      return [
        item('goToDefer', 'Defer', 'tray'),
        item('goToNextActions', 'Next Actions', 'bolt'),
        item('projects', 'Projects', 'folder'),
      ]
    case 'defer':
      return [
        item('delete', 'Delete', 'trash', true),
        item('someday', 'Someday', 'archive'),
        item('notes', 'Notes', 'note'),
      ]
    case 'nextActions':
      return [
        item('goToDoIt', 'Do It', 'check'),
        item('goToDelegate', 'Delegate It', 'person'),
      ]
    case 'doIt':
      return [item('commitDeadline', 'Set deadline & move to Next Actions', 'calendar')]
    case 'delegate':
      return [item('commitDeadline', 'Set deadline & move to Waiting For', 'calendar')]
  }
}

/**
 * The queue, frozen at open.
 *
 * Seeded once and never recomputed. The Swift comment is worth keeping: the
 * sheet re-evaluates on every store mutation and would otherwise re-pass a
 * freshly recomputed, now-smaller queue, so the position would walk an
 * unstable list and skip tasks.
 */
export class ReviewQueue {
  private readonly ids: string[]
  private readonly index: number

  constructor(ids: string[], index = 0) {
    this.ids = [...ids]
    this.index = Math.max(0, index)
  }

  get current(): string | null {
    return this.ids[this.index] ?? null
  }

  /** 1-based, for the "N of M" readout. */
  get position(): number {
    return Math.min(this.index + 1, this.ids.length)
  }

  get total(): number {
    return this.ids.length
  }

  get isFinished(): boolean {
    return this.index >= this.ids.length
  }

  /** A terminal action: the task left the Inbox, so the index steps on. */
  advance(): ReviewQueue {
    return new ReviewQueue(this.ids, this.index + 1)
  }
}
