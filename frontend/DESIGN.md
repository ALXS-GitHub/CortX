# CortX design system — "Halcyon"

CortX shares its visual language with Zorg: a calm, premium desktop feel.
Faintly tinted canvas, frosted-glass panels, large radii, soft depth. One
accent colour leads (teal by default, user-customisable), coral punctuates.
Everything is driven by CSS variables. A **skin** is one file under
`src/styles/` that defines the whole token set (colours, typography, shape,
effects, component knobs — see `src/styles/tokens.md`): `theme-halcyon.css`
(default) and `theme-classic.css` (the previous near-native shadcn look,
`data-skin="classic"`). `src/index.css` only maps the tokens to Tailwind
utilities and holds the shared component CSS. The runtime knobs (skin,
accent, radius, font) live in `src/lib/theme.ts`, the light/dark mode in the
app settings. Accent and font apply to both skins (accent `undefined` = the
skin's own primary); the radius knob is Halcyon-only.

Components must never hard-code a colour, radius, shadow or blur: use the
utilities below (or `var(--token)` in an arbitrary value) so both skins stay
correct.

## Tokens (Tailwind classes)

| Role | Class | Notes |
|---|---|---|
| Canvas | `bg-background` | tinted, with radial washes painted on `<body>` |
| Surface | `bg-card` | cards, list rows |
| Glass | `.glass` / `.glass-strong` | sidebar, title bar, dialogs, popovers, menus |
| Text | `text-foreground`, `text-muted-foreground`, `text-faint` | never pure black/white |
| Accent | `bg-primary`, `text-primary`, `bg-accent` (12–16 % tint), `border-accent-border` | |
| Borders | `border-border` (hairline), `border-border-strong` (menus, dialogs, dashed empty states) | |
| Status | `text-st-done` (green-teal), `text-st-progress` (amber), `text-st-blocked` (coral), `text-st-open` (sky) | also `success` / `warning` / `info` / `destructive` |
| Shadows | `shadow-soft` (cards), `shadow-pop` (floating panels, hover lift) | |
| Radii | `rounded-sm` ≈10 px (buttons, inputs, chips, menu items), `rounded-lg` ≈16 px (cards), `rounded-xl` ≈22 px (dialogs, large panels) | scale with `--radius` |
| Fonts | `font-display` (Outfit — headings, titles), default sans (Plus Jakarta Sans), `font-mono` (JetBrains Mono — paths, commands, ports) | |
| Eyebrow | `.eyebrow` | 10.5 px uppercase tracking label for group / section titles |
| Kbd | `.kbd` | keyboard hint |

## Building blocks

- **`layout/Screen`** — every screen: sticky glass header with `title`,
  `subtitle`, optional `eyebrow`, `onBack`, right-aligned `actions`, and an
  optional `toolbar` row (search, filters, `ViewModeToggle`). Content scrolls
  inside (`p-5`), or `fill` for full-height workbenches. `narrow` centres the
  content at `max-w-3xl` (settings, forms).
- **`ui/card`** — `<Card>` (16 px radius, hairline border, soft shadow).
  `interactive` adds the hover lift for clickable cards. `size="sm"` tightens
  the padding for list rows.
- **`ui/button`** — `default` (accent with glow), `outline` (card surface),
  `ghost`, `secondary`, `destructive`, `destructive-soft`, `link`. Sizes
  `xs`/`sm`/`default`/`lg` and `icon-*`. Icons inside buttons need no size class.
- **`ui/badge`** — neutral pills for counts and metadata (`secondary`), and
  tinted `success`/`warning`/`info`/`destructive` variants for runtime state.
- **`ui/Chip`** — colour-coded pill (tags, statuses, agent providers). Use
  `TagBadge` / `StatusBadge` which wrap it with the user's definitions.
- **`ui/StatusDot`** — runtime dot: `status="running"` pulses, `starting` is
  half, `completed` filled green, `failed` filled coral, idle outlined.
- **`ui/Segmented`** — iOS-style segmented control (view modes, small option
  sets). `ui/tabs` with `variant="line"` for page sections, `default` for a
  segmented look inside a card. `TabsCount` shows a count next to a tab label.
- **`ui/EmptyState`** — icon + title + description + action, `compact` inside a
  card or a dashed box (`rounded-lg border border-dashed border-border-strong`).
- **Dialogs** — `Dialog` / `AlertDialog` / `Sheet` are frosted glass with a
  footer bar (`DialogFooter` handles the border + tint). Cancel = `ghost`,
  destructive confirm = `<AlertDialogAction variant="destructive">`.
- **Menus** — `DropdownMenu` items take a leading icon (no size class needed),
  destructive items use `variant="destructive"`, sections use
  `DropdownMenuLabel` + `DropdownMenuSeparator`.

## Rules of thumb

- Titles in `font-display` semibold with `tracking-tight`; body 13.5 px.
- Paths, commands and ports in `font-mono text-[11px]` on `text-faint` or
  `text-muted-foreground`.
- Hover-only controls: `opacity-0 group-hover:opacity-100` on a `group` parent.
- Prefer `text-faint` for icons at rest, `text-primary` when active.
- No raw Tailwind colours (`text-green-500`, `bg-blue-500/20`…): use the status
  tokens above so the accent and the dark mode stay coherent.
- Spacing: screens `p-5`, cards `px-4 py-3` (sm) or `p-5`, gaps `gap-2`/`gap-3`.
- Keep lists dense: rows 40 px (compact) / cards with 3 lines max.
- The terminal dock follows the app theme: `bg-terminal` is the xterm canvas
  colour (white in light mode, deep navy in dark mode); the xterm palette is
  rebuilt automatically when the `dark` class changes.
