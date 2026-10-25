import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseJson, type Json } from '../web/src/tools/jsonDiff.ts';
import { buildTable, defaultLevel, findLevels, type Level } from '../web/src/tools/jsonTable.ts';
import { parseSheet, toTsv } from '../web/src/tools/sheet.ts';
import { launch, withPage } from './helpers.ts';

const FUNDOS = {
  meta: { total: 2 },
  data: {
    fundos: [
      { id: 1, nome: 'Alpha', gestor: { nome: 'XP' }, tags: ['rf', 'dí'], classes: [{ nome: 'A', min: 1000 }, { nome: 'B', min: 5000 }] },
      { id: 2, nome: 'Beta', gestor: null, classes: [] },
    ],
  },
};

const json = (v: unknown): Json => {
  const r = parseJson(typeof v === 'string' ? v : JSON.stringify(v));
  if (!r.ok) throw new Error('JSON de teste inválido');
  return r.value;
};
const levelOf = (levels: Level[], label: string) => levels.find((l) => l.label === label)!;

describe('JSON para tabela: níveis', () => {
  it('cada lista de objetos é um nível; lista de valores simples não é', () => {
    const levels = findLevels(json(FUNDOS));
    expect(levels.map((l) => [l.label, l.count])).toEqual([
      ['data.fundos', 2],
      ['data.fundos → classes', 2],
      ['campos do objeto', 2],
    ]);
    expect(defaultLevel(levels)!.label).toBe('data.fundos');
  });

  it('uma linha por fundo: objeto vira coluna com ponto, lista simples vira texto, lista de objetos vira JSON', () => {
    const v = json(FUNDOS);
    expect(buildTable(v, levelOf(findLevels(v), 'data.fundos'))).toEqual({
      columns: ['id', 'nome', 'gestor.nome', 'tags', 'classes'],
      rows: [
        ['1', 'Alpha', 'XP', 'rf, dí', '[{"nome":"A","min":1000},{"nome":"B","min":5000}]'],
        ['2', 'Beta', '', '', ''], // gestor nulo não cria uma coluna "gestor" sempre vazia
      ],
    });
  });

  it('uma linha por classe: repete os campos do fundo; fundo sem classe não gera linha', () => {
    const v = json(FUNDOS);
    expect(buildTable(v, levelOf(findLevels(v), 'data.fundos → classes'))).toEqual({
      columns: ['id', 'nome', 'gestor.nome', 'tags', 'classes.nome', 'classes.min'],
      rows: [
        ['1', 'Alpha', 'XP', 'rf, dí', 'A', '1000'],
        ['1', 'Alpha', 'XP', 'rf, dí', 'B', '5000'],
      ],
    });
  });

  it('o objeto campo a campo vira uma tabela vertical', () => {
    const v = json(FUNDOS);
    const t = buildTable(v, levelOf(findLevels(v), 'campos do objeto'));
    expect(t.columns).toEqual(['Campo', 'Valor']);
    expect(t.rows[0]).toEqual(['meta.total', '2']);
    expect(t.rows[1]![0]).toBe('data.fundos');
  });

  it('três níveis de lista', () => {
    const v = json({ a: [{ x: 1, b: [{ y: 2, c: [{ z: 3 }, { z: 4 }] }] }] });
    const levels = findLevels(v);
    expect(levels.map((l) => l.label)).toEqual(['a', 'a → b', 'a → b → c', 'campos do objeto']);
    expect(buildTable(v, levelOf(levels, 'a → b → c'))).toEqual({ columns: ['x', 'b.y', 'b.c.z'], rows: [['1', '2', '3'], ['1', '2', '4']] });
  });

  it('a raiz pode ser uma lista de objetos ou de valores simples', () => {
    const objs = json([{ a: 1 }, { b: 2 }]);
    expect(findLevels(objs).map((l) => l.label)).toEqual(['itens']);
    expect(buildTable(objs, findLevels(objs)[0]!)).toEqual({ columns: ['a', 'b'], rows: [['1', ''], ['', '2']] });
    const values = json([1, 'x', null, true]);
    expect(buildTable(values, findLevels(values)[0]!)).toEqual({ columns: ['valor'], rows: [['1'], ['x'], [''], ['true']] });
  });

  it('objeto sem lista nenhuma: o padrão é a tabela vertical; um valor só não vira tabela', () => {
    const v = json({ a: 1, b: { c: true, d: {} } });
    const levels = findLevels(v);
    expect(defaultLevel(levels)!.segments).toBeNull();
    expect(buildTable(v, defaultLevel(levels)!).rows).toEqual([['a', '1'], ['b.c', 'true'], ['b.d', '{}']]);
    expect(findLevels(json(42))).toEqual([]);
  });

  it('chave com ponto ou espaço vai entre colchetes; __proto__ é uma coluna como outra', () => {
    const v = json('[{"a.b":1,"a":{"b":2},"x y":3,"__proto__":{"k":4}}]');
    expect(buildTable(v, findLevels(v)[0]!)).toEqual({
      columns: ['["a.b"]', 'a.b', '["x y"]', '__proto__.k'],
      rows: [['1', '2', '3', '4']],
    });
  });

  it('para de descer depois de 5 listas dentro de listas', () => {
    let v: unknown = [{ fim: 1 }];
    for (let i = 0; i < 8; i++) v = [{ n: i, l: v }];
    expect(findLevels(json(v)).length).toBe(5);
  });
});

