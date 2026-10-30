import { defineConfig } from 'vite';

// In dev, Vite serves the client on :5173 and proxies the game socket and /version to the server on :8787.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/version': 'http://localhost:8787',
      '/health': 'http://localhost:8787',
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
});
