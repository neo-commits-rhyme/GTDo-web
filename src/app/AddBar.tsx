import { useEffect, useRef, useState } from 'react'
import { useStore, useStoreTick } from './useStore'

/**
 * Creation goes through submitNewTask, not addTask: creating in a
 * deadline-required list must raise the prompt rather than quietly producing
 * an undated task there.
 */
export function AddBar() {
  useStoreTick()
  const store = useStore()
  const [title, setTitle] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const focus = () => input.current?.focus()
    window.addEventListener('gtdo:focus-add', focus)
    return () => window.removeEventListener('gtdo:focus-add', focus)
  }, [])

  const submit = () => {
    if (title.trim() === '') return
    store.submitNewTask(title, store.selection)
    setTitle('')
  }

  return (
    <form
      className="addbar"
      onSubmit={(e) => { e.preventDefault(); submit() }}
    >
      <input
        ref={input}
        className="addbar__input"
        type="text"
        value={title}
        placeholder="Add a task"
        aria-label="Add a task"
        onChange={(e) => setTitle(e.target.value)}
      />
      <button type="submit" className="addbar__submit" disabled={title.trim() === ''}>
        Add
      </button>
    </form>
  )
}
