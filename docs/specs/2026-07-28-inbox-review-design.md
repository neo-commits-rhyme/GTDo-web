# GTDo Web — sub-project 4: Inbox Review

**Date:** 2026-07-28 · **Status:** approved design, ready for implementation planning.
**Builds on:** sub-projects 1–3, all shipped.
**Ports from:** `Sources/GTDo/Views/InboxReviewView.swift` — the **macOS** sheet.

Not `ios/GTDoiOS/Support/ReviewFlow.swift`. The iPhone rail adds File…, Make it
a project… and Skip because a thumb needs more escape hatches than a keyboard
does; the Mac sheet is three buttons and a number key. The first draft of this
port used the iPhone table by mistake and shipped two buttons whose labels
ended in an ellipsis and opened nothing.

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

| Step | Choices, in button order |
|---|---|
| `root` | Defer, Next Actions, Projects |
| `defer` | Delete, Someday, Notes |
| `nextActions` | Do It, Delegate It |
| `doIt` | Set deadline & move to Next Actions |
| `delegate` | Set deadline & move to Waiting For |

**Projects converts immediately** — there is no naming or confirmation step.

**Delete carries key 1 in the Defer step**, unlike the iPhone, and that is
correct rather than an oversight: it moves the task to Trash rather than
destroying it, and pressing 1 on a labelled button is not the reflex the iPhone
swipe rule guards against.

Every step has at most three choices, which is what keeps the keys single
digits.

**A step advance is not terminal.** Going root → nextActions is the same task
with a new question; only a choice that removes the card from the queue is
terminal. Both cannot be true of one action, and the classification is a pure
function so it cannot drift.

## 3. The frozen queue

The queue is seeded **once** when Review opens and is never recomputed. The
Swift carries the reason and it applies unchanged: the view re-evaluates on
every store mutation, and re-passing a freshly computed, now-smaller queue
corrupts the position.

The position is an index into that frozen list, and the readout is
`position of total` where `total` is the count captured at open. There is no
Skip on the Mac, so nothing can make an index-based counter lie.

## 4. Presentation

A modal over the app showing the current task's title and note, the current
step's choices as buttons, and a progress readout.

- **Keys:** `1`/`2`/`3` in button order, `Esc` for back — and at the root, `Esc`
  leaves Review. The Back button is therefore pointer-only, so Esc never fires
  both handlers.
- **Sub-project 1's global digit shortcuts are suppressed while Review is
  open.** Otherwise `2` would mean both "Defer" and "go to Calendar".
- Focus moves into the sheet on open and returns to the invoking control on
  close.
- **Entry point:** a *Review* button on the Inbox list, disabled when the Inbox
  is empty.

## 5. Safety

Delete moves the task to Trash, never destroys it, so it is recoverable from
the Trash view as well as from undo.

Every terminal action routes through `UndoCenter.perform` — the one addition
over the Mac, which has no undo here. It costs the flow nothing and makes a
mis-filed task in a fast run a single keystroke to reverse. The undo bar sits
above the sheet's scrim so it stays reachable while Review is still open.

## 6. Testing

- **State machine, pure:** parent per step, terminal classification, rail
  contents and prominence per step, and the direction→choice map.
- **Queue:** the position walks the frozen list, `total` never changes as you
  go, advancing past the end is safe, and the queue is immutable so a stale
  reference cannot corrupt the position.
- **Sheet:** every choice reachable by keyboard, global digit shortcuts
  suppressed while open, focus returns on close, and undo available after each
  terminal action.
- **All 432 existing tests keep passing.**

## 7. Out of scope

Reminders and PWA (sub-project 5). The shortcut editor is deliberately not
ported — see §1.

## 8. Success criteria

1. A full Inbox can be triaged without touching the pointer.
2. The rail matches the macOS sheet at every step.
3. The count is frozen at open and never changes mid-review.
4. Every terminal action is undoable, including from inside the sheet.
5. All 432 existing tests still pass.
