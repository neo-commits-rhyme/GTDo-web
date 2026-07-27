# Browser-platform assumptions — measured

Settles the six items listed as unverified in `docs/specs/2026-07-28-core-shell-design.md` §11.

**Measured on:** 2026-07-28, macOS (darwin), Playwright 1.49 against bundled Chromium, Firefox and
WebKit. Raw output in `probes/results/`, reproducible with `npm run build && npm run probe`.

**Read this before Task 20.** Where this file and spec §7 disagree, this file wins.

---

## 1. `⌘N` / `⌘F` / `⌘,` interception — **PARTIAL**

**Measured:** all three chords reach a page listener in all three engines, and `preventDefault()`
is honoured (`defaultPrevented: true` for `Meta+n`, `Meta+f`, `Meta+,` on Chromium, Firefox and
WebKit). They are also delivered while an `<input>` has focus, with `target: "INPUT"`.

**Not measured, and not measurable this way:** whether the *browser chrome* also acted. Playwright
injects key events into the page, so a chord arriving at our listener says nothing about whether
Safari opened a find bar or Chrome opened a window. Only a human at a real keyboard can settle that.

**Decision — keep the bare-key map from spec §7.** It is correct under either outcome, and it is
required regardless on Windows and Linux, where `Ctrl+N` and `Ctrl+F` are browser-owned. Spending a
manual test cycle to maybe reclaim `⌘F` is not worth the divergence between platforms.

**Consequence for Task 20:** the handler must check `event.target` itself. Chords and bare keys both
arrive while a text field is focused, so the browser will not do the suppression for us.

## 2. IndexedDB quota vs localStorage — **CONFIRMED (quota); eviction UNVERIFIABLE**

`navigator.storage.estimate().quota`, measured:

| Engine | Quota | vs localStorage (~5 MB) |
|---|---|---|
| Chromium | 5,368,711,435 B (5.00 GiB) | ~1,000× |
| Firefox | 10,737,418,240 B (10.00 GiB) | ~2,000× |
| WebKit | 1,048,576,000 B (0.98 GiB) | ~200× |

IndexedDB opened, wrote and read back successfully in all three. The choice of IndexedDB over
localStorage is settled: even WebKit's ~1 GiB leaves the data file and thirty days of snapshots
with room to spare.

**Safari's 7-day eviction of script-writable storage is UNVERIFIABLE here.** It is an ITP behavior
of Safari on macOS/iOS, absent from headless WebKit, and observing it needs a real browser left
alone for a week. Treat it as live: §8's export path and the README caveat stay exactly as specified.

## 3. `navigator.storage.persist()` — **CONFIRMED, with a sharp edge**

Present in all three engines. Results:

| Engine | `persisted()` before | `persist()` |
|---|---|---|
| Chromium | `false` | returned `false` (denied) |
| WebKit | `false` | returned `false` (denied) |
| Firefox | `false` | **never settled** — permission prompt with nobody to answer it |

Firefox hanging is the finding that matters. The first version of the probe awaited it directly and
the whole run timed out at 15s.

**Rule for Task 14:** call `requestPersistentStorage()` fire-and-forget. Never `await` it on a path
the UI blocks on, and treat a promise that does not settle as "not granted". A denial is normal —
both Chromium and WebKit denied it in an unengaged context — so the app must be fully correct
without persistence, which is what §8's Export path is for.

## 4. Hash routing vs the `404.html` SPA fallback — **UNVERIFIABLE locally**

Needs a real GitHub Pages deployment to observe. Not settled.

**No action.** Hash routing is correct whether or not the `404.html` trick has the back-button
defect, so the spec's choice carries no risk. Re-check after the first deploy only out of interest.

## 5. Vite `base: '/GTDo-web/'` — **CONFIRMED**

Built `dist/index.html` emits `/GTDo-web/assets/index-B4ESuVBL.js`. Without `base`, Vite emits
`/assets/...`, which 404s on a project Pages site served from `https://<user>.github.io/GTDo-web/`.
A probe asserts every `src`/`href` in the built HTML starts with `/GTDo-web/`, so a regression here
fails CI.

Note: the **dev server** serves both `/` and `/GTDo-web/`, so it cannot verify this — the assertion
runs against `dist/`.

## 6. IndexedDB in private browsing — **UNVERIFIABLE with Playwright**

Playwright contexts are already ephemeral, and neither Safari's Private Browsing flag nor Chrome's
Incognito flag is exposed to the driver. IndexedDB was usable in the ephemeral contexts tested,
which is suggestive and not conclusive.

**No code change.** The failure path this assumption feeds — a rejected `persist()` or a failed
write — is already handled by §8: `saveError`, the banner, and Export now. Verify by hand in real
private windows after the first deploy, and record the result here.

---

## Summary

| # | Assumption | Verdict | Changes code? |
|---|---|---|---|
| 1 | `⌘`-chords not interceptable | PARTIAL — page half confirmed, chrome half untestable | No — bare-key map stands |
| 2 | IndexedDB quota ≫ localStorage | CONFIRMED | No |
| 2b | Safari 7-day eviction applies | UNVERIFIABLE | No — warnings stay |
| 3 | `storage.persist()` worth calling | CONFIRMED, must not be awaited | **Yes — Task 14** |
| 4 | Hash routing avoids a 404.html defect | UNVERIFIABLE | No |
| 5 | Pages needs `base: '/GTDo-web/'` | CONFIRMED | No |
| 6 | IndexedDB works in private mode | UNVERIFIABLE | No |

One assumption changed the plan (3). None changed the architecture.