describe('texto para planilha (TSV)', () => {
  it('volta igual quando lido de novo, com Tab, quebra de linha e aspas dentro da célula', () => {
    const rows = [['a', 'b'], ['x\ty', 'linha 1\nlinha 2'], ['ele disse "oi"', '']];
    expect(parseSheet(toTsv(rows))).toEqual(rows);
  });

  it('célula que viraria fórmula ganha apóstrofo; número com sinal não', () => {
    expect(toTsv([['=SUM(A1)', '-3', '+5,2', '-abc', '@x', '10%']])).toBe("'=SUM(A1)\t-3\t+5,2\t'-abc\t'@x\t10%");
  });
});

let browser: Browser;
beforeAll(async () => { browser = await launch(); });
afterAll(() => browser?.close());

/** Solta um arquivo sobre o elemento, como quem arrasta do Explorer. */
const dropFile = (page: Page, selector: string, name: string, content: string) =>
  page.evaluate(([sel, n, c]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([c!], n!, { type: 'application/json' }));
    const el = document.querySelector(sel!)!;
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [selector, name, content]);

const openTable = async (page: Page) => {
  await page.getByRole('button', { name: 'JSON → tabela' }).click();
  await page.locator('.dialog.tool').waitFor();
};
const markdownBox = (page: Page) => page.getByRole('textbox', { name: 'Tabela Markdown' });
const hint = (page: Page) => page.locator('.tool .actions .muted').innerText();

