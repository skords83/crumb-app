---
name: Crumb
description: A shared recipe library and bake-timing planner for home sourdough bakers.
colors:
  cream-bg: "#F5F0E8"
  cream-surface: "#EDE5D6"
  cream-card: "#FFFFFF"
  cream-border: "#D6C9B4"
  cream-hover: "#E5DAC8"
  crumb-900: "#2C1A0E"
  crumb-700: "#5C3D1E"
  crumb-500: "#8B7355"
  crumb-400: "#A68B6A"
  crumb-300: "#C4A484"
  dark-canvas: "#0F172A"
  console-surface: "#161B22"
  console-well: "#0D1117"
  console-border: "#30363D"
  console-muted: "#8B949E"
  console-now-line: "#F85149"
  console-success: "#4ADE80"
  phase-tan: "#C4A484"
  phase-blue: "#60A5FA"
  phase-purple: "#A78BFA"
  phase-emerald: "#34D399"
typography:
  display:
    fontFamily: "DM Serif Display, Georgia, serif"
    fontSize: "clamp(1.65rem, 4vw, 2.25rem)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "normal"
  body:
    fontFamily: "Outfit, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Outfit, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0.05em"
rounded:
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  full: "9999px"
components:
  button-primary:
    backgroundColor: "{colors.crumb-500}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "12px 24px"
  button-primary-hover:
    backgroundColor: "#766248"
  button-secondary:
    backgroundColor: "{colors.cream-card}"
    textColor: "{colors.crumb-700}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
  button-secondary-hover:
    textColor: "{colors.crumb-900}"
  fab-save:
    backgroundColor: "{colors.crumb-500}"
    textColor: "#FFFFFF"
    rounded: "{rounded.lg}"
    padding: "16px 32px 16px 28px"
  card-recipe:
    backgroundColor: "{colors.cream-card}"
    rounded: "{rounded.lg}"
    padding: "16px"
  modal-surface:
    backgroundColor: "{colors.cream-card}"
    rounded: "{rounded.xl}"
    padding: "24px"
  badge-tag:
    backgroundColor: "{colors.cream-surface}"
    textColor: "{colors.crumb-400}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
---

# Design System: Crumb

## 1. Overview

**Creative North Star: "The Kitchen Notebook & The Console"**

Crumb is two rooms in one house. Most of the app — the recipe library, the search, the import flow, the plan sheet — is **the kitchen notebook**: warm cream and toasted-brown, generous rounded corners, soft brand-tinted shadows, the feel of a trusted handwritten binder a small circle of bakers has kept for years. Then there's Backplan, the timing engine, which steps into **the console**: a near-black, precision-instrument surface borrowed from flight displays and terminal UIs, where colored phase bars and a live now-line replace warmth with exactness. The same hand designed both rooms — the console still carries the notebook's signature tan accent (`#C4A484`) through its phase bars and highlights — but the register shifts because the *task* shifts: browsing and planning is unhurried, timing is exact. This directly follows PRODUCT.md's Design Principle 1, "Precision without sterility": the console is allowed to go dark and exact because it's carrying real timing math, but it never turns cold or corporate — it borrows the kitchen's rounded shapes and warm accent rather than reaching for sharp-edged dashboard chrome.

Crumb explicitly rejects three things named in PRODUCT.md: the generic cold SaaS dashboard look (navy/blue corporate palettes, icon-in-a-box metric cards, gradient hero banners), the saccharine food-blog aesthetic (pastel doodles, cutesy icons, stock-photo food styling), and gamified or playful timer treatments. It is a tool for a small trusted circle of home bakers, not a public product — every design decision favors quiet trustworthiness over acquisition-funnel polish.

**Key Characteristics:**
- Warm cream-and-brown palette for browsing/planning; a separate near-black console palette exclusively for Backplan's timing view
- One workhorse sans (Outfit) carries all UI text; a serif display face (DM Serif Display) appears only for named things — the wordmark and an active recipe's title — never for generic headings
- Confident, heavy type weights (black/extrabold) even within a warm, soft-cornered shell
- Brand-tinted shadows in light mode; tonal layering (translucent white) in dark mode
- Functional color-coding throughout (recipe categories, dough phases, hydration %, ingredient tags) rather than decorative color

## 2. Colors

The palette is Restrained-to-Committed: cream and brown carry the vast majority of the surface, with the brand tan (`crumb-500`) as the sole accent for actions and selection. The console introduces its own committed dark palette, scoped entirely to Backplan.

### Primary
- **Toasted Crumb** (`#8B7355` / `crumb-500`): the one accent color. Primary buttons, active nav state, the "Planen" CTA, selection state. Used for actions and current-state only, never as decoration.

### Secondary
- **Warm Sand** (`#C4A484` / `crumb-300`): the accent's dark-mode stand-in, and the color that bridges the two rooms — it's the same tan used for the primary dough-phase color inside the dark Backplan console, keeping the console visibly part of the same brand even at its darkest.

