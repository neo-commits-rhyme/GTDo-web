# GTDo Web — sub-project 2: visual identity

**Date:** 2026-07-28 · **Status:** approved design, ready for implementation planning.
**Builds on:** sub-project 1 (`2026-07-28-core-shell-design.md`), shipped and deployed.
**Direction:** *Paper* — warm neutrals, serif view titles, amber completion.

Every contrast ratio below was computed, not asserted. Two values from the approved
mockup failed that check and are already replaced; both are called out in §2 rather than
quietly corrected, because the failure mode they represent is the one this project has
hit before.

## 1. Decisions

Settled during brainstorming; not to be re-litigated:

1. **A web-native direction, not a port of the iOS *Instrument* language.** The macOS and
   iPhone apps share an identity; the web app deliberately does not.
2. **Dense and fast** in character — keyboard-first, tight rows, chrome that recedes.
   This follows the interaction model sub-project 1 already shipped: bare-key shortcuts,
   a fixed trailing gutter, and a completion hold whose entire purpose is not breaking a
   fast run down a column.
3. **Paper**: warm neutrals, a serif reserved for view titles, amber for completion.
4. **A self-hosted variable serif**, subset and served from our own origin.
5. **The 16 SF Symbol names are the icon vocabulary**, drawn as our own SVGs.

Decision 3 was chosen over a near-monochrome option that would have kept the *accent
yields* rule from the iOS spec. Paper is warmer and more distinctive, and it is also the
harder of the two to keep accessible — which is why §2 is measured rather than declared.

## 2. Palette — measured

Canvas is `Paper`; the sidebar sits on `Panel`.

| Token | Light | Dark | Ratio vs canvas | Role |
|---|---|---|---|---|
| `Paper` | `#FAF9F6` | `#191817` | — | Canvas |
| `Panel` | `#F2F0EA` | `#201F1D` | **1.08** | Sidebar surface (see §2.2) |
| `Ink` | `#24221D` | `#ECEBE7` | 15.09 / 14.86 | Primary text |
| `Ink-secondary` | `#6B655A` | `#A29C92` | 5.49 / 6.51 | Notes, counts, section labels |
| `Ink-tertiary` | `#8B8578` | `#79736A` | 3.48 / 3.78 | Disabled glyphs, placeholders **only** |
| `Done` | `#96570F` | `#D99441` | 5.44 / 6.98 | Completed circle fill and label |
| `Overdue` | `#A8331B` | `#F0866A` | 6.32 / 7.03 | Overdue token and glyph |
| `Rule` | `#D6D0C2` | `#3A3631` | 1.46 / 1.48 | Hairlines — decorative only |

### 2.1 The amber that failed

The mockup's `#A8621B` measures **4.50:1** on `#FAF9F6` — exactly the AA threshold, where
any rounding, subpixel rendering or future canvas tweak drops it below. Replaced with
**`#96570F` at 5.44:1**, which has real headroom.

Amber is also used as a *fill* with a mark drawn on it. Both directions pass:
`Paper` on `Done` light is **5.44:1**; `Paper`-dark ink `#191817` on `Done` dark is **6.98:1**.

### 2.2 The panel that is nearly invisible

`Panel` against `Paper` measures **1.08:1** in both schemes. That is the same class of
defect the iOS spec hit twice — a card on its ground at 1.02:1, invisible, followed by a
"fix" at 1.005:1 that differed in hue only. A hue-only edge is not an edge.

**Therefore the sidebar's boundary is drawn, not inferred:** an explicit 1px `Rule` border
on its trailing edge. The tonal difference is a secondary cue, never the only one. For
reference, the iOS spec accepted 1.099 and 1.119 for the same class of surface on the same
reasoning.

### 2.3 Rules that constrain every later change

1. **`Ink-tertiary` may not carry information.** At 3.48:1 it is legal for a disabled
   glyph or a placeholder and nothing else.
2. **Never colour alone.** Overdue is a word change (`Fri` → `3d late`) **plus** weight
   **plus** `Overdue` **plus** a `!` glyph. Completed is a filled circle **plus**
   strikethrough **plus** `Ink-secondary` **plus** section membership.
3. **Hairlines are decoration.** At ~1.4:1 they may never be the only thing separating two
   pieces of information.
4. **A completed task is never overdue.** Already true in sub-project 1; the palette must
   not reintroduce it by tinting completed rows with `Overdue`.

## 3. Type

