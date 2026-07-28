import type { StoragePort } from './ports'

/**
 * Coalesces a burst of mutations into one write.
 *
 * The store mutates synchronously in memory and calls enqueue(); the UI is
 * already correct before anything touches disk. Only the newest pending value
 * is ever written — an intermediate state has no value once superseded.
 *
 * A rejection is reported and then forgotten: the queue never latches off, so a
 * transient quota error does not silently stop persisting for the rest of the
 * session.
 */
export class WriteQueue {
  private pending: string | null = null
  private inFlight: Promise<void> | null = null

  onError: (e: Error) => void = () => {}
  onSuccess: () => void = () => {}

  constructor(private readonly adapter: StoragePort) {}

  enqueue(raw: string): void {
    this.pending = raw
  }

  /** Nothing written and nothing waiting to be: memory and disk agree. */
  get isIdle(): boolean {
    return this.inFlight === null && this.pending === null
  }

  /** Writes the newest pending value, if any, and waits for it to settle. */
  async flush(): Promise<void> {
    // Loops rather than awaiting once. Several callers can be parked on the
    // same in-flight write; when it settles the first one to resume claims the
    // pending value and starts writing it, so a later one that only checked
    // `pending` would report done with the newest bytes still in the air.
    for (;;) {
      if (this.inFlight !== null) {
        await this.inFlight
        continue
      }
      const raw = this.pending
      if (raw === null) return

      this.pending = null
      this.inFlight = this.adapter
        .persist(raw)
        .then(
          () => this.onSuccess(),
          (e: unknown) => this.onError(e instanceof Error ? e : new Error(String(e))),
        )
        .finally(() => {
          this.inFlight = null
        })
      await this.inFlight
    }
  }
}
