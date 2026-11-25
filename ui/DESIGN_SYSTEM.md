# FIND ME / لقني — Design System

© 2026 MD Studio. All rights reserved. Developed by Mohsen ~ Danial.

## Principles
1. **The world stays visible.** Every overlay is a translucent glass panel (blur 18 px, 62 % ink). No screen ever goes black over the 3D scene. The pose wheel dims only the edges.
2. **The character is never covered.** The paint dock sits on the inline-start edge and the camera uses `setViewOffset` to frame the body in the free space. The dock collapses to a single header.
3. **One icon language.** All icons come from `web/src/ui/icons.tsx`: 24 px grid, 2 px rounded strokes, original drawings. No emoji in the UI.
4. **RTL first.** Only logical CSS properties (`inset-inline-*`, `padding-inline-*`). Directional icons (back, undo, redo) carry `.flip`. Key chips keep their keys LTR (`direction: ltr`) while the label follows the page.
5. **Big touch targets.** Minimum 52 px (`--tap`), 76 px for the main action. Key chips are hidden on touch devices.

## Tokens (`web/src/styles.css :root`)
| Token | Value | Use |
|---|---|---|
| `--brand` | #ff5c8a | primary action, paint mode |
| `--accent` | #ffc93c | Arabic logo, highlights, online play |
| `--mint` | #2ed3b7 | success, camo score, Done |
| `--danger` | #ff4d5e | errors, offline banner |
| `--ink` | #0f0c24 | background |
| `--text` / `--muted` | #fff9f2 / #c9c3e6 | text |
| `--glass` / `--glass-strong` | ink at 62 % / 82 % | panels |
| `--r-s/m/l` | 12 / 18 / 26 px | radii |
| `--ease-bounce` | cubic-bezier(.34,1.56,.64,1) | all press/pop motion |

## Type
- **Cairo** (variable 200–1000, SIL OFL), for UI text in Arabic and English.
- **Baloo Bhaijaan 2** (SIL OFL), for display: logo, modal titles.
- Both are self-hosted in `web/public/fonts` with their licences.

## Components
| Component | Class | Notes |
|---|---|---|
| Button | `.btn` `.primary` `.accent` `.mint` `.ghost` `.lg` | 3D press: 4 px bottom shadow, collapses on `:active` |
| Icon button | `.icon-btn` (`.on`, `.big`) | round glass |
| Glass panel | `.glass` | add to any container |
| Pill / status | `.pill` + `.dot` | play = mint, paint = brand, locked = accent |
| Key chip | `.kbd > b` | desktop only |
| Slider | `.field > .field-row + input[type=range]` | value in an `<output>`, LTR digits |
| Switch | `.switch > input + span` | mirrors in RTL |
| Tabs | `.tabs > button.on` | horizontally scrollable on phones |
| Modal | `.scrim > .modal.glass` | light blur scrim, the world shows through |
| Paint dock | `.paint-dock.glass(.collapsed)` | tool grid, colour wheel, sliders, sticky footer |
| Pose wheel | `.pose-scrim > .pose-wheel` | 2 rings (7 + 10) of 3D thumbnails rendered by Blender; hub shows the hovered pose name |

## Screens
Splash (MD Studio → FIND ME logo) → Menu (map preview background with Ken Burns motion, gradient shade on the reading side) → Loading (progress + tip) → Game HUD (top bar: back, status pill, camo score, settings; bottom: key chips and action bar) → Paint dock → Pose wheel → Settings (Controls, Graphics, Audio, Language, Accessibility) → Credits.

## Motion
Pop-in 280 ms with the bounce curve; pose items are staggered by 18 ms; `prefers-reduced-motion` disables everything.
