import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { localWaitlistPlugin } from './server/waitlist.ts'

const root = import.meta.dirname

/** Meta's domain verification tag, from VITE_META_DOMAIN_VERIFICATION. Left out when unset. */
function metaDomainVerification(token: string | undefined): Plugin {
  const value = token?.trim() ?? ''
  return {
    name: 'meta-domain-verification',
    transformIndexHtml(html) {
      const tag = /^[a-z0-9]{10,64}$/i.test(value) ? `<meta name="facebook-domain-verification" content="${value}" />` : ''
      return html.replace('<!--meta-domain-verification-->', tag)
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), localWaitlistPlugin(), metaDomainVerification(loadEnv(mode, root, 'VITE_').VITE_META_DOMAIN_VERIFICATION)],
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
}))
