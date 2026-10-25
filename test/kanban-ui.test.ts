import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launch, withPage } from './helpers.ts';

let browser: Browser;
beforeAll(async () => { browser = await launch(); });
afterAll(() => browser?.close());

const quadro = readFileSync(path.join(import.meta.dirname, 'fixtures/quadro-plugin.md'), 'utf8');
const diskOf = (app: { vault: string }, rel: string) => () => readFile(path.join(app.vault, rel), 'utf8').catch(() => null);
const open = async (page: Page, name: string) => {
  await page.locator('.tree-item', { hasText: name }).first().click();
  await page.locator('.board').waitFor();
};
const lane = (page: Page, title: string) => page.locator('.lane', { has: page.locator('.lane-title', { hasText: new RegExp(`^${title}$`) }) });
const dialogInput = (page: Page, text: string) => page.locator('.dialog input').fill(text).then(() => page.keyboard.press('Enter'));

describe('quadro kanban', () => {
  it('mostra as lanes, os cartões, as datas e as tags; o arquivo fica recolhido', async () => {
    await withPage(browser, { 'q.md': quadro }, async (page) => {
      await open(page, 'q.md');
      expect(await page.locator('.lane-title').allInnerTexts()).toEqual(['A fazer', 'Fazendo', 'Feito', 'Arquivo']);
      expect(await lane(page, 'A fazer').locator('.card').count()).toBe(2);
      expect(await lane(page, 'A fazer').locator('.chip.date').innerText()).toBe('03/11/2026');
      expect(await lane(page, 'A fazer').locator('.chip.tag').innerText()).toBe('#cliente');
      expect(await lane(page, 'A fazer').locator('.card').nth(1).innerText()).toContain('terceira linha');
      expect(await page.locator('.lane.archive .card').count()).toBe(0);
      await page.locator('.lane.archive').getByTitle('Mostrar').click();
      expect(await page.locator('.lane.archive .card').count()).toBe(1);
    });
  });

  it('marcar como feito muda só aquela linha do arquivo', async () => {
    await withPage(browser, { 'q.md': quadro }, async (page, app) => {
      await open(page, 'q.md');
      await lane(page, 'A fazer').locator('.card').first().getByRole('checkbox').check();
      const expected = quadro.replace('- [ ] Revisar proposta', '- [x] Revisar proposta');
      await expect.poll(diskOf(app, 'q.md'), { timeout: 5000 }).toBe(expected);
    });
  });

  it('adiciona cartões em sequência, edita o texto e exclui', async () => {
    await withPage(browser, { 'q.md': quadro }, async (page, app) => {
      await open(page, 'q.md');
      const feito = lane(page, 'Feito');
      await feito.getByRole('button', { name: '+ Cartão' }).click();
      await page.keyboard.type('Primeiro novo');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Segundo novo');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Escape');
      await expect.poll(diskOf(app, 'q.md'), { timeout: 5000 }).toContain('- [x] Kickoff\n- [ ] Primeiro novo\n- [ ] Segundo novo\n');
      expect(await feito.locator('.card').count()).toBe(3);

      await feito.locator('.card-text', { hasText: 'Primeiro novo' }).click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type('Editado @{2020-01-01}');
      await page.keyboard.press('Enter');
      await expect.poll(diskOf(app, 'q.md'), { timeout: 5000 }).toContain('- [ ] Editado @{2020-01-01}\n');
      expect(await feito.locator('.chip.date.late').count()).toBe(1);

      await feito.locator('.card', { hasText: 'Editado' }).hover();
      await feito.locator('.card', { hasText: 'Editado' }).getByTitle('Excluir cartão').click();
      await expect.poll(diskOf(app, 'q.md'), { timeout: 5000 }).not.toContain('Editado');
    });
  });

  it('arrasta um cartão para outra lane e muda a ordem dentro da lane', async () => {
    await withPage(browser, { 'q.md': quadro }, async (page, app) => {
      await open(page, 'q.md');
      await lane(page, 'A fazer').locator('.card', { hasText: 'Revisar proposta' }).dragTo(lane(page, 'Feito').locator('.cards'));
      await expect.poll(diskOf(app, 'q.md'), { timeout: 5000 }).toContain('- [x] Kickoff\n- [ ] Revisar proposta @{2026-11-03} #cliente\n');
      expect(await lane(page, 'A fazer').locator('.card').count()).toBe(1);

      const fazendo = lane(page, 'Fazendo');
      await fazendo.locator('.card').nth(1).dragTo(fazendo.locator('.card').nth(0), { targetPosition: { x: 20, y: 3 } });
      await expect.poll(async () => {
        const t = (await diskOf(app, 'q.md')())!;
        return t.indexOf('Cartão depois de linha em branco') < t.indexOf('Fluxo de aprovação');
      }, { timeout: 5000 }).toBe(true);
    });
  });

  it('arquiva um cartão; sem lane Archive ela é criada com o `***`', async () => {
    await withPage(browser, { 'q.md': '---\n\nkanban-plugin: board\n\n---\n\n## Fazer\n\n- [x] velho\n- [ ] novo\n' }, async (page, app) => {
      await open(page, 'q.md');
      await lane(page, 'Fazer').locator('.card', { hasText: 'velho' }).hover();
      await lane(page, 'Fazer').locator('.card', { hasText: 'velho' }).getByTitle('Arquivar').click();
      await expect.poll(diskOf(app, 'q.md'), { timeout: 5000 }).toContain('\n***\n\n## Archive\n\n- [x] velho');
      expect(await page.locator('.lane.archive .count').innerText()).toBe('1');
    });
  });

  it('cria, renomeia e exclui lanes', async () => {
    await withPage(browser, { 'q.md': quadro }, async (page, app) => {
      await open(page, 'q.md');
      await page.getByRole('button', { name: '+ Lane' }).click();
      await dialogInput(page, 'Revisão');
      await expect.poll(diskOf(app, 'q.md'), { timeout: 5000 }).toMatch(/## Revisão[\s\S]*\*\*\*\s+## Archive/);

      await lane(page, 'Revisão').getByTitle('Renomear lane').click();
      await dialogInput(page, 'Em revisão');
      await expect.poll(diskOf(app, 'q.md'), { timeout: 5000 }).toContain('## Em revisão');

      await lane(page, 'Em revisão').getByTitle('Excluir lane').click();
      await page.getByRole('button', { name: 'OK' }).click();
      await expect.poll(diskOf(app, 'q.md'), { timeout: 5000 }).not.toContain('Em revisão');
      expect(await page.locator('.lane-title').allInnerTexts()).toEqual(['A fazer', 'Fazendo', 'Feito', 'Arquivo']);
    });
  });

  it('alterna entre quadro e texto Markdown; editar o texto atualiza o quadro', async () => {
    await withPage(browser, { 'q.md': quadro }, async (page, app) => {
      await open(page, 'q.md');
      await page.getByRole('button', { name: 'Texto', exact: true }).click();
      await expect.poll(() => page.locator('.cm-content').innerText()).toContain('kanban-plugin: board');
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+Home');
      await page.keyboard.press('Control+F').catch(() => {});
      await page.getByRole('button', { name: 'Quadro', exact: true }).click();
      await page.locator('.board').waitFor();
      expect(await readFile(path.join(app.vault, 'q.md'), 'utf8')).toBe(quadro);
    });
  });

  it('cria um quadro novo com as lanes padrão', async () => {
    await withPage(browser, {}, async (page, app) => {
      await page.getByRole('button', { name: '+ Quadro' }).click();
      await dialogInput(page, 'projeto');
      await page.locator('.board').waitFor();
      expect(await page.locator('.lane-title').allInnerTexts()).toEqual(['A fazer', 'Fazendo', 'Feito']);
      const md = (await diskOf(app, 'projeto.md')())!;
      expect(md).toContain('kanban-plugin: board');
      expect(md).toContain('%% kanban:settings');
    });
  });

  it('mudança feita por outra ferramenta aparece no quadro', async () => {
    await withPage(browser, { 'q.md': quadro }, async (page, app) => {
      await open(page, 'q.md');
      await writeFile(path.join(app.vault, 'q.md'), quadro.replace('Kickoff', 'Kickoff alterado por fora'));
      await expect.poll(() => lane(page, 'Feito').innerText(), { timeout: 5000 }).toContain('alterado por fora');
    });
  });
});
