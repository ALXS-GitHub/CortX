# CortX design system — Zinc

CortX is built on **Zinc**, the design system shared by the user's apps. Its
source of truth is the sibling clone `../../Zinc` (repository
`ALXS-GitHub/Zinc`): tokens, theme engine, `zn-` components, the shadcn layer
and the guide (`docs/guide.md`). Read that guide first; this file only covers
what is specific to CortX.

**Anything wrong in the look of a Zinc component is fixed in Zinc**, committed
and pushed there, never patched locally.

## How it is wired

- **Consumed from source.** Bun cannot install Zinc as a `file:` dependency
  (it copies the clone's `.git` and fails on Windows), so `@zinc/ui` and
  `@zinc/ui/theme` are aliases (`vite.config.ts`, `tsconfig.app.json`), and
  `src/index.css` imports `../../../Zinc/src/styles/zinc.css` and
  `../../../Zinc/src/tailwind/shadcn.css`. CI checks the clone out next to the
  repository (`ZINC_TOKEN` secret, see `.github/workflows/`).
- **shadcn/ui stays.** The components in `components/ui/*` carry `data-slot`
  attributes; Zinc's shadcn layer imposes its heights, corners, borders, focus
  and typography on them, whatever their Tailwind classes. A `h-10` or
  `rounded-xl` on a shadcn component changes nothing.
- **Colours** come from the Zinc engine (`lib/theme.ts`): three seeds, a
  **neutral** and an **accent** (per machine, localStorage, Settings →
  Appearance; CortX's default is teal on slate) and the **mode** (backend
  settings, `system` follows the OS). Any accent colour works.
- **CortX's profile** (`src/styles/cortx-profile.css`) adds the runtime status
  colours and bridges the legacy token names the terminal code still reads
  (`--bg-terminal`, `--bg-input`, `--rad-*`, `--font-mono-stack`…) onto Zinc.
  New code reads the Zinc names.

## Shell (Panneau style)

- `layout/AppTopBar` — on the shell background: the brand above the sidebar,
  the search pill (opens the command palette, Ctrl K), the app menu and the
  window buttons. The whole strip drags the window.
- `layout/AppSidebar` — on the shell background, Zinc nav items
  (`zn-nav`): Projects / Scripts / Agents, then *Library* (Tools, Apps, Shell
  config, Utilities), then *Running* (live services and scripts by project,
  only when something runs or has output). Settings, light/dark and the
  collapse toggle at the bottom. Ctrl+B collapses it to an icon rail.
- The **panel** (`bg-surface`, border, `rounded-lg`, `shadow-sm`, 6 px from
  the window edges) holds the current screen and the terminal dock under it.
- `layout/Screen` — every screen: page title (`zn-page-title`, once per
  view) with its subtitle, optional eyebrow and back button, actions on the
  right (one `default` button at most), optional toolbar row (search,
  filters, view switcher), a hairline, then the content, which scrolls on its
  own. `fill` for full-height workbenches, `narrow` for reading width.
- The Terminal window keeps its own chrome (`layout/TitleBar`) and its Warp
  themes; when a theme is applied it writes the Zinc tokens itself
  (`lib/terminalTheme.ts`), and the app theme stands back.

## Tokens (Tailwind classes)

| Role | Class |
|---|---|
| Planes | `bg-bg` (shell), `bg-surface` / `bg-background` (panel, menus, dialogs, fields), `bg-card` / `bg-surface-subtle` (cards and rows in the panel), `bg-surface-muted` / `bg-accent` (hover, tags, tab track), `bg-terminal` (terminal and code) |
| Text | `text-foreground`, `text-muted-foreground`, `text-faint` |
| Accent | `bg-primary` (solid: main button, checked switch), `text-primary` (resolves to the readable `accent-text`), `bg-accent-soft` |
| Borders | `border-border` (cards, panel), `border-border-strong` (hover of clickable cards), `border-input` (controls) |
| Status | `text-st-done`, `text-st-progress`, `text-st-blocked`, `text-st-open` (on Zinc's success / warning / danger / info) and `text-st-agent` (violet: an agent at work, nothing else) |
| Corners | `rounded-xs` (tags, kbd), `rounded-sm` (buttons, fields), `rounded-md` (cards, nav items, menus), `rounded-lg` (panel, dialogs) |
| Shadows | none on cards; `shadow-sm` for the panel and active items; `shadow-pop` for what floats |
| Type | sans (Hanken Grotesk), `font-mono` (JetBrains Mono) to *display* paths, commands, ports; `eyebrow` for group titles; `kbd` for shortcuts; 12 px minimum (`text-xs`) |

## Building blocks

- **`ui/card`** — `<Card>`: `surface-subtle`, hairline border, no shadow.
  `interactive` for clickable cards (stronger border and panel surface on
  hover, never a lift). `size="sm"` for list rows.
- **`ui/Chip`** — status pill (project statuses, agent states): Zinc's chip,
  the colour in its dot. **`ui/TagBadge`** — a tag (Zinc tag: small corners,
  muted ground); a tag the user gave a colour keeps it as a dot.
- **`ui/StatusDot`** — runtime dot: `running` pulses, `starting` is half,
  `completed` filled green, `failed` filled red, idle outlined. Agents and
  terminals (ticket #48): `tone="agent"` pulses violet, `warning` is solid
  amber (an agent waiting for you), `ready` is a solid grey dot (a shell at
  its prompt). Draw them through `AgentStateDot` / `TerminalStatusGlyph`
  (`AGENT_DOT_TONE` in `agents/agentUtils.ts`), never by hand.
- **`ui/Segmented`** — segmented control (view modes, small option sets).
- **`ui/EmptyState`** — icon + title + description + action.
- **Dialogs** — `Dialog` / `AlertDialog` / `Sheet` on the panel surface with
  `shadow-pop`. Cancel = `ghost`, destructive confirm =
  `<AlertDialogAction variant="destructive">`.
- **Menus** — `DropdownMenu` items take a leading icon, destructive items use
  `variant="destructive"`.

## Rules of thumb

- One accent: it marks the main action and what is active. Everything else is
  neutral; status colours only for states, always with a word or an icon.
- No glass, no gradients, no lift on hover, no emoji, no coloured left borders.
- No raw Tailwind colours (`text-green-500`…), no hard-coded radius or shadow.
- Paths, commands and ports: `font-mono text-xs` on `text-faint` or
  `text-muted-foreground`. Inside an input, keep the sans font.
- Hover-only controls: `opacity-0 group-hover:opacity-100` on a `group` parent.
- The terminal dock follows the app theme (`bg-terminal` is Zinc's
  `surface-sunken`); the xterm palette is rebuilt when the `dark` class
  changes.
