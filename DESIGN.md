# Qalib Design System

## Direction

Dark glass workstation. Deep ink canvas, frosted panels, teal signal light. Feels like a modern creative tool — not a generic SaaS dashboard.

## Color

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#070B14` | Page field |
| `--glass` | `rgba(16,24,40,0.55)` | Frosted panels |
| `--ink` | `#F2F5F8` | Primary text |
| `--ink-muted` | `#9AA8B8` | Secondary |
| `--line` | `rgba(255,255,255,0.12)` | Hairlines |
| `--accent` | `#2DD4BF` | CTA / focus |
| `--danger` | `#FB7185` | Errors |
| `--success` | `#34D399` | Saved |

## Typography

- **UI:** Outfit + IBM Plex Sans Arabic
- **Mono:** IBM Plex Mono

## Motion (Emil)

- Enter: `cubic-bezier(0.23, 1, 0.32, 1)` ease-out, ~280–420ms
- Press: `scale(0.97)`
- Prefer transform/opacity only
- Respect `prefers-reduced-motion`

## Components

Glass nav, glass cards, lucide icons, Sonner toasts, motion for page/list enter.
