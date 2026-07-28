import { useCallback, useState } from 'react'
import type { SidebarItem } from '../core/models'
import { DeadlinePrompt } from './DeadlinePrompt'
import { DetailPane } from './DetailPane'
import { LiveRegion } from './LiveRegion'
import { SaveFailureBanner } from './SaveFailureBanner'
import { SearchField } from './SearchField'
import { SettingsSheet } from './SettingsSheet'
import { Sidebar } from './Sidebar'
import { TaskList } from './TaskList'
import { useBreakpoint } from './useBreakpoint'
import { useRoute } from './useRoute'
import { useShortcuts } from './useShortcuts'
import { useStore, useStoreTick } from './useStore'

/**
 * Layout A: sidebar 240 | task list | detail.
 *
 * At >=1100 the detail is a third column that reflows the list narrower. Below
 * that it overlays instead — a third column starves the list — and below 700
 * the whole thing becomes stacked push navigation with the detail as a sheet.
 *
 * The list keeps a min-width so opening the detail never re-wraps row titles,
 * and the hold pin is keyed on task id in core/, never on DOM position, so a
 * reflow mid-window cannot drop it.
 */
export function RootShell() {
  useStoreTick()
  const store = useStore()
  const navigate = useRoute()
  const breakpoint = useBreakpoint()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [narrowPane, setNarrowPane] = useState<'lists' | 'tasks'>('tasks')

  const openSettings = useCallback(() => setSettingsOpen(true), [])
  useShortcuts(navigate, openSettings)

  const detailID = store.selectedTaskID !== null && store.task(store.selectedTaskID) !== null
    ? store.selectedTaskID
    : null
  const closeDetail = () => store.setSelectedTask(null)

  const goto = (item: SidebarItem) => {
    navigate(item)
    setNarrowPane('tasks')
  }

  const narrow = breakpoint === 'narrow'
  const detailIsOverlay = breakpoint !== 'wide'

  return (
    <div className={`shell shell--${breakpoint}${detailID !== null && breakpoint === 'wide' ? ' shell--detail' : ''}`}>
      <SaveFailureBanner />
      <LiveRegion />

      <header className="shell__bar">
        {narrow && (
          <button
            type="button"
            className="shell__back"
            onClick={() => setNarrowPane(narrowPane === 'lists' ? 'tasks' : 'lists')}
          >
            {narrowPane === 'lists' ? 'Done' : 'Lists'}
          </button>
        )}
        <SearchField />
        <button type="button" onClick={openSettings} aria-label="Settings">⚙</button>
      </header>

      {(!narrow || narrowPane === 'lists') && (
        <div className="shell__sidebar">
          <Sidebar onNavigate={goto} />
        </div>
      )}

      {(!narrow || narrowPane === 'tasks') && (
        <main className="shell__main">
          <TaskList />
        </main>
      )}

      {detailID !== null && (
        <div className={detailIsOverlay ? 'shell__detail shell__detail--overlay' : 'shell__detail'}>
          <DetailPane taskID={detailID} onClose={closeDetail} />
        </div>
      )}

      <DeadlinePrompt />
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
