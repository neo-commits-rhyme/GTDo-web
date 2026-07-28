/**
 * The debounced "the row does not move while you are still tapping" window.
 * Port of Sources/GTDo/Store/CompletionHold.swift.
 *
 * Pure: no timers, no clock, no React. AppStore owns one and drives it; the
 * scheduling that closes the window is injected, so every rule here is testable
 * synchronously.
 *
 * Two things are held:
 * - **pins** — a task whose completion was toggled inside the window keeps
 *   rendering in the section it was in when the window opened, along with the
 *   completion date it had, so the Completed section does not resort either.
 * - **suppressions** — a task *created* inside the window (a recurrence spawn)
 *   does not appear until the window closes, so the list never grows under a
 *   finger any more than it shrinks.
 */

/** The pre-toggle appearance a pinned row keeps for the life of the window. */
export type Pin = {
  rendersCompleted: boolean
  completedAt: Date | null
}

export class CompletionHold {
  private pins = new Map<string, Pin>()
  private suppressed = new Set<string>()

  /**
   * Bumped by every pin. A scheduled release only fires when its generation is
   * still current — that is the entire debounce, and it means no timer ever has
   * to be cancelled.
   */
  private gen = 0

  get generation(): number {
    return this.gen
  }

  get isEmpty(): boolean {
    return this.pins.size === 0 && this.suppressed.size === 0
  }

  /** The pinned ids, for AppStore.recentlyCompleted. Suppressions are NOT here. */
  get pinnedIDs(): Set<string> {
    return new Set(this.pins.keys())
  }

  pinFor(id: string): Pin | null {
    return this.pins.get(id) ?? null
  }

  isSuppressed(id: string): boolean {
    return this.suppressed.has(id)
  }

  /**
   * Pin `id` to the appearance it had *before* the toggle, and restart the
   * window.
   *
   * Toggling a task that is already pinned **unpins** it instead of stacking a
   * second pin: the row is back in the section it started in, so there is
   * nothing left to hold and the re-tap costs no reflow at all.
   *
   * @returns the generation the caller must schedule its release against
   */
  pin(id: string, wasCompleted: boolean, completedAt: Date | null): number {
    if (this.pins.has(id)) {
      this.pins.delete(id)
    } else {
      this.pins.set(id, { rendersCompleted: wasCompleted, completedAt })
    }
    this.gen += 1
    return this.gen
  }

  /** Hide tasks that appeared inside the window (recurrence spawns). */
  suppress(ids: Iterable<string>): void {
    for (const id of ids) this.suppressed.add(id)
  }

  /**
   * Close the window, but only if `candidate` is still the current generation.
   * @returns true when it actually released, so the caller knows to announce
   *   the layout change to assistive technology
   */
  release(candidate: number): boolean {
    if (candidate !== this.gen || this.isEmpty) return false
    this.pins.clear()
    this.suppressed.clear()
    return true
  }

  /**
   * Release with no generation check and invalidate any scheduled release — the
   * screen went away, the list was deleted, the app backgrounded.
   */
  releaseNow(): boolean {
    const released = !this.isEmpty
    this.pins.clear()
    this.suppressed.clear()
    this.gen += 1
    return released
  }
}
