/** Ports ListSortTests.swift. Sorting is a view over `order`, never a write. */

import { describe, expect, it } from 'vitest'
import { sortTasks, allowsReordering } from '../sorting'
import { BuiltIn, type TaskItem } from '../models'

function item(title: string, order: number, due: Date | null = null,
              created = new Date(2026, 6, 1)): TaskItem {
  return {
    id: `id-${title}`, title, note: '', dueDate: due, reminderDate: null,
    listID: BuiltIn.inbox, isCompleted: false, completedAt: null, isTrashed: false,
    createdAt: created, order, repeatRule: null, trashedAt: null,
  }
}

const titles = (ts: TaskItem[]) => ts.map((t) => t.title)

describe('manual', () => {
  it('is the stored order', () => {
    const t = [item('c', 3), item('a', 1), item('b', 2)]
    expect(titles(sortTasks(t, 'manual'))).toEqual(['a', 'b', 'c'])
  })

  it('is the only sort that leaves rows draggable', () => {
    expect(allowsReordering('manual')).toBe(true)
    expect(allowsReordering('dueDate')).toBe(false)
    expect(allowsReordering('dateAdded')).toBe(false)
  })
})

describe('due date', () => {
  it('sorts soonest first', () => {
    const t = [item('later', 1, new Date(2026, 7, 1)), item('sooner', 2, new Date(2026, 6, 22))]
    expect(titles(sortTasks(t, 'dueDate'))).toEqual(['sooner', 'later'])
  })

  it('puts undated tasks last', () => {
    const t = [item('undated', 1), item('dated', 2, new Date(2026, 7, 1))]
    expect(titles(sortTasks(t, 'dueDate'))).toEqual(['dated', 'undated'])
  })

  it('keeps undated tasks in their manual order', () => {
    const t = [item('second', 2), item('first', 1)]
    expect(titles(sortTasks(t, 'dueDate'))).toEqual(['first', 'second'])
  })

  /** Every deadline is pinned to local noon, so same-day tasks tie. */
  it('breaks same-day ties on the manual order', () => {
    const due = new Date(2026, 6, 25, 12)
    const t = [item('third', 3, due), item('first', 1, due), item('second', 2, due)]
    expect(titles(sortTasks(t, 'dueDate'))).toEqual(['first', 'second', 'third'])
  })
})

describe('date added', () => {
  it('sorts oldest first', () => {
    const t = [item('new', 1, null, new Date(2026, 6, 20)),
               item('old', 2, null, new Date(2026, 6, 1))]
    expect(titles(sortTasks(t, 'dateAdded'))).toEqual(['old', 'new'])
  })

  /** An import stamps a whole file with one createdAt; file order must hold. */
  it('breaks identical creation dates on the manual order', () => {
    const at = new Date(2026, 6, 10)
    const t = [item('second', 2, null, at), item('first', 1, null, at)]
    expect(titles(sortTasks(t, 'dateAdded'))).toEqual(['first', 'second'])
  })
})

describe('purity', () => {
  it('never mutates the input array or its order values', () => {
    const t = [item('b', 2, new Date(2026, 7, 1)), item('a', 1)]
    const before = t.map((x) => `${x.title}:${x.order}`)
    sortTasks(t, 'dueDate')
    expect(t.map((x) => `${x.title}:${x.order}`)).toEqual(before)
    expect(titles(t)).toEqual(['b', 'a']) // input array itself untouched
  })

  it('returns to the manual arrangement when switched back', () => {
    const t = [item('b', 2, new Date(2026, 6, 1)), item('a', 1, new Date(2026, 7, 1))]
    expect(titles(sortTasks(t, 'dueDate'))).toEqual(['b', 'a'])
    expect(titles(sortTasks(t, 'manual'))).toEqual(['a', 'b'])
  })
})
