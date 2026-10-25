import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [preact()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 4000,
    reportCompressedSize: false,
  },
});
