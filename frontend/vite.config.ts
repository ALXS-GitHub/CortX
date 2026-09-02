import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"
import tailwindcss from '@tailwindcss/vite'

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
    watch: {
      // Cargo's output is rewritten while `tauri dev` compiles; watching it
      // makes Vite crash with EBUSY on Windows.
      ignored: ['**/target/**', '**/src-tauri/**'],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