### Neutral
- **Flour Cream** (`#F5F0E8` / `cream-bg`): the default page background in light mode — a warm, deliberately *not* sterile-white canvas.
- **Toasted Surface** (`#EDE5D6` / `cream-surface`): secondary surface layer — stat bars, badge backgrounds, the "kitchen counter" beneath cards.
- **Paper White** (`#FFFFFF` / `cream-card`): card and modal surfaces in light mode — the one true white in the system, reserved for content containers.
- **Crust Border** (`#D6C9B4` / `cream-border`): all light-mode borders and dividers.
- **Deep Crumb** (`#2C1A0E` / `crumb-900`): primary text in light mode.
- **Toasted Brown** (`#5C3D1E` / `crumb-700`): secondary text, secondary-button labels.
- **Dried Crust** (`#A68B6A` / `crumb-400`): muted text — timestamps, placeholder-adjacent labels, inactive nav.
- **Midnight Slate** (`#0F172A` / `dark-canvas`): the app-wide dark-mode background outside the console (nav, default page dark mode).

### Console Palette (Backplan only)
- **Console Well** (`#0D1117`): deepest recessed surfaces — sunken inputs, the timeline track floor.
- **Console Surface** (`#161B22`): the Backplan modal and panel background.
- **Console Border** (`#30363D`): structural dividers within the console.
- **Console Muted** (`#8B949E`): secondary/label text on console surfaces.
- **Now-Line Red** (`#F85149`): the live current-time marker on the timeline — the one place red appears, and only to mark "now."
- **Free-Time Green** (`#4ADE80` / `rgba(34,197,94,*)`): open/available time segments and confirm actions inside the console.
- **Phase Colors** — `#C4A484` tan, `#60A5FA` blue, `#A78BFA` purple, `#34D399` emerald: sequential coding for parallel dough sections on the Backplan timeline, so overlapping doughs stay visually distinct at a glance.

### Named Rules
**The Warmth-Is-Not-Decoration Rule.** Every color in the cream/brown system carries a job — text hierarchy, a surface layer, or the single accent. Nothing is added for prettiness; PRODUCT.md is explicit that "warmth comes from color, type, and texture choices, not from cute illustration or ornament."

**The One Room Rule.** The console palette (`#0D1117`–`#30363D`) is scoped to Backplan alone. It never leaks into the recipe library, and the cream system never leaks into Backplan's timeline — the two registers stay visually distinct so the console's precision reads as intentional, not as an inconsistency.

## 3. Typography

**Body/UI Font:** Outfit (with system sans-serif fallback)
**Display Font:** DM Serif Display (with Georgia, serif fallback)

**Character:** One confident grotesk-adjacent sans carries essentially the entire interface — labels, buttons, data, card titles — at surprisingly heavy weights (extrabold/black) for a "warm" system, which is what keeps the cream palette feeling crafted and precise rather than soft and sleepy. The serif only appears where a proper noun is being presented.

### Hierarchy
- **Display** (400, `clamp(1.65rem, 4vw, 2.25rem)`, line-height 1, italic-capable): the "crumb" wordmark and, on the active Backplan session, the specific recipe's title. Reserved for named things, not generic headings.
- **Headline** (900/black, `text-xl`/1.25rem): recipe card titles, rendered in white with a drop-shadow over the hero photo.
- **Title** (700/bold, `text-lg`–`text-xl`): generic page headings ("Konto erstellen", section titles) — bold Outfit, not the serif.
- **Body** (400–500, `0.9375rem`, line-height 1.5): descriptions, form text, list content.
- **Label** (900/black, `0.625rem`–`0.6875rem`, letter-spacing `0.05em`, uppercase): category badges, ingredient tags, stat-bar captions. The heaviest weight in the system used at the smallest size — a deliberate, confident micro-typography choice.

### Named Rules
**The Named-Thing Rule.** DM Serif Display renders exactly two kinds of content: the Crumb wordmark, and an active bake's recipe title inside Backplan. It never appears on a generic page heading, a card title, a button, or a label — the serif marks identity, not hierarchy.

## 4. Elevation

The Warm Shadow Rule governs light mode; dark mode abandons shadows in favor of tonal layering, since a shadow can't read against a near-black surface.

### Shadow Vocabulary
- **Card Rest** (`box-shadow: 0 2px 12px -2px rgba(92,61,30,0.08)`): recipe cards at rest in light mode — a brown-tinted shadow, not neutral gray.
- **FAB Elevation** (`box-shadow: 0 20px 50px rgba(139,115,85,0.3)`, hover `0 10px 30px rgba(139,115,85,0.4)`): the floating save button — the most elevated element in the system, tinted with the brand accent itself.
- **Dark Mode Card** (`box-shadow: 0 4px 20px -2px rgba(0,0,0,0.3)`): the one place shadows go neutral-black instead of tinted, since dark surfaces already read as elevated through tonal contrast, not tint.

### Named Rules
**The Warm Shadow Rule.** In light mode, every shadow is tinted brown (`rgba(92,61,30,*)` or `rgba(139,115,85,*)`) — never plain black. A shadow is still warmth, not just depth. In dark mode this inverts: surfaces lift via translucent white overlays (`rgba(255,255,255,0.04)` fill, `rgba(255,255,255,0.07)` border) rather than shadows, since shadows don't register against `#0F172A` or the console's near-black surfaces.

