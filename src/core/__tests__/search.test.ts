import { describe, it, expect } from 'vitest'
import { AppStore } from '../store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { searchScopeLabel } from '../search'
import { BuiltIn, type TaskItem } from '../models'

/** Ports SearchTests.swift and SearchScopeTests.swift. */

const NOW = new Date(2026, 6, 28, 9, 0, 0)
const store = async () =>
  AppStore.create({ adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f() })

let seq = 0
function task(over: Partial<TaskItem> = {}): TaskItem {
  seq += 1
  return {
    id: `30000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
    title: `task ${seq}`, note: '', dueDate: null, reminderDate: null,
    listID: BuiltIn.inbox, isCompleted: false, completedAt: null, isTrashed: false,
    createdAt: NOW, order: seq, repeatRule: null, trashedAt: null,
    ...over,
  }
}

describe('Search', () => {
  it('emptyAndWhitespaceQueriesMatchNothing', async () => {
    const s = await store()
    s.data.tasks = [task({ title: 'anything' })]
    s.searchQuery = ''
    expect(s.searchResults()).toEqual([])
    s.searchQuery = '   '
    expect(s.searchResults()).toEqual([])
  })

  it('matchesTitleAndNoteCaseInsensitively', async () => {
    const s = await store()
    const byTitle = task({ title: 'Buy MILK' })
    const byNote = task({ title: 'errand', note: 'remember the milk' })
    const neither = task({ title: 'walk the dog' })
    s.data.tasks = [byTitle, byNote, neither]
    s.searchQuery = 'milk'
    expect(s.searchResults().map((t) => t.id).sort()).toEqual([byTitle.id, byNote.id].sort())
  })

  it('isDiacriticInsensitive', async () => {
    const s = await store()
    s.data.tasks = [task({ title: 'café société' })]
    s.searchQuery = 'cafe'
    expect(s.searchResults().length).toBe(1)
  })

  it('sortsByOrder', async () => {
    const s = await store()
    const late = task({ title: 'milk later', order: 9 })
    const early = task({ title: 'milk first', order: 1 })
    s.data.tasks = [late, early]
    s.searchQuery = 'milk'
    expect(s.searchResults().map((t) => t.id)).toEqual([early.id, late.id])
  })

  it('trimsTheQuery', async () => {
    const s = await store()
    s.data.tasks = [task({ title: 'milk' })]
    s.searchQuery = '  milk  '
    expect(s.searchResults().length).toBe(1)
  })
})

describe('Search scopes', () => {
  it('defaultIncludesCompletedButNotTrashed', async () => {
    const s = await store()
    const open = task({ title: 'milk' })
    const done = task({ title: 'milk', isCompleted: true, completedAt: NOW })
    const gone = task({ title: 'milk', isTrashed: true, trashedAt: NOW })
    s.data.tasks = [open, done, gone]
    s.searchQuery = 'milk'
    expect(s.searchResults().map((t) => t.id).sort()).toEqual([open.id, done.id].sort())
  })

  it('activeOnlyExcludesCompleted', async () => {
    const s = await store()
    const open = task({ title: 'milk' })
    const done = task({ title: 'milk', isCompleted: true, completedAt: NOW })
    s.data.tasks = [open, done]
    s.searchQuery = 'milk'
    expect(s.searchResults({ scope: 'activeOnly' }).map((t) => t.id)).toEqual([open.id])
  })

  it('includeTrashedReachesEverything', async () => {
    const s = await store()
    const gone = task({ title: 'milk', isTrashed: true, trashedAt: NOW })
    s.data.tasks = [gone]
    s.searchQuery = 'milk'
    expect(s.searchResults({ scope: 'includeTrashed' }).map((t) => t.id)).toEqual([gone.id])
  })

  it('listIDRestrictsToOneList', async () => {
    const s = await store()
    const here = task({ title: 'milk', listID: BuiltIn.notes })
    const there = task({ title: 'milk', listID: BuiltIn.inbox })
    s.data.tasks = [here, there]
    s.searchQuery = 'milk'
    expect(s.searchResults({ listID: BuiltIn.notes }).map((t) => t.id)).toEqual([here.id])
  })

  it('listNameMatchingIsOffByDefault', async () => {
    // Otherwise the first keystroke of most searches returns an entire
    // built-in list before narrowing.
    const s = await store()
    const t = task({ title: 'unrelated', listID: BuiltIn.notes })
    s.data.tasks = [t]
    s.searchQuery = 'notes'
    expect(s.searchResults()).toEqual([])
    expect(s.searchResults({ matchListNames: true }).map((x) => x.id)).toEqual([t.id])
  })

  it('scopeLabels', () => {
    expect(searchScopeLabel('activeOnly')).toBe('Active')
    expect(searchScopeLabel('includeCompleted')).toBe('Completed')
    expect(searchScopeLabel('includeTrashed')).toBe('Trash')
  })

  it('searchIgnoresTheCompletionHold', async () => {
    // A pinned just-completed task is matched by its STORED state, and a
    // suppressed recurrence spawn is visible to search. Spec §5.4.
    const queued: (() => void)[] = []
    const s = await AppStore.create({
      adapter: new MemoryAdapter(), now: () => NOW,
      scheduler: (_m, f) => { queued.push(f) },
    })
    const t = task({ title: 'milk', repeatRule: { unit: 'day', interval: 1 }, dueDate: NOW })
    s.data.tasks = [t]
    s.searchQuery = 'milk'

    s.toggleCompletedHolding(t.id)
    // The view still renders it incomplete…
    expect(s.rendersCompleted(s.task(t.id)!)).toBe(false)
    // …but activeOnly search, reading the stored flag, excludes it.
    expect(s.searchResults({ scope: 'activeOnly' }).map((x) => x.id)).toEqual([
      s.data.tasks[1]!.id, // the suppressed spawn IS visible to search
    ])
  })
})
