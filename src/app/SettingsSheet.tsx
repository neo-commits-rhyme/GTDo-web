import { useEffect, useState } from 'react'
import type { SnapshotMeta } from '../core/ports'
import { downloadExport, importText, restoreSnapshot } from './transfer'
import { useStore, useStoreTick } from './useStore'
import type { ThemeChoice } from './theme/useTheme'
import { ACCENTS, type AccentID } from './theme/accents'
import { readableInkOn } from './theme/contrast'
import { completionSoundEnabled, setCompletionSoundEnabled } from './sound'

export const AUTO_EMPTY_TRASH_KEY = 'gtdo.autoEmptyTrash'

/** Default OFF, matching macOS — nothing deletes itself unless asked. */
export function autoEmptyTrashEnabled(): boolean {
  return localStorage.getItem(AUTO_EMPTY_TRASH_KEY) === 'true'
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
  const [autoEmpty, setAutoEmpty] = useState(autoEmptyTrashEnabled)
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([])
  const [sound, setSound] = useState(completionSoundEnabled)
  const [error, setError] = useState<string | null>(null)

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
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={a.label}
                className={`swatch${selected ? ' swatch--selected' : ''}`}
                style={{ '--swatch': a.light, '--swatch-ink': readableInkOn(a.light) } as React.CSSProperties}
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

        <h3>Your data</h3>
        <p className="settings__note">
          Everything lives in this browser. Export to move it to the macOS app or another device.
        </p>
        <div className="settings__actions">
          <button type="button" onClick={() => downloadExport(store)}>Export data.json</button>
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
