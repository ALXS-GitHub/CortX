import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"
import tailwindcss from '@tailwindcss/vite'

// Zinc, the design system (../../Zinc, a sibling clone), is consumed from
// source. Bun cannot install it as a `file:` dependency (it copies the
// clone's .git and fails on Windows), so the package name is aliased here and
// in tsconfig.app.json. Its bare imports (react, radix-ui, lucide-react) are
// deduped onto this app's copies so there is one React.
const ZINC = path.resolve(__dirname, '../../Zinc')

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          ['babel-plugin-react-compiler', {}],
        ],
      },
    }),
    tailwindcss(),
  ],
  server: {
    port: 12321,
    fs: { allow: [__dirname, ZINC] },
    watch: {
      // Cargo's output is rewritten while `tauri dev` compiles; watching it
      // makes Vite crash with EBUSY on Windows.
      ignored: ['**/target/**', '**/src-tauri/**'],
    },
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: /^@zinc\/ui\/theme$/, replacement: path.join(ZINC, 'src/theme/index.ts') },
      { find: /^@zinc\/ui$/, replacement: path.join(ZINC, 'src/index.ts') },
    ],
    dedupe: ['react', 'react-dom', 'radix-ui', 'lucide-react'],
  },
})
