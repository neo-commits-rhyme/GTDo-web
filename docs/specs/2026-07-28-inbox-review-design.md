# GTDo Web — sub-project 4: Inbox Review

**Date:** 2026-07-28 · **Status:** approved design, ready for implementation planning.
**Builds on:** sub-projects 1–3, all shipped.
**Ports from:** `Sources/GTDo/Views/InboxReviewView.swift` and
`ios/GTDoiOS/Support/ReviewFlow.swift`.

A card-at-a-time pass over the Inbox: one task, one question, until the Inbox is
empty. The store half is already ported and tested — `inboxReviewQueue`,
`reviewDoIt`, `reviewDelegate` shipped in sub-project 1 — so this is the flow
and its presentation.

## 1. Decisions

1. **The macOS model: a modal sheet, keyboard-first.** Not the iPhone card with
   throw gestures. That card exists because triage on a phone happens in gaps,
   where a thumb is all you have; on the web the same session happens at a desk,
   and sub-project 3 already established that a pointer drag means *drag*.
2. **Fixed positional keys**, no editor. `1`/`2`/`3` in button order per step,
   `Esc` for back. The macOS editor exists because that app has no other
   keyboard surface competing for those keys; here the defaults are unambiguous.
   Same reasoning that dropped the six swipe contexts in sub-project 3.

## 2. The state machine

Ported from `ReviewStep`:

```
root ──▶ nextActions ──▶ doIt
 │                   └─▶ delegate
 └─────▶ defer
```

Back lands one step closer to the root. **At the root there is no back button**,
rather than a disabled one.

| Step | Choices, prominent first |
|---|---|
| `root` | **Next actions**, Defer, File…, Make it a project…, Skip |
| `defer` | **Someday**, Notes, Delete |
| `nextActions` | **Do It**, Delegate It |
| `doIt` | **Set deadline & move to Next actions** |
| `delegate` | **Set deadline & move to Waiting for** |

Exactly one prominent choice per step, always the highest-frequency one — the
macOS `1`/`2`/`3` ordering surviving as visual weight rather than keycaps.

**A step advance is not terminal.** Going root → nextActions is the same task
with a new question; only a choice that removes the card from the queue is
terminal. Both cannot be true of one action, and the classification is a pure
function so it cannot drift.

## 3. The frozen queue

The queue is seeded **once** when Review opens and is never recomputed. The
Swift carries the reason and it applies unchanged: the view re-evaluates on
every store mutation, and re-passing a freshly computed, now-smaller queue
corrupts the position.

**Skip rotates rather than consumes.** The progress counter therefore reads off
a `processed` count, never off an index — an index would make the counter lie
the moment anything is skipped.

A task that vanishes mid-review — deleted in another tab, or by an undo — is
dropped from the queue rather than crashing the sheet.

## 4. Presentation

A modal over the app showing the current task's title and note, the current
step's choices as buttons, and a progress readout.

- **Keys:** `1`/`2`/`3` in button order, `Esc` for back — and at the root, `Esc`
  leaves Review.
- **Sub-project 1's global digit shortcuts are suppressed while Review is
  open.** Otherwise `2` would mean both "Defer" and "go to Calendar".
- Focus moves into the sheet on open and returns to the invoking control on
  close.
- **Entry point:** a *Review* button on the Inbox list, disabled when the Inbox
  is empty.

## 5. Safety

**Delete, File… and Make it a project… are reachable only by an explicit click
or their own key — never by any accelerator.** Ported from the iOS rule: a
reflex must not reach an unconfirmed delete, and the two pickers need a decision
no gesture can express.

Every terminal action routes through `UndoCenter.perform`, so a mis-filed task
in a fast run costs one keystroke rather than a hunt through the trash.

## 6. Testing

- **State machine, pure:** parent per step, terminal classification, rail
  contents and prominence per step, and the direction→choice map.
- **Queue:** Skip rotates without incrementing `processed`; the counter survives
  a skip; a vanished task is dropped, not fatal; `total` stays stable.
- **Sheet:** every choice reachable by keyboard, global digit shortcuts
  suppressed while open, focus returns on close, and undo available after each
  terminal action.
- **All 432 existing tests keep passing.**

## 7. Out of scope

Reminders and PWA (sub-project 5). The shortcut editor is deliberately not
ported — see §1.

## 8. Success criteria

1. A full Inbox can be triaged without touching the pointer.
2. Skip does not corrupt the progress counter.
3. Delete is unreachable by any accelerator.
4. Every terminal action is undoable.
5. All 432 existing tests still pass.
