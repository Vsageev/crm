# Design System

## Concept

A clean, professional design emphasizing trust, clarity, and generous whitespace with subtle depth cues.

## Philosophy

Communicate value visually. Prioritize scannability, clear hierarchy, and real-feeling interface elements alongside marketing copy.

## Color Palette

### Base Colors

- **Background:** `#FFFFFF` (pure white)
- **Surface:** `#F7F8FA` (light cool gray)
- **Card:** `#FFFFFF`
- **Border:** `#E8EAED`
- **Border Subtle:** `#F0F1F3`

### Text Colors

- **Primary:** `#1A1A2E` (deep navy-black)
- **Secondary:** `#6B7280` (medium gray)
- **Tertiary:** `#9CA3AF` (light gray)
- **Inverse:** `#FFFFFF`

### Accent Colors

- **Primary Green:** `#43E660`
- **Primary Brand:** `#2D2D2D` (dark buttons)
- **Link Blue:** `#3B82F6`
- **Warning Amber:** `#F59E0B`
- **Info Purple:** `#8B5CF6`

### Semantic Colors

- **Success:** `#10B981`
- **Error:** `#EF4444`
- **Warning:** `#F59E0B`
- **Info:** `#3B82F6`

## Typography

### Font Stack

- **Primary:** Inter, system-ui, -apple-system, sans-serif
- **Display:** Inter with tighter tracking

### Scale

- **Hero Title:** 48px, weight 500, tracking -0.02em, line-height 1.15
- **Section Title:** 28px, weight 600, tracking -0.01em
- **Subsection:** 20px, weight 600
- **Body Large:** 18px, weight 400, line-height 1.6
- **Body:** 15px, weight 400, line-height 1.5
- **Small/Label:** 13px, weight 500
- **Caption:** 12px, weight 500, uppercase, tracking 0.05em

## Components

### Buttons

- **Primary:** Dark background (#2D2D2D), white text, 8px radius, 12px 24px padding
- **Secondary:** White background, 1px border, dark text, 8px radius
- **Ghost:** No background, text only with arrow
- **Link:** Accent color text with underline on hover

### Cards

- White background, 1px border (#E8EAED), 12px radius
- **No box-shadow on hover.** Cards are flat — interaction is communicated through border color or background tint changes, never shadows.
- Interior padding: 20px-24px

### Badges

- Rounded pill shape, small text (13px weight 500)
- Colored background at 10% opacity with matching text color
- Used for status, counts, or labels

## Layout

### Grid

- Max width: 1200px centered
- 2-column layouts for content sections (text + visual)
- Generous vertical spacing between sections (80-100px)

### Spacing

- Section padding: 80px vertical
- Card padding: 20-24px
- Element gap: 12-16px
- **Be intentional with spacing.** Every margin and padding should serve hierarchy — avoid arbitrary values. Use the spacing scale consistently (4, 8, 12, 16, 20, 24, 32, 48, 64, 80px). Don't add extra spacing "just to breathe" — whitespace should guide the eye, not fill emptiness.

## Animation & Interaction

### Hover Effects

1. **Card:** Border color darkens or background tint changes on hover. **No shadow on hover** — no `box-shadow` transitions. No position shift (`translateY`), no wiggle, no movement — cards stay flat and in place.
2. **Inline text link:** Underline grows from left on hover (underline sweep). Only for true inline text links within body copy.
3. **Navigation link** (back links, breadcrumbs): Color darkens on hover. No underline, no movement.
4. **Interactive controls** (buttons, action triggers): Background/border subtly darken. No link-style underlines, no position shift.

### Rules

- **No hover shadows:** Never add or enhance `box-shadow` on hover. The interface is flat — use border or background changes instead.
- **No hover movement:** Never use `transform: translateY()` or `translate()` on hover. Elements must not shift position on interaction.
- **No fake link styling:** Only true inline text links get underline effects. Navigation elements, cards, list items, and action buttons must never gain underlines on hover.
- **Link Blue is for links only:** Reserve `var(--color-link)` for actual hyperlinks and form focus rings. Do not use it for card borders, button hovers, or list item highlights.

### Transitions

- Duration: 0.2s ease for interactions
- Smooth color and border transitions
