#!/usr/bin/env swift
//
// The answer to the separate-repo risk.
//
// Reads a TypeScript-produced data.json on stdin, decodes it with the REAL
// Models.swift from a pinned GTDo checkout, re-encodes it with the same
// encoder configuration Persistence.swift uses, and fails when the bytes
// differ. A silent divergence between the two models would otherwise only be
// discovered by a user whose data file got moved aside as undecodable.
//
//   npx tsx scripts/emit-fixture.ts | swift scripts/drift-check.swift
//
// Model declarations are read from the checkout by the CI job, which
// concatenates Models.swift ahead of this file. When run standalone the
// structs below are used instead — keep them in sync or, better, run it the
// way CI does.

import Foundation

struct RepeatRule: Codable, Equatable {
    enum Unit: String, Codable { case day, weekday, week, month, year }
    var unit: Unit
    var interval: Int
}

struct TaskItem: Codable {
    var id: UUID; var title: String; var note: String
    var dueDate: Date?; var reminderDate: Date?; var listID: UUID
    var isCompleted: Bool; var completedAt: Date?; var isTrashed: Bool
    var createdAt: Date; var order: Int; var repeatRule: RepeatRule?; var trashedAt: Date?
}

struct TaskList: Codable {
    var id: UUID; var name: String; var isBuiltIn: Bool
    var groupID: UUID?; var order: Int; var colorHex: String?; var symbol: String?
}

struct ListGroup: Codable { var id: UUID; var name: String; var isBuiltIn: Bool; var order: Int }

struct AppData: Codable {
    var tasks: [TaskItem]; var lists: [TaskList]; var groups: [ListGroup]
    var gtdOrder: [UUID]?; var userOrder: [UUID]?
}

let raw = FileHandle.standardInput.readDataToEndOfFile()
guard !raw.isEmpty else {
    FileHandle.standardError.write("drift-check: no input on stdin\n".data(using: .utf8)!)
    exit(2)
}

let decoder = JSONDecoder()
decoder.dateDecodingStrategy = .iso8601

let data: AppData
do {
    data = try decoder.decode(AppData.self, from: raw)
} catch {
    FileHandle.standardError.write(
        "drift-check: the Swift decoder REJECTED TypeScript output — \(error)\n".data(using: .utf8)!)
    exit(1)
}

let encoder = JSONEncoder()
encoder.dateEncodingStrategy = .iso8601
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let reencoded = try encoder.encode(data)

if reencoded == raw {
    print("drift-check: OK — \(data.tasks.count) tasks, \(data.lists.count) lists, byte-identical")
    exit(0)
}

FileHandle.standardError.write("""
drift-check: decoded fine but re-encoded DIFFERENTLY (\(raw.count) in, \(reencoded.count) out).
The TypeScript encoder and Foundation disagree about the wire format.
--- Swift output ---
\(String(decoding: reencoded, as: UTF8.self))
""".data(using: .utf8)!)
exit(1)
