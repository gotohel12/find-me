import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: { '/v1': 'http://localhost:8787', '/health': 'http://localhost:8787' },
    fs: { allow: ['..'] },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // The game canvas (PixiJS) is loaded with dynamic import() from the editor and
    // seek screens, so it stays out of the first load (spec: initial JS < 200 KB gzipped).
  },
});
