/**
 * Importing a plain list of lines as tasks — the counterpart to
 * File ▸ Import Tasks from File… on macOS.
 *
 * The file picker accepts anything (a list has no reliable extension), so a
 * mis-picked image, a multi-gigabyte video and the user's own data.json all
 * reach this code and have to be turned away here rather than imported as a few
 * hundred nonsense tasks.
 */

import { useRef, useState } from 'react'
import type { AppStore } from '../core/store'
import { BuiltIn } from '../core/models'
import { decodeText, isBackupDocument, MAXIMUM_FILE_SIZE } from '../core/taskImport'

export type ImportOutcome = {
  added: number
  /** Not a list of text lines: binary, or too large to be one. */
  notText: string[]
  /** Could not be read at all. */
  unreadable: string[]
  /** A GTDo backup, which has its own restore path. */
  backups: string[]
}

/**
 * The file's bytes. `Blob.arrayBuffer` is the direct route but is missing on
 * Safari before 14 (and in jsdom), so FileReader is the fallback rather than
 * the primary — an import that silently fails on one browser is worse than a
 * few extra lines here.
 */
function readBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer().then((b) => new Uint8Array(b))
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('unreadable'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Reads each chosen file and appends its lines to the Inbox. A file that can't
 * be read is named in the outcome rather than failing the whole import — the
 * other files still land.
 */
export async function importTaskFiles(store: AppStore, files: File[]): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { added: 0, notText: [], unreadable: [], backups: [] }

  for (const file of files) {
    if (file.size > MAXIMUM_FILE_SIZE) {
      outcome.notText.push(file.name)
      continue
    }
    let bytes: Uint8Array
    try {
      bytes = await readBytes(file)
    } catch {
      outcome.unreadable.push(file.name)
      continue
    }
    const text = decodeText(bytes)
    if (text === null) {
      outcome.notText.push(file.name)
      continue
    }
    if (isBackupDocument(text)) {
      outcome.backups.push(file.name)
      continue
    }
    outcome.added += store.importTasksFromText(text)
  }

  if (outcome.added > 0) {
    // Show the result: an active search or another list would hide the tasks
    // that were just imported.
    store.setSearchQuery('')
    store.setSelection({ kind: 'list', id: BuiltIn.inbox })
  }
  return outcome
}

export function summarizeImport(o: ImportOutcome): string {
  const lines: string[] = []
  if (o.added > 0) {
    lines.push(`Added ${o.added} task${o.added === 1 ? '' : 's'} to the Inbox.`)
  } else if (o.notText.length === 0 && o.unreadable.length === 0 && o.backups.length === 0) {
    lines.push('No tasks found — that file has no lines of text.')
  }
  if (o.backups.length > 0) {
    lines.push(
      `${o.backups.join(', ')} is GTDo data — restore it with “Import data.json” in Settings.`,
    )
  }
  if (o.notText.length > 0) {
    lines.push(`Skipped ${o.notText.join(', ')} — not a list of text lines.`)
  }
  if (o.unreadable.length > 0) {
    lines.push(`Couldn’t read ${o.unreadable.join(', ')}.`)
  }
  return lines.join(' ')
}

/**
 * The button + hidden file input, used both on an empty Inbox and in Settings.
 * The label is a real <label> wrapping the input so it is keyboard-reachable
 * without scripting the click.
 */
export function ImportTasksButton({
  store, className = 'import-tasks__button', label = 'Import tasks from a file…', onDone,
}: {
  store: AppStore
  className?: string
  label?: string
  /**
   * Where the result goes. Callers whose button can disappear as a *result* of
   * the import — the empty-Inbox one, which is unmounted the moment the first
   * task lands — must own the message themselves, or the confirmation vanishes
   * in the same frame it is set.
   */
  onDone?: (summary: string) => void
}) {
  const [message, setMessage] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  return (
    <div className="import-tasks">
      <label className={className}>
        {label}
        <input
          ref={input}
          type="file"
          // No `accept`: a hand-written list may carry any extension or none,
          // and a filter would grey out exactly those files. The contents
          // decide whether it imports — that is what decodeText is for.
          multiple
          className="visually-hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            // Clear first: picking the same file twice must fire onChange twice.
            e.target.value = ''
            if (files.length === 0) return
            void importTaskFiles(store, files).then((o) => {
              const summary = summarizeImport(o)
              if (onDone !== undefined) onDone(summary)
              else setMessage(summary)
            })
          }}
        />
      </label>
      {onDone === undefined && message !== null && (
        <p className="import-tasks__message" role="status">{message}</p>
      )}
    </div>
  )
}
