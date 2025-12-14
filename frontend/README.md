# Local App Launcher - Frontend

This is the frontend for Local App Launcher, built with:

- **React 19** with TypeScript
- **Vite** (using rolldown-vite for better performance)
- **React Compiler** (enabled via babel-plugin-react-compiler)
- **Tauri** for desktop application capabilities

## Development

The development server runs on port **12321**.

### Using Bun (recommended)

```bash
bun install
bun run dev
```

### Using npm (fallback)

```bash
npm install
npm run dev
```

## Tauri Development

To run the Tauri desktop app:

```bash
npm run tauri dev
```

## Building

```bash
npm run build
```

## React Compiler

This project uses the React Compiler (experimental) for automatic optimization of React components. It's configured in `vite.config.ts` using the babel plugin.

## Project Structure

- `src/` - React application source code
- `src-tauri/` - Tauri backend (Rust)
- `public/` - Static assets
- `dist/` - Build output
