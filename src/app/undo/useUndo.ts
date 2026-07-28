import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'
import { UndoCenter } from '../../core/undo'

/**
 * One centre for the app, in context. Only one bar is ever on screen, so a
 * single slot is the whole model.
 */
export const UndoContext = createContext<UndoCenter | null>(null)

export function useUndoCenter(): UndoCenter {
  const centre = useContext(UndoContext)
  if (centre === null) throw new Error('useUndoCenter must be used inside an UndoContext')
  return centre
}

/** Re-renders when the pending action appears, is undone, or expires. */
export function usePendingUndo() {
  const centre = useUndoCenter()
  const subscribe = useCallback((fn: () => void) => centre.subscribe(fn), [centre])
  const snapshot = useCallback(() => centre.pending, [centre])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
