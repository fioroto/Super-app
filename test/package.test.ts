import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launch } from './helpers.ts';

const root = path.resolve(import.meta.dirname, '..');
let tmp: string;
let server: ChildProcess;
let base = '';
let token = '';
let startMs = 0;
let browser: Browser;

/** Extrai com o módulo zipfile do Python: um leitor de .zip independente do que escreveu o arquivo. */
const unzip = (zip: string, to: string) => execFileSync('python3', ['-I', '-c',
  'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; z.extractall(sys.argv[2])', zip, to]);

beforeAll(async () => {
  execFileSync(process.execPath, ['scripts/package.mjs'], { cwd: root, stdio: 'pipe' });
  tmp = await mkdtemp(path.join(os.tmpdir(), 'superapp-pkg-'));
  unzip(path.join(root, 'super-app.zip'), path.join(tmp, 'instalado'));
  const vault = path.join(tmp, 'notas');
  await mkdir(vault);
  await writeFile(path.join(vault, 'oi.md'), '# Oi\n');

  // Roda de uma pasta sem node_modules por perto: o pacote tem que bastar.
  const t0 = performance.now();
  server = spawn(process.execPath, [path.join(tmp, 'instalado/super-app/dist/server.mjs'), vault, '--no-open', '--port', '0'], {
    cwd: tmp, env: { ...process.env, SUPERAPP_HOME: path.join(tmp, 'home') },
  });
  const url = await new Promise<string>((resolve, reject) => {
    let out = '';
    server.stdout!.on('data', (d) => {
      out += d;
      const m = /(http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)/.exec(out);
      if (m) resolve(m[1]!);
    });
    server.once('exit', (c) => reject(new Error(`servidor saiu com ${c}: ${out}`)));
    setTimeout(() => reject(new Error('servidor não subiu em 10 s')), 10_000);
  });
  startMs = performance.now() - t0;
  base = new URL(url).origin;
  token = new URL(url).searchParams.get('t')!;
  browser = await launch();
});

afterAll(async () => {
  server?.kill();
  await browser?.close();
  await rm(tmp, { recursive: true, force: true });
});

describe('pacote de distribuição', () => {
  it('o .zip cabe em 5 MB, tem o conteúdo esperado e não leva node_modules', () => {
    const size = readFileSync(path.join(root, 'super-app.zip')).length;
    console.log(`super-app.zip: ${(size / 1048576).toFixed(2)} MB`);
    expect(size).toBeLessThan(5 * 1048576);
    const listing = execFileSync('python3', ['-I', '-c', 'import sys,zipfile; print("\\n".join(i.filename for i in zipfile.ZipFile(sys.argv[1]).infolist()))', path.join(root, 'super-app.zip')]).toString().split('\n');
    for (const f of ['super-app/iniciar.bat', 'super-app/iniciar.sh', 'super-app/LEIAME.md', 'super-app/dist/server.mjs', 'super-app/dist/web/index.html', 'super-app/dist/web/canvas.html']) expect(listing).toContain(f);
    expect(listing.some((f) => f.includes('node_modules') || f.endsWith('.map'))).toBe(false);
  });

  it('iniciar.sh sai executável e iniciar.bat sai com quebras de linha do Windows', () => {
    const out = execFileSync('python3', ['-I', '-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(oct(z.getinfo("super-app/iniciar.sh").external_attr>>16)); print(z.read("super-app/iniciar.bat").count(b"\\r\\n"))', path.join(root, 'super-app.zip')]).toString().trim().split('\n');
    expect(out[0]).toBe('0o100755');
    expect(Number(out[1])).toBeGreaterThan(5);
  });

  it('o servidor instalado sobe sem npm install, rápido e leve', async () => {
    console.log(`servidor pronto em ${startMs.toFixed(0)} ms`);
    expect(startMs).toBeLessThan(1500);
    const cookie = `sa=${token}`;
    const tree = await (await fetch(`${base}/api/tree`, { headers: { cookie } })).json();
    expect(tree.children.map((c: { name: string }) => c.name)).toEqual(['oi.md']);
    for (const url of ['/', '/canvas.html', '/excalidraw/fonts/Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2']) {
      const r = await fetch(base + url, { headers: { cookie } });
      expect(r.status, url).toBe(200);
    }
    if (process.platform === 'linux') {
      const rss = Number(/VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${server.pid}/status`, 'utf8'))![1]) / 1024;
      console.log(`RSS do servidor parado: ${rss.toFixed(0)} MB`);
      expect(rss).toBeLessThan(60);
    }
  });

  it('a interface do pacote abre a primeira tela rápido, sem chamar a internet', async () => {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: 'sa', value: token, url: base }]);
    const page = await ctx.newPage();
    const external: string[] = [];
    page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:')) external.push(r.url()); });
    await page.goto(base);
    await page.locator('.side-head').waitFor();
    const fcp = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1);
    console.log(`primeira tela: ${fcp.toFixed(0)} ms`);
    expect(fcp).toBeGreaterThan(0);
    expect(fcp).toBeLessThan(1500);
    await page.locator('.tree-item', { hasText: 'oi.md' }).click();
    await page.locator('.preview h1').waitFor();
    expect(external).toEqual([]);
    await ctx.close();
  });
});
