---
name: Hyundai Trip Tracker
description: "A flat, instrument-grade readout for a long-term EV trip archive — one accent, tabular numerals, and a caveat attached to every reading."
colors:
  instrument-blue: "#1b6ef3"
  instrument-blue-ink: "#1459cc"
  instrument-blue-dark: "#63a4ff"
  chart-paper: "#f6f7f9"
  readout-surface: "#ffffff"
  hairline: "#e2e5ea"
  recorded-ink: "#16191d"
  annotation-grey: "#666d78"
  panel-black: "#14171b"
  readout-surface-dark: "#1c2026"
  hairline-dark: "#2c323a"
  recorded-ink-dark: "#e8eaed"
  annotation-grey-dark: "#9aa2ad"
  fault-crimson: "crimson"
  fault-crimson-dark: "lightcoral"
  caution-amber: "darkorange"
  affirm-seagreen: "#26744a"
  affirm-seagreen-dark: "mediumseagreen"
typography:
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "26px"
    fontWeight: 700
    letterSpacing: "-0.02em"
  readout:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "22px"
    fontWeight: 600
    fontFeature: "tabular-nums"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "17px"
    fontWeight: 700
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 400
  body-dense:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 400
  caption:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
  note:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "0.06em"
  micro:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 400
  tag:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "10px"
    fontWeight: 400
    letterSpacing: "0.04em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
  4xl: "64px"
components:
  tile:
    backgroundColor: "{colors.readout-surface}"
    textColor: "{colors.recorded-ink}"
    rounded: "{rounded.lg}"
    padding: "14px 16px"
  table-shell:
    backgroundColor: "{colors.readout-surface}"
    rounded: "{rounded.lg}"
  chip-range:
    backgroundColor: "{colors.readout-surface}"
    textColor: "{colors.annotation-grey}"
    typography: "{typography.note}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  chip-range-selected:
    textColor: "{colors.instrument-blue}"
    typography: "{typography.note}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  tag-gps:
    textColor: "{colors.affirm-seagreen}"
    typography: "{typography.tag}"
    rounded: "{rounded.xs}"
    padding: "1px 5px"
  tag-cached:
    textColor: "{colors.annotation-grey}"
    typography: "{typography.tag}"
    rounded: "{rounded.xs}"
    padding: "1px 5px"
  alert-note:
    textColor: "{colors.annotation-grey}"
    typography: "{typography.note}"
  alert-caution:
    typography: "{typography.note}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
  alert-fault:
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
  input-datetime:
    backgroundColor: "{colors.readout-surface}"
    textColor: "{colors.recorded-ink}"
    typography: "{typography.note}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
  button-link:
    textColor: "{colors.instrument-blue}"
    typography: "{typography.note}"
  modal:
    backgroundColor: "{colors.chart-paper}"
    rounded: "{rounded.xl}"
    width: "min(620px, 100%)"
---

# Design System: Hyundai Trip Tracker

## Overview

**Creative North Star: "The Flight Recorder"**

This is an instrument, not an interface. It logs faithfully and it never flatters. Every
number on screen came off a car that syncs on its own schedule, through an API that
returns a cached view, and the design's entire job is to present those numbers at full
precision while never once letting them pass as fresher or more certain than they are.
The caveat is part of the reading. It is not a footnote, not a tooltip-only afterthought,
and not something the layout apologises for — "as reported by the car 14 min ago" sits on
the same line as the heading it qualifies.

The register is precise, sober and unhedged, and at the same time calm and unhurried.
Those are not in tension here: the page states limits directly because that is the
accurate thing to do, and it does so without alarm. Contrast is low, borders are
hairlines, there is exactly one accent hue and no motion anywhere in the system. Nothing
pulses, slides, or asks for attention. It is a page you can leave open on a second
monitor for a week.

Restraint does the expressive work. There is no webfont, no illustration, no gradient, no
icon set, and one shadow in the entire stylesheet. What is left is typography and
alignment, and those are handled with care: tabular numerals everywhere a digit can
appear, a type scale that descends as certainty descends, and a radius scale that tracks
the size of the thing it rounds. The craft is legible to anyone who looks closely and
invisible to anyone who doesn't, which is the correct ratio for an instrument.

