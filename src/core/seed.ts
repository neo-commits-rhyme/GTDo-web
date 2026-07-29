/**
 * Deterministic demo dataset spanning ~3 months around a reference date.
 * Port of Sources/GTDo/Store/SampleData.swift.
 *
 * The container IDs are fixed so the set is reproducible across calls and
 * across the two apps. Task IDs are derived from the row index for the same
 * reason — a random id would make the sample data untestable.
 */

import { startOfDay } from './calendar'
import { BuiltIn, seededAppData, type AppData, type RepeatRule, type TaskItem } from './models'

export const SampleIDs = {
  workList: '5A409E00-0000-0000-0000-000000000001',
  homeList: '5A409E00-0000-0000-0000-000000000002',
  areasGroup: '5A409E00-0000-0000-0000-0000000000A1',
  readingList: '5A409E00-0000-0000-0000-000000000003',
  siteProject: '5A409E00-0000-0000-0000-0000000000B1',
} as const

type Row = {
  title: string
  listID: string
  due?: number
  completed?: number
  trashed?: boolean
  reminder?: number
  repeat?: RepeatRule
}

const weekly: RepeatRule = { unit: 'week', interval: 1 }
const weekdays: RepeatRule = { unit: 'weekday', interval: 1 }
const monthly: RepeatRule = { unit: 'month', interval: 1 }

const ROWS: Row[] = [
  { title: 'Pay electricity bill', listID: BuiltIn.inbox, due: -40, completed: -39 },
  { title: 'Renew gym membership', listID: SampleIDs.homeList, due: -35, completed: -33 },
  { title: 'Submit Q2 expense report', listID: SampleIDs.workList, due: -28, completed: -27 },
  { title: 'Book dentist appointment', listID: BuiltIn.nextActions, due: -21 },
  { title: 'Reply to landlord email', listID: BuiltIn.waitingFor, due: -18 },
  { title: "Read 'The Pragmatic Programmer'", listID: SampleIDs.readingList },
  { title: 'Fix leaking kitchen tap', listID: SampleIDs.homeList, due: -12, completed: -10 },
  { title: 'Draft blog post on GTD', listID: SampleIDs.workList, due: -9 },
  { title: 'Order new running shoes', listID: BuiltIn.inbox, due: -6, completed: -5 },
  { title: 'Water the plants', listID: SampleIDs.homeList, due: -3, repeat: weekly },
  { title: 'Call mom', listID: BuiltIn.nextActions, due: -1, repeat: weekly },
  { title: 'Stand-up meeting notes', listID: SampleIDs.workList, due: 0, reminder: 0, repeat: weekdays },
  { title: 'Review pull requests', listID: SampleIDs.workList, due: 0 },
  { title: 'Buy groceries', listID: SampleIDs.homeList, due: 0 },
  { title: 'Finish tax paperwork', listID: BuiltIn.inbox, due: 1, reminder: 1 },
  { title: 'Team retro', listID: SampleIDs.workList, due: 2 },
  { title: 'Dentist appointment', listID: BuiltIn.nextActions, due: 3, reminder: 3 },
  { title: 'Weekend hike prep', listID: SampleIDs.homeList, due: 4 },
  { title: 'Wait for invoice from vendor', listID: BuiltIn.waitingFor, due: 5 },
  { title: 'Read chapter 5', listID: SampleIDs.readingList, due: 6 },
  { title: 'Plan sprint', listID: SampleIDs.workList, due: 7 },
  { title: 'Monthly budget review', listID: BuiltIn.inbox, due: 12, repeat: monthly },
  { title: 'Car service', listID: SampleIDs.homeList, due: 18 },
  { title: 'Conference talk proposal', listID: SampleIDs.workList, due: 24, reminder: 23 },
  { title: 'Renew passport', listID: BuiltIn.someday },
  { title: 'Learn watercolor painting', listID: BuiltIn.someday },
  { title: 'Idea: side project app', listID: BuiltIn.notes },
  { title: 'Books to gift', listID: BuiltIn.notes },
  { title: 'Wireframe home page', listID: SampleIDs.siteProject, due: 8 },
  { title: 'Pick color palette', listID: SampleIDs.siteProject, due: 10 },
  { title: 'Set up analytics', listID: SampleIDs.siteProject, due: 15 },
  { title: 'Old cancelled task', listID: BuiltIn.inbox, trashed: true },
  { title: 'Duplicate note', listID: BuiltIn.notes, trashed: true },
  { title: 'Quarterly OKR planning', listID: SampleIDs.workList, due: 40 },
  { title: 'Spring cleaning', listID: SampleIDs.homeList, due: 38 },
  { title: 'Finish reading list', listID: SampleIDs.readingList, due: 42 },
]

export function makeSampleData(reference: Date): AppData {
  const data = seededAppData()
  const today = startOfDay(reference)

  const day = (offset: number, hour = 9): Date => {
    const d = new Date(today)
    d.setDate(d.getDate() + offset)
    d.setHours(hour, 0, 0, 0)
    return d
  }

  data.groups.push({ id: SampleIDs.areasGroup, name: 'Areas', isBuiltIn: false, order: 1 })
  data.lists.push(
    { id: SampleIDs.workList, name: 'Work', isBuiltIn: false, groupID: SampleIDs.areasGroup, order: 10, colorHex: '#007AFF', symbol: 'briefcase', completedAt: null },
    { id: SampleIDs.homeList, name: 'Home', isBuiltIn: false, groupID: SampleIDs.areasGroup, order: 11, colorHex: '#34C759', symbol: 'house', completedAt: null },
    { id: SampleIDs.readingList, name: 'Reading', isBuiltIn: false, groupID: null, order: 12, colorHex: '#AF52DE', symbol: 'book', completedAt: null },
    { id: SampleIDs.siteProject, name: 'Website redesign', isBuiltIn: false, groupID: BuiltIn.projectsGroup, order: 13, colorHex: '#FF9500', symbol: 'flame', completedAt: null },
  )

  ROWS.forEach((r, i) => {
    const task: TaskItem = {
      // Derived from the index so the dataset is byte-reproducible.
      id: `5A409E00-1111-0000-0000-${String(i).padStart(12, '0')}`,
      title: r.title,
      note: '',
      dueDate: r.due === undefined ? null : day(r.due),
      reminderDate: r.reminder === undefined ? null : day(r.reminder, 10),
      listID: r.listID,
      isCompleted: r.completed !== undefined,
      completedAt: r.completed === undefined ? null : day(r.completed, 17),
      isTrashed: r.trashed === true,
      createdAt: day(-45 + i),
      order: i + 1,
      repeatRule: r.repeat ?? null,
      trashedAt: r.trashed === true ? day(-2) : null,
    }
    data.tasks.push(task)
  })

  return data
}
