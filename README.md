# GTDo for the web

A GTD task manager that runs entirely in your browser. Microsoft To Do layout,
GTD lists, no account and no server.

**→ https://neo-commits-rhyme.github.io/GTDo-web/**

This is a web port of [GTDo](https://github.com/neo-commits-rhyme/GTDo), a macOS
and iPhone app. It reads and writes the same `data.json`, so you can move your
tasks between them.

## Your data stays in your browser

There is no backend. Nothing is uploaded, and nobody — including whoever
publishes this page — can see your tasks. They live in your browser's IndexedDB.

Two consequences worth knowing before you rely on it:

- **Clearing site data deletes your tasks.** So does a browser that decides to
  reclaim space. The app asks for persistent storage on first save, but Chrome
  and Safari both deny that request in an unengaged context, and it is not a
  guarantee anywhere. **Export regularly.**
- **Safari evicts script-writable storage after 7 days of not visiting the
  site.** If GTDo is not part of your routine, export before you step away.

The app keeps rotating snapshots (the 20 most recent, plus the first of each of
the last 30 days) in the same browser, restorable from Settings. Those help with
a mistake; they do not help with a cleared browser. Export does.

## Moving data to and from the macOS app

Settings → **Export data.json** produces exactly the file the macOS app reads.
Drop it at `~/Library/Application Support/GTDo/data.json` and it opens there.
Settings → **Import data.json** goes the other way.

The format compatibility is not a hope — CI decodes this app's output using the
macOS app's own `Models.swift` on every push and fails if the two ever
disagree — 42 tasks, 9 lists, byte-identical in both directions.

## Layout

- **Today / Calendar / Completed / Trash** — computed smart views.
- **Inbox** — default list; tasks added from Today or Calendar land here, due today.
- **Next actions / Waiting for... / Someday / Notes** — the built-in GTD lists.
  Moving a task into *Next actions* or *Waiting for...* asks for a deadline first;
  moving into *Someday* deliberately strips the deadline and any repeat.
- **Projects** — a built-in group. "Convert to project" turns a task into a list
  and moves the task into it, keeping every field.
- Recurring tasks: set Repeat in the detail pane. Completing one spawns the next
  occurrence, skipping any that were missed rather than spawning into the past.
- Completing a task holds its row in place for half a second, so running down a
  column of checkboxes never reflows under your cursor.

## Keyboard

| Key | Action |
|---|---|
| `n` | New task |
| `/` or `f` | Search |
| `1` / `2` / `3` | Today / Calendar / Inbox |
| `Delete` | Move selected task to trash |
| `[` / `]` | Move selected task up / down in its list |
| `,` | Settings |
| `Escape` | Close detail, then clear search |

These are bare keys, not `⌘`-chords like the macOS app. Browsers own `⌘N`,
`⌘F` and `⌘,` — on Windows and Linux unavoidably so. See
[`docs/assumptions.md`](docs/assumptions.md) for what was measured.

## Appearance

Settings carries **System / Light / Dark** and seven accent colours, both stored
in this browser. Lists can be given one of twelve colours and sixteen icons —
the same twelve hexes and sixteen symbol names the macOS app uses, so a list
customised here opens there looking the same.

Completing a task plays a short synthesised tone, which you can turn off.
`prefers-reduced-motion` removes every spring and scale transform.

## Drag, swipe and undo

Drag a task by its handle to reorder it, or onto a list in the sidebar to file
it there — dropping onto *Next actions* or *Waiting for…* asks for a deadline
first. Sidebar entries reorder the same way.

**Everything reachable by drag is reachable by keyboard.** `[` and `]` move the
selected task, and the sidebar's ↑/↓ buttons reorder lists. Drag is an
accelerator over those, never a replacement.

On touch, swipe right to complete and left to trash. Neither is offered in
Completed or Trash: the only commits there are un-complete, already one tap,
and permanent deletion — and a reflex must never do something unrecoverable.

Anything reversible offers an undo for eight seconds, and `⌘Z` / `Ctrl+Z` works
for that whole window so you never have to catch a disappearing button.

## Inbox Review

**Review** on the Inbox walks your captured items one at a time: Next actions,
Defer, File, make it a project, or Skip — then a second question, then the next
task. `1`/`2`/`3` pick the current step's choices, `Esc` goes back a step and
leaves at the top. A whole inbox can be triaged without the pointer.

Skip sends a task to the back of the queue rather than counting it as done, so
the progress readout stays honest. Delete, File and *Make it a project* have no
shortcut: a reflex should not reach an unconfirmed delete, and the two pickers
need a decision no keystroke can express. Every action is undoable.

## Not here yet

Sub-projects 1–4 of five. Still to come: reminders plus offline install (5).
Reminders will always be weaker than the macOS app's — a web page cannot wake
itself up without a push server, and this one deliberately has no server.

## Development

```bash
npm install
npm test          # 471 unit tests
npm run dev
npm run build
```

- `src/core/` — pure TypeScript, ported from the macOS app's `Models/` and
  `Store/`. No React, no DOM, no storage, no ambient clock. A lint rule enforces
  it.
- `src/storage/` — IndexedDB, plus memory and always-failing adapters for tests.
- `src/app/` — the React shell.
- `src/app/theme/` — colour tokens, and the contrast suite that guards them. No
  stylesheet outside `theme/` may name a colour; a test enforces it.

`npm run probe` re-runs the browser measurements behind `docs/assumptions.md`.

## Licence

MIT — see [LICENSE](LICENSE).