describe('JSON para tabela na interface', () => {
  it('solta o arquivo, escolhe o nível de baixo, copia para a planilha', async () => {
    await withPage(browser, {}, async (page, app) => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.base });
      await openTable(page);
      const text = JSON.stringify(FUNDOS, null, 2);
      await dropFile(page, '.json-source textarea', 'fundos.json', text);

      await expect.poll(() => page.getByLabel('JSON', { exact: true }).inputValue()).toBe(text);
      expect(await page.getByLabel('Uma linha por').locator('option').allInnerTexts()).toEqual([
        'data.fundos (2)', 'data.fundos → classes (2)', 'campos do objeto (Campo | Valor)',
      ]);
      expect(await page.locator('.tool-preview th').allInnerTexts()).toEqual(['id', 'nome', 'gestor.nome', 'tags', 'classes']);
      expect(await hint(page)).toBe('2 linhas × 5 colunas');

      await page.getByLabel('Uma linha por').selectOption({ label: 'data.fundos → classes (2)' });
      await page.getByLabel('Alinhar as colunas no texto').uncheck();
      await expect.poll(() => markdownBox(page).inputValue()).toBe([
        '| id | nome | gestor.nome | tags | classes.nome | classes.min |',
        '| --: | --- | --- | --- | --- | --: |',
        '| 1 | Alpha | XP | rf, dí | A | 1000 |',
        '| 1 | Alpha | XP | rf, dí | B | 5000 |',
      ].join('\n'));

      await page.getByRole('button', { name: 'Copiar para planilha' }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
        'id\tnome\tgestor.nome\ttags\tclasses.nome\tclasses.min\n1\tAlpha\tXP\trf, dí\tA\t1000\n1\tAlpha\tXP\trf, dí\tB\t5000');
    });
  });

  it('escolher colunas tira a coluna da tabela', async () => {
    await withPage(browser, {}, async (page) => {
      await openTable(page);
      await page.getByLabel('JSON', { exact: true }).fill(JSON.stringify([{ a: 1, b: 2, c: 3 }]));
      await page.locator('.tool-cols summary').click();
      expect(await page.locator('.tool-cols summary').innerText()).toBe('Colunas: 3 de 3');
      await page.locator('.tool-cols-list').getByLabel('b', { exact: true }).uncheck();
      await expect.poll(() => markdownBox(page).inputValue()).toBe('|   a |   c |\n| --: | --: |\n|   1 |   3 |');
      expect(await page.locator('.tool-cols summary').innerText()).toBe('Colunas: 2 de 3');
      await page.getByRole('button', { name: 'Nenhuma' }).click();
      expect(await page.locator('.tool-preview').innerText()).toContain('Nenhuma coluna marcada.');
      expect(await page.getByRole('button', { name: 'Copiar', exact: true }).isDisabled()).toBe(true);
      await page.getByRole('button', { name: 'Todas' }).click();
      await expect.poll(() => page.locator('.tool-preview th').count()).toBe(3);
    });
  });

  it('abre pelo botão; arquivo grande fica fora da caixa e a tabela sai inteira', async () => {
    await withPage(browser, {}, async (page) => {
      await openTable(page);
      await page.locator('.json-source input[type=file]').setInputFiles({ name: 'pequeno.json', mimeType: 'application/json', buffer: Buffer.from('[{"x":1}]') });
      await expect.poll(() => page.getByLabel('JSON', { exact: true }).inputValue()).toBe('[{"x":1}]');

      const big = JSON.stringify(Array.from({ length: 40000 }, (_, i) => ({ id: i, nome: `item número ${i}`, valor: i * 1.5, ativo: i % 2 === 0 })));
      expect(big.length).toBeGreaterThan(2 * 1024 * 1024);
      await dropFile(page, '.json-source textarea', 'grande.json', big);
      await page.locator('.json-file').waitFor();
      expect(await page.locator('.json-file').innerText()).toMatch(/^grande\.json · \d+(,\d)? MB/);
      expect(await page.getByLabel('JSON', { exact: true }).count()).toBe(0);
      await expect.poll(() => hint(page)).toBe('40000 linhas × 4 colunas');
      expect(await page.locator('.tool-preview tbody tr').count()).toBe(200);
      expect(await page.locator('.json-out .tool-label').innerText()).toBe('A caixa mostra 2000 de 40000 linhas. Copiar e salvar levam todas.');

      await page.locator('.json-file').getByRole('button', { name: 'Limpar' }).click();
      await expect.poll(() => page.getByLabel('JSON', { exact: true }).count()).toBe(1);
    });
  });

  it('JSON inválido mostra linha e coluna e desliga os botões', async () => {
    await withPage(browser, {}, async (page) => {
      await openTable(page);
      await dropFile(page, '.json-source textarea', 'ruim.json', '[\n  {"a": 1},\n]');
      await expect.poll(() => page.locator('.tool-err').innerText()).toBe('JSON inválido na linha 3, coluna 1: vírgula sobrando antes de "]".');
      expect(await page.getByRole('button', { name: 'Copiar para planilha' }).isDisabled()).toBe(true);
    });
  });

  it('arquivo solto fora da caixa não sai do app; no Comparar, soltar no lado A preenche o A', async () => {
    await withPage(browser, {}, async (page) => {
      await openTable(page);
      // Fora da caixa, a janela recusa o arquivo (sem isto o navegador abriria o arquivo no lugar do app).
      const refused = await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.items.add(new File(['{}'], 'x.json'));
        const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
        const drop = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
        document.querySelector('.overlay')!.dispatchEvent(over);
        document.querySelector('.overlay')!.dispatchEvent(drop);
        return [over.defaultPrevented, dt.dropEffect, drop.defaultPrevented];
      });
      expect(refused).toEqual([true, 'none', true]);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Comparar JSON' }).click();
      await page.getByLabel('JSON A').waitFor();
      await dropFile(page, '.json-source:first-child textarea', 'a.json', '{"x":1}');
      await expect.poll(() => page.getByLabel('JSON A').inputValue()).toBe('{"x":1}');
      expect(await page.getByLabel('JSON B').inputValue()).toBe('');
    });
  });
});
