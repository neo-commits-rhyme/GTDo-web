import type { StorageAdapter } from './types'

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

  constructor(private readonly adapter: StorageAdapter) {}

  enqueue(raw: string): void {
    this.pending = raw
  }

  /** Writes the newest pending value, if any, and waits for it to settle. */
  async flush(): Promise<void> {
    if (this.inFlight) await this.inFlight
    if (this.pending === null) return

    const raw = this.pending
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
