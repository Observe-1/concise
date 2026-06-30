import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // A finance app must never show stale cached figures when offline —
      // precache only the static app shell (instant load), and never the
      // API: every data fetch always hits the network or visibly fails.
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        name: 'Concise',
        short_name: 'Concise',
        description: 'A minimalist personal finance tracker — your wealth, at a glance.',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    // "assets" would collide with the SPA's /assets route when served by Express
    assetsDir: 'static',
  },
  resolve: {
    alias: {
      // Single source of truth for API DTOs (pure module, no node deps).
      '@api': path.resolve(__dirname, '../server/src/types/api.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // No changeOrigin: the backend's CSRF check compares Origin to Host,
      // so the original Host header must be preserved.
      '/api': 'http://localhost:3002',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
  },
});
