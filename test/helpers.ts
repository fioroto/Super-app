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

export async function startApp(files: Record<string, string> = {}, opts: { vault?: boolean; now?: () => number } = {}): Promise<App> {
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
    now: opts.now,
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

export type Mode = 'doc' | 'editor' | 'split';

/**
 * Fixa o modo de edição e liga o gancho de teste (`window.__cmView`) antes de a página carregar.
 * Os testes antigos esperam o painel duplo, então o padrão é `split`; `null` deixa o app escolher.
 */
export async function setMode(ctx: BrowserContext, mode: Mode | null = 'split'): Promise<void> {
  await ctx.addInitScript((m) => {
    localStorage.setItem('superapp.test', '1');
    if (m) localStorage.setItem('superapp.mode', m);
  }, mode);
}

export async function newContext(browser: Browser, app: App, opts: { mode?: Mode | null } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  ctx.setDefaultTimeout(5000);
  await ctx.addCookies([{ name: 'sa', value: app.run.token, url: app.base }]);
  await setMode(ctx, opts.mode === undefined ? 'split' : opts.mode);
  return ctx;
}

/** Sobe o app com os arquivos dados, abre a página já autenticada e limpa tudo no fim. */
export async function withPage(
  browser: Browser,
  files: Record<string, string>,
  fn: (page: Page, app: App) => Promise<void>,
  opts: { mode?: Mode | null } = {},
): Promise<void> {
  const app = await startApp(files);
  const ctx = await newContext(browser, app, opts);
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
