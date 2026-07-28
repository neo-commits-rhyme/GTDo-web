/**
 * Emits a TypeScript-authored data.json on stdout for the drift CI job to feed
 * to the real Swift decoder. Exercises every optional and all five repeat units.
 */
import { encodeAppData } from '../src/core/codec'
import { BuiltIn, type RepeatUnit } from '../src/core/models'
import { makeSampleData } from '../src/core/seed'

const units: RepeatUnit[] = ['day', 'weekday', 'week', 'month', 'year']
const data = makeSampleData(new Date(Date.UTC(2026, 6, 28, 9, 0, 0)))

// A bare task (every optional absent) and one carrying every optional, plus a
// title and note containing the characters Foundation escapes.
data.tasks.push({
  id: 'AAAAAAAA-1111-2222-3333-444444444444',
  title: 'bare/slashed "title"', note: '',
  dueDate: null, reminderDate: null, listID: BuiltIn.inbox,
  isCompleted: false, completedAt: null, isTrashed: false,
  createdAt: new Date(Date.UTC(2026, 6, 28, 9, 0, 0)), order: 900,
  repeatRule: null, trashedAt: null,
})
units.forEach((unit, i) => {
  data.tasks.push({
    id: `BBBBBBBB-1111-2222-3333-${String(i).padStart(12, '0')}`,
    title: `repeats ${unit}`, note: 'note with / slash and "quote"',
    dueDate: new Date(Date.UTC(2026, 7, 1 + i, 12, 0, 0)),
    reminderDate: new Date(Date.UTC(2026, 7, 1 + i, 8, 0, 0)),
    listID: BuiltIn.nextActions,
    isCompleted: true, completedAt: new Date(Date.UTC(2026, 6, 30, 17, 0, 0)),
    isTrashed: true, trashedAt: new Date(Date.UTC(2026, 6, 29, 9, 0, 0)),
    createdAt: new Date(Date.UTC(2026, 6, 28, 9, 0, 0)), order: 910 + i,
    repeatRule: { unit, interval: i + 1 },
  })
})
data.gtdOrder = [BuiltIn.nextActions, BuiltIn.waitingFor, BuiltIn.someday, BuiltIn.notes]
data.userOrder = null

process.stdout.write(encodeAppData(data))
