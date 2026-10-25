// Confere o orçamento de peso. Sai com código 1 se algum limite estourar.
import { readFile, readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'dist/web');
const LIMIT_INITIAL_KB = 220;
const LIMIT_ZIP_MB = 5;

const kb = (n) => (n / 1024).toFixed(1);
const gz = async (file) => gzipSync(await readFile(file), { level: 9 }).length;

const html = await readFile(path.join(web, 'index.html'), 'utf8').catch(() => {
  console.error('dist/web/index.html não existe. Rode `npm run build` antes.');
  process.exit(1);
});

// Tudo que o index.html carrega antes de qualquer import dinâmico.
const initial = new Set();
for (const m of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)) {
  if (m[1].startsWith('/') && /\.(js|mjs|css)$/.test(m[1])) initial.add(m[1].slice(1));
}

let failed = false;
let total = 0;
console.log('Carregado ao abrir o app:');
for (const f of [...initial].sort()) {
  const size = await gz(path.join(web, f));
  total += size;
  console.log(`  ${f.padEnd(44)} ${kb(size).padStart(8)} KB gzip`);
}
console.log(`  ${'TOTAL'.padEnd(44)} ${kb(total).padStart(8)} KB gzip  (limite ${LIMIT_INITIAL_KB} KB)`);
if (total > LIMIT_INITIAL_KB * 1024) {
  console.error('  ✗ JS inicial passou do orçamento');
  failed = true;
}

const lazy = [];
const walk = async (dir) => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else if (/\.(js|mjs|css)$/.test(e.name)) {
      const rel = path.relative(web, p).split(path.sep).join('/');
      if (!initial.has(rel)) lazy.push([rel, await gz(p)]);
    }
  }
};
await walk(web);
if (lazy.length) {
  lazy.sort((a, b) => b[1] - a[1]);
  console.log('\nSob demanda (não conta no orçamento):');
  for (const [f, s] of lazy.slice(0, 12)) console.log(`  ${f.padEnd(44)} ${kb(s).padStart(8)} KB gzip`);
  if (lazy.length > 12) console.log(`  … e mais ${lazy.length - 12} pedaços`);
}

const zip = path.join(root, 'super-app.zip');
const zs = await stat(zip).catch(() => null);
if (zs) {
  console.log(`\nsuper-app.zip: ${(zs.size / 1048576).toFixed(2)} MB (limite ${LIMIT_ZIP_MB} MB)`);
  if (zs.size > LIMIT_ZIP_MB * 1048576) {
    console.error('  ✗ zip passou do orçamento');
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
