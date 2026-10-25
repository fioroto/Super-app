import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launch, withPage, type Mode } from './helpers.ts';

let browser: Browser;
beforeAll(async () => { browser = await launch(); });
afterAll(() => browser?.close());

/** Roda o teste no modo pedido (padrão: Documento). */
const doc = (files: Record<string, string>, fn: (page: Page, app: { vault: string }) => Promise<void>, mode: Mode | null = 'doc') =>
  withPage(browser, files, fn, { mode });
const open = (page: Page, name: string) => page.locator('.tree-item', { hasText: name }).first().click();
const disk = (app: { vault: string }, rel: string) => () => readFile(path.join(app.vault, rel), 'utf8').catch(() => null);
const modeButton = (page: Page, label: string) => page.locator('.seg button', { hasText: label });

describe('modos de edição', () => {
  it('sem escolha anterior, a nota abre em Documento: uma coluna e sem preview', async () => {
    await doc({ 'a.md': '# Oi\n' }, async (page) => {
      await open(page, 'a.md');
      await page.locator('.cm-editor').waitFor();
      expect(await modeButton(page, 'Documento').getAttribute('class')).toContain('on');
      await expect.poll(() => page.locator('.cm-editor.cm-live').count()).toBe(1);
      await expect.poll(() => page.locator('.preview').count()).toBe(0);
      expect(await page.locator('.seg button').allInnerTexts()).toEqual(['Documento', 'Código', 'Dividido']);
    }, null);
  });

  it('o modo escolhido é lembrado depois de recarregar', async () => {
    await doc({ 'a.md': '# Oi\n' }, async (page) => {
      await open(page, 'a.md');
      await modeButton(page, 'Código').click();
      await expect.poll(() => page.locator('.cm-editor.cm-live').count()).toBe(0);
      await page.reload();
      await open(page, 'a.md');
      await page.locator('.cm-editor').waitFor();
      expect(await modeButton(page, 'Código').getAttribute('class')).toContain('on');
    }, null);
  });

  it('Dividido mostra o preview; Código e Documento não', async () => {
    await doc({ 'a.md': '# Oi\n' }, async (page) => {
      await open(page, 'a.md');
      await modeButton(page, 'Dividido').click();
      await page.locator('.preview h1').waitFor();
      await modeButton(page, 'Código').click();
      await expect.poll(() => page.locator('.preview').count()).toBe(0);
      await expect.poll(() => page.locator('.cm-editor.cm-live').count()).toBe(0);
      await modeButton(page, 'Documento').click();
      await expect.poll(() => page.locator('.cm-editor.cm-live').count()).toBe(1);
    });
  });

  it('trocar de modo mantém o texto e o desfazer', async () => {
    await doc({ 'a.md': 'base\n' }, async (page, app) => {
      await open(page, 'a.md');
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type('digitado');
      await modeButton(page, 'Código').click();
      await expect.poll(() => page.locator('.cm-content').innerText()).toContain('digitado');
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+z');
      await expect.poll(() => page.locator('.cm-content').innerText()).not.toContain('digitado');
      await modeButton(page, 'Documento').click();
      await expect.poll(disk(app, 'a.md'), { timeout: 5000 }).toBe('base\n');
    });
  });

  it('cada aba lembra o seu desfazer ao trocar de modo', async () => {
    await doc({ 'a.md': 'AAA\n', 'b.md': 'BBB\n' }, async (page) => {
      await open(page, 'a.md');
      await open(page, 'b.md');
      await modeButton(page, 'Código').click();
      await page.locator('.tab', { hasText: 'a.md' }).click();
      await expect.poll(() => page.locator('.cm-content').innerText()).toContain('AAA');
      await expect.poll(() => page.locator('.cm-editor.cm-live').count()).toBe(0);
      await modeButton(page, 'Documento').click();
      await page.locator('.tab', { hasText: 'b.md' }).click();
      await expect.poll(() => page.locator('.cm-content').innerText()).toContain('BBB');
      await expect.poll(() => page.locator('.cm-editor.cm-live').count()).toBe(1);
    });
  });

  it('arquivo .txt e quadro em modo Texto não usam o modo Documento', async () => {
    const quadro = '---\n\nkanban-plugin: board\n\n---\n\n## A\n\n- [ ] x\n';
    await doc({ 'n.txt': 'texto simples\n', 'q.md': quadro }, async (page) => {
      await open(page, 'n.txt');
      await page.locator('.cm-editor').waitFor();
      await expect.poll(() => page.locator('.cm-editor.cm-live').count()).toBe(0);
      expect(await page.locator('.seg').count()).toBe(0);

      await open(page, 'q.md');
      await page.locator('.board').waitFor();
      await page.getByRole('button', { name: 'Texto', exact: true }).click();
      await page.locator('.cm-editor').waitFor();
      await expect.poll(() => page.locator('.cm-editor.cm-live').count()).toBe(0);
    });
  });

  it('o gancho de teste expõe o editor (só com a chave ligada)', async () => {
    await doc({ 'a.md': 'oi\n' }, async (page) => {
      await open(page, 'a.md');
      await page.locator('.cm-editor').waitFor();
      expect(await page.evaluate(() => (window as any).__cmView().state.doc.toString())).toBe('oi\n');
    });
  });
});