**Key Characteristics:**

- One accent hue, used on well under 10% of any screen, and never as a large fill
- Absolutely flat — depth exists only for things that leave the document plane
- Tabular numerals on every element that can hold a number
- A six-token palette per theme, plus three semantic colors that deliberately sit outside it
- System font stack only; no webfont is loaded and none should be
- Zero motion: no transitions, no animation, no easing tokens
- Every uncertain value carries its provenance and its age in adjacent muted type

## Colors

A near-monochrome cool grey field carrying a single saturated blue, with three semantic
hues that never participate in theming.

### Primary

- **Instrument Blue** (`--accent`): The blue of a gauge needle and a backlit panel. It is
  the system's only decorative-capable color and it is never used decoratively. It marks
  exactly three things: what is interactive (links, the raw-payload toggle, sort headers
  on hover), what is currently selected (the active range chip), and what is in motion
  (the `moved` event in the timeline). The dark-mode value is a distinct lighter tone
  rather than the same hex, because the light-mode blue does not hold contrast on a near
  black panel.
- **Instrument Blue Ink** (`--accent-ink`): the same needle, darkened for *text sitting on
  an accent tint*. The plain accent clears 4.5:1 on a white surface but reaches only
  3.4:1 on its own 10% wash — which is exactly where the selected range chip puts it. Used
  for that text and nothing else. In dark mode it is identical to the accent, whose
  lighter value already passes on the darker wash.

### Neutral

- **Chart Paper** / **Panel Black** (`--bg`): The page ground. Cool and very slightly blue
  in both themes, never pure white or pure black.
- **Readout Surface** (`--surface`): Every card, tile, table shell, input, timeline item
  and code chip. In light mode it is the one pure white in the system, so surfaces lift
  off the paper without a shadow; in dark mode it steps *up* from the panel for the same
  effect.
- **Hairline** (`--border`): All dividers, card outlines and input strokes. One pixel,
  always, at a value close enough to the surface that it reads as a seam rather than a
  line.
- **Recorded Ink** (`--text`): Values, headings, and anything the archive actually
  asserts.
- **Annotation Grey** (`--muted`): Labels, timestamps, caveats, hints, provenance, and
  every piece of text that qualifies a value rather than being one. This token carries
  more of the system's meaning than any other.

### Semantic

These three sit **outside** the custom-property set on purpose and are written as CSS
color keywords. They encode meaning, not theme, and must not become re-skinnable
alongside the accent — a fault should look like a fault regardless of what the palette
ever becomes.

- **Fault Crimson** (`crimson`, `lightcoral` in dark): A poll that failed, a load that
  errored, an invalid custom range. Something is broken and needs a person.
- **Caution Amber** (`darkorange`): The location subsystem is rate limited or failing.
  Degraded, not broken; trips are unaffected.
- **Affirm Seagreen** (`#26744a`, `mediumseagreen` in dark): Engine on, charging started,
  plugged in, and a requested GPS fix. Positive state and first-hand evidence. Deeper than
  the CSS `seagreen` keyword it replaced, which measured 4.25:1 on the light surface and
  3.96:1 inside its own tint — both short of 4.5.

Each of the seven event kinds takes one of these three: **on / started / plugged in** are
affirm, **off / stopped / unplugged** are Annotation Grey, and **moved** is the accent. A
kind with no assignment inherits full-strength ink and becomes the loudest row in the
timeline by accident, which is how `plugged_in` and `unplugged` read until this pass.

### Named Rules

**The Tint-and-Hairline Rule.** A colored surface is never a solid fill. It is a
`color-mix` of its hue at 10–12% over transparent, outlined by the same hue at 35–45%.
That single formula produces every tinted element in the system — the error banner, the
caution banner, the selected range chip, the GPS provenance tag, the table row hover — and
it is why colored areas never overpower a page whose default state is grey.

