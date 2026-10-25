import { cp, readdir } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

const here = import.meta.dirname;

// O Excalidraw busca as fontes em /excalidraw/fonts. Copia as latinas e deixa de fora a CJK
// (Xiaolai, 13 MB): quem escreve em chinês/japonês/coreano cai na fonte do sistema.
const excalidrawFonts = (): Plugin => ({
  name: 'excalidraw-fonts',
  async writeBundle(options) {
    const src = path.resolve(here, '../node_modules/@excalidraw/excalidraw/dist/prod/fonts');
    const out = path.join(options.dir ?? path.resolve(here, '../dist/web'), 'excalidraw/fonts');
    for (const family of await readdir(src)) {
      if (family !== 'Xiaolai') await cp(path.join(src, family), path.join(out, family), { recursive: true });
    }
  },
});

export default defineConfig({
  root: here,
  plugins: [preact(), excalidrawFonts()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 4000,
    reportCompressedSize: false,
    rollupOptions: { input: { main: path.join(here, 'index.html'), canvas: path.join(here, 'canvas.html') } },
  },
});
