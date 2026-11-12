import { useEffect, useState } from 'react'
import type { SnapshotMeta } from '../core/ports'
import { ImportTasksButton } from './ImportTasks'
import { downloadExport, exportBytes, importText, restoreSnapshot } from './transfer'
import { syncNow, useSyncStatus, type SyncStatus } from './sync/syncRunner'
import { telegram } from '../telegram'
import { useStore, useStoreTick } from './useStore'
import { useResolvedScheme, type ThemeChoice } from './theme/useTheme'
import { ACCENTS, type AccentID } from './theme/accents'
import { readableInkOn } from './theme/contrast'
import { completionSoundEnabled, setCompletionSoundEnabled } from './sound'

export const AUTO_EMPTY_TRASH_KEY = 'gtdo.autoEmptyTrash'

/** Default OFF, matching macOS — nothing deletes itself unless asked. */
export function autoEmptyTrashEnabled(): boolean {
  return localStorage.getItem(AUTO_EMPTY_TRASH_KEY) === 'true'
}

function syncLine(sync: SyncStatus): string {
  if (sync.phase === 'syncing') return 'Syncing…'
  if (sync.phase === 'error') return `Couldn’t sync: ${sync.error ?? 'unknown error'}`
  if (sync.lastSyncedAt === null) return 'Not synced yet'
  return `Synced at ${new Date(sync.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export function SettingsSheet({
  onClose, theme, setTheme, accent, setAccent,
}: {
  onClose: () => void
  theme: ThemeChoice
  setTheme: (c: ThemeChoice) => void
  accent: AccentID
  setAccent: (id: AccentID) => void
}) {
  useStoreTick()
  const store = useStore()
  const scheme = useResolvedScheme(theme)
  const [autoEmpty, setAutoEmpty] = useState(autoEmptyTrashEnabled)
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([])
  const [sound, setSound] = useState(completionSoundEnabled)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const sync = useSyncStatus()
  const inTelegram = telegram.active()

  // Telegram's in-app browser does not reliably save a download, so there the
  // file's text goes to the clipboard instead.
  const copyExport = async () => {
    setError(null)
    setNotice(null)
    try {
      await navigator.clipboard.writeText(exportBytes(store))
      setNotice('Copied. Paste it into a file named data.json to use it in the macOS app.')
    } catch {
      setError('Couldn’t copy to the clipboard.')
    }
  }

  useEffect(() => { void store.listSnapshots().then(setSnapshots) }, [store])

  const onImport = async (file: File) => {
    setError(null)
    try {
      importText(store, await file.text())
    } catch (e) {
      // The store is untouched — decoding happens before anything is replaced.
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="prompt" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="prompt__panel">
        <div className="detail__header">
          <h2>Settings</h2>
          <button type="button" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <h3>Appearance</h3>
        <fieldset className="settings__choices">
          <legend className="visually-hidden">Appearance</legend>
          {(['system', 'light', 'dark'] as ThemeChoice[]).map((choice) => (
            <label key={choice} className="settings__choice">
              <input
                type="radio"
                name="theme"
                value={choice}
                checked={theme === choice}
                onChange={() => setTheme(choice)}
              />
              <span>{choice === 'system' ? 'System' : choice === 'light' ? 'Light' : 'Dark'}</span>
            </label>
          ))}
        </fieldset>

        <div className="swatches swatches--accent" role="radiogroup" aria-label="Accent colour">
          {ACCENTS.map((a) => {
            const selected = accent === a.id
            // tokens.css resolves --accent per scheme, so a swatch fixed to the
            // light value misrepresents the click: the deep-green Teal chip
            // turned the app bright aqua, and the light values on dark paper
            // sat as low as 1.52:1 — an invisible blob where Ink should be.
            const shown = a[scheme]
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={a.label}
                className={`swatch${selected ? ' swatch--selected' : ''}`}
                style={{ '--swatch': shown, '--swatch-ink': readableInkOn(shown) } as React.CSSProperties}
                onClick={() => setAccent(a.id)}
              >
                {selected && <span className="swatch__check" aria-hidden="true">✓</span>}
              </button>
            )
          })}
        </div>

        <label className="settings__row">
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => { setSound(e.target.checked); setCompletionSoundEnabled(e.target.checked) }}
          />
          <span>Completion sound</span>
        </label>

        <label className="settings__row">
          <input
            type="checkbox"
            checked={autoEmpty}
            onChange={(e) => {
              setAutoEmpty(e.target.checked)
              localStorage.setItem(AUTO_EMPTY_TRASH_KEY, String(e.target.checked))
            }}
          />
          <span>Auto-empty Trash after 30 days</span>
        </label>

        {inTelegram && (
          <>
            <h3>Telegram sync</h3>
            {sync.available ? (
              <>
                <p className="settings__note">
                  Your tasks are saved on this device and mirrored to your Telegram account’s cloud
                  storage, so they follow you to Telegram on your other devices. If two devices
                  change them while one is offline, the later change wins.
                </p>
                <div className="settings__actions">
                  <button type="button" disabled={sync.phase === 'syncing'} onClick={() => syncNow()}>
                    Sync now
                  </button>
                  <span className={sync.phase === 'error' ? 'settings__error' : 'settings__note'} role="status">
                    {syncLine(sync)}
                  </span>
                </div>
                {sync.incomplete && (
                  <>
                    <p className="settings__note">
                      Another device may have stopped halfway through saving. If this keeps
                      happening, replace the cloud copy with what is on this device.
                    </p>
                    <div className="settings__actions">
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm('Replace your tasks in Telegram on every other device with what is on this one?')) {
                            syncNow('push')
                          }
                        }}
                      >
                        Upload this device’s tasks
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <p className="settings__note">
                This version of Telegram has no cloud storage, so your tasks stay on this device.
                Update Telegram to sync between devices.
              </p>
            )}
          </>
        )}

        <h3>Your data</h3>
        <p className="settings__note">
          {inTelegram
            ? 'Export to move it to the macOS app, or to keep a copy of your own.'
            : 'Everything lives in this browser. Export to move it to the macOS app or another device.'}
        </p>
        <div className="settings__actions">
          {inTelegram
            ? <button type="button" onClick={() => void copyExport()}>Copy data.json</button>
            : <button type="button" onClick={() => downloadExport(store)}>Export data.json</button>}
          <label className="settings__import">
            Import data.json
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file !== undefined) void onImport(file)
              }}
            />
          </label>
        </div>
        {error !== null && <p className="settings__error" role="alert">{error}</p>}
        {notice !== null && <p className="settings__note" role="status">{notice}</p>}

        <h3>Import a task list</h3>
        <p className="settings__note">
          A .txt or .csv file with one task per line lands in the Inbox. Numbering,
          bullets and checkboxes are stripped; blank lines are skipped.
        </p>
        <ImportTasksButton store={store} className="settings__import" />

        <h3>Restore a snapshot</h3>
        {snapshots.length === 0 ? (
          <p className="settings__note">No snapshots yet.</p>
        ) : (
          <ul className="settings__snapshots">
            {snapshots.slice(0, 10).map((s) => (
              <li key={s.id}>
                <span>{s.id}</span>
                <button type="button" onClick={() => void restoreSnapshot(store, s.id)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}

        <h3>Danger zone</h3>
        <div className="settings__actions">
          <button type="button" onClick={() => store.loadSampleData()}>Load sample data</button>
          <button
            type="button"
            className="detail__destructive"
            onClick={() => {
              if (window.confirm('Delete every task and list? A snapshot is taken first.')) {
                store.resetAllData()
              }
            }}
          >
            Reset all data
          </button>
        </div>
      </div>
    </div>
  )
}
