import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { localWaitlistPlugin } from './server/waitlist.ts'

const root = import.meta.dirname

export default defineConfig({
  plugins: [react(), tailwindcss(), localWaitlistPlugin()],
  base: './',
  resolve: { alias: { '@': path.resolve(root, './src') } },
  server: { port: 4310, strictPort: true },
  build: {
    rollupOptions: {
      // The landing page, the admin dashboard and the legal pages are separate
      // documents, so dashboard code never ships with the public page.
      input: {
        main: path.resolve(root, 'index.html'),
        admin: path.resolve(root, 'admin/index.html'),
        privacy: path.resolve(root, 'privacy/index.html'),
        terms: path.resolve(root, 'terms/index.html'),
      },
    },
  },
})
