import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev server config.
 * - Binds to 0.0.0.0 so preview environments can reach it.
 * - Proxies /api to the Express server, so the browser only ever talks to
 *   one origin (no CORS, no tokens in the browser).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
