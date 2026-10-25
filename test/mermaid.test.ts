import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launch, withPage } from './helpers.ts';
import { mermaidTemplates } from '../web/src/diagrams/mermaid/templates.ts';

let browser: Browser;
beforeAll(async () => { browser = await launch(); });
afterAll(() => browser?.close());

const open = (page: Page, name: string) => page.locator('.tree-item', { hasText: name }).first().click();
const FLOW = '# Fluxo\n\n```mermaid\nflowchart TD\n  A[Início] --> B{Ok?}\n  B -- Sim --> C[Fim]\n```\n';

describe('mermaid no preview', () => {
  it('só baixa o Mermaid quando a nota tem diagrama', async () => {
    await withPage(browser, { 'simples.md': '# Oi\n', 'fluxo.md': FLOW }, async (page) => {
      const js: string[] = [];
      page.on('request', (r) => { if (/\.m?js(\?|$)/.test(r.url())) js.push(r.url()); });
      await open(page, 'simples.md');
      await page.locator('.preview h1').waitFor();
      await page.waitForTimeout(300);
      const before = js.length;
      await open(page, 'fluxo.md');
      await page.locator('.preview .mermaid-out svg').waitFor({ timeout: 15_000 });
      expect(js.length).toBeGreaterThan(before);
      expect(before).toBe(0);
    });
  });

  it('mostra o erro de sintaxe no lugar do diagrama, sem sujar a página', async () => {
    await withPage(browser, { 'ruim.md': '```mermaid\ndiagramaquenaoexiste\n  A --> B\n```\n' }, async (page) => {
      await open(page, 'ruim.md');
      await page.locator('.preview .mermaid-error').waitFor({ timeout: 15_000 });
      expect(await page.locator('body > [id^="dmmd"], body > [id^="mmd"]').count()).toBe(0);
    });
  });

  it('não executa script vindo do rótulo ou de click', async () => {
    const md = '```mermaid\nflowchart TD\n  A["<img src=x onerror=window.__pwned=1>"] --> B\n  click B call alert("x")\n```\n';
    await withPage(browser, { 'x.md': md }, async (page) => {
      await open(page, 'x.md');
      await page.locator('.preview .mermaid-out, .preview .mermaid-error').first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
    });
  });

  it('layout elk não vem no pacote: mostra um aviso claro em vez de travar', async () => {
    const md = '```mermaid\n---\nconfig:\n  layout: elk\n---\nflowchart TD\n  A --> B\n```\n';
    await withPage(browser, { 'elk.md': md }, async (page) => {
      await open(page, 'elk.md');
      await page.locator('.preview .mermaid-error').waitFor({ timeout: 15_000 });
      expect(await page.locator('.preview .mermaid-error').innerText()).toContain('elk');
    });
  });

  it('muda o desenho quando o texto muda', async () => {
    await withPage(browser, { 'fluxo.md': FLOW }, async (page) => {
      await open(page, 'fluxo.md');
      await page.locator('.preview .mermaid-out svg').waitFor({ timeout: 15_000 });
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('End');
      await page.keyboard.type('\n  C --> Z[Extra]');
      await expect.poll(() => page.locator('.preview .mermaid-out:not(.stale)').innerText(), { timeout: 15_000 }).toContain('Extra');
    });
  });
});

describe('editor de diagramas', () => {
  it('todos os modelos desenham sem erro', async () => {
    await withPage(browser, { 'n.md': 'nota\n' }, async (page) => {
      await open(page, 'n.md');
      await page.getByRole('button', { name: 'Diagrama' }).click();
      for (const t of mermaidTemplates) {
        await page.locator('.diagram select').selectOption(t.id);
        await expect.poll(() => page.locator('.diagram textarea').inputValue()).toBe(t.code);
        await expect.poll(async () => {
          if (await page.locator('.diagram-view .mermaid-error').count()) {
            throw new Error(`modelo "${t.id}": ${await page.locator('.diagram-view .mermaid-error').innerText()}`);
          }
          return page.locator('.diagram-view .mermaid-out svg').count();
        }, { timeout: 15_000, message: t.id }).toBe(1);
      }
    });
  });

  it('insere um bloco novo no cursor e edita um bloco existente', async () => {
    await withPage(browser, { 'n.md': 'antes\n\ndepois\n' }, async (page, app) => {
      const file = path.join(app.vault, 'n.md');
      await open(page, 'n.md');
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+Home');
      await page.keyboard.press('End'); // fim de "antes"
      await page.getByRole('button', { name: 'Diagrama' }).click();
      await page.locator('.diagram textarea').fill('flowchart LR\n  X --> Y');
      await page.getByRole('button', { name: 'Inserir' }).click();
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 5000 }).toBe('antes\n\n```mermaid\nflowchart LR\n  X --> Y\n```\n\ndepois\n');

      // Cursor dentro do bloco → o botão edita aquele bloco.
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.getByRole('button', { name: 'Diagrama' }).click();
      await expect.poll(() => page.locator('.diagram textarea').inputValue()).toBe('flowchart LR\n  X --> Y');
      await page.locator('.diagram textarea').fill('flowchart LR\n  X --> Y --> W');
      await page.getByRole('button', { name: 'Salvar' }).click();
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 5000 }).toBe('antes\n\n```mermaid\nflowchart LR\n  X --> Y --> W\n```\n\ndepois\n');
    });
  });
});
