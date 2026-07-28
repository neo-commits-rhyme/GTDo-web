import type { LoadResult, SnapshotMeta, StorageAdapter } from './types'

/**
 * Every operation fails, the way a browser out of quota or with an evicted
 * origin behaves. Drives the paths that are hardest to reach by accident and
 * most damaging when wrong.
 */
export class FailingAdapter implements StorageAdapter {
  constructor(private readonly errorName = 'QuotaExceededError') {}

  private error(): Error {
    const e = new Error(`${this.errorName}: the storage quota has been exceeded`)
    e.name = this.errorName
    return e
  }

  async load(): Promise<LoadResult> {
    // Unreadable, NOT absent — the whole data-safety guarantee turns on this.
    return { kind: 'unreadable', error: this.error() }
  }

  async persist(_raw: string): Promise<void> {
    throw this.error()
  }

  /** Best-effort: reports failure instead of throwing, so it never blocks a save. */
  async writeSnapshot(_raw: string, _at: Date): Promise<boolean> {
    return false
  }

  async listSnapshots(): Promise<SnapshotMeta[]> {
    return []
  }

  async readSnapshot(_id: string): Promise<string> {
    throw this.error()
  }

  async quarantine(_raw: string, _reason: string): Promise<void> {
    throw this.error()
  }
}
