import { describe, expect, it } from 'vitest';
import { cellOf, markSegs, proseDiff, splitBlocks, type Change, type Row } from '../web/src/history/proseDiff.ts';

const RELATORIO = [
  '# Relatório mensal',
  '',
  'O fundo rendeu 1,2% no mês, acima do CDI. A taxa de administração continua em 0,5%.',
  '',
  '## Custos',
  '',
  'Os custos ficaram estáveis e dentro do orçamento previsto para o trimestre inteiro.',
  '',
  '## Riscos',
  '',
  'O risco de crédito segue baixo, com a carteira concentrada em títulos públicos federais.',
  '',
].join('\n');

/** Os trechos destacados de cada lado de uma mudança. */
const marked = (c: Change) => ({
  left: (c.leftSegs ?? []).filter((s) => s.changed && !s.markup).map((s) => s.text).join('').trim(),
  right: (c.rightSegs ?? []).filter((s) => s.changed && !s.markup).map((s) => s.text).join('').trim(),
});
const html = (c: Change, side: 'left' | 'right') => {
  const cell = cellOf(side === 'left' ? c.left! : c.right!, side === 'left' ? c.leftSegs : c.rightSegs, side === 'left' ? 'd' : 'a', 'md');
  return 'md' in cell ? cell.md : cell.html;
};
const visible = (rows: Row[]): Row[] => rows.flatMap((r) => (r.kind === 'skip' ? r.rows : [r]));

describe('blocos', () => {
  it('parágrafo quebrado em várias linhas é um bloco só; título, item, citação, tabela e código são blocos', () => {
    const src = '---\ntags: [a]\n---\n# Título\n\nlinha um\nlinha dois\n\n- item a\n  continua\n- item b\n\n> citação\n> segue\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\nx = 1\n```\n\n---\n';
    expect(splitBlocks(src, 'md').map((b) => [b.kind, b.text])).toEqual([
      ['front', '---\ntags: [a]\n---'],
      ['heading', '# Título'],
      ['para', 'linha um\nlinha dois'],
      ['item', '- item a\n  continua'],
      ['item', '- item b'],
      ['quote', '> citação\n> segue'],
      ['row', '| a | b |\n| --- | --- |'],
      ['row', '| 1 | 2 |'],
      ['code', '```js\nx = 1\n```'],
      ['rule', '---'],
    ]);
  });

  it('a posição de cada bloco aponta o texto de origem', () => {
    const src = 'a\n\nb b\nc\n';
    for (const blk of splitBlocks(src, 'md')) expect(src.slice(blk.from, blk.to)).toBe(blk.text);
  });
});

