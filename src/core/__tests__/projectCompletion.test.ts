/**
 * Ports ProjectCompletionTests.swift — completing a project closes the list and
 * everything still open in it. Same cases as macOS, so a divergence between the
 * two apps surfaces as a failing test rather than as data that behaves
 * differently on each side.
 */

import { describe, expect, it } from 'vitest'
import { AppStore } from '../store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { atNoon } from '../calendar'
import { BuiltIn, type TaskItem, type TaskList } from '../models'

const DUE = atNoon(new Date(2026, 6, 25))

/** A store whose clock can be moved, so two completions get distinct stamps. */
function clockedStore(): { store: Promise<AppStore>; setNow: (d: Date) => void } {
  let now = new Date(2026, 6, 21, 9, 0, 0)
  return {
    store: AppStore.create({
      adapter: new MemoryAdapter(), now: () => now, scheduler: (_m, f) => f(),
    }),
    setNow: (d: Date) => { now = d },
  }
}

const store = async () => (await clockedStore().store)

function project(s: AppStore, name = 'Website'): TaskList {
  return s.addList(name, BuiltIn.projectsGroup)!
}

function task(s: AppStore, title: string, listID: string, due: Date | null = null): TaskItem {
  const created = s.addTask(title, { kind: 'list', id: listID })!
  if (due !== null) s.setDueDate(created.id, due)
  return s.task(created.id)!
}

const ids = <T extends { id: string }>(xs: T[]) => xs.map((x) => x.id)

describe('the bulk pass', () => {
  it('completes every open task in the project', async () => {
    const s = await store()
    const p = project(s)
    const a = task(s, 'wireframes', p.id)
    const b = task(s, 'copy', p.id)
    s.completeList(p.id)
    expect(s.task(a.id)?.isCompleted).toBe(true)
    expect(s.task(b.id)?.isCompleted).toBe(true)
    expect(s.list(p.id)?.completedAt).not.toBeNull()
  })

  it('stamps the list and its tasks with one timestamp', async () => {
    const s = await store()
    const p = project(s)
    const a = task(s, 'wireframes', p.id)
    s.completeList(p.id)
    expect(s.task(a.id)?.completedAt?.getTime()).toBe(s.list(p.id)?.completedAt?.getTime())
  })

  it('completes an empty project', async () => {
    const s = await store()
    const p = project(s)
    s.completeList(p.id)
    expect(s.list(p.id)?.completedAt).not.toBeNull()
  })

  it('leaves trashed tasks alone', async () => {
    const s = await store()
    const p = project(s)
    const a = task(s, 'abandoned', p.id)
    s.trashTask(a.id)
    s.completeList(p.id)
    expect(s.task(a.id)?.isCompleted).toBe(false)
  })

  /** Spawning here would finish a project and immediately refill it. */
  it('does not spawn another occurrence of a repeating task', async () => {
    const s = await store()
    const p = project(s)
    const a = task(s, 'weekly report', p.id, DUE)
    s.setRepeatRule(a.id, { unit: 'week', interval: 1 })
    const before = s.data.tasks.length
    s.completeList(p.id)
    expect(s.data.tasks.length).toBe(before)
    // The rule survives, so un-completing restores the task as it was.
    expect(s.task(a.id)?.repeatRule).toEqual({ unit: 'week', interval: 1 })
  })

  it('persists exactly once, so another tab adopts one revision', async () => {
    const s = await store()
    const p = project(s)
    task(s, 'a', p.id)
    task(s, 'b', p.id)
    task(s, 'c', p.id)
    let writes = 0
    s.subscribe(() => { writes += 1 })
    s.completeList(p.id)
    expect(writes).toBe(1)
  })
})

describe('guards', () => {
  it('refuses a built-in list', async () => {
    const s = await store()
    expect(s.canCompleteList(BuiltIn.inbox)).toBe(false)
    s.completeList(BuiltIn.inbox)
    expect(s.list(BuiltIn.inbox)?.completedAt).toBeNull()
  })

  it('refuses an ordinary user list', async () => {
    const s = await store()
    const l = s.addList('Shopping', null)!
    expect(s.canCompleteList(l.id)).toBe(false)
    s.completeList(l.id)
    expect(s.list(l.id)?.completedAt).toBeNull()
  })

  it('refuses a project that is already complete', async () => {
    const s = await store()
    const p = project(s)
    s.completeList(p.id)
    expect(s.canCompleteList(p.id)).toBe(false)
  })

  it('counts the open tasks that drive the confirmation', async () => {
    const s = await store()
    const p = project(s)
    task(s, 'a', p.id)
    task(s, 'b', p.id)
    expect(s.openTaskCount(p.id)).toBe(2)
  })
})

