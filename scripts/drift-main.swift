// Concatenated AFTER the real Models.swift from a pinned GTDo checkout, so the
// types below are the macOS app's own — not a copy that could drift.
//
//   cat gtdo/Sources/GTDo/Models/Models.swift scripts/drift-main.swift > check.swift
//   npx tsx scripts/emit-fixture.ts | swift check.swift

import Foundation

let driftInput = FileHandle.standardInput.readDataToEndOfFile()
guard !driftInput.isEmpty else {
    FileHandle.standardError.write("drift-check: no input on stdin\n".data(using: .utf8)!)
    exit(2)
}

let driftDecoder = JSONDecoder()
driftDecoder.dateDecodingStrategy = .iso8601

let driftData: AppData
do {
    driftData = try driftDecoder.decode(AppData.self, from: driftInput)
} catch {
    FileHandle.standardError.write(
        "drift-check: the macOS app's decoder REJECTED TypeScript output — \(error)\n"
            .data(using: .utf8)!)
    exit(1)
}

let driftEncoder = JSONEncoder()
driftEncoder.dateEncodingStrategy = .iso8601
driftEncoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let driftReencoded = try driftEncoder.encode(driftData)

if driftReencoded == driftInput {
    print("drift-check: OK — \(driftData.tasks.count) tasks, \(driftData.lists.count) lists, byte-identical")
    exit(0)
}

FileHandle.standardError.write("""
drift-check: decoded fine but re-encoded DIFFERENTLY (\(driftInput.count) in, \(driftReencoded.count) out).
The TypeScript encoder and the macOS app disagree about the wire format.
--- macOS output ---
\(String(decoding: driftReencoded, as: UTF8.self))
""".data(using: .utf8)!)
exit(1)