- **Serif — view titles only.** `Today`, `Calendar`, `Completed`, `Trash`, and list names
  in the list header. A self-hosted variable serif with genuine text-weight design
  (Source Serif 4 or Newsreader), subset to Latin plus the punctuation the UI uses,
  `woff2`, `font-display: swap`, served from our own origin. No CDN: it must work under a
  strict CSP with no third party involved.
- **Sans — everything else.** The system stack. Rows, sidebar, notes, buttons, settings.
- **Mono — the trailing gutter only.** `ui-monospace` with `font-variant-numeric:
  tabular-nums`, so `21d late` and `3d late` align down the column and the gutter stays
  readable as a strip.

Row height stays 26–28px. Nothing in this sub-project changes layout — sub-project 1's
three-pane shell, breakpoints and gutter are untouched.

## 4. Motion

Ported from `Sources/GTDo/Theme/Motion.swift` rather than invented:

| Swift | Web |
|---|---|
| `spring(response: 0.35, dampingFraction: 1.0)` | ~350ms, critically damped easing — no overshoot |
| `spring(response: 0.25, dampingFraction: 0.6)` | ~250ms press, slight overshoot |
| `PressableStyle(scale: 0.86)` | `transform: scale(0.86)` on `:active` |

`prefers-reduced-motion: reduce` replaces every spring with a 150ms cross-fade and drops
the scale dip for an opacity dim. Feedback is reduced, never removed — the same rule the
Swift honours.

## 5. What gets built

- **`src/app/theme/tokens.css`** — every token above as a custom property, both schemes via
  `prefers-color-scheme`, plus `:root[data-theme="light"|"dark"]` overrides so a manual
  switch wins in both directions.
- **Theme switch** — System / Light / Dark in Settings, persisted in `localStorage`. Not in
  `data.json`, so there is no interop consequence.
- **`ListIcon`** — 16 inline SVGs keyed by the SF Symbol names in `ListPalette.symbols`:
  `list.bullet`, `star`, `flag`, `tag`, `bookmark`, `bolt`, `flame`, `leaf`, `heart`,
  `cart`, `briefcase`, `book`, `house`, `airplane`, `graduationcap`, `dollarsign.circle`.
- **`ListEditor`** — rename, a 12-swatch colour picker using the exact hexes in
  `ListPalette.colors`, and a 16-icon picker. Built-in lists remain uncustomisable,
  matching the Swift guards already ported in sub-project 1.
- **Accent themes** — 7 choices in `localStorage`. macOS's eighth, `system`, followed the
  macOS accent colour; it has no web meaning and is dropped rather than faked.
- **Completion feedback** — the circle fills and springs; this is the one moment executed
  to a high standard. Sound is synthesised with Web Audio (a short struck tone), needs no
  asset file, defaults on, and requires no autoplay exemption because completing a task is
  itself the user gesture.

### 5.1 The interop rule

**The web may write only the 16 names listed above into `list.symbol`, and only the 12
hexes in `ListPalette.colors` into `list.colorHex`.** A 17th icon would round-trip to
macOS as an unknown symbol and render as nothing — silent one-way data damage from a
feature that appeared to work. Enforced by a test that asserts the picker's vocabulary is
exactly the Swift list.

## 6. Testing

- **Contrast**: the §2 table becomes a test. Every pair is computed from the token values
  and asserted against its floor, so a future palette edit that drops a pair below AA
  fails CI instead of shipping. This test is the reason §2.1 was caught before code.
- **Token completeness**: every custom property referenced in CSS resolves in both schemes
  — a token defined in light but not dark is a black-on-black bug waiting for nightfall.
- **Icon vocabulary**: the picker offers exactly the 16 Swift names, no more.
- **Colour vocabulary**: the picker offers exactly the 12 Swift hexes.
- **Reduced motion**: with the media query forced, no transition exceeds 150ms and no
  scale transform is applied.
- **Existing suites keep passing.** Sub-project 1's 302 tests assert behaviour, not looks;
  any of them breaking means this sub-project changed something it should not have.

## 7. Out of scope

Drag-and-drop and swipe (sub-project 3), Inbox Review (4), reminders and PWA (5). Layout,
routing, keyboard and storage are all settled in sub-project 1 and are not touched here.

## 8. Success criteria

1. Every pair in §2 passes its floor, verified by a test rather than by eye.
2. The sidebar boundary is visible in both schemes without relying on the 1.08:1 tone.
3. A list customised on the web opens on macOS with the same colour and icon.
4. `prefers-reduced-motion` removes every spring and every scale transform.
5. All 302 existing tests still pass.
