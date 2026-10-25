import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error: script .mjs sem tipos
import { precisa } from '../scripts/preparar.mjs';

const root = path.resolve(import.meta.dirname, '..');
let dir = '';
afterEach(() => rm(dir, { recursive: true, force: true }));

async function clone(files: Record<string, string>) {
  dir = await mkdtemp(path.join(os.tmpdir(), 'preparar-'));
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), content);
  }
}
const age = (rel: string, seconds: number) => {
  const t = new Date(Date.now() - seconds * 1000);
  return utimes(path.join(dir, rel), t, t);
};

describe('preparar (iniciar a partir de um clone do git)', () => {
  it('clone recém-baixado: instala e compila', async () => {
    await clone({ 'package.json': '{}', 'web/src/main.tsx': 'x' });
    expect(precisa(dir)).toEqual({ instalar: true, compilar: true });
  });

  it('já instalado e compilado depois da última mudança: nada a fazer', async () => {
    await clone({ 'package.json': '{}', 'node_modules/.package-lock.json': '{}', 'web/src/main.tsx': 'x', 'server/src/main.ts': 'y', 'dist/server.mjs': 'z' });
    await age('web/src/main.tsx', 60);
    await age('server/src/main.ts', 60);
    expect(precisa(dir)).toEqual({ instalar: false, compilar: false });
  });

  it('código mais novo que o dist (depois de um git pull): compila de novo', async () => {
    await clone({ 'package.json': '{}', 'node_modules/.package-lock.json': '{}', 'web/src/app/App.tsx': 'x', 'dist/server.mjs': 'z' });
    await age('dist/server.mjs', 60);
    expect(precisa(dir)).toEqual({ instalar: false, compilar: true });
  });

  it('dependências novas (package-lock mais novo) também recompilam', async () => {
    await clone({ 'package.json': '{}', 'node_modules/.package-lock.json': '{}', 'package-lock.json': '{}', 'dist/server.mjs': 'z' });
    await age('dist/server.mjs', 60);
    expect(precisa(dir).compilar).toBe(true);
  });
});

describe('scripts de início', () => {
  it('iniciar.bat: quebras de linha do Windows e preparar só num clone', async () => {
    const bat = await readFile(path.join(root, 'iniciar.bat'), 'utf8');
    expect(bat.split('\n').every((l) => l === '' || l.endsWith('\r'))).toBe(true);
    expect(bat).toMatch(/if exist "package\.json" \(\r\n\s+node scripts\\preparar\.mjs/);
    expect(bat).toContain('Extrair tudo');
  });

  it('iniciar.sh: chama o preparar só num clone', async () => {
    expect(await readFile(path.join(root, 'iniciar.sh'), 'utf8')).toMatch(/if \[ -f package\.json \]; then\n\s+node scripts\/preparar\.mjs/);
  });
});
