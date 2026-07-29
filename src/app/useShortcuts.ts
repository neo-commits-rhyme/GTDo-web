import { useEffect } from 'react'
import { BuiltIn, type SidebarItem } from '../core/models'
import { useStore } from './useStore'
import { undoLabel, type UndoCenter } from '../core/undo'

/**
 * Bare keys, not ⌘-chords.
 *
 * Measured in docs/assumptions.md §1: a page can see and preventDefault ⌘N/⌘F/⌘,
 * in all three engines, but whether the browser chrome ALSO acts is not
 * testable through a driver — and on Windows and Linux Ctrl+N and Ctrl+F are
 * browser-owned regardless. Bare keys are correct under either outcome.
 *
 * The handler checks event.target itself: chords and bare keys both arrive
 * while a text field is focused, so the browser will not do the suppression
 * for us.
 */
export function useShortcuts(
  navigate: (item: SidebarItem) => void,
  openSettings: () => void,
  undo: UndoCenter,
  /** False while the list on screen is date-sorted: [ and ] rewrite `order`,
   *  which under a date sort would destroy the manual arrangement. */
  reorderable = true,
) {
  const store = useStore()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      if (e.key === 'Escape') {
        // Detail first, then search — most-recently-opened wins.
        if (store.selectedTaskID !== null) store.setSelectedTask(null)
        else if (store.searchQuery !== '') store.setSearchQuery('')
        else if (typing) (target as HTMLElement).blur()
        return
      }

      // Cmd/Ctrl+Z is one of the few chords worth attempting: unlike Cmd+N,
      // browsers do not own it outside a text field — and the check above has
      // already returned if one is focused.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (typing) return
        if (undo.pending !== null) {
          e.preventDefault()
          undo.undo(store)
        }
        return
      }

      if (typing || e.metaKey || e.ctrlKey || e.altKey) return

      switch (e.key) {
        case 'n':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('gtdo:focus-add'))
          break
        case '/':
        case 'f':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('gtdo:focus-search'))
          break
        case '1': navigate({ kind: 'smart', view: 'today' }); break
        case '2': navigate({ kind: 'smart', view: 'calendar' }); break
        case '3': navigate({ kind: 'list', id: BuiltIn.inbox }); break
        case ',': openSettings(); break
        case 'Delete':
        case 'Backspace': {
          const id = store.selectedTaskID
          if (id !== null) {
            e.preventDefault()
            undo.perform(undoLabel('trashed', 1), [id], store, () => store.trashTask(id))
          }
          break
        }
        case '[':
        case ']': {
          // The accessible path sub-project 3's drag will layer over.
          if (!reorderable) return
          const id = store.selectedTaskID
          if (id === null) return
          const task = store.task(id)
          if (task === null) return
          const siblings = store.incompleteTasks(task.listID)
          const index = siblings.findIndex((t) => t.id === id)
          if (index < 0) return
          e.preventDefault()
          // The same action by drag is undoable, so this must be too — one
          // gesture being reversible and its keyboard twin not is worse than
          // neither being.
          const moved = (to: number) => {
            undo.perform(undoLabel('moved', 1), siblings.map((t) => t.id), store, () => {
              store.moveIncompleteTasks(task.listID, [index], to)
            })
          }
          // SwiftUI onMove semantics: down one is index + 2.
          if (e.key === '[' && index > 0) moved(index - 1)
          if (e.key === ']' && index < siblings.length - 1) moved(index + 2)
          break
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [store, navigate, openSettings, undo])
}
