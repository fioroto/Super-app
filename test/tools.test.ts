import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonical, changesToMarkdown, compareJson, parseJson, type Json } from '../web/src/tools/jsonDiff.ts';
import { parseSheet, toMarkdownTable, type TableOptions } from '../web/src/tools/sheet.ts';
import { launch, withPage } from './helpers.ts';

const ALL: TableOptions = { header: true, pad: true, alignNumbers: true };

describe('planilha para tabela Markdown', () => {
  it('converte o que o Excel copia (tabulação) e alinha números à direita', () => {
    const md = toMarkdownTable(parseSheet('Nome\tIdade\nAna\t30\nBruno\t5\n'), ALL);
    expect(md).toBe([
      '| Nome  | Idade |',
      '| ----- | ----: |',
      '| Ana   |    30 |',
      '| Bruno |     5 |',
    ].join('\n'));
  });

  it('célula entre aspas pode ter quebra de linha, aspas e barra vertical', () => {
    const rows = parseSheet('a\tb\tc\n"linha 1\nlinha 2"\t"ele disse ""oi"""\tx|y\n');
    expect(rows).toEqual([['a', 'b', 'c'], ['linha 1\nlinha 2', 'ele disse "oi"', 'x|y']]);
    expect(toMarkdownTable(rows, { ...ALL, pad: false })).toBe(
      '| a | b | c |\n| --- | --- | --- |\n| linha 1<br>linha 2 | ele disse "oi" | x\\|y |');
  });

  it('aceita fim de linha do Windows, linhas curtas e linhas vazias no fim', () => {
    expect(parseSheet('a\tb\tc\r\n1\t2\r\n\r\n')).toEqual([['a', 'b', 'c'], ['1', '2', '']]);
  });

  it('reconhece ponto e vírgula e vírgula só quando todas as linhas têm as mesmas colunas', () => {
    expect(parseSheet('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseSheet('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    // Uma coluna só, com vírgula dentro do texto: não parte.
    expect(parseSheet('Silva, João\nSouza')).toEqual([['Silva, João'], ['Souza']]);
    // O separador escolhido à mão vale sempre.
    expect(parseSheet('Silva, João\nSouza', ',')).toEqual([['Silva', ' João'], ['Souza', '']]);
  });

  it('sem cabeçalho, a tabela ganha um cabeçalho vazio', () => {
    expect(toMarkdownTable(parseSheet('1\t2\n3\t4'), { header: false, pad: false, alignNumbers: false })).toBe(
      '|  |  |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
  });

  it('só alinha à direita a coluna em que tudo é número (moeda, porcentagem, negativo)', () => {
    const md = toMarkdownTable(parseSheet('item\tvalor\tnota\nA\tR$ 1.234,56\tok\nB\t-3\t12%\nC\t\t7'), ALL);
    const rule = md.split('\n')[1]!;
    expect(rule).toBe('| ---- | ----------: | ---- |');
    expect(toMarkdownTable(parseSheet('x\ty\n1\tz'), { ...ALL, alignNumbers: false })).not.toContain(':');
  });

  it('texto vazio não gera tabela', () => {
    expect(toMarkdownTable(parseSheet(''), ALL)).toBe('');
    expect(toMarkdownTable(parseSheet('\n\n'), ALL)).toBe('');
  });
});

const cmp = (a: string, b: string, unorderedArrays = false) => {
  const pa = parseJson(a), pb = parseJson(b);
  if (!pa.ok || !pb.ok) throw new Error('JSON de teste inválido');
  return compareJson(pa.value, pb.value, { unorderedArrays });
};

describe('comparar JSON', () => {
  it('ignora a ordem das chaves e a formatação', () => {
    expect(cmp('{"a":1,"b":{"c":[1,2],"d":null}}', '{ "b": {"d": null, "c": [1, 2]}, "a": 1.0 }')).toEqual([]);
  });

  it('diz o caminho de cada diferença: valor, tipo, só de um lado', () => {
    const a = '{"user":{"name":"Ana","age":30,"tags":["x","y"]},"ok":true,"gone":1}';
    const b = '{"user":{"name":"Ana","age":"30","tags":["x","z","w"]},"ok":false,"new":[1]}';
    expect(cmp(a, b)).toEqual([
      { kind: 'type', path: '$.user.age', before: 30, after: '30' },
      { kind: 'changed', path: '$.user.tags[1]', before: 'y', after: 'z' },
      { kind: 'added', path: '$.user.tags[2]', after: 'w' },
      { kind: 'changed', path: '$.ok', before: true, after: false },
      { kind: 'removed', path: '$.gone', before: 1 },
      { kind: 'added', path: '$.new', after: [1] },
    ]);
  });

  it('chave com espaço ou símbolo vai entre colchetes', () => {
    expect(cmp('{"a b":1,"c-d":{"e":1}}', '{"a b":2,"c-d":{"e":2}}').map((c) => c.path)).toEqual(['$["a b"]', '$["c-d"].e']);
  });

  it('objeto contra array, e null contra valor, são diferença de tipo', () => {
    expect(cmp('{"a":[]}', '{"a":{}}')[0]!.kind).toBe('type');
    expect(cmp('{"a":null}', '{"a":0}')[0]!.kind).toBe('type');
  });

  it('a ordem dos itens do array conta, a não ser que se peça para ignorar', () => {
    expect(cmp('[1,2,3]', '[3,2,1]').length).toBe(2);
    expect(cmp('[1,2,3]', '[3,2,1]', true)).toEqual([]);
    // Itens repetidos contam pela quantidade.
    expect(cmp('[1,2,2,3]', '[3,2,1]', true)).toEqual([{ kind: 'removed', path: '$[2]', before: 2 }]);
    expect(cmp('[{"id":1,"v":"a"},{"id":2}]', '[{"id":2},{"v":"a","id":1}]', true)).toEqual([]);
  });

  it('uma chave __proto__ é um dado como outro qualquer', () => {
    expect(cmp('{"__proto__":{"x":1}}', '{"__proto__":{"x":2}}').map((c) => c.path)).toEqual(['$.__proto__.x']);
    expect(canonical(JSON.parse('{"b":1,"__proto__":{"z":0}}') as Json, { unorderedArrays: false })).toBe('{"__proto__":{"z":0},"b":1}');
  });

  it('o texto canônico ordena as chaves e (se pedido) os itens', () => {
    const v = JSON.parse('{"b":[3,1],"a":{"y":1,"x":2}}') as Json;
    expect(canonical(v, { unorderedArrays: false }, '  ')).toBe('{\n  "a": {\n    "x": 2,\n    "y": 1\n  },\n  "b": [\n    3,\n    1\n  ]\n}');
    expect(canonical(v, { unorderedArrays: true })).toBe('{"a":{"x":2,"y":1},"b":[1,3]}');
  });

  it('JSON inválido: aponta linha e coluna, com a causa', () => {
    const err = (t: string) => {
      const r = parseJson(t);
      if (r.ok) throw new Error('devia falhar');
      return `${r.line}:${r.column} ${r.message}`;
    };
    expect(err('{\n  "a": 1,\n  "b": }')).toBe('3:8 caractere inesperado "}"');
    expect(err('{"a": 1,}')).toBe('1:9 vírgula sobrando antes de "}"');
    expect(err('[1, 2,\n]')).toBe('2:1 vírgula sobrando antes de "]"');
    expect(err("{'a': 1}")).toBe('1:2 esperava o nome de uma chave entre aspas duplas');
    expect(err('{"a": 1 "b": 2}')).toBe('1:9 esperava "," ou "}"');
    expect(err('{"a": "x')).toBe('1:9 texto sem aspas de fechamento');
    expect(err('{"a": 1} x')).toBe('1:10 há texto depois do fim do JSON');
    expect(err('[1, // nota\n2]')).toBe('1:5 caractere inesperado "/"');
    expect(err('[1')).toBe('1:3 o texto terminou antes do esperado');
  });

  it('o relatório em Markdown é uma tabela; sem diferença, uma frase', () => {
    const md = changesToMarkdown(cmp('{"a":1,"b":"x|y"}', '{"a":2}'));
    expect(md).toBe([
      '| Caminho | Diferença | A | B |',
      '| --- | --- | --- | --- |',
      '| `$.a` | valor diferente | `1` | `2` |',
      '| `$.b` | só no A | `"x\\|y"` |  |',
    ].join('\n'));
    expect(changesToMarkdown([])).toBe('Os dois JSON têm o mesmo conteúdo.');
  });
});

let browser: Browser;
beforeAll(async () => { browser = await launch(); });
afterAll(() => browser?.close());

const openTool = async (page: Page, name: string) => {
  await page.getByRole('button', { name }).click();
  await page.locator('.dialog.tool').waitFor();
};
const vaultFile = (app: { vault: string }, rel: string) => () => readFile(path.join(app.vault, rel), 'utf8').catch(() => null);

const TSV = 'Produto\tQtd\tObs\nCaneta\t10\t"2 cores\nazul e preta"\nLápis\t5\t\n';
const TABLE = [
  '| Produto | Qtd | Obs                     |',
  '| ------- | --: | ----------------------- |',
  '| Caneta  |  10 | 2 cores<br>azul e preta |',
  `| Lápis   |   5 | ${' '.repeat(23)} |`,
].join('\n');

/** Cola de verdade (Ctrl+V com o texto na área de transferência), como quem copiou células numa planilha. */
async function pasteSheet(page: Page, app: { base: string }, text: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.base });
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.getByLabel('Células da planilha').focus();
  await page.keyboard.press('Control+V');
}

describe('ferramentas na interface', () => {
  it('planilha: cola do jeito que a planilha copia, mostra a tabela e copia o Markdown', async () => {
    await withPage(browser, {}, async (page, app) => {
      await openTool(page, 'Planilha → tabela');
      await pasteSheet(page, app, TSV);

      await expect.poll(() => page.getByRole('textbox', { name: 'Tabela Markdown' }).inputValue()).toBe(TABLE);
      expect(await page.locator('.tool-preview th').allInnerTexts()).toEqual(['Produto', 'Qtd', 'Obs']);
      expect(await page.locator('.tool-preview tbody tr').count()).toBe(2);
      expect(await page.locator('.tool-preview th.r').allInnerTexts()).toEqual(['Qtd']); // só a coluna de números fica à direita
      expect(await page.locator('.tool .actions .muted').innerText()).toBe('3 linhas × 3 colunas');

      await page.getByRole('button', { name: 'Copiar', exact: true }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(TABLE);
      expect(await page.locator('.tool .actions .muted').innerText()).toBe('Copiado.');
    });
  });

  it('planilha: as opções mudam o Markdown na hora', async () => {
    await withPage(browser, {}, async (page) => {
      await openTool(page, 'Planilha → tabela');
      await page.getByLabel('Células da planilha').fill('a;b\nx;2');
      const out = page.getByRole('textbox', { name: 'Tabela Markdown' });
      await expect.poll(() => out.inputValue()).toBe('| a   |   b |\n| --- | --: |\n| x   |   2 |');
      await page.getByLabel('Alinhar as colunas no texto').uncheck();
      await expect.poll(() => out.inputValue()).toBe('| a | b |\n| --- | --: |\n| x | 2 |');
      await page.getByLabel('Alinhar as colunas no texto').check();
      await page.getByLabel('Primeira linha é o cabeçalho').uncheck();
      await expect.poll(() => out.inputValue()).toBe('|     |     |\n| --- | --- |\n| a   | b   |\n| x   | 2   |');
      await page.getByLabel('Primeira linha é o cabeçalho').check();
      await page.getByLabel('Separador').selectOption('tab');
      await expect.poll(() => out.inputValue()).toBe('| a;b |\n| --- |\n| x;2 |');
    });
  });

  it('planilha: insere a tabela no cursor da nota aberta, e ela aparece pronta no modo Documento', async () => {
    await withPage(browser, { 'nota.md': 'Antes\n\nDepois\n' }, async (page, app) => {
      await page.locator('.tree-item', { hasText: 'nota.md' }).first().click();
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+Home');
      await page.keyboard.press('End'); // fim de "Antes"
      await openTool(page, 'Planilha → tabela');
      await pasteSheet(page, app, 'x\ty\n1\t2');
      await page.getByRole('button', { name: 'Inserir na nota' }).click();

      await expect.poll(() => page.locator('.dialog.tool').count()).toBe(0);
      await expect.poll(vaultFile(app, 'nota.md'), { timeout: 5000 }).toBe('Antes\n\n|   x |   y |\n| --: | --: |\n|   1 |   2 |\n\nDepois\n');
      await page.locator('.cm-live-table table').waitFor();
    }, { mode: 'doc' });
  });

  it('planilha: sem nota aberta não dá para inserir; salvar como nota cria o arquivo', async () => {
    await withPage(browser, {}, async (page, app) => {
      await openTool(page, 'Planilha → tabela');
      await pasteSheet(page, app, TSV);
      await expect.poll(() => page.getByRole('textbox', { name: 'Tabela Markdown' }).inputValue()).toBe(TABLE);
      expect(await page.getByRole('button', { name: 'Inserir na nota' }).isDisabled()).toBe(true);

      await page.getByRole('button', { name: 'Salvar como nota' }).click();
      await page.getByRole('textbox', { name: 'Nome da nota' }).fill('estoque');
      await page.keyboard.press('Enter');
      await expect.poll(vaultFile(app, 'estoque.md'), { timeout: 5000 }).toBe(`${TABLE}\n`);
      await expect.poll(() => page.locator('.dialog.tool').count()).toBe(0);
      expect(await page.locator('.tab.active').innerText()).toContain('estoque.md');
    });
  });

  it('JSON: lista as diferenças com o caminho, troca A e B, e o rascunho sobrevive ao fechar', async () => {
    await withPage(browser, {}, async (page) => {
      await openTool(page, 'Comparar JSON');
      expect(await page.locator('.tool-result').innerText()).toContain('Cole um JSON em cada lado');
      await page.getByLabel('JSON A').fill('{"nome":"Ana","idade":30,"tags":["a","b"],"extra":true}');
      await page.getByLabel('JSON B').fill('{ "idade": "30", "nome": "Ana", "tags": ["a","c"], "novo": 1 }');

      const rows = () => page.locator('.changes tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent)));
      await expect.poll(rows).toEqual([
        ['$.idade', 'tipo diferente', '30', '"30"'],
        ['$.tags[1]', 'valor diferente', '"b"', '"c"'],
        ['$.extra', 'só no A', 'true', '—'],
        ['$.novo', 'só no B', '—', '1'],
      ]);
      expect(await page.locator('.tool .actions .muted').innerText()).toBe('1 com valor diferente · 1 com tipo diferente · 1 só no A · 1 só no B');

      await page.getByRole('button', { name: 'Trocar A e B' }).click();
      await expect.poll(rows).toContainEqual(['$.novo', 'só no A', '1', '—']);

      await page.getByRole('tab', { name: 'Lado a lado' }).click();
      await page.locator('.diff-row').first().waitFor();
      expect(await page.locator('.diff-row pre.add').count()).toBeGreaterThan(0);

      await page.getByRole('button', { name: 'Fechar' }).click();
      await openTool(page, 'Comparar JSON');
      expect(await page.getByLabel('JSON A').inputValue()).toContain('"novo"');
    });
  });

  it('JSON: erro mostra a linha e a coluna; ignorar a ordem dos arrays zera a diferença', async () => {
    await withPage(browser, {}, async (page) => {
      await openTool(page, 'Comparar JSON');
      await page.getByLabel('JSON A').fill('{\n  "a": [1, 2, 3],\n}');
      await page.getByLabel('JSON B').fill('{"a": [3, 2, 1]}');
      expect(await page.locator('.tool-err').innerText()).toBe('JSON inválido na linha 3, coluna 1: vírgula sobrando antes de "}".');
      expect(await page.getByRole('button', { name: 'Copiar', exact: true }).isDisabled()).toBe(true);
      expect(await page.locator('.tool-result').innerText()).toContain('Corrija o JSON');

      await page.getByLabel('JSON A').fill('{"a": [1, 2, 3]}');
      await expect.poll(() => page.locator('.changes tbody tr').count()).toBe(2);
      await page.getByLabel('Ignorar a ordem dos itens dos arrays').check();
      await expect.poll(() => page.locator('.tool-result').innerText()).toContain('Os dois JSON têm o mesmo conteúdo.');
    });
  });

  it('JSON: salva o relatório como nota Markdown', async () => {
    await withPage(browser, {}, async (page, app) => {
      await openTool(page, 'Comparar JSON');
      await page.getByLabel('JSON A').fill('{"a":1}');
      await page.getByLabel('JSON B').fill('{"a":2}');
      await page.getByRole('button', { name: 'Salvar como nota' }).click();
      await page.getByRole('textbox', { name: 'Nome da nota' }).fill('comparacao');
      await page.keyboard.press('Enter');
      await expect.poll(vaultFile(app, 'comparacao.md'), { timeout: 5000 }).toBe(
        '| Caminho | Diferença | A | B |\n| --- | --- | --- | --- |\n| `$.a` | valor diferente | `1` | `2` |\n');
    });
  });

  it('as janelas fecham com Esc e não deixam nada aberto', async () => {
    await withPage(browser, {}, async (page) => {
      await openTool(page, 'Comparar JSON');
      await page.keyboard.press('Escape');
      expect(await page.locator('.overlay').count()).toBe(0);
    });
  });
});