**The Meaning-Is-Not-Theme Rule.** Crimson, amber and seagreen are not tokens and must not
be tokenised into the `--` palette. Restyling the theme must never be able to restyle what
a failure looks like.

**The One Needle Rule.** Instrument Blue appears on well under 10% of any screen and never
as a solid fill larger than a focus ring. If a new element wants the accent, first check
whether it is interactive, selected, or moving. If it is none of those, it gets Annotation
Grey.

## Typography

**Display Font:** none — the system deliberately loads no webfont.
**Body Font:** the platform UI stack (`ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`)
**Label/Mono Font:** none distinct; monospace appears only in `<pre>` for raw payloads, at the UA default.

**Character:** Whatever the operating system considers its own voice. This is a deliberate
refusal rather than an omission: an instrument should read in the local dialect, render
instantly, and cost nothing to load. All personality comes from size, weight, tracking and
numeral alignment — not from a typeface.

### Hierarchy

- **Headline** (700, 26px, `-0.02em`): The page title only. The negative tracking is the
  single typographic flourish in the system.
- **Readout** (600, 22px, tabular): Tile values. The largest *number* on the page and the
  thing the eye should land on first in any tile grid.
- **Title** (700, 17px): Modal heading. Section headings on the page take
  `.section-title` — 15px/700, the Body Dense size — and both `<h2>`s use it, so two
  headings of the same rank cannot render at two different sizes.
- **Body** (400, 16px): The reading size, and the base below 640px. Table cells and
  fault-weight alert text. 16px is also the floor for any focusable field — anything
  smaller makes iOS zoom the page on focus and never zoom back.
- **Body Dense** (400, 15px): The desk. Replaces Body as the base from 640px up, where
  density is worth more than legibility at arm's length. Also the section headings in the
  live panel and the timeline, at 700.
- **Caption** (400, 14px): Content that is still a value but secondary — the subtitle, the
  vehicle select, modal detail rows.
- **Note** (400, 13px): Content that *comments on* a value — poll notes, the caution
  banner, range chips, inputs, link buttons, timeline rows.
- **Label** (400, 12px, `0.05–0.06em`, uppercase, Annotation Grey): Tile labels, table
  column headers, modal section headings. Never used for content.
- **Micro** (400, 11px, Annotation Grey): Tile hints and detection-lag notes. The smallest
  size that carries words.
- **Tag** (400, 10px, `0.04em`, uppercase): Provenance badges only (`GPS FIX`, `CACHED`).

### Named Rules

**The Tabular Rule.** Every element that can contain a digit sets
`font-variant-numeric: tabular-nums` — the whole table, tile values, detail values, event
times, event details, range chips. Columns of numbers must never shift width as they
update. This is non-negotiable and is the cheapest thing in the system that makes it look
engineered.

**The Caveat Ladder.** Type size descends as certainty descends: 16px reads, 15px packs,
14px details, 13px comments, 12px labels, 11px qualifies, 10px attributes. A caveat
rendered at body size is a bug, and so is a value rendered at 11px. Where a reading needs
a qualification, the qualification goes *adjacent and smaller*, never in place of the
value.

**The Label Case Rule.** 12px + uppercase + `0.06em` + Annotation Grey means "this is a
label." That combination is reserved. Never set content in it, and never set a label
without it.

## Layout

A single centered column, `max-width: 1180px`, with `32px` of top padding, `20px` of side
gutter and `64px` of bottom air. There is no sidebar, no nav, and no second column
anywhere — the page is one vertical read.

**The stack has a fixed narrative order**, and it is load-bearing: header → poll status →
live panel → range filter → summary tiles → trip table → event timeline. Everything above
the range filter describes the car *now*; everything below it describes the archive
*within the selected window*.

**Tile grids** are `repeat(auto-fit, minmax(150px, 1fr))` at a `12px` gap, used identically
by the live panel and the summary tiles. This is the only grid in the system and it is the
reason the two panels read as the same instrument at different scales.

