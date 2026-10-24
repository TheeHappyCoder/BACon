import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Rasher reuses BACon's design system straight from ../../web/src. Those files resolve their packages from BACon's
// node_modules, so dedupe makes React and friends come from here: one copy of each, or hooks and context break.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@ui': here('../../web/src/ui'), '@bacon': here('../../web/src') },
    dedupe: ['react', 'react-dom', 'framer-motion', '@base-ui/react', '@hugeicons/react', '@hugeicons/core-free-icons', 'class-variance-authority', 'clsx', 'tailwind-merge'],
  },
  // the backend serves the built UI from inside the Python package
  build: { outDir: '../src/rasher/web', emptyOutDir: true },
  server: {
    port: 5174,
    proxy: { '/api': 'http://127.0.0.1:8048' },
    fs: { allow: [here('../..')] },
  },
})
