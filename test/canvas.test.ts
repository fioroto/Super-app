import { copyFileSync } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launch, withPage } from './helpers.ts';

let browser: Browser;
beforeAll(async () => { browser = await launch(); });
afterAll(() => browser?.close());

const exemplo = path.join(import.meta.dirname, 'fixtures/exemplo.excalidraw.md');
const readIf = (file: string) => () => readFile(file, 'utf8').catch(() => null);
const dialogInput = (page: Page, text: string) => page.locator('.dialog input').fill(text).then(() => page.keyboard.press('Enter'));
const frame = (page: Page) => page.frameLocator('iframe.canvas-frame');

async function drawRectangle(page: Page) {
  const canvas = frame(page).locator('canvas.interactive');
  await canvas.waitFor({ timeout: 20_000 });
  const box = (await canvas.boundingBox())!;
  // O painel de propriedades cobre a esquerda; desenha na área livre à direita.
  await page.mouse.click(box.x + 600, box.y + 500);
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 560, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 700, box.y + 330, { steps: 6 });
  await page.mouse.up();
}

describe('desenho livre', () => {
  it('abre um desenho existente usando só recursos locais', async () => {
    await withPage(browser, {}, async (page, app) => {
      copyFileSync(exemplo, path.join(app.vault, 'exemplo.excalidraw.md'));
      const external: string[] = [];
      const bad: string[] = [];
      page.on('request', (r) => { if (!r.url().startsWith(app.base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
      page.on('response', (r) => { if (r.url().includes('/excalidraw/') && r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
      await page.locator('.tree-item', { hasText: 'exemplo.excalidraw.md' }).click();
      await frame(page).locator('canvas.interactive').waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      expect(external).toEqual([]);
      expect(bad).toEqual([]);
    });
  });

  it('cria um desenho, desenha e grava .excalidraw.md e .svg ao lado', async () => {
    await withPage(browser, {}, async (page, app) => {
      await page.getByRole('button', { name: '+ Desenho' }).click();
      await dialogInput(page, 'fluxo');
      const md = path.join(app.vault, 'fluxo.excalidraw.md');
      const svg = path.join(app.vault, 'fluxo.excalidraw.svg');
      await expect.poll(readIf(md), { timeout: 5000 }).toContain('excalidraw-plugin: parsed');

      await drawRectangle(page);
      await expect.poll(readIf(md), { timeout: 10_000 }).toContain('"type":"rectangle"');
      await expect.poll(readIf(svg), { timeout: 10_000 }).toMatch(/^<svg[\s\S]*<\/svg>$/);
      console.log(`svg: ${((await readFile(svg)).length / 1024).toFixed(0)} KB, md: ${((await readFile(md)).length / 1024).toFixed(1)} KB`);
      expect(await page.locator('.status').innerText()).toMatch(/salvo|editando/);
    });
  });

  it('o último traço é salvo ao fechar a aba logo depois de desenhar', async () => {
    await withPage(browser, {}, async (page, app) => {
      await page.getByRole('button', { name: '+ Desenho' }).click();
      await dialogInput(page, 'rapido');
      await drawRectangle(page);
      await page.locator('.tab', { hasText: 'rapido' }).getByTitle('Fechar').click();
      await expect.poll(readIf(path.join(app.vault, 'rapido.excalidraw.md')), { timeout: 8000 }).toContain('"type":"rectangle"');
    });
  });

  it('insere o desenho numa nota como imagem e mostra no preview', async () => {
    await withPage(browser, { 'nota.md': 'texto\n' }, async (page, app) => {
      copyFileSync(exemplo, path.join(app.vault, 'exemplo.excalidraw.md'));
      await mkdir(path.join(app.vault, 'x'), { recursive: true });
      await page.locator('.tree-item', { hasText: 'exemplo.excalidraw.md' }).waitFor();
      // Cria o .svg ao lado como o app faria depois de uma edição.
      await page.evaluate(() => fetch('/api/file', { method: 'PUT', body: JSON.stringify({ path: 'exemplo.excalidraw.svg', content: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="red"/></svg>', hash: null, force: true }) }));
      await page.locator('.tree-item', { hasText: 'nota.md' }).click();
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+End');
      await page.getByRole('button', { name: 'Desenho', exact: true }).click();
      await page.locator('.quick input').fill('exemplo');
      await page.keyboard.press('Enter');
      await expect.poll(readIf(path.join(app.vault, 'nota.md')), { timeout: 5000 }).toBe('texto\n![exemplo](exemplo.excalidraw.svg)');
      await expect.poll(() => page.locator('.preview img').evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 5000 }).toBe(40);
    });
  });

  it('desenho que o app não entende abre como texto, sem perder o arquivo', async () => {
    await withPage(browser, { 'estranho.excalidraw.md': '# Só um texto\n' }, async (page, app) => {
      await page.locator('.tree-item', { hasText: 'estranho' }).click();
      await page.getByRole('button', { name: 'Abrir como texto' }).click();
      await expect.poll(() => page.locator('.cm-content').innerText()).toContain('Só um texto');
      expect(await readFile(path.join(app.vault, 'estranho.excalidraw.md'), 'utf8')).toBe('# Só um texto\n');
    });
  });
});

describe('memória do canvas', () => {
  it('fechar o desenho devolve a memória (o iframe inteiro é descartado)', async () => {
    await withPage(browser, { 'nota.md': 'oi\n' }, async (page, app) => {
      copyFileSync(exemplo, path.join(app.vault, 'exemplo.excalidraw.md'));
      const cdp = await page.context().newCDPSession(page);
      const heap = async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        await cdp.send('HeapProfiler.collectGarbage');
        return ((await cdp.send('Runtime.getHeapUsage')) as { usedSize: number }).usedSize / 1048576;
      };
      await page.locator('.tree-item', { hasText: 'nota.md' }).click();
      await page.locator('.cm-content').waitFor();
      const before = await heap();

      await page.locator('.tree-item', { hasText: 'exemplo.excalidraw.md' }).click();
      await frame(page).locator('canvas.interactive').waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1000);
      const open = await heap();

      await page.locator('.tab', { hasText: 'exemplo.excalidraw.md' }).getByTitle('Fechar').click();
      await expect.poll(() => page.locator('iframe').count()).toBe(0);
      await page.waitForTimeout(500);
      const after = await heap();
      console.log(`heap JS: antes ${before.toFixed(1)} MB | com desenho aberto ${open.toFixed(1)} MB | depois de fechar ${after.toFixed(1)} MB`);
      expect(open).toBeGreaterThan(before);
      expect(after).toBeLessThan(before * 1.5 + 2);
    });
  });
});