**Vertical rhythm** runs on 16 / 20 / 24px between blocks, with tighter 6–14px inside
components. Alert banners pull up with a `-8px` top margin so they sit against the element
they qualify rather than floating in the stack.

**Tables are right-aligned by default**, with only the first column (the timestamp) left
aligned, and every cell is `white-space: nowrap` inside a horizontally scrolling shell.
Column headers are `position: sticky`.

**Responsive behavior runs on one width breakpoint and one input query.** Viewport-dependent
rules are mobile-first: the base value is the phone and `@media (min-width: 640px)` layers
the desk back on. Everything with no viewport dimension — colour, radius, border, weight —
is stated once. Below 640px the base font is 16px, the page gutter is 16px, the tile grid
floor drops to 130px so two tiles still fit at 320px, table cells tighten to 6px of side
padding, the trip table drops its Duration column and its date loses the year, the live
panel's tiles go compact (see Components), and the trip modal becomes a bottom sheet.

**Touch sizing is a separate axis from width**, handled by `@media (pointer: coarse)`,
because a tablet with a keyboard and a laptop with a touchscreen both exist. It raises
table rows to 44px, grows the sort headers and the modal close control, and floors every
focusable field at 16px. Hover rules are all guarded by `@media (hover: hover)` so a
`:hover` never latches on after a tap, with `:active` carrying touch feedback instead.

**Every edge that content reaches is padded with `env(safe-area-inset-*)`**, wrapped in
`max()` so the inset is a floor rather than a replacement. The page opts into
`viewport-fit=cover`, so this is load-bearing, not decorative.

### Named Rules

**The No-Sideways-Scroll Rule.** The trip table fits the viewport at every width; it is
never placed in a horizontal scroller. This is not a preference — an `overflow-x` on the
table wrapper silently makes it a scroll container on *both* axes, and the sticky column
headers then anchor to a box that never scrolls and never move again. Columns give way
instead, and a long value wraps.

### Named Rules

**The Filter Boundary Rule.** The range filter is a horizon line. Nothing above it may be
affected by the selected window, and everything below it must be. Placing a windowed value
above the filter, or an archive-wide value below it, breaks the page's central promise
about what the numbers mean.

## Elevation & Depth

The system is flat. Depth is expressed entirely as a three-step tonal climb — page ground
(`--bg`) → surface (`--surface`) → hairline (`--border`) — and every card, tile, table,
input and timeline item in the application earns its separation that way and only that way.

There is exactly one shadow in the entire stylesheet.

### Shadow Vocabulary

- **Overlay** (`box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32)`): The trip detail modal, and
  nothing else. Paired with a `rgba(0, 0, 0, 0.45)` backdrop.

### Named Rules

**The Floats-Above-the-Record Rule.** A shadow means "this has left the document plane."
Exactly one thing does that today — the trip modal — and a shadow is reserved for anything
that genuinely does the same. Nothing that sits *in* the page ever gets one. A tile, a
card, a table, a banner or a hover state that reaches for elevation is reaching for the
wrong tool: the answer is a hairline and a surface tint, forever.

## Shapes

Rectangles with softened corners, no clipping, no masks, no non-rectilinear geometry
anywhere. Borders are always exactly 1px and always `--border`, except on tinted surfaces
where they are the tint hue at 35–45%.

The radius scale is `4 / 6 / 8 / 10 / 12 / 999px`, and it is not arbitrary.

### Named Rules

**The Radius-Tracks-Size Rule.** Corner radius grows with the surface it rounds: 4px on an
inline code chip and a provenance tag, 6px on an icon-sized button, 8px on inputs, alerts,
code blocks and list items, 10px on tiles and the table shell, 12px on the modal. Pick the
radius from the element's footprint, not from taste. The one exception is the fully
rounded 999px range chip, where the pill shape is doing semantic work — it reads as a
toggle rather than a field.

**The Seamed List Rule.** A vertical list of records is one object, not a stack of cards.
The event timeline achieves this with a `1px` gap, `border-bottom: none` on every item,
the bottom border restored on the last child, and radius applied only to the first and
last corners — with an `:only-child` case so a single item is still a complete card. Any
new list of homogeneous records follows the same construction.

