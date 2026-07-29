#!/usr/bin/env swift
//
// Generates fixtures/macos-data.json using the SAME Codable declarations and
// the SAME encoder configuration as the macOS app
// (../GTDo/Sources/GTDo/Models/Models.swift and Store/Persistence.swift:73-78).
//
// The data is synthetic on purpose. The user's real data.json must never enter
// this repository — the fixture's job is to pin the wire FORMAT, and synthetic
// input exercises it harder than real input does (every optional populated,
// all five repeat units, slashes and quotes in strings).
//
//   swift scripts/make-fixture.swift
//
// Re-run after any change to Models.swift in the GTDo repo; the drift CI job
// exists to notice when that happens.

import Foundation

struct RepeatRule: Codable {
    enum Unit: String, Codable { case day, weekday, week, month, year }
    var unit: Unit
    var interval: Int
}

struct TaskItem: Codable {
    var id: UUID
    var title: String
    var note: String = ""
    var dueDate: Date? = nil
    var reminderDate: Date? = nil
    var listID: UUID
    var isCompleted: Bool = false
    var completedAt: Date? = nil
    var isTrashed: Bool = false
    var createdAt: Date
    var order: Int = 0
    var repeatRule: RepeatRule? = nil
    var trashedAt: Date? = nil
}

struct TaskList: Codable {
    var id: UUID
    var name: String
    var isBuiltIn: Bool = false
    var groupID: UUID? = nil
    var order: Int = 0
    var colorHex: String? = nil
    var symbol: String? = nil
    var completedAt: Date? = nil
}

struct ListGroup: Codable {
    var id: UUID
    var name: String
    var isBuiltIn: Bool = false
    var order: Int = 0
}

struct AppData: Codable {
    var tasks: [TaskItem] = []
    var lists: [TaskList] = []
    var groups: [ListGroup] = []
    var gtdOrder: [UUID]? = nil
    var userOrder: [UUID]? = nil
}

let inbox = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
let nextActions = UUID(uuidString: "00000000-0000-0000-0000-000000000002")!
let waitingFor = UUID(uuidString: "00000000-0000-0000-0000-000000000003")!
let someday = UUID(uuidString: "00000000-0000-0000-0000-000000000004")!
let notes = UUID(uuidString: "00000000-0000-0000-0000-000000000005")!
let projects = UUID(uuidString: "00000000-0000-0000-0000-0000000000AA")!
let work = UUID(uuidString: "11111111-2222-3333-4444-555555555555")!
let areas = UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")!
let doneProject = UUID(uuidString: "CCCCCCCC-1111-2222-3333-444444444444")!
let liveProject = UUID(uuidString: "DDDDDDDD-1111-2222-3333-444444444444")!

// Whole seconds only: .iso8601 writes no fractional part, so a fractional date
// would not survive the round trip and the byte-identity test would be wrong
// about why it failed.
let t0 = Date(timeIntervalSince1970: 1_700_000_000)   // 2023-11-14T22:13:20Z
func at(_ offsetDays: Int) -> Date { t0.addingTimeInterval(Double(offsetDays) * 86_400) }

var tasks: [TaskItem] = [
    // Every optional absent — proves nil optionals are omitted, not nulled.
    TaskItem(id: UUID(uuidString: "00000000-0000-0000-0000-00000000000B")!,
             title: "bare/slashed title", listID: inbox, createdAt: t0),
    // Every optional present, plus quotes and slashes in free text.
    TaskItem(id: UUID(uuidString: "DEADBEEF-0000-0000-0000-00000000FFFF")!,
             title: "full", note: "note with / slash and \"quote\"",
             dueDate: at(1), reminderDate: at(2), listID: work,
             isCompleted: true, completedAt: at(3), isTrashed: true,
             createdAt: t0, order: 7,
             repeatRule: RepeatRule(unit: .weekday, interval: 3), trashedAt: at(4)),
]

// One task per repeat unit, so every enum raw value appears in the fixture.
for (i, unit) in [RepeatRule.Unit.day, .weekday, .week, .month, .year].enumerated() {
    tasks.append(TaskItem(
        id: UUID(uuidString: "0000000\(i)-1111-2222-3333-444444444444")!,
        title: "repeats \(unit.rawValue)", note: "", dueDate: at(i + 1),
        listID: nextActions, createdAt: t0, order: 10 + i,
        repeatRule: RepeatRule(unit: unit, interval: i + 1)))
}

let data = AppData(
    tasks: tasks,
    lists: [
        TaskList(id: inbox, name: "Inbox", isBuiltIn: true, order: 0),
        TaskList(id: nextActions, name: "Next actions", isBuiltIn: true, order: 1),
        TaskList(id: waitingFor, name: "Waiting for...", isBuiltIn: true, order: 2),
        TaskList(id: someday, name: "Someday", isBuiltIn: true, order: 3),
        TaskList(id: notes, name: "Notes", isBuiltIn: true, order: 4),
        // A user list carrying every customization field.
        TaskList(id: work, name: "Work/Home", isBuiltIn: false, groupID: areas,
                 order: 5, colorHex: "#FF8800", symbol: "star.fill"),
        // A finished project, so the fixture pins where completedAt lands in a
        // sorted-keys encode — and a live one beside it, so the omitted case is
        // pinned too.
        TaskList(id: doneProject, name: "Kitchen remodel", isBuiltIn: false,
                 groupID: projects, order: 6,
                 completedAt: Date(timeIntervalSince1970: 1_785_000_000)),
        TaskList(id: liveProject, name: "Site redesign", isBuiltIn: false,
                 groupID: projects, order: 7),
    ],
    groups: [
        ListGroup(id: projects, name: "Projects", isBuiltIn: true, order: 0),
        ListGroup(id: areas, name: "Areas", isBuiltIn: false, order: 1),
    ],
    gtdOrder: [nextActions, waitingFor, someday, notes, projects],
    userOrder: [areas, work])

let encoder = JSONEncoder()
encoder.dateEncodingStrategy = .iso8601
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

let bytes = try encoder.encode(data)
let out = URL(fileURLWithPath: "fixtures/macos-data.json")
try FileManager.default.createDirectory(
    at: out.deletingLastPathComponent(), withIntermediateDirectories: true)
try bytes.write(to: out)

// Prove the round trip holds on the Swift side before we ask TypeScript to match it.
let decoder = JSONDecoder()
decoder.dateDecodingStrategy = .iso8601
let reencoded = try encoder.encode(try decoder.decode(AppData.self, from: bytes))
precondition(reencoded == bytes, "Swift itself does not round-trip this fixture")

FileHandle.standardError.write(
    "wrote \(out.path) — \(bytes.count) bytes, \(data.tasks.count) tasks\n".data(using: .utf8)!)
