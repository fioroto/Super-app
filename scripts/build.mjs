import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';
import { rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

await mkdir(path.join(root, 'dist'), { recursive: true });
if (!watch) await rm(path.join(root, 'dist'), { recursive: true, force: true });

const server = {
  entryPoints: [path.join(root, 'server/src/main.ts')],
  outfile: path.join(root, 'dist/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: !watch,
  legalComments: 'none',
};

if (watch) {
  const ctx = await (await import('esbuild')).context(server);
  await ctx.watch();
  await viteBuild({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.ts'), build: { watch: {} } });
} else {
  await viteBuild({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.ts'), logLevel: 'warn' });
  await esbuild(server);
  console.log('build ok → dist/');
}
