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
- Subtle box-shadow on hover: `0 4px 12px rgba(0,0,0,0.06)`
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

## Animation & Interaction

### Hover Effects

1. **Card Lift:** translateY(-2px) + enhanced shadow on hover
2. **Link Underline Sweep:** Underline grows from left on hover

### Transitions

- Duration: 0.2s ease for interactions
- Smooth color and shadow transitions