## 5. Components

### Buttons
- **Shape:** rounded corners throughout (`0.75rem` / `rounded-xl`); nothing in the system uses sharp corners.
- **Primary:** solid `crumb-500` fill, white text, bold, 2px self-colored border, `12px 24px` padding. Hover deepens to `#766248`; active scales to 95%.
- **Secondary:** card-white fill, `crumb-700` text, `cream-border` border. Hover: border deepens to `crumb-400`, text darkens to `crumb-900`.
- **FAB (signature):** the floating "Rezept speichern" button — `crumb-500` fill, `rounded-2xl`, oversized brand-tinted shadow, fixed bottom-right. The one place a button is allowed to visually dominate the screen.

### Cards
- **Recipe Card (signature):** `rounded-2xl`, white surface, a hero photo with a bottom gradient scrim carrying the white recipe title, and a left border stripe (2–3px) color-coded to recipe category (e.g. `#8a9a6a` for Brot, `#c27a8a` for Süßes Gebäck). Below the photo, a stat bar (time / steps / hydration %) sits on a `cream-surface` chip, separated by hairline dividers.
- **Corner Style:** `1rem` (`rounded-2xl`) for content cards; `1.5rem` (`rounded-3xl`) for modals and auth cards.
- **Shadow Strategy:** see Elevation — brand-tinted in light mode.

### Badges / Tags
- **Category & ingredient tags:** uppercase, black-weight, `10px` text, pill-rounded, each with its own light background + matching border (e.g. sourdough tags in `#FDE2E2`/`#A23939`, grain tags in `#E2E8F0`/`#475569`, wholegrain in `#E1F2E5`/`#2D5A39`). Function over decoration — the color tells the baker what's in the dough at a glance.
- **Overflow:** when tags overflow the card width, they collapse to a `+N` chip rather than wrapping — cards stay a fixed height.

### Inputs
- **Style:** `cream-border` stroke, `cream-card` or `cream-surface` background, generous rounding.
- **Console inputs (Backplan):** invert to the dark system — `#0D1117` well background, `#30363D` border, monospace-adjacent numeric alignment for time values.

### Navigation
- **Desktop:** fixed top header, `cream-bg` background, the serif wordmark at left, nav items in `crumb-400` at rest, `crumb-500` active with a bottom accent bar. A "smart status" pill (baking = red, active = orange, upcoming = amber, idle = brand tan) shows live bake state without needing to open Backplan.
- **Mobile:** fixed bottom tab bar, same color logic, icon + 10px label.
- **Backplan nav item:** the one nav entry allowed a second accent color (orange) with a pulsing dot — signaling "something is live" distinctly from the brand tan used everywhere else.

### The Backplan Timeline (signature component)
A canvas-rendered horizontal timeline unique to Backplan: a 24-hour track (`#21262d`) showing each dough phase as a colored bar (tan/blue/purple/emerald by section), a diagonally-hatched blue zone for overnight/sleep hours (`rgba(96,130,210,0.18–0.25)`), green free-time gaps, and a live red now-line (`#F85149`) sweeping across in real time. This is the clearest expression of "precision without sterility" in the whole app — an instrument-panel component rendered in the brand's own accent colors rather than generic chart-library defaults.

## 6. Do's and Don'ts

### Do:
- **Do** keep the accent (`crumb-500` / `#8B7355`) to actions, selection, and current-state only — it is the single accent color in the notebook system.
- **Do** tint light-mode shadows brown (`rgba(92,61,30,*)` or the accent's own color), never neutral black.
- **Do** reserve DM Serif Display for named things only: the wordmark, or a specific recipe's title in an active session. Everything else — including page headings — is bold Outfit.
- **Do** keep the console palette (`#0D1117`–`#30363D`, phase colors, now-line red) scoped to Backplan; it is a distinct room, not a system-wide dark theme.
- **Do** use color-coding functionally — recipe categories, dough phases, hydration levels, ingredient tags — so color always answers "what is this," never just "look at me."

### Don't:
- **Don't** introduce a navy/blue corporate palette or icon-in-a-box metric cards anywhere in the app — PRODUCT.md names this explicitly as the generic cold SaaS dashboard look Crumb must avoid.
- **Don't** add pastel doodles, cutesy icons, or stock-photo food styling — the saccharine food-blog aesthetic is an explicit anti-reference; Crumb is a trusted personal notebook, not a monetized content site.
- **Don't** gamify or "cutesify" bake timing — no playful stopwatch animations, no novelty countdown treatments. Backplan is precision infrastructure the baker relies on; the tone stays calm and exact.
- **Don't** let the console's dark, terminal-native palette bleed into the recipe library, or vice versa — each room keeps its own palette.
- **Don't** use plain black shadows in light mode; every light-mode shadow in the system is brand-tinted.
- **Don't** add growth-marketing UI (upsells, social proof, onboarding funnels) — Crumb is personal, not public, per PRODUCT.md's fifth design principle.
