import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // the backend serves the built UI from inside the Python package
  build: { outDir: '../src/bacon/web', emptyOutDir: true },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8047' },
  },
})
