/// <reference types="vitest/config" />
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // GitHub Pages serves the app under /my-badminton-queue/; set by the deploy workflow.
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    // GitHub Pages has no fallback for paths like /my-badminton-queue/<club link>:
    // it serves 404.html, so that's the app too (it routes on the path).
    {
      name: 'pages-404',
      apply: 'build',
      writeBundle: ({ dir }) => copyFileSync(join(dir!, 'index.html'), join(dir!, '404.html')),
    },
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'MBQ - My Badminton Queue',
        short_name: 'MBQ',
        description: 'Badminton court queue, balanced games and cost split',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'landscape',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
})
