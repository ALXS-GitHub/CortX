import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    react({
      babel: {
        // babel-plugin-react-compiler is a Babel transform that runs on every
        // changed file. In dev (HMR) it noticeably slows down each save and
        // initial cold-start, especially on macOS WebKit. Its only purpose is
        // to add memoization, which doesn't change correctness — so we run it
        // only for production builds.
        plugins: command === 'build'
          ? [['babel-plugin-react-compiler', {}]]
          : [],
      },
    }),
    tailwindcss(),
  ],
  server: {
    port: 12321,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}))
