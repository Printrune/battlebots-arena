import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist/client', sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { middlewareMode: true },
});
