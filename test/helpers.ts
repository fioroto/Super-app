import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { startServer, type Running } from '../server/src/server.ts';

const root = path.resolve(import.meta.dirname, '..');

export interface App {
  run: Running;
  base: string;
  vault: string;
  home: string;
  /** fetch já autenticado com o cookie de sessão. */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export async function startApp(files: Record<string, string> = {}, opts: { vault?: boolean } = {}): Promise<App> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'superapp-'));
  const vault = path.join(tmp, 'vault');
  const home = path.join(tmp, 'home');
  await mkdir(vault, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(vault, rel)), { recursive: true });
    await writeFile(path.join(vault, rel), content);
  }
  const run = await startServer({
    vaultPath: opts.vault === false ? undefined : vault,
    port: 0,
    webRoot: path.join(root, 'dist/web'),
    home,
  });
  const base = `http://127.0.0.1:${run.port}`;
  const cookie = `sa=${run.token}`;
  return {
    run, base, vault, home,
    fetch: (url, init = {}) => fetch(base + url, { ...init, headers: { cookie, ...(init.headers as object) } }),
    close: async () => {
      await run.close();
      await rm(tmp, { recursive: true, force: true });
    },
  };
}

export async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
}

export async function newContext(browser: Browser, app: App): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  ctx.setDefaultTimeout(5000);
  await ctx.addCookies([{ name: 'sa', value: app.run.token, url: app.base }]);
  return ctx;
}

/** Sobe o app com os arquivos dados, abre a página já autenticada e limpa tudo no fim. */
export async function withPage(browser: Browser, files: Record<string, string>, fn: (page: Page, app: App) => Promise<void>): Promise<void> {
  const app = await startApp(files);
  const ctx = await newContext(browser, app);
  try {
    const page = await ctx.newPage();
    await page.goto(app.base);
    await page.locator('.side-head').waitFor();
    await fn(page, app);
  } finally {
    await ctx.close();
    await app.close();
  }
}
