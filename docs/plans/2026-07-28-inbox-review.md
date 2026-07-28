# GTDo Web — Inbox Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triage a full Inbox one task at a time, without touching the pointer.

**Architecture:** The flow is a pure state machine and a frozen queue in `core/`, with no React anywhere near it. The sheet is a thin renderer over both, and every terminal action routes through the undo centre built in sub-project 3.

**Tech Stack:** TypeScript, React, Vitest + Testing Library, Playwright.

**Spec:** `docs/specs/2026-07-28-inbox-review-design.md`. Read §3 before touching the queue.

## Global Constraints

- **No behaviour changes.** All 432 tests from sub-projects 1–3 must still pass.
- **The queue is frozen at open.** Never recompute it from the store mid-review — that corrupts the position.
- **Skip rotates, never consumes**, and the counter reads off `processed`, never an index.
- **Delete, File… and Make it a project… are unreachable by any accelerator.** Explicit click or their own key only.
- **Every terminal action goes through `UndoCenter.perform`.**
- **Global digit shortcuts are suppressed while Review is open.**
- Colours from tokens; the no-colour-literals test from sub-project 2 still applies.
- Conventional commits, one per task.

---

### Task 1: The flow, as pure logic

**Files:**
- Create: `src/core/review.ts`
- Test: `src/core/__tests__/review.test.ts`
- Reference: `../GTDo/ios/GTDoiOS/Support/ReviewFlow.swift`

**Interfaces:**
- Produces: `type ReviewStep = 'root' | 'defer' | 'nextActions' | 'doIt' | 'delegate'`, `type ReviewChoice`, `parentStep(step): ReviewStep | null`, `isTerminal(choice): boolean`, `stepTarget(choice): ReviewStep | null`, `railFor(step): ReviewRailItem[]`, `class ReviewQueue { current; total; processed; isFinished; consume(); rotate(); drop(id) }`

- [ ] **Step 1: Write the failing test**

Cover, at minimum: `parentStep` for all five steps including root's `null`; `isTerminal` true for exactly the terminal choices and false for the four step advances plus back; one rail per step with exactly one prominent item; delete marked destructive; `ReviewQueue.rotate()` moving the head to the back **without** incrementing `processed`; `consume()` incrementing it; `total` stable across a rotate; `drop(id)` removing a vanished task; and `isFinished` only when nothing pends.

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run src/core/__tests__/review.test.ts`, expect FAIL.
- [ ] **Step 3: Implement `src/core/review.ts`**, porting the step/choice/rail tables verbatim and carrying the comments that say why Skip rotates and why the queue is frozen.
- [ ] **Step 4: Run it to verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add src/core/review.ts src/core/__tests__/review.test.ts
git commit -m "feat: Inbox Review as a pure state machine and a frozen queue"
```

---

### Task 2: The sheet

**Files:**
- Create: `src/app/review/ReviewSheet.tsx`, `src/app/review/useReview.ts`
- Modify: `src/app/TaskList.tsx` (the Review entry point), `src/app/useShortcuts.ts`, `src/app/styles.css`
- Test: `src/app/review/__tests__/reviewSheet.test.tsx`

- [ ] **Step 1: Write the failing test**

Cover: the Review button appears on Inbox and is disabled when empty; opening freezes the queue; `1`/`2`/`3` activate the step's choices in button order; `Esc` goes back a step and leaves at the root; the progress readout survives a Skip; global digit shortcuts do nothing while the sheet is open; focus returns to the Review button on close; each terminal action is undoable; and Delete has no accelerator binding.

- [ ] **Step 2: Run it to verify it fails.**
- [ ] **Step 3: Implement.** `useReview` owns the step and the frozen queue; `ReviewSheet` renders the rail and handles keys. Terminal choices call the store through `UndoCenter.perform`.
- [ ] **Step 4: Run it to verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add src/app/review src/app/TaskList.tsx src/app/useShortcuts.ts src/app/styles.css
git commit -m "feat: keyboard-first Inbox Review sheet"
```

---

### Task 3: Verify and ship

- [ ] **Step 1: Add the E2E** — triage an Inbox of three tasks to empty using only the keyboard.
- [ ] **Step 2: Run everything** — `npx tsc --noEmit && npx eslint . && npx vitest run && npx vite build && npx playwright test`.
- [ ] **Step 3: Look at the running app.** Run a real triage pass. Every sub-project so far has had at least one bug that only appeared this way.
- [ ] **Step 4: Update the README**, then commit and push.

---

## Verification against the spec

| Spec section | Task |
|---|---|
| §2 state machine | 1 |
| §3 frozen queue, Skip rotates | 1 |
| §4 presentation and keys | 2 |
| §5 safety and undo | 2 |
| §6 testing | 1, 2, 3 |
| §8 success criteria | 3 (1), 1 (2), 2 (3, 4), 3 (5) |
