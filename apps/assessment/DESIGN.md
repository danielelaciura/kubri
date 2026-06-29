---
name: Kubri Assessment
description: A calm, confident skills-assessment companion for entry-level candidates
colors:
  kubri-violet: "#534AB7"
  violet-deep: "#3C3489"
  violet-surface: "#EEEDFE"
  violet-hover: "#E4E2FC"
  violet-border: "#AFA9EC"
  ink: "#171717"
  body-text: "#404040"
  muted: "#737373"
  faint: "#A3A3A3"
  border: "#E5E5E5"
  border-strong: "#D4D4D4"
  surface-subtle: "#FAFAFA"
  bg: "#FFFFFF"
  success: "#15803D"
  success-surface: "#F0FDF4"
  danger: "#DC2626"
  danger-border: "#F87171"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  metric:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
rounded:
  md: "0.375rem"
  lg: "0.5rem"
  xl: "0.75rem"
  "2xl": "1rem"
  full: "9999px"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.25rem"
components:
  button-primary:
    backgroundColor: "{colors.kubri-violet}"
    textColor: "{colors.bg}"
    rounded: "{rounded.xl}"
    padding: "0.75rem 1rem"
  button-primary-hover:
    backgroundColor: "{colors.violet-deep}"
    textColor: "{colors.bg}"
    rounded: "{rounded.xl}"
  button-secondary:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.kubri-violet}"
    rounded: "{rounded.xl}"
    padding: "0.625rem 1.25rem"
  button-secondary-hover:
    backgroundColor: "{colors.violet-surface}"
    textColor: "{colors.kubri-violet}"
  choice-card:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.body-text}"
    rounded: "{rounded.md}"
    padding: "0.625rem 0.875rem"
  choice-card-selected:
    backgroundColor: "{colors.violet-surface}"
    textColor: "{colors.violet-deep}"
    rounded: "{rounded.md}"
  input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0.625rem 0.75rem"
  card-cta:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
    padding: "1.25rem"
  card-cta-featured:
    backgroundColor: "{colors.violet-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
    padding: "1.25rem"
---

# Design System: Kubri Assessment

## 1. Overview

**Creative North Star: "The Confident Companion"**

Kubri Assessment is a public, mobile-first questionnaire that walks an entry-level candidate
— often someone with a language barrier or informal work history — through a self-assessment
of their skills, then hands them a competence report they're proud to download. The interface
exists to make that person feel *capable*, not measured. It sits beside the candidate as a
steady, encouraging companion: more brand warmth than a bare utility, but never loud. **Kubri
Violet** carries the identity; abundant white space and a quiet neutral-gray text ramp keep
the experience calm and unintimidating.

The system is deliberately restrained in surface but generous in reassurance. One accent hue
does all the brand work — there is no secondary or tertiary color competing for attention.
Soft radii, full-width touch targets, and a single friendly emoji per moment signal approachability;
an accessibility-first interaction layer (every choice is a real `aria-pressed` button, every
focus state is a visible violet ring) signals respect. The candidate is never scored to their
face: there are no grades, no red marks, no punitive progress.

This system explicitly rejects three things. It is **not a clinical exam** — no test-anxiety,
no judgment, no "you are being evaluated" framing. It is **not a noisy gamified quiz** — no
confetti, no badges, no garish color, no over-animation. And it is **not a generic SaaS
dashboard** — no identical card grids, no tracked-uppercase eyebrows over every section, no
gradients, no hero-metric template.

**Key Characteristics:**
- One brand hue (Kubri Violet), white canvas, quiet neutral text ramp.
- Calm and encouraging; warmth from spacing and tone, not from loud color.
- Accessibility is the craft: semantic buttons, visible focus rings, screen-reader value text.
- Soft, rounded, touch-friendly; mobile-first.

## 2. Colors

A single violet identity on a pure-white canvas, supported by a restrained neutral-gray ramp and reserved success/danger states.

### Primary
- **Kubri Violet** (`#534AB7`): The one brand voice. Primary buttons, the selected-state border, focus rings, the live scale value, the `accent-color` of range inputs, links. It does the identity work alone.
- **Violet Deep** (`#3C3489`): The ink-violet companion. Text on selected/tinted surfaces (selected choice cards, active combobox option, the "+ add experience" affordance) and the primary-button hover. Used where violet must read as text against a light violet wash.