## Components

**Component philosophy: legible instrumentation.** Every component is a readout — a label
and a value. The uppercase 12px label over a 22px tabular value in the tile is the base
unit of the entire system, and the table, the timeline and the modal's detail rows are all
variations on that same pairing at different densities. Design a new component by deciding
what its label is and what its value is.

### Readout Tile (signature)

The system's atom, used identically for live vehicle state and for archive summaries.

- **Corner Style:** 10px (`{rounded.lg}`)
- **Background:** Readout Surface, 1px hairline border, no shadow
- **Internal Padding:** `14px 16px`
- **Structure:** Label (12px uppercase, Annotation Grey) → 6px → Value (22px/600, tabular)
  → optional Hint (11px, Annotation Grey)
- **Unknown values render as an em dash (`—`), never as `0`, `Off`, or `false`.** A field
  the backend omitted is not a field the backend answered, and the tile must not invent the
  difference.
- **Compact variant** (`.tiles-compact`, below 640px only): 17px value, 11px label, 10px
  hint, `10px 12px` padding, 8px gap. Applied to the live panel and nothing else. At full
  size those six tiles take three tall rows and push the trip table — the reason the page
  exists — onto a second screen; the car's current state is context, so on a phone it
  reads at a smaller scale. From 640px up it is identical to the standard tile in every
  respect, because there the panel costs a single row.

**The Fits-On-One-Line Rule.** A tile value is a readout, and a readout that wraps or
escapes its box is a defect, not a layout event. The compact grid's 140px floor exists
because the longest live value (`Unplugged` at 17px) overflows a narrower track. Any new
value or tighter grid gets checked against the longest string it can actually produce.

### Chips

- **Style:** Fully rounded (999px), `6px 12px`, Readout Surface, hairline border, 13px
  tabular, Annotation Grey text — recessive at rest.
- **Hover:** Text lifts to Recorded Ink. Nothing else changes.
- **Selected:** Instrument Blue text, border at 45% accent, background at 10% accent —
  the Tint-and-Hairline formula.
- **Focus:** `2px` Instrument Blue outline at `1px` offset.
- **Semantics:** `aria-pressed` carries selection state; these are toggles, not links.

### Cards / Containers

- **Corner Style:** 10px for tiles and the table shell, 12px for the modal
- **Background:** Readout Surface (modal uses the page ground so its own inner surfaces
  can still lift off it)
- **Shadow Strategy:** None. See Elevation & Depth.
- **Border:** 1px hairline
- **Internal Padding:** `14px 16px` for tiles, `10px 14px` for table cells, `16px 20px` for
  the modal header

### Inputs / Fields

- **Style:** Readout Surface fill, 1px hairline stroke, 8px radius, `6px 8px` padding for
  datetime inputs and `8px 10px` for the vehicle select. `font-family: inherit` is set
  explicitly so native date controls do not fall back to the UA font.
- **Focus:** Native focus ring; the system does not restyle it on inputs, only on custom
  controls.
- **Error:** The field is not recolored. The validation message replaces the range summary
  line beneath it and turns Fault Crimson. Errors are stated, not indicated.

### Alerts (signature)

Three deliberately distinct weights, which must not collapse into one another:

- **Note** (13px, Annotation Grey, no background, no border): Routine truth. Last poll
  succeeded, nothing has run yet.
- **Caution** (13px, amber tint + amber border, 8px radius, `10px 14px`): Degraded but not
  broken. Sits between note and fault on purpose — a stalled location feed must not read as
  routine, and must not read as an outage.
- **Fault** (15px, crimson tint + crimson border, 8px radius, `10px 14px`): Broken and
  actionable.

**The Three Weights Rule.** A degraded subsystem is never a clause appended to a
reassuring line. When something is only partly wrong, it gets its own element at its own
weight, and the sentence says what is *unaffected* as well as what is not.

### Provenance Tag (signature)

