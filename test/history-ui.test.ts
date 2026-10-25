import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launch, withPage } from './helpers.ts';

let browser: Browser;
beforeAll(async () => { browser = await launch(); });
afterAll(() => browser?.close());

const open = (page: import('playwright-core').Page, name: string) => page.locator('.tree-item', { hasText: name }).first().click();
const diskOf = (app: { vault: string }, rel: string) => () => readFile(path.join(app.vault, rel), 'utf8').catch(() => null);

describe('histórico na interface', () => {
  it('mostra a diferença para a versão anterior e restaura', async () => {
    await withPage(browser, { 'a.md': 'linha 1\nlinha 2\nlinha 3\n' }, async (page, app) => {
      await open(page, 'a.md');
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+Home');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('End');
      await page.keyboard.type(' EDITADA');
      await expect.poll(diskOf(app, 'a.md'), { timeout: 5000 }).toBe('linha 1\nlinha 2 EDITADA\nlinha 3\n');

      await page.getByRole('button', { name: 'Histórico' }).click();
      await expect.poll(() => page.locator('.versions li').count()).toBe(1);
      // As três linhas são um parágrafo só: aparece uma mudança, e só a palavra nova fica em destaque.
      await page.locator('.pdiff-row.changed').first().waitFor();
      expect(await page.locator('.pdiff-row.changed').count()).toBe(1);
      expect(await page.locator('mark.a').allInnerTexts()).toEqual(['EDITADA']);
      expect(await page.locator('mark.d').count()).toBe(0);
      expect(await page.locator('.pdiff-sum').innerText()).toBe('+1 palavra · −0 · 1 parágrafo mudado');
      // "Ver o Markdown" volta à comparação linha a linha.
      await page.getByRole('button', { name: 'Ver o Markdown' }).click();
      expect(await page.locator('.diff-row pre.del').allInnerTexts()).toEqual(['linha 2']);
      expect(await page.locator('.diff-row pre.add').allInnerTexts()).toEqual(['linha 2 EDITADA']);

      await page.getByRole('button', { name: 'Restaurar esta versão' }).click();
      await expect.poll(diskOf(app, 'a.md'), { timeout: 5000 }).toBe('linha 1\nlinha 2\nlinha 3\n');
      await expect.poll(() => page.locator('.cm-content').innerText()).toContain('linha 2');
      await expect.poll(() => page.locator('.cm-content').innerText()).not.toContain('EDITADA');
      expect(await page.locator('.overlay').count()).toBe(0);

      // O estado antes de restaurar virou uma versão nova.
      await page.getByRole('button', { name: 'Histórico' }).click();
      await expect.poll(() => page.locator('.versions li').count()).toBe(2);
    });
  });

  it('"Voltar este trecho" desfaz só aquela mudança na nota, e o Ctrl+Z desfaz o voltar', async () => {
    await withPage(browser, { 'a.md': 'Primeiro parágrafo.\n\nSegundo parágrafo.\n' }, async (page, app) => {
      await open(page, 'a.md');
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+End'); // linha vazia do fim
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft'); // antes do ponto final
      await page.keyboard.type(' NOVO');
      await page.keyboard.press('Control+Home');
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.type(' OUTRO');
      await expect.poll(diskOf(app, 'a.md'), { timeout: 5000 }).toBe('Primeiro parágrafo OUTRO.\n\nSegundo parágrafo NOVO.\n');

      await page.getByRole('button', { name: 'Histórico' }).click();
      await expect.poll(() => page.locator('.pdiff-row.changed').count()).toBe(2);
      await page.locator('.pdiff-row.changed').nth(1).getByRole('button', { name: 'Voltar este trecho' }).click();
      await expect.poll(diskOf(app, 'a.md'), { timeout: 5000 }).toBe('Primeiro parágrafo OUTRO.\n\nSegundo parágrafo.\n');
      await expect.poll(() => page.locator('.pdiff-row.changed').count()).toBe(1);

      await page.getByRole('button', { name: 'Fechar' }).click();
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+z');
      await expect.poll(diskOf(app, 'a.md'), { timeout: 5000 }).toBe('Primeiro parágrafo OUTRO.\n\nSegundo parágrafo NOVO.\n');
    });
  });

  it('conflito: escolher o trecho do disco num lugar e manter o meu no outro', async () => {
    await withPage(browser, { 'a.md': 'Um.\n\nDois.\n' }, async (page, app) => {
      await open(page, 'a.md');
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+Home');
      await page.keyboard.type('Meu ');
      await writeFile(path.join(app.vault, 'a.md'), 'Um.\n\nDois do disco.\n');
      await page.getByRole('button', { name: 'Ver diferença' }).click();
      await expect.poll(() => page.locator('.merge .pdiff-row.changed').count()).toBe(2);
      expect(await page.locator('.merge .actions .muted').innerText()).toContain('0 de 2 do disco');

      await page.locator('.pdiff-row[data-change="1"]').getByRole('button', { name: 'Do disco' }).click();
      expect(await page.locator('.pdiff-row[data-change="1"]').getByRole('button', { name: 'Do disco' }).getAttribute('aria-pressed')).toBe('true');
      await page.getByRole('button', { name: 'Aplicar' }).click();

      await expect.poll(diskOf(app, 'a.md'), { timeout: 5000 }).toBe('Meu Um.\n\nDois do disco.\n');
      expect(await page.locator('.overlay').count()).toBe(0);
      await expect.poll(() => page.locator('.banner').count()).toBe(0);
      await expect.poll(() => page.locator('.cm-content').innerText()).toContain('Dois do disco.');
    });
  });

  it('marcos: marcar versão, comparar dois marcos e tirar o nome', async () => {
    await withPage(browser, { 'a.md': 'Texto inicial.\n' }, async (page, app) => {
      await open(page, 'a.md');
      const marcar = async (name: string) => {
        await page.getByRole('button', { name: 'Marcar versão…' }).click();
        await page.locator('.dialog input').fill(name);
        await page.keyboard.press('Enter');
      };
      await page.getByRole('button', { name: 'Histórico' }).click();
      await marcar('Enviado ao jurídico');
      await expect.poll(() => page.locator('.versions li.marco').allInnerTexts()).toEqual([expect.stringContaining('⚑ Enviado ao jurídico')]);
      await page.getByRole('button', { name: 'Fechar' }).click();

      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type('Parágrafo revisado.');
      await expect.poll(diskOf(app, 'a.md'), { timeout: 5000 }).toBe('Texto inicial.\nParágrafo revisado.');
      await page.getByRole('button', { name: 'Histórico' }).click();
      await marcar('Revisado');
      await expect.poll(() => page.locator('.versions li.marco').count()).toBe(2);
      expect(await page.locator('.versions li.sel').innerText()).toContain('Revisado');

      // O marco antigo contra o novo: dá para comparar, mas não para voltar trecho (nenhum lado é o agora).
      await page.locator('.versions li', { hasText: 'Enviado ao jurídico' }).click();
      await page.locator('.compare-bar select').selectOption({ index: 1 });
      await expect.poll(() => page.locator('mark.a').allInnerTexts()).toEqual(['Parágrafo revisado.']);
      expect(await page.getByRole('button', { name: 'Voltar este trecho' }).count()).toBe(0);
      await page.locator('.compare-bar select').selectOption('');
      await expect.poll(() => page.getByRole('button', { name: 'Voltar este trecho' }).count()).toBe(1);

      // Tirar o nome: o marco vira versão comum.
      await page.locator('.versions li', { hasText: 'Revisado' }).getByRole('button', { name: /^Nome da versão/ }).click();
      await page.locator('.dialog input').fill('');
      await page.keyboard.press('Enter');
      await expect.poll(() => page.locator('.versions li.marco').count()).toBe(1);
    });
  });

  it('nota sem versões anteriores explica por quê', async () => {
    await withPage(browser, { 'nova.md': 'x\n' }, async (page) => {
      await open(page, 'nova.md');
      await page.getByRole('button', { name: 'Histórico' }).click();
      await expect.poll(() => page.locator('.history').innerText()).toContain('Ainda não há versões anteriores');
    });
  });

  it('"Ver diferença" no conflito compara o disco com o que está no editor', async () => {
    await withPage(browser, { 'a.md': 'base\n' }, async (page, app) => {
      await open(page, 'a.md');
      await page.locator('.cm-content').click();
      await page.keyboard.type('minha ');
      await writeFile(path.join(app.vault, 'a.md'), 'versão externa\n');
      await page.getByRole('button', { name: 'Ver diferença' }).click();
      await page.locator('.pdiff-row.changed').first().waitFor();
      expect(await page.locator('.pdiff-labels').innerText()).toContain('No disco');
      expect(await page.locator('mark.d').allInnerTexts()).toEqual(['versão externa']);
      expect(await page.locator('mark.a').allInnerTexts()).toEqual(['base minha']);
    });
  });
});