### Neutral
- **Ink** (`#171717`, Tailwind `neutral-900`): Headings and the highest-emphasis body text on white.
- **Body Text** (`#404040`, `neutral-700`): Default reading text, labels.
- **Muted** (`#737373`, `neutral-500`): Secondary text, hints, scale endpoints, helper copy.
- **Faint** (`#A3A3A3`, `neutral-400`): Placeholders and de-emphasized parentheticals (e.g. "(opzionale)").
- **Border** (`#E5E5E5`, `neutral-200`) / **Border Strong** (`#D4D4D4`, `neutral-300`): Card/divider borders and input strokes respectively.
- **Surface Subtle** (`#FAFAFA`, `neutral-50`): The resting fill of unselected choice cards and inputs — a hair off white so interactive elements read as tappable.
- **Background** (`#FFFFFF`): The body. The canvas is white, full stop.

### Tinted Surfaces (the violet washes)
- **Violet Surface** (`#EEEDFE`): The selected/featured fill — selected choice cards, the featured "join community" card, the active combobox option, the intro emoji tile, the secondary-button hover.
- **Violet Hover** (`#E4E2FC`): One step deeper than Violet Surface, for hover on already-tinted affordances.
- **Violet Border** (`#AFA9EC`): The hover border on unselected choice cards and the dashed accent on "add" affordances.

### State
- **Success** (`#15803D`) on **Success Surface** (`#F0FDF4`): the "you're in the community" confirmation. Reserved; never decorative.
- **Danger** (`#DC2626`) with **Danger Border** (`#F87171`): inline field-validation errors only.

### Named Rules
**The One Voice Rule.** Kubri Violet is the only brand color. There is no secondary or tertiary accent. If a screen feels like it needs a second color to create hierarchy, the fix is spacing, weight, or a violet wash — not a new hue.

**The No-Verdict Color Rule.** Red means "this field needs a fix", never "wrong answer". The assessment never colors a candidate's response as good or bad. Green is reserved for the single membership confirmation. The candidate is encouraged, never graded.

## 3. Typography

**Display / Body / Label Font:** the system UI sans stack (`ui-sans-serif, system-ui, sans-serif`) — Tailwind v4's default. There is no loaded web font in the app shell; the report PDF is a separate surface (Onest) and is out of this app's scope.

**Character:** One family, separated by weight and size. Bold and tight for the few headline moments, regular and roomy for the dense reading layer. The restraint is the point — type stays out of the way so the candidate focuses on answering.

### Hierarchy
- **Display** (700, `1.875rem` / `text-3xl`, `tracking-tight` −0.025em): Hero/intro headline only ("Scopri dove puoi arrivare davvero"). Uses `text-balance` for even lines.
- **Title** (600, `1.125rem`–`1.25rem`): Section and question prompts, CTA card headings.
- **Body** (400, `0.875rem` / `text-sm`): The dominant size — option labels, form fields, descriptions, helper text. Cap reading measure at ~65ch.
- **Label** (500, `0.75rem` / `text-xs`): Field labels, hints, micro-copy ("no spam promesso!"), step counts.
- **Metric** (600, `2.25rem` / `text-4xl`, Kubri Violet): The single live number on the 1–5 scale slider. The only "big number" in the system — earned, not a template.

### Named Rules
**The Small-Body Rule.** `text-sm` (0.875rem) is the workhorse, not `text-base`. The flow is dense with options and labels; the small body keeps choices scannable. Hierarchy comes from weight and the violet, not from inflating sizes.

## 4. Elevation

Flat by default. The system conveys depth through **borders, tonal violet washes, and white space** — not shadows. Resting surfaces (choice cards, inputs, CTA cards) are bordered, not lifted. The single exception is overlays: the comune-search listbox uses one soft drop shadow to read as floating above the form.

### Shadow Vocabulary
- **Overlay** (`box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)`, Tailwind `shadow-lg`): The `ComuneSelect` dropdown listbox only. Signals "temporary layer above the page".

### Named Rules
**The Flat-Canvas Rule.** Surfaces are flat at rest. Depth is a border or a violet wash. A shadow appears only when an element genuinely floats above the page (the search dropdown) — never on cards or buttons to make them "pop".

