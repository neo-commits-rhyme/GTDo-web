/**
 * Ports ProjectNextActionsTests.swift — a project task with a deadline is a
 * committed next action, so Next actions shows it without moving it out of its
 * project.
 */

import { describe, expect, it } from 'vitest'
import { AppStore } from '../store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { atNoon } from '../calendar'
import { BuiltIn, type TaskItem, type TaskList } from '../models'

const NOW = new Date(2026, 6, 21, 9, 0, 0)
const DUE = atNoon(new Date(2026, 6, 25))

const store = async () =>
  AppStore.create({ adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f() })

function project(s: AppStore, name = 'Site'): TaskList {
  return s.addList(name, BuiltIn.projectsGroup)!
}

function task(s: AppStore, title: string, listID: string, due: Date | null = DUE): TaskItem {
  const created = s.addTask(title, { kind: 'list', id: listID })!
  if (due !== null) s.setDueDate(created.id, due)
  return s.task(created.id)!
}

const ids = (tasks: TaskItem[]) => tasks.map((t) => t.id)

describe('membership', () => {
  it('shows a project task that has a deadline', async () => {
    const s = await store()
    const t = task(s, 'wireframes', project(s).id)
    expect(ids(s.nextActionsTasks)).toEqual([t.id])
  })

  it('does not show a project task without a deadline', async () => {
    const s = await store()
    task(s, 'someday idea', project(s).id, null)
    expect(s.nextActionsTasks).toEqual([])
  })

  /** Only the Projects group mirrors. */
  it('does not show an ordinary list with a deadline', async () => {
    const s = await store()
    task(s, 'buy milk', s.addList('Shopping', null)!.id)
    expect(s.nextActionsTasks).toEqual([])
  })

  it('does not mirror built-in lists', async () => {
    const s = await store()
    task(s, 'inbox item', BuiltIn.inbox)
    task(s, 'someday item', BuiltIn.someday)
    expect(s.nextActionsTasks).toEqual([])
  })

  it('still lists its own tasks', async () => {
    const s = await store()
    const own = task(s, 'call the bank', BuiltIn.nextActions)
    expect(ids(s.nextActionsTasks)).toEqual([own.id])
  })

  it('interleaves own and mirrored by order, with no duplicates', async () => {
    const s = await store()
    const p = project(s)
    const a = task(s, 'own A', BuiltIn.nextActions)
    const b = task(s, 'project B', p.id)
    const c = task(s, 'own C', BuiltIn.nextActions)
    expect(ids(s.nextActionsTasks)).toEqual([a.id, b.id, c.id])
  })

  it('does not show trashed project tasks', async () => {
    const s = await store()
    const t = task(s, 'wireframes', project(s).id)
    s.trashTask(t.id)
    expect(s.nextActionsTasks).toEqual([])
  })

  /** The mirror is a view, not a move. */
  it('leaves the task in its project', async () => {
    const s = await store()
    const p = project(s)
    const t = task(s, 'wireframes', p.id)
    expect(ids(s.incompleteTasks(p.id))).toEqual([t.id])
    expect(s.task(t.id)!.listID).toBe(p.id)
  })
})

describe('completing from Next actions', () => {
  it('moves a mirrored task into the completed panel, and into the project', async () => {
    const s = await store()
    const p = project(s)
    const t = task(s, 'wireframes', p.id)
    s.toggleCompleted(t.id)
    expect(s.nextActionsTasks).toEqual([])
    expect(ids(s.nextActionsCompletedTasks)).toEqual([t.id])
    expect(ids(s.completedTasksIn(p.id))).toEqual([t.id])
  })

  it('brings it back when un-completed', async () => {
    const s = await store()
    const t = task(s, 'wireframes', project(s).id)
    s.toggleCompleted(t.id)
    s.toggleCompleted(t.id)
    expect(ids(s.nextActionsTasks)).toEqual([t.id])
    expect(s.nextActionsCompletedTasks).toEqual([])
  })

  it('keeps its own completed tasks too', async () => {
    const s = await store()
    const own = task(s, 'call the bank', BuiltIn.nextActions)
    const borrowed = task(s, 'wireframes', project(s).id)
    s.toggleCompleted(own.id)
    s.toggleCompleted(borrowed.id)
    expect(new Set(ids(s.nextActionsCompletedTasks))).toEqual(new Set([own.id, borrowed.id]))
  })
})

describe('leaving the mirror', () => {
  it('drops the task when the deadline is cleared', async () => {
    const s = await store()
    const p = project(s)
    const t = task(s, 'wireframes', p.id)
    s.setDueDate(t.id, null)
    expect(s.nextActionsTasks).toEqual([])
    expect(ids(s.incompleteTasks(p.id))).toEqual([t.id])
  })

  /** Someday strips the deadline, so the mirror drops it. */
  it('drops the task when it moves to Someday', async () => {
    const s = await store()
    const t = task(s, 'wireframes', project(s).id)
    s.moveTask(t.id, BuiltIn.someday)
    expect(s.nextActionsTasks).toEqual([])
  })

  it('stops mirroring a list dragged out of the Projects group', async () => {
    const s = await store()
    const p = project(s)
    task(s, 'wireframes', p.id)
    s.moveList(p.id, null)
    expect(s.nextActionsTasks).toEqual([])
  })

  it('drops the tasks of a deleted project', async () => {
    const s = await store()
    const p = project(s)
    task(s, 'wireframes', p.id)
    s.deleteList(p.id)
    expect(s.nextActionsTasks).toEqual([])
  })
})

