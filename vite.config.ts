import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  worker: { format: 'es' },
  build: { outDir: 'dist/client', sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { middlewareMode: true },
});