describe('exportar', () => {
  const nota = '# Relatório\n\nTexto com **negrito**.\n\n![foto](foto.png)\n\n[outra](outra.md)\n\n```mermaid\nflowchart TD\n  A[Início] --> B[Fim]\n```\n';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

  it('HTML: um arquivo só, com diagrama em SVG, imagem embutida e sem links do app', async () => {
    await withPage(browser, { 'rel.md': nota, 'outra.md': 'o' }, async (page, app) => {
      await writeFile(path.join(app.vault, 'foto.png'), png);
      await open(page, 'rel.md');
      await page.locator('.preview .mermaid-out svg').waitFor({ timeout: 15_000 });
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'HTML', exact: true }).click()]);
      expect(dl.suggestedFilename()).toBe('rel.html');
      const html = await readFile((await dl.path())!, 'utf8');
      expect(html).toMatch(/^<!doctype html>/);
      expect(html).toContain('<title>Relatório</title>');
      expect(html).toContain('<style>');
      expect(html).toContain('<svg');
      expect(html).toContain('src="data:image/png;base64,');
      expect(html).not.toContain('/api/raw');
      expect(html).not.toContain('data-note');
      expect(html).not.toContain('mermaid-src');
      // Sem endereços externos (os xmlns do SVG são só nomes de formato, não requisições).
      expect(html.replace(/xmlns(:\w+)?="[^"]*"/g, '')).not.toMatch(/https?:\/\//);
    });
  });

  it('diagrama: baixa SVG e PNG de verdade', async () => {
    await withPage(browser, { 'rel.md': nota }, async (page) => {
      await open(page, 'rel.md');
      const diagram = page.locator('.preview .mermaid-out');
      await diagram.locator('svg').waitFor({ timeout: 15_000 });
      await diagram.hover();

      const [svgDl] = await Promise.all([page.waitForEvent('download'), diagram.getByTitle('Baixar SVG').click()]);
      expect(svgDl.suggestedFilename()).toBe('diagrama.svg');
      const svg = await readFile((await svgDl.path())!, 'utf8');
      expect(svg.startsWith('<?xml')).toBe(true);
      expect(svg).toContain('<svg');

      const [pngDl] = await Promise.all([page.waitForEvent('download'), diagram.getByTitle('Baixar PNG').click()]);
      expect(pngDl.suggestedFilename()).toBe('diagrama.png');
      const bytes = await readFile((await pngDl.path())!);
      expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      expect(bytes.length).toBeGreaterThan(1000);
    });
  });

  it('PDF: vai para o modo "Ler", imprime e as regras de impressão escondem o resto da tela', async () => {
    await withPage(browser, { 'rel.md': '# Imprimir\n\ntexto\n' }, async (page) => {
      await open(page, 'rel.md');
      await page.evaluate(() => {
        (window as any).print = () => { (window as any).__printed = document.querySelector('.panes')!.className; };
      });
      await page.getByRole('button', { name: 'PDF', exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as any).__printed)).toContain('preview');

      await page.emulateMedia({ media: 'print' });
      await page.locator('.preview h1').waitFor();
      expect(await page.locator('.sidebar').isVisible()).toBe(false);
      expect(await page.locator('.tabs').isVisible()).toBe(false);
      expect(await page.locator('.cm-content').isVisible()).toBe(false);
      const pdf = await page.pdf();
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    });
  });
});