describe('the project tag', () => {
  it('identifies the owning project', async () => {
    const s = await store()
    const p = project(s, 'Website')
    const borrowed = task(s, 'wireframes', p.id)
    const own = task(s, 'call the bank', BuiltIn.nextActions)
    expect(s.projectOf(borrowed)?.id).toBe(p.id)
    expect(s.projectOf(own)).toBeNull()
  })

  it('carries the list colour and symbol', async () => {
    const s = await store()
    const p = project(s, 'Website')
    s.setListColor(p.id, '#34C759')
    s.setListSymbol(p.id, 'hammer')
    const borrowed = task(s, 'wireframes', p.id)
    expect(s.projectOf(borrowed)?.colorHex).toBe('#34C759')
    expect(s.projectOf(borrowed)?.symbol).toBe('hammer')
  })
})

describe('reordering', () => {
  it('moves the row within Next actions', async () => {
    const s = await store()
    const p = project(s)
    const a = task(s, 'own A', BuiltIn.nextActions)
    const b = task(s, 'project B', p.id)
    const c = task(s, 'own C', BuiltIn.nextActions)
    s.moveNextActions([2], 0)
    expect(ids(s.nextActionsTasks)).toEqual([c.id, a.id, b.id])
  })

  it('leaves other lists alone', async () => {
    const s = await store()
    const p = project(s)
    const inboxA = task(s, 'inbox A', BuiltIn.inbox, null)
    const inboxB = task(s, 'inbox B', BuiltIn.inbox, null)
    task(s, 'own', BuiltIn.nextActions)
    task(s, 'project', p.id)
    s.moveNextActions([1], 0)
    expect(ids(s.incompleteTasks(BuiltIn.inbox))).toEqual([inboxA.id, inboxB.id])
  })
})

describe('the rows a view renders', () => {
  /** The list, its sidebar badge and the drag context all read this — a drop's
   *  from/to are indices into it, so any caller reading a different array moves
   *  the wrong row. */
  it('is the mirror for Next actions and the plain list everywhere else', async () => {
    const s = await store()
    const p = project(s)
    const own = task(s, 'own', BuiltIn.nextActions)
    const borrowed = task(s, 'project', p.id)
    const inbox = task(s, 'inbox', BuiltIn.inbox, null)

    expect(ids(s.tasksInView(BuiltIn.nextActions))).toEqual([own.id, borrowed.id])
    expect(ids(s.tasksInView(BuiltIn.nextActions))).toEqual(ids(s.nextActionsTasks))
    expect(ids(s.tasksInView(BuiltIn.inbox))).toEqual([inbox.id])
    expect(ids(s.tasksInView(p.id))).toEqual([borrowed.id])
  })

  it('carries the mirror into the completed tail too', async () => {
    const s = await store()
    const p = project(s)
    const borrowed = task(s, 'project', p.id)
    s.toggleCompleted(borrowed.id)
    expect(ids(s.completedInView(BuiltIn.nextActions))).toEqual([borrowed.id])
    expect(s.completedInView(BuiltIn.inbox)).toEqual([])
  })

  /** The index a drop reports is an index into tasksInView, so moveNextActions
   *  must move exactly that row. */
  it('reorders by the index the drag context reports', async () => {
    const s = await store()
    const p = project(s)
    const a = task(s, 'own A', BuiltIn.nextActions)
    const b = task(s, 'project B', p.id)
    const c = task(s, 'own C', BuiltIn.nextActions)

    const order = ids(s.tasksInView(BuiltIn.nextActions))
    expect(order).toEqual([a.id, b.id, c.id])
    // Drag the mirrored row (index 1) to the top.
    s.moveNextActions([order.indexOf(b.id)], 0)
    expect(ids(s.tasksInView(BuiltIn.nextActions))).toEqual([b.id, a.id, c.id])
  })
})

describe('importing a task list', () => {
  it('lands everything in the Inbox, in file order', async () => {
    const s = await store()
    expect(s.importTasksFromText('1. один\n2. два\n3. три')).toBe(3)
    expect(s.incompleteTasks(BuiltIn.inbox).map((t) => t.title)).toEqual(['один', 'два', 'три'])
  })

  it('ignores the current selection', async () => {
    const s = await store()
    s.setSelection({ kind: 'list', id: BuiltIn.someday })
    s.importTasksFromText('один')
    expect(s.incompleteTasks(BuiltIn.someday)).toEqual([])
    expect(s.incompleteTasks(BuiltIn.inbox).map((t) => t.title)).toEqual(['один'])
  })

  it('appends below existing tasks with unique order slots', async () => {
    const s = await store()
    s.addTask('existing', { kind: 'list', id: BuiltIn.inbox })
    s.importTasksFromText('один\nдва')
    expect(s.incompleteTasks(BuiltIn.inbox).map((t) => t.title)).toEqual(['existing', 'один', 'два'])
    const orders = s.data.tasks.map((t) => t.order)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('creates undated, incomplete tasks', async () => {
    const s = await store()
    s.importTasksFromText('один')
    const t = s.incompleteTasks(BuiltIn.inbox)[0]!
    expect(t.dueDate).toBeNull()
    expect(t.isCompleted).toBe(false)
    expect(t.isTrashed).toBe(false)
    expect(t.listID).toBe(BuiltIn.inbox)
  })

  it('creates nothing from an empty file', async () => {
    const s = await store()
    expect(s.importTasksFromText('\n   \n\t\n')).toBe(0)
    expect(s.data.tasks).toEqual([])
  })

  it('imports duplicate lines as separate tasks', async () => {
    const s = await store()
    expect(s.importTasksFromText('один\nодин')).toBe(2)
  })

  it('shows imported tasks to the Inbox review queue', async () => {
    const s = await store()
    s.importTasksFromText('один\nдва')
    expect(s.inboxReviewQueue().map((t) => t.title)).toEqual(['один', 'два'])
  })
})