A 10px uppercase micro-badge on a value whose source matters — `GPS FIX` for a fix the
poller requested, `CACHED` for one the car volunteered.

- **GPS:** Seagreen text, 40% seagreen border, 10% seagreen fill
- **Cached:** Annotation Grey text, plain hairline border, no fill
- Both: 4px radius, `1px 5px` padding, `white-space: nowrap`, `6px` left margin

The green one is the exception that proves the One Needle Rule — first-hand evidence is
worth a color, and the absence of one is itself the signal.

### Link Button

Text that acts. Built with `all: unset` and then only cursor, Instrument Blue, 13px and
`display: inline-block` added back — so it inherits nothing from the UA button and carries
no box whatsoever. Underlines on hover.

**The Unset Rule.** A button that should read as text starts from `all: unset`, never from
overriding `background`, `border` and `padding` one property at a time. `all: unset` also
strips the UA focus ring and returns `display` to inline, so every control built that way
owes two things back: a `:focus-visible` outline (`2px solid var(--accent)`, `2px` offset,
`4px` radius) and a `display` that can hold a touch target. The three controls built this
way are the link button, the modal close, and the table's sort headers.

### Table

- Full-width, `border-collapse: collapse`, tabular numerals on the whole element.
- Right-aligned by default; the first column and any `.left` cell align left.
- Sticky 12px uppercase headers on Readout Surface; the header label is itself a button
  that turns Instrument Blue on hover and appends `▲` / `▼` for the active sort.
- Rows are interactive: `cursor: pointer`, a 7% accent wash on hover, a `2px` accent
  outline inset on focus, and `tabIndex` + `role="button"` so they are keyboard-reachable.
- The last row drops its bottom border so the shell's radius stays clean.

### Modal

- `min(620px, 100%)` wide, `88vh` max height, 12px radius, the system's only shadow.
- Sticky header on the page-ground color with a 1px bottom hairline.
- Backdrop click closes; `Escape` closes; focus moves to the close button on open.
- The close control is a bare `✕` in Annotation Grey that gains a Readout Surface
  background and Recorded Ink on hover and focus.

## Do's and Don'ts

### Do:

- **Do** attach provenance and age to any value the car did not report just now — adjacent,
  smaller, in Annotation Grey. The Caveat Ladder is the mechanism.
- **Do** set `font-variant-numeric: tabular-nums` on anything that can hold a digit.
- **Do** build every new tinted surface with the Tint-and-Hairline formula (10–12% fill,
  35–45% border, same hue).
- **Do** render an unknown value as `—`. Never let a missing field default to a plausible
  reading.
- **Do** pick corner radius from the element's footprint per the Radius-Tracks-Size Rule.
- **Do** define every new color in both `:root` and the `prefers-color-scheme: dark` block.
  Dark mode is a first-class theme here, not an inversion — the accent, the seagreen and
  the crimson all take genuinely different values.
- **Do** give a partly-degraded subsystem its own element at Caution weight.
- **Do** start text-styled buttons from `all: unset`.

### Don't:

- **Don't** add a shadow to anything that stays in the document plane. Tonal layering is
  the depth system; the modal is the one documented exception.
- **Don't** load a webfont, add an icon library, or introduce a display typeface. The
  system font stack and a handful of literal glyphs (`▲ ▼ ✕ · →`) are the entire vocabulary.
- **Don't** add motion. There is no transition, animation or easing anywhere in the system,
  and a page meant to sit open for days should not move on its own.
- **Don't** introduce a second accent hue. If something needs to stand out and is not
  interactive, selected, or moving, it needs Annotation Grey and better placement.
- **Don't** tokenise crimson, darkorange or seagreen into the `--` palette. Meaning is not
  theme.
- **Don't** put a window-filtered value above the range filter, or an archive-wide value
  below it.
- **Don't** use the 12px-uppercase-tracked-muted combination for anything that is not a
  label.
- **Don't** show a route, a path, a map tile, or any geographic rendering beyond a
  coordinate pair linking out to OpenStreetMap. The API returns no route data of any kind
  and the design must not imply otherwise.
