import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
  },
});
