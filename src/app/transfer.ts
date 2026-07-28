/**
 * Export and import of data.json — the only route between the web app and the
 * macOS app, and the escape hatch when storage fails.
 *
 * Both directions go through core/codec, so the interop contract has exactly
 * one implementation.
 */

import { decodeAppData, encodeAppData } from '../core/codec'
import type { AppStore } from '../core/store'

export const EXPORT_FILENAME = 'data.json'
export const EXPORT_MIME = 'application/json'

export function exportBytes(store: AppStore): string {
  return encodeAppData(store.data)
}

export function exportBlob(store: AppStore): Blob {
  return new Blob([exportBytes(store)], { type: EXPORT_MIME })
}

/** Triggers a download. Separate from exportBlob so tests can skip the DOM. */
export function downloadExport(store: AppStore): void {
  const url = URL.createObjectURL(exportBlob(store))
  const a = document.createElement('a')
  a.href = url
  a.download = EXPORT_FILENAME
  a.click()
  URL.revokeObjectURL(url)
}

export class ImportError extends Error {
  constructor(readonly cause: Error) {
    super(`That file could not be read as GTDo data: ${cause.message}`)
    this.name = 'ImportError'
  }
}

/**
 * Replaces the store with an imported document.
 *
 * Decoding happens BEFORE anything is replaced, so an unreadable file leaves
 * the store untouched. importData itself takes a snapshot first, which is what
 * makes the import undoable.
 */
export function importText(store: AppStore, text: string): void {
  let decoded
  try {
    decoded = decodeAppData(text)
  } catch (e) {
    throw new ImportError(e instanceof Error ? e : new Error(String(e)))
  }
  store.importData(decoded)
}

/** Restores a rotating snapshot. Same guarantee: decode before replace. */
export async function restoreSnapshot(store: AppStore, id: string): Promise<void> {
  const raw = await store.readSnapshot(id)
  importText(store, raw)
}
