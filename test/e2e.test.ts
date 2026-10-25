import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launch, newContext, startApp, type App } from './helpers.ts';

let browser: Browser;
let app: App;
beforeAll(async () => {
  browser = await launch();
  app = await startApp({ 'notas/a.md': '# Título\n\ntexto\n', 'b.md': 'outra\n' });
});
afterAll(async () => {
  await browser?.close();
  await app?.close();
});

describe('abrir e salvar', () => {
  it('mostra a árvore, abre uma nota, edita e grava no disco', async () => {
    const ctx = await newContext(browser, app);
    const page = await ctx.newPage();
    await page.goto(app.base);

    await page.getByRole('button', { name: 'a.md' }).click();

    const box = page.locator('textarea.raw');
    await expect.poll(() => box.inputValue()).toBe('# Título\n\ntexto\n');

    await box.fill('# Título\n\nmudei\n');
    await expect.poll(() => readFile(path.join(app.vault, 'notas/a.md'), 'utf8'), { timeout: 5000 }).toBe('# Título\n\nmudei\n');
    await expect.poll(() => page.locator('.status').innerText()).toBe('salvo');
    await ctx.close();
  });

  it('sem pasta aberta, mostra o seletor e abre a escolhida', async () => {
    const empty = await startApp({}, { vault: false });
    try {
      const ctx = await newContext(browser, empty);
      const page = await ctx.newPage();
      await page.goto(empty.base);
      await expect.poll(() => page.getByRole('heading', { name: /Escolha a pasta/ }).count()).toBe(1);
      await page.evaluate((p) => fetch('/api/vault', { method: 'POST', body: JSON.stringify({ path: p }) }), app.vault);
      await page.reload();
      await expect.poll(() => page.locator('.side-head').innerText()).toBe('vault');
      await ctx.close();
    } finally {
      await empty.close();
    }
  });
});