describe('where a completed project shows up', () => {
  it('leaves the Projects section and its count', async () => {
    const s = await store()
    const done = project(s, 'Finished')
    const live = project(s, 'Running')
    s.completeList(done.id)
    expect(ids(s.listsInGroup(BuiltIn.projectsGroup))).toEqual([live.id])
    expect(s.listCount(BuiltIn.projectsGroup)).toBe(1)
  })

  it('lists completed projects newest first', async () => {
    const { store: pending, setNow } = clockedStore()
    const s = await pending
    const first = project(s, 'First')
    const second = project(s, 'Second')
    s.completeList(first.id)
    setNow(new Date(2026, 6, 22, 9, 0, 0))
    s.completeList(second.id)
    expect(ids(s.completedProjects)).toEqual([second.id, first.id])
  })

  it('keeps its tasks out of the Completed view', async () => {
    const s = await store()
    const p = project(s)
    task(s, 'project task', p.id)
    const loose = task(s, 'loose task', BuiltIn.inbox)
    s.toggleCompleted(loose.id)
    s.completeList(p.id)
    expect(ids(s.completedTasks)).toEqual([loose.id])
  })

  it('keeps its tasks out of the Next actions mirror', async () => {
    const s = await store()
    const p = project(s)
    task(s, 'deadlined', p.id, DUE)
    s.completeList(p.id)
    expect(s.nextActionsTasks).toEqual([])
    expect(s.nextActionsCompletedTasks).toEqual([])
  })

  it('still shows its tasks inside the project', async () => {
    const s = await store()
    const p = project(s)
    const a = task(s, 'wireframes', p.id)
    s.completeList(p.id)
    expect(ids(s.completedTasksIn(p.id))).toEqual([a.id])
  })

  it('is no longer a move target', async () => {
    const s = await store()
    const p = project(s)
    s.completeList(p.id)
    expect(s.moveTargets(null).some((l) => l.id === p.id)).toBe(false)
  })

  it('moves the selection off a project as it is completed', async () => {
    const s = await store()
    const p = project(s)
    s.selection = { kind: 'list', id: p.id }
    s.completeList(p.id)
    expect(s.selection).toEqual({ kind: 'smart', view: 'completedProjects' })
  })

  it('leaves a selection elsewhere untouched', async () => {
    const s = await store()
    const p = project(s)
    s.selection = { kind: 'list', id: BuiltIn.inbox }
    s.completeList(p.id)
    expect(s.selection).toEqual({ kind: 'list', id: BuiltIn.inbox })
  })
})

describe('un-completing', () => {
  it('reopens the list and the tasks the bulk closed', async () => {
    const s = await store()
    const p = project(s)
    const a = task(s, 'wireframes', p.id)
    s.completeList(p.id)
    s.uncompleteList(p.id)
    expect(s.list(p.id)?.completedAt).toBeNull()
    expect(s.task(a.id)?.isCompleted).toBe(false)
    expect(ids(s.listsInGroup(BuiltIn.projectsGroup))).toEqual([p.id])
  })

  /** The point of matching on the timestamp: work finished before the project
   *  was closed stays finished. */
  it('leaves tasks completed before the project alone', async () => {
    const { store: pending, setNow } = clockedStore()
    const s = await pending
    const p = project(s)
    const early = task(s, 'done earlier', p.id)
    const late = task(s, 'still open', p.id)
    s.toggleCompleted(early.id)
    setNow(new Date(2026, 6, 22, 9, 0, 0))
    s.completeList(p.id)
    s.uncompleteList(p.id)
    expect(s.task(early.id)?.isCompleted).toBe(true)
    expect(s.task(late.id)?.isCompleted).toBe(false)
  })

  it('does nothing to a live project', async () => {
    const s = await store()
    const p = project(s)
    const a = task(s, 'wireframes', p.id)
    s.uncompleteList(p.id)
    expect(s.task(a.id)?.isCompleted).toBe(false)
    expect(s.list(p.id)?.completedAt).toBeNull()
  })

  it('lands a reopened project at the end of its group', async () => {
    const s = await store()
    const a = project(s, 'A')
    const b = project(s, 'B')
    s.completeList(a.id)
    s.uncompleteList(a.id)
    expect(ids(s.listsInGroup(BuiltIn.projectsGroup))).toEqual([b.id, a.id])
  })

  /** A document that has been through encode/decode holds distinct Date objects
   *  for the same instant, so the receipt compares by time value. */
  it('matches the receipt by time value, not object identity', async () => {
    const s = await store()
    const p = project(s)
    const a = task(s, 'wireframes', p.id)
    s.completeList(p.id)
    const stamp = s.list(p.id)!.completedAt!
    const i = s.data.tasks.findIndex((t) => t.id === a.id)
    s.data.tasks[i]!.completedAt = new Date(stamp.getTime())
    s.uncompleteList(p.id)
    expect(s.task(a.id)?.isCompleted).toBe(false)
  })
})