## 5. Components

### Buttons
- **Shape:** Pill-soft rectangles, `rounded-xl` (0.75rem). Primary CTAs are full-width in the flow.
- **Primary:** Kubri Violet fill (`#534AB7`), white text, `font-semibold`. Padding `py-3` full-width (`px-10 py-4` for the larger hero CTA). Hover deepens to Violet Deep (`#3C3489`).
- **Secondary (download):** White fill, Kubri Violet border + text, `rounded-xl`. Hover fills Violet Surface (`#EEEDFE`). Used for the "Scarica PDF" report action.
- **Disabled:** reduced opacity (60%), `cursor-not-allowed`.

### Choice cards (single / multi select)
- **Shape:** `rounded-md` (0.375rem), left-aligned, generous tap padding (`px-3.5 py-2.5`), 1- or 2-column responsive grid.
- **Resting:** `neutral-50` fill, `neutral-200` border, `body-text`. Hover lifts the border to Violet Border (`#AFA9EC`).
- **Selected:** Violet Surface fill, Kubri Violet border, Violet Deep text, `font-medium`. Implemented as a real `<button aria-pressed>`.
- **Focus:** visible 2px Kubri Violet ring with a 1px offset (`focus-visible:ring-2 focus-visible:ring-[#534AB7] focus-visible:ring-offset-1`).

### Inputs / fields
- **Style:** White fill, `neutral-300` stroke, `rounded-lg` (0.5rem), `px-3 py-2.5`.
- **Focus:** border shifts to Kubri Violet plus a soft violet glow ring (`focus:ring-2 focus:ring-[#534AB7]/20`).
- **Error:** `red-400` border, shifting to `red-500` on focus; a `text-xs` `red-600` message below. `aria-invalid` is set.
- **Range (scale):** native `<input type="range">` with `accent-[#534AB7]`, a large live value above and endpoint labels below.

### Cards / containers (CTAs)
- **Corner:** `rounded-2xl` (1rem). **Border:** `neutral-200`, 1px. **Padding:** `p-5` (1.25rem). Flat (no shadow).
- **Featured variant:** 2px Kubri Violet border on a Violet Surface fill — the "join the community" card. The only emphasized container.

### Signature Component — ComuneSelect (search combobox)
An accessible type-ahead for residence comune: a text input (`role="combobox"`, `aria-activedescendant`) over a floating `role="listbox"`. The active option uses the Violet Surface / Violet Deep pairing; the panel is the system's one shadowed overlay. Includes a "Nessun comune trovato" empty state. This is the system's reference pattern for "selection from a large set".

## 6. Do's and Don'ts

### Do:
- **Do** carry identity with **Kubri Violet alone** — one hue, on white, supported by neutral gray. (The One Voice Rule.)
- **Do** make every interactive element a real, accessible control: `aria-pressed` choice buttons, `aria-invalid` fields, visible `focus-visible` violet rings, `aria-valuetext` on the scale.
- **Do** keep surfaces **flat** — depth is a border or a violet wash; reserve the single `shadow-lg` for the search dropdown only.
- **Do** keep `text-sm` (0.875rem) as the body workhorse; build hierarchy with weight and the violet, not bigger type.
- **Do** keep the tone encouraging — full-width tappable targets, soft radii, one friendly emoji per moment, plain reassuring Italian.

### Don't:
- **Don't** make it feel like a **clinical exam** — no grades, no "you are being evaluated" framing, no punitive progress. Red is "fix this field", never "wrong answer". (The No-Verdict Color Rule.)
- **Don't** make it a **noisy gamified quiz** — no confetti, no badges, no garish colors, no over-animation or bouncy/elastic motion.
- **Don't** drift into a **generic SaaS dashboard** — no identical card grids, no tracked-uppercase eyebrows over every section, no gradients, no `background-clip: text`, no hero-metric template.
- **Don't** add a second brand color to create hierarchy. Reach for spacing, weight, or a violet wash instead.
- **Don't** use side-stripe borders (`border-left` accents) or decorative glassmorphism. Use full borders or violet tints.
- **Don't** add a drop shadow to cards or buttons to make them "pop". The canvas is flat. (The Flat-Canvas Rule.)
