/**
 * storage/ implements the port that core/ declares. The types live in
 * core/ports.ts so that core/ can depend on the shape without depending on any
 * implementation; this module re-exports them for adapter authors.
 */

export type { LoadResult, SnapshotMeta, StoragePort } from '../core/ports'
export type { StoragePort as StorageAdapter } from '../core/ports'
