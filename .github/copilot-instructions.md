# Local App Launcher - AI Coding Agent Instructions

## Project Overview

Desktop application launcher built with Tauri v2 + React 19 + TypeScript. The architecture splits frontend (React) and backend (Rust) within a single monorepo under `frontend/`.

## Architecture & Project Structure

```
frontend/
  src/              # React app with TypeScript
  src-tauri/        # Rust backend for Tauri
  dist/             # Build output (generated)
```

**Critical path quirk**: All work happens in `frontend/` directory. The `src-tauri/` folder is nested inside, not a sibling.

## Key Technology Choices

### React Compiler (Experimental)
- **React Compiler** is ENABLED via `babel-plugin-react-compiler` in [vite.config.ts](frontend/vite.config.ts)
- Write standard React - compiler auto-optimizes re-renders
- No manual `useMemo`/`useCallback` needed in most cases

### Vite Override
Uses `rolldown-vite@7.2.5` (not standard Vite) via package overrides for improved build performance. Check [package.json](frontend/package.json) `overrides` field before modifying.

### UI Component System
- **shadcn/ui** with Radix Vega style configured in [components.json](frontend/components.json)
- **Base UI** (@base-ui/react) for headless primitives
- **Tailwind v4** with CSS variables for theming
- **CVA** (class-variance-authority) for component variants

Component pattern from [button.tsx](frontend/src/components/ui/button.tsx):
```tsx
const buttonVariants = cva("base-classes", {
  variants: { variant: {...}, size: {...} },
  defaultVariants: { variant: "default", size: "default" }
})
```

### Import Aliases
Path aliases configured in [tsconfig.json](frontend/tsconfig.json) and [vite.config.ts](frontend/vite.config.ts):
- `@/` → `./src/`
- All components use `@/components/ui/*` imports
- Utils at `@/lib/utils`

## Development Workflows

### Commands
Run from `frontend/` directory:

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server only (port 12321) |
| `npm run tauri:dev` | Full Tauri app with hot reload |
| `npm run build` | Production build |
| `npm run tauri:build` | Build desktop binaries |

**Dev server port**: Hard-coded to **12321** in [vite.config.ts](frontend/vite.config.ts) and [tauri.conf.json](frontend/src-tauri/tauri.conf.json). Changing one requires updating both.

### Package Manager
Prefers **Bun** (mentioned in README) but npm works. No lockfile committed suggests flexibility.

## Styling Conventions

### Tailwind Setup
- Uses Tailwind v4 with **@layer** and **@import** syntax in [index.css](frontend/src/index.css)
- Theme uses **oklch** color space for all CSS variables
- Custom dark mode variant: `@custom-variant dark (&:is(.dark *))`
- Imports: `tw-animate-css`, `shadcn/tailwind.css`, Inter font

### Class Merging
Always use `cn()` helper from [utils.ts](frontend/src/lib/utils.ts):
```tsx
import { cn } from "@/lib/utils"
<div className={cn("base-class", conditionalClass)} />
```

## Tauri Integration

### Configuration
- Rust workspace in [Cargo.toml](frontend/src-tauri/Cargo.toml) with `staticlib`, `cdylib`, `rlib` crate types
- Library name: `app_lib` (not "app")
- Entry point: [lib.rs](frontend/src-tauri/src/lib.rs) exports `run()` function
- Logging plugin enabled only in debug builds

### Window Configuration
Default window from [tauri.conf.json](frontend/src-tauri/tauri.conf.json):
- 800x600, resizable, windowed
- No CSP restrictions (`"csp": null`)

## Adding Features

### New UI Components
1. Use shadcn CLI to add components to `src/components/ui/`
2. Follow the pattern in [button.tsx](frontend/src/components/ui/button.tsx): CVA variants + Radix primitives
3. Always support `asChild` prop for composition via `Slot.Root`

### Tauri Commands
Add Rust functions in [lib.rs](frontend/src-tauri/src/lib.rs) and register in `.invoke_handler()` chain.

### Icons
Uses **lucide-react**. See [component-example.tsx](frontend/src/components/component-example.tsx) for import pattern.

## Common Pitfalls

1. **Working directory**: Commands must run from `frontend/`, not repo root
2. **Port conflicts**: Dev server uses 12321, not standard 5173
3. **Vite version**: Don't upgrade `vite` package - uses rolldown override
4. **React Compiler**: Components already optimized, avoid over-optimizing
5. **Imports**: Use `@/` prefix, never relative paths like `../../components`