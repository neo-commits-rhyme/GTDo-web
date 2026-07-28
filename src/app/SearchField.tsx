import { useEffect, useRef } from 'react'
import { useStore, useStoreTick } from './useStore'

export function SearchField() {
  useStoreTick()
  const store = useStore()
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const focus = () => input.current?.focus()
    window.addEventListener('gtdo:focus-search', focus)
    return () => window.removeEventListener('gtdo:focus-search', focus)
  }, [])

  return (
    <input
      ref={input}
      className="search"
      type="search"
      value={store.searchQuery}
      placeholder="Search"
      aria-label="Search"
      onChange={(e) => store.setSearchQuery(e.target.value)}
    />
  )
}