describe('comparar texto', () => {
  it('quebrar o parágrafo em outras linhas não é mudança', () => {
    const d = proseDiff('Um parágrafo longo que\nfoi quebrado assim.\n', 'Um parágrafo longo\nque foi quebrado assim.\n', 'md');
    expect(d.changes).toEqual([]);
  });

  it('trocar um número destaca só o número', () => {
    const d = proseDiff(RELATORIO, RELATORIO.replace('1,2%', '1,4%'), 'md');
    expect(d.changes.length).toBe(1);
    expect(d.changes[0]!.kind).toBe('changed');
    expect(marked(d.changes[0]!)).toEqual({ left: '1,2%', right: '1,4%' });
    expect(html(d.changes[0]!, 'left')).toContain('rendeu <mark class="d">1,2%</mark> no mês');
    expect(html(d.changes[0]!, 'right')).toContain('rendeu <mark class="a">1,4%</mark> no mês');
    expect(d.stats).toEqual({ added: 2, removed: 2, changed: 1, moved: 0 }); // "1,4%" conta como duas palavras: 1 e 4
  });

  it('uma frase reescrita vira um destaque de cada lado, não palavra sim, palavra não', () => {
    const d = proseDiff(RELATORIO, RELATORIO.replace('continua em 0,5%', 'caiu para 0,4%'), 'md');
    expect(marked(d.changes[0]!)).toEqual({ left: 'continua em 0,5%', right: 'caiu para 0,4%' });
    expect(html(d.changes[0]!, 'right')).toContain('<mark class="a">caiu para 0,4%</mark>');
  });

  it('parágrafo novo e parágrafo removido', () => {
    const novo = RELATORIO.replace('## Custos', 'Parágrafo novo, escrito agora.\n\n## Custos');
    const d = proseDiff(RELATORIO, novo, 'md');
    expect(d.changes.map((c) => c.kind)).toEqual(['added']);
    expect(d.stats.added).toBe(4);
    const back = proseDiff(novo, RELATORIO, 'md');
    expect(back.changes.map((c) => c.kind)).toEqual(['removed']);
    expect(back.stats.removed).toBe(4);
  });

  it('parágrafo que mudou de lugar aparece como movido, não como removido e adicionado', () => {
    const riscos = '## Riscos\n\nO risco de crédito segue baixo, com a carteira concentrada em títulos públicos federais.\n';
    const trocado = RELATORIO.replace(`\n${riscos}`, '').replace('## Custos', `${riscos}\n## Custos`);
    expect(trocado.match(/Riscos/g)!.length).toBe(1);
    const d = proseDiff(RELATORIO, trocado, 'md');
    expect(d.changes.every((c) => c.kind === 'moved')).toBe(true);
    expect(d.stats.moved).toBe(d.changes.length);
    // Cada movido aparece duas vezes: apagado na posição antiga, presente na nova.
    const sides = visible(d.rows).filter((r) => r.kind === 'change').map((r) => (r as { side: string }).side);
    expect(sides.filter((x) => x === 'left').length).toBe(d.changes.length);
    expect(sides.filter((x) => x === 'right').length).toBe(d.changes.length);
  });

  it('só o item de lista que mudou aparece', () => {
    const d = proseDiff('- maçã\n- pera\n- uva\n', '- maçã\n- pêra\n- uva\n', 'md');
    expect(d.changes.length).toBe(1);
    expect(marked(d.changes[0]!)).toEqual({ left: 'pera', right: 'pêra' });
    expect(html(d.changes[0]!, 'right')).toBe('- <mark class="a">pêra</mark>');
  });

  it('linha de tabela e linha de código', () => {
    const t = proseDiff('| a | b |\n| --- | --- |\n| 1 | 2 |\n', '| a | b |\n| --- | --- |\n| 1 | 3 |\n', 'md');
    expect(html(t.changes[0]!, 'right')).toBe('| 1 | <mark class="a">3</mark> |');
    const c = proseDiff('```\nx = 1\ny = 2\n```\n', '```\nx = 1\ny = 3\n```\n', 'md');
    expect(html(c.changes[0]!, 'right')).toBe('<pre class="pdiff-code">```\nx = 1\n<mark class="a">y = 3</mark>\n```</pre>');
  });

  it('o destaque nunca entra na marcação: link, negrito, separador de tabela', () => {
    const link = proseDiff('Veja [o site](https://a.com/x) hoje.\n', 'Veja [o portal](https://b.com/y) hoje.\n', 'md');
    const right = html(link.changes[0]!, 'right');
    expect(right).toBe('Veja [o <mark class="a">portal</mark>](https://b.com/y) hoje.');
    expect(link.changes[0]!.format).toBe(true); // o destino do link mudou

    const bold = proseDiff('O resultado foi bom.\n', 'O resultado foi **bom**.\n', 'md');
    expect(bold.changes[0]!.format).toBe(true);
    expect(marked(bold.changes[0]!)).toEqual({ left: '', right: '' });
    expect(html(bold.changes[0]!, 'right')).not.toContain('<mark');

    const head = proseDiff('# Título\n', '## Título\n', 'md');
    expect(head.changes[0]!.format).toBe(true);
    expect(html(head.changes[0]!, 'right')).toBe('## Título');
  });

  it('trechos iguais longos ficam recolhidos, com um bloco de contexto de cada lado', () => {
    const many = Array.from({ length: 10 }, (_, i) => `Parágrafo ${i}.`).join('\n\n');
    const d = proseDiff(many, many.replace('Parágrafo 5.', 'Parágrafo cinco.'), 'md');
    expect(d.rows.map((r) => r.kind)).toEqual(['skip', 'same', 'change', 'same', 'skip']);
    expect((d.rows[0] as { rows: Row[] }).rows.length).toBe(4);
  });

  it('texto puro: tudo pode ser destacado e o HTML sai escapado', () => {
    const d = proseDiff('a <b> | c\n', 'a <b> | d\n', 'txt');
    const cell = cellOf(d.changes[0]!.right!, d.changes[0]!.rightSegs, 'a', 'txt');
    expect(cell).toEqual({ html: '<p class="pdiff-txt">a &lt;b&gt; | <mark class="a">d</mark></p>' });
  });

  it('markSegs deixa o espaço das pontas fora do destaque', () => {
    expect(markSegs([{ text: 'a', changed: false, markup: false }, { text: ' b ', changed: true, markup: false }, { text: 'c', changed: false, markup: false }], 'a')).toBe('a <mark class="a">b</mark> c');
  });

  it('textos iguais não têm mudança', () => {
    expect(proseDiff(RELATORIO, RELATORIO, 'md').changes).toEqual([]);
  });
});
