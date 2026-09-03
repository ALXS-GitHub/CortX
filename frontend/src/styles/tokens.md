# Theme tokens

A theme (a "skin") is one CSS file under `src/styles/` that defines **every**
variable below for light mode and for `.dark`. Components never hard-code a
colour, a radius or a shadow: they read these tokens (directly, or through the
Tailwind utilities mapped in `src/index.css`). Adding a theme = adding a file
with the full set + a `Skin` value in `src/lib/theme.ts`.

| Group | Tokens |
|---|---|
| Colours | `--background` `--foreground` `--card(-foreground)` `--popover(-foreground)` `--primary(-foreground)` `--secondary(-foreground)` `--muted(-foreground)` `--accent(-foreground)` `--destructive(-foreground)` `--success` `--warning` `--info` `--border` `--border-strong` `--input` `--ring` `--text-faint` `--accent-border` `--bg-sidebar` `--bg-glass` `--bg-input` `--bg-terminal` `--terminal-fg` `--st-open` `--st-progress` `--st-blocked` `--st-done` `--shadow-color` `--sidebar-*` `--chart-1..5` |
| Typography | `--font-display-stack` `--font-sans-stack` `--font-mono-stack` `--body-size` `--display-tracking` `--eyebrow-size` `--eyebrow-transform` `--eyebrow-tracking` |
| Shape | `--radius` `--rad-xs` `--rad-sm` (controls) `--rad-md` `--rad-lg` (cards) `--rad-xl` (dialogs) `--rad-2xl` `--rad-menu` (menus / popovers) `--rad-nav` (sidebar items) `--chip-radius` |
| Effects | `--elev-soft` (`shadow-soft`) `--elev-pop` (`shadow-pop`) `--glass-blur` `--glass-strong-blur` `--glass-saturate` `--overlay-bg` `--overlay-blur` `--lift-y` `--canvas-wash` |
| Components | `--btn-primary-shadow` `--btn-primary-hover` `--btn-primary-active` `--btn-outline-bg` `--btn-outline-border` `--btn-outline-hover` `--card-border` `--panel-border` `--tab-active-bg` `--tab-active-fg` `--tab-active-shadow` `--chip-border-mix` `--chip-bg-mix` `--chip-text-mix` `--chip-dot` `--footer-bg` `--footer-border` `--dot-idle-fill` |

Tailwind mapping (in `index.css`): `rounded-sm|md|lg|xl|2xl` → `--rad-*`,
`shadow-soft|pop` → `--elev-*`, colours → `bg-*/text-*/border-*` as usual,
`font-display|sans|mono` → the stacks (resolved through `data-font`).

Runtime overrides (`lib/theme.ts`, Halcyon only): `--primary` /
`--primary-foreground` (accent), `--radius` (corners), `data-font` (family).
