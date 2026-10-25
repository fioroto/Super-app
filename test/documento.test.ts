import { readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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

// ---------- W1: aparência inline e de linha ----------

const NOTA = readFileSync(path.join(import.meta.dirname, 'fixtures/nota-completa.md'), 'utf8');
const view = async <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> => {
  // O editor monta logo depois do clique na árvore: espera existir e ter o texto da nota.
  await page.waitForFunction(() => { const v = (window as any).__cmView?.(); return !!v && v.state.doc.length > 0; });
  return page.evaluate(([f, a]) => (new Function('v', 'a', `return (${f})(v, a)`))((window as any).__cmView(), a), [fn, args] as [string, unknown[]]) as Promise<T>;
};
const place = async (page: Page, needle: string, delta = 0) => {
  // Com duas notas abertas o editor é o mesmo: espera ele trocar para a nota que tem o trecho.
  await page.waitForFunction((n) => (window as any).__cmView?.()?.state.doc.toString().includes(n), needle);
  return placeNow(page, needle, delta);
};
const placeNow = (page: Page, needle: string, delta = 0) =>
  view<void>(page, '(v, [n, d]) => { const p = v.state.doc.toString().indexOf(n) + d; v.dispatch({ selection: { anchor: p }, scrollIntoView: true }); v.focus(); }', needle, delta);
const lines = (page: Page) => page.locator('.cm-line').allInnerTexts();
const lineWith = async (page: Page, text: string) => (await lines(page)).find((l) => l.includes(text));

describe('modo Documento: aparência', () => {
  it('título sem o # quando o cursor está em outra linha; com o # na linha do cursor', async () => {
    await doc({ 'n.md': NOTA }, async (page) => {
      await open(page, 'n.md');
      await page.locator('.cm-editor').waitFor();
      await place(page, 'Fim.');
      await expect.poll(() => lineWith(page, 'Título principal')).toBe('Título principal');
      expect(await page.locator('.cm-live-h1').count()).toBe(1);
      expect(await page.locator('.cm-live-h2').count()).toBe(1);
      await place(page, 'Título principal');
      await expect.poll(() => lineWith(page, 'Título principal')).toBe('# Título principal');
    });
  });

  it('negrito, itálico, riscado e código: sem marcas fora, com marcas dentro', async () => {
    await doc({ 'n.md': NOTA }, async (page) => {
      await open(page, 'n.md');
      await place(page, 'Fim.');
      const texto = 'Texto com negrito, itálico, riscado e código.';
      await expect.poll(() => lineWith(page, 'Texto com')).toContain('Texto com negrito, itálico, riscado e código. Um link');
      expect(await page.locator('.cm-live-strong').innerText()).toBe('negrito');
      expect(await page.locator('.cm-live-em').innerText()).toBe('itálico');
      expect(await page.locator('.cm-live-strike').innerText()).toBe('riscado');
      expect(await page.locator('.cm-live-code').innerText()).toBe('código');
      expect(texto.length).toBeGreaterThan(0);

      await place(page, 'negrito', 3);
      await expect.poll(() => lineWith(page, 'Texto com')).toContain('**negrito**, itálico');
      await place(page, 'itálico', 3);
      await expect.poll(() => lineWith(page, 'Texto com')).toContain('negrito, *itálico*, riscado');
      await place(page, 'riscado', 3);
      await expect.poll(() => lineWith(page, 'Texto com')).toContain('~~riscado~~');
      await place(page, 'código', 3);
      await expect.poll(() => lineWith(page, 'Texto com')).toContain('`código`');
    });
  });

  it('link mostra só o texto; Ctrl+clique em link relativo abre a nota', async () => {
    await doc({ 'n.md': NOTA, 'outra.md': 'OUTRA NOTA\n' }, async (page) => {
      await open(page, 'n.md');
      await place(page, 'Fim.');
      await expect.poll(() => lineWith(page, 'Texto com')).toContain('Um link e uma nota irmã.');
      expect(await page.locator('.cm-live-link').allInnerTexts()).toEqual(['link', 'irmã']);
      await place(page, 'Título principal'); // tira o cursor de perto dos links
      await page.locator('.cm-live-link', { hasText: 'irmã' }).click({ modifiers: ['Control'] });
      await expect.poll(() => page.locator('.tab.active').innerText()).toContain('outra.md');
      await expect.poll(() => page.locator('.cm-content').innerText()).toContain('OUTRA NOTA');
    });
  });

  it('lista mostra marcadores; caixa de tarefa alterna e grava [x] no disco', async () => {
    await doc({ 'n.md': NOTA }, async (page, app) => {
      await open(page, 'n.md');
      await place(page, 'Fim.');
      expect(await page.locator('.cm-live-bullet').allInnerTexts()).toEqual(['•', '•', '◦']);
      expect(await page.locator('.cm-live-check').count()).toBe(2);
      expect(await page.locator('.cm-live-check').nth(1).isChecked()).toBe(true);
      expect(await lineWith(page, 'tarefa aberta')).toBe('tarefa aberta');
      expect(await page.locator('.cm-live-done').innerText()).toBe('tarefa feita');

      await page.locator('.cm-live-check').first().click();
      await expect.poll(disk(app, 'n.md'), { timeout: 5000 }).toBe(NOTA.replace('- [ ] tarefa aberta', '- [x] tarefa aberta'));
      await expect.poll(() => page.locator('.cm-live-check:checked').count()).toBe(2);
      await page.locator('.cm-live-check').nth(1).click();
      await expect.poll(disk(app, 'n.md'), { timeout: 5000 }).toBe(NOTA.replace('- [ ] tarefa aberta', '- [x] tarefa aberta').replace('- [x] tarefa feita', '- [ ] tarefa feita'));
    });
  });

  it('citação, bloco de código, linha horizontal e HTML cru', async () => {
    await doc({ 'n.md': NOTA }, async (page) => {
      await open(page, 'n.md');
      await place(page, 'Fim.');
      expect(await page.locator('.cm-live-quote').count()).toBe(2);
      expect(await lineWith(page, 'uma citação')).toBe('uma citação');
      expect(await lineWith(page, 'em duas linhas')).toBe('em duas linhas');
      expect(await page.locator('.cm-live-codeblock').count()).toBe(3);
      expect(await page.locator('.cm-live-codefence').count()).toBe(2);
      expect(await page.locator('.cm-live-hr').count()).toBe(1);
      expect(await page.locator('.cm-live-html').innerText()).toBe('<div>html cru</div>');
      expect(await page.locator('.cm-content div').filter({ hasText: /^html cru$/ }).count()).toBe(0);
    });
  });

  it('frontmatter fica visível e discreto: nem linha horizontal nem título', async () => {
    await doc({ 'n.md': NOTA }, async (page) => {
      await open(page, 'n.md');
      await place(page, 'Fim.');
      expect(await page.locator('.cm-live-fm').count()).toBe(4);
      expect((await lines(page)).slice(0, 4)).toEqual(['---', 'tags: [projeto, teste]', 'autor: eu', '---']);
      expect(await page.locator('.cm-live-h2').count()).toBe(1); // só o "## Subtítulo"
    });
  });

  it('a seta atravessa os trechos escondidos sem travar', async () => {
    await doc({ 'n.md': 'ab **cd** ef [gh](x.md) ij\n' }, async (page) => {
      await open(page, 'n.md');
      await place(page, 'ab');
      const heads: number[] = [];
      for (let i = 0; i < 27; i++) {
        heads.push(await view<number>(page, '(v) => v.state.selection.main.head'));
        await page.keyboard.press('ArrowRight');
      }
      for (let i = 1; i < heads.length; i++) expect(heads[i]!, `passo ${i}`).toBeGreaterThan(heads[i - 1]!);
      expect(heads.at(-1)).toBe(26);
    });
  });
});

describe('modo Documento: o texto do arquivo nunca muda sozinho', () => {
  it('abrir e olhar não grava nada: disco intacto e sem histórico', async () => {
    await doc({ 'n.md': NOTA }, async (page, app) => {
      await open(page, 'n.md');
      await place(page, 'Fim.');
      await page.waitForTimeout(2500);
      expect(await readFile(path.join(app.vault, 'n.md'), 'utf8')).toBe(NOTA);
      const hist = await readdir(path.join(app.vault, '.superapp/history')).catch(() => null);
      expect(hist).toBeNull();
      expect(await page.locator('.status').innerText()).toBe('salvo');
    });
  });

  it('editar uma linha muda só essa linha no disco', async () => {
    await doc({ 'n.md': NOTA }, async (page, app) => {
      await open(page, 'n.md');
      await place(page, 'Fim.', 4);
      await page.keyboard.type(' E mais.');
      await expect.poll(disk(app, 'n.md'), { timeout: 5000 }).toBe(NOTA.replace('Fim.', 'Fim. E mais.'));
    });
  });
});

// ---------- W2: imagem, diagrama e tabela ----------

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const FLUXO = '```mermaid\nflowchart TD\n  A[Início] --> B[Fim]\n```';

describe('modo Documento: imagem, diagrama e tabela', () => {
  it('imagem do vault aparece; imagem externa não é buscada e mostra o texto alternativo', async () => {
    await doc({ 'n.md': '![foto](anexos/f.png)\n\n![logo](https://exemplo.com/logo.png)\n\nfim\n' }, async (page, app) => {
      await mkdir(path.join(app.vault, 'anexos'));
      await writeFile(path.join(app.vault, 'anexos/f.png'), PNG);
      const requests: string[] = [];
      page.on('request', (r) => requests.push(r.url()));
      await open(page, 'n.md');
      await place(page, 'fim', 3);
      await expect.poll(() => page.locator('.cm-live-img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1);
      expect(await page.locator('.cm-live-img').getAttribute('src')).toBe('/api/raw?path=anexos%2Ff.png');
      expect(await page.locator('.cm-live-img-blocked').innerText()).toBe('[imagem externa bloqueada: logo]');
      expect(requests.some((u) => u.includes('exemplo.com'))).toBe(false);
      // Clicar na imagem abre o texto-fonte dela.
      await page.locator('.cm-live-img').click();
      await expect.poll(() => lineWith(page, 'anexos/f.png')).toBe('![foto](anexos/f.png)');
    });
  });

  it('imagem relativa a partir de uma subpasta', async () => {
    await doc({ 'notas/n.md': '![x](../anexos/f%201.png)\n\nfim\n' }, async (page, app) => {
      await mkdir(path.join(app.vault, 'anexos'));
      await writeFile(path.join(app.vault, 'anexos/f 1.png'), PNG);
      await open(page, 'n.md');
      await place(page, 'fim', 3);
      await expect.poll(() => page.locator('.cm-live-img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1);
    });
  });

  it('bloco mermaid vira diagrama; clicar abre o código; ao sair volta o diagrama', async () => {
    await doc({ 'n.md': `antes\n\n${FLUXO}\n\ndepois\n` }, async (page) => {
      await open(page, 'n.md');
      await place(page, 'depois', 6);
      await page.locator('.cm-live-mermaid svg').waitFor({ timeout: 15_000 });
      expect(await page.locator('.cm-live-mermaid').innerText()).toContain('Início');
      expect(await lineWith(page, 'flowchart')).toBeUndefined();

      await page.locator('.cm-live-mermaid').click();
      await expect.poll(() => lineWith(page, 'flowchart TD')).toBe('flowchart TD');
      expect(await page.locator('.cm-live-mermaid').count()).toBe(0);
      expect(await page.locator('.cm-live-codeblock').count()).toBe(4);

      await place(page, 'antes', 2);
      await page.locator('.cm-live-mermaid svg').waitFor({ timeout: 15_000 });
      expect(await lineWith(page, 'flowchart')).toBeUndefined();
    });
  });

  it('erro de sintaxe aparece no próprio widget', async () => {
    await doc({ 'n.md': '```mermaid\ndiagramaquenaoexiste\n  A --> B\n```\n\nfim\n' }, async (page) => {
      await open(page, 'n.md');
      await place(page, 'fim', 3);
      await page.locator('.cm-live-mermaid-error').waitFor({ timeout: 15_000 });
      expect(await page.locator('.cm-live-mermaid-error').innerText()).toContain('Diagrama com erro');
    });
  });

  it('o Mermaid só é baixado quando a nota tem diagrama', async () => {
    await doc({ 'simples.md': '# Oi\n\ntexto\n', 'fluxo.md': `${FLUXO}\n\ndepois\n` }, async (page) => {
      const js: string[] = [];
      page.on('request', (r) => { if (/\.m?js(\?|$)/.test(r.url())) js.push(r.url()); });
      await open(page, 'simples.md');
      await place(page, 'texto', 5);
      await page.waitForTimeout(400);
      expect(js.length).toBe(0);
      await open(page, 'fluxo.md');
      await place(page, 'depois', 6); // o cursor sai do bloco, que então vira diagrama
      await page.locator('.cm-live-mermaid svg').waitFor({ timeout: 15_000 });
      expect(js.length).toBeGreaterThan(0);
    });
  });

  it('tabela vira <table>; clicar abre o código; HTML perigoso na célula não executa', async () => {
    const md = 'antes\n\n| Nome | Valor |\n|---|---|\n| a | <img src=x onerror="window.__pwned=1"> |\n| **b** | 2 |\n\ndepois\n';
    await doc({ 'n.md': md }, async (page) => {
      await open(page, 'n.md');
      await place(page, 'depois', 6);
      await page.locator('.cm-live-table table').waitFor();
      expect(await page.locator('.cm-live-table th').allInnerTexts()).toEqual(['Nome', 'Valor']);
      expect(await page.locator('.cm-live-table td strong').innerText()).toBe('b');
      expect(await lineWith(page, '|---|---|')).toBeUndefined();
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();

      await page.locator('.cm-live-table').click();
      await expect.poll(() => lineWith(page, '| Nome | Valor |')).toBe('| Nome | Valor |');
      expect(await page.locator('.cm-live-table').count()).toBe(0);
      expect(await page.locator('.cm-live-table-src').count()).toBe(4);
    });
  });

  it('diagrama dentro de lista continua como código (não perde o recuo)', async () => {
    const md = '- item\n\n  ```mermaid\n  flowchart TD\n    A --> B\n  ```\n\nfim\n';
    await doc({ 'n.md': md }, async (page, app) => {
      await open(page, 'n.md');
      await place(page, 'fim', 3);
      await page.waitForTimeout(500);
      expect(await page.locator('.cm-live-mermaid').count()).toBe(0);
      expect(await lineWith(page, 'flowchart TD')).toBe('  flowchart TD');
      expect(await readFile(path.join(app.vault, 'n.md'), 'utf8')).toBe(md);
    });
  });

  it('rolar um documento com 20 diagramas não faz o texto pular quando eles carregam', async () => {
    const partes = Array.from({ length: 20 }, (_, i) => `Parágrafo ${i}\n\n\`\`\`mermaid\nflowchart TD\n  A${i}[Caixa ${i}] --> B${i}[Fim]\n\`\`\`\n`).join('\n');
    await doc({ 'n.md': partes + '\nFinal\n' }, async (page) => {
      await open(page, 'n.md');
      await view<void>(page, '(v) => { v.focus(); }');
      // Leva "Parágrafo 12" para o topo da janela e mede onde ele fica depois de tudo carregar.
      const topOf = () => page.evaluate(() => {
        const el = [...document.querySelectorAll('.cm-line')].find((l) => l.textContent === 'Parágrafo 12');
        return el ? el.getBoundingClientRect().top : null;
      });
      await view<void>(page, '(v, [n]) => { const p = v.state.doc.toString().indexOf(n); v.dispatch({ selection: { anchor: p } }); v.scrollDOM.scrollTop = v.lineBlockAt(p).top; }', 'Parágrafo 12');
      await page.waitForTimeout(150);
      const before = await topOf();
      await page.waitForFunction(() => document.querySelectorAll('.cm-live-mermaid svg').length >= 5, undefined, { timeout: 30_000 });
      await page.waitForTimeout(2500);
      const after = await topOf();
      expect(before).not.toBeNull();
      expect(after).not.toBeNull();
      expect(Math.abs(after! - before!), `antes ${before}, depois ${after}`).toBeLessThanOrEqual(40);
    });
  });
});

// ---------- W3: formatação, barra e atalhos ----------

/** Texto com marcas: «» é a seleção, | é o cursor, ⏎ é quebra de linha, · é espaço. */
function parseMarked(marked: string): { text: string; anchor: number; head: number } {
  const raw = marked.replace(/⏎/g, '\n').replace(/·/g, ' ');
  let text = '', from = -1, to = -1, cursor = -1;
  for (const ch of raw) {
    if (ch === '«') from = text.length;
    else if (ch === '»') to = text.length;
    else if (ch === '|') cursor = text.length;
    else text += ch;
  }
  return cursor >= 0 ? { text, anchor: cursor, head: cursor } : { text, anchor: from, head: to };
}
function showMarked(text: string, anchor: number, head: number): string {
  const [a, b] = [Math.min(anchor, head), Math.max(anchor, head)];
  const marked = a === b ? `${text.slice(0, a)}|${text.slice(a)}` : `${text.slice(0, a)}«${text.slice(a, b)}»${text.slice(b)}`;
  return marked.replace(/\n/g, '⏎').replace(/ /g, ' ');
}
const hasMarks = (s: string) => /[«»|]/.test(s);

const setDoc = (page: Page, marked: string) => {
  const { text, anchor, head } = parseMarked(marked);
  return view<void>(page, '(v, [t, a, h]) => { v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t }, selection: { anchor: a, head: h } }); v.focus(); }', text, anchor, head);
};
const snapshot = async (page: Page) => {
  const s = await view<{ text: string; a: number; h: number }>(page, '(v) => ({ text: v.state.doc.toString(), a: v.state.selection.main.anchor, h: v.state.selection.main.head })');
  return { text: s.text, marked: showMarked(s.text, s.a, s.h) };
};
/** Abre uma nota, põe o texto marcado e devolve a página pronta para o atalho. */
const withNote = (marked: string, fn: (page: Page, app: { vault: string }) => Promise<void>, mode: Mode = 'doc') =>
  doc({ 'n.md': 'x' }, async (page, app) => {
    await open(page, 'n.md');
    await page.locator('.cm-editor').waitFor();
    await setDoc(page, marked);
    await fn(page, app);
  }, mode);

const CASOS: [string, string, string, string][] = [
  // [nome, antes, atalho, depois]  (sem marcas no "depois" = compara só o texto)
  ['negrito na seleção', 'Olá «mundo»', 'Control+b', 'Olá **«mundo»**'],
  ['tira o negrito (seleção dentro)', 'Olá **«mundo»**', 'Control+b', 'Olá «mundo»'],
  ['tira o negrito (seleção com as marcas)', 'Olá «**mundo**»', 'Control+b', 'Olá «mundo»'],
  ['tira o negrito (cursor dentro)', 'Olá **mu|ndo**', 'Control+b', 'Olá mu|ndo'],
  ['negrito na palavra do cursor', 'Olá mu|ndo', 'Control+b', 'Olá **mu|ndo**'],
  ['negrito sem palavra: par de marcas', 'Olá |', 'Control+b', 'Olá **|**'],
  ['espaços ficam fora das marcas', '«·mundo·»', 'Control+b', '·**mundo**·'],
  ['negrito por linha', '«linha 1⏎linha 2»', 'Control+b', '**«linha 1**⏎**linha 2»**'],
  ['itálico dentro de negrito', '**mu|ndo**', 'Control+i', '***mu|ndo***'],
  ['tira o itálico', '*«x»*', 'Control+i', '«x»'],
  ['código em linha', '«a*b»', 'Control+Backquote', '`«a*b»`'],
  ['riscado', 'a «b» c', 'Control+Shift+x', 'a ~~«b»~~ c'],
  ['título 2 no cursor', '|Texto', 'Control+Alt+2', '## |Texto'],
  ['repetir o nível volta a parágrafo', '## |Texto', 'Control+Alt+2', '|Texto'],
  ['troca de nível', '## |Texto', 'Control+Alt+1', '# |Texto'],
  ['título não vale em item de lista', '- |item', 'Control+Alt+1', '- |item'],
  ['título em várias linhas', '«a⏎b»', 'Control+Alt+3', '### a⏎### b'],
  ['parágrafo tira o título', '### |x', 'Control+Alt+0', '|x'],
  ['lista de marcadores', '«a⏎b»', 'Control+Shift+8', '- a⏎- b'],
  ['tira a lista', '«- a⏎- b»', 'Control+Shift+8', 'a⏎b'],
  ['lista vira numerada', '«- a⏎- b»', 'Control+Shift+7', '1. a⏎2. b'],
  ['numeração reinicia depois de linha vazia', '«a⏎⏎b»', 'Control+Shift+7', '1. a⏎⏎1. b'],
  ['tira a tarefa', '«- [ ] a»', 'Control+Shift+9', 'a'],
  ['tarefa em linha comum', '«a»', 'Control+Shift+9', '- [ ] a'],
  ['lista mista completa o que falta', '«- a⏎b»', 'Control+Shift+8', '- a⏎- b'],
  ['numerada vira marcadores', '«1. a⏎2. b»', 'Control+Shift+8', '- a⏎- b'],
  ['marcadores viram tarefas', '«- a⏎- b»', 'Control+Shift+9', '- [ ] a⏎- [ ] b'],
  ['citação', '«a⏎b»', 'Control+Shift+Period', '> a⏎> b'],
  ['tira a citação', '«> a⏎> b»', 'Control+Shift+Period', 'a⏎b'],
  ['citação mista completa o que falta', '«> a⏎b»', 'Control+Shift+Period', '> a⏎> b'],
  ['bloco de código nas linhas', '«a⏎b»', 'Control+Alt+c', '```⏎a⏎b⏎```'],
  ['tira o bloco de código', '```⏎«a»⏎```', 'Control+Alt+c', 'a'],
  ['Tab aninha o item', '- a⏎- |b', 'Tab', '- a⏎  - |b'],
  ['Shift+Tab desaninha', '- a⏎  - |b', 'Shift+Tab', '- a⏎- |b'],
  ['Tab em lista numerada usa 3 espaços', '1. a⏎2. |b', 'Tab', '1. a⏎   2. |b'],
  ['Tab no primeiro item não faz nada', '- |a', 'Tab', '- |a'],
];

describe('modo Documento: comandos de formatação', () => {
  for (const [nome, antes, atalho, depois] of CASOS) {
    it(`${nome}: ${atalho}`, async () => {
      await withNote(antes, async (page) => {
        await page.keyboard.press(atalho);
        const got = await snapshot(page);
        if (hasMarks(depois)) expect(got.marked).toBe(depois);
        else expect(got.text).toBe(parseMarked(depois).text);
      });
    });
  }

  it('um Ctrl+Z desfaz cada comando por inteiro', async () => {
    await withNote('«a⏎b⏎c»', async (page) => {
      for (const atalho of ['Control+b', 'Control+Shift+8', 'Control+Shift+Period', 'Control+Alt+2']) {
        await setDoc(page, '«a⏎b⏎c»');
        await page.keyboard.press(atalho);
        expect((await snapshot(page)).text).not.toBe('a\nb\nc');
        await page.keyboard.press('Control+z');
        expect((await snapshot(page)).text, atalho).toBe('a\nb\nc');
      }
    });
  });

  it('Tab fora de lista não é engolido: segue o caminho normal do editor', async () => {
    await withNote('|texto', async (page) => {
      await page.keyboard.press('Tab');
      expect((await snapshot(page)).text).not.toBe('texto');
    });
  });

  it('Enter em citação continua; Enter em citação vazia sai', async () => {
    await withNote('> a|', async (page) => {
      await page.keyboard.press('Enter');
      await page.keyboard.type('b');
      expect((await snapshot(page)).text).toBe('> a\n> b');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      expect((await snapshot(page)).text).toBe('> a\n> b\n');
    });
  });

  it('atalhos de formatação só valem em notas .md', async () => {
    await doc({ 'n.txt': 'texto' }, async (page) => {
      await open(page, 'n.txt');
      await page.locator('.cm-editor').waitFor();
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Control+b');
      expect((await snapshot(page)).text).toBe('texto');
      expect(await page.locator('.fmt-bar').count()).toBe(0);
    });
  });

  it('funciona também nos modos Código e Dividido', async () => {
    for (const mode of ['editor', 'split'] as const) {
      await withNote('«x»', async (page) => {
        await page.keyboard.press('Control+b');
        expect((await snapshot(page)).marked).toBe('**«x»**');
        expect(await page.locator('.fmt-bar').count()).toBe(1);
      }, mode);
    }
  });
});

describe('modo Documento: link, tabela, imagem e barra', () => {
  const dialog = (page: Page) => page.locator('.dialog input');

  it('Ctrl+K cria o link com o texto selecionado', async () => {
    await withNote('«texto»', async (page) => {
      await page.keyboard.press('Control+k');
      await dialog(page).fill('https://x.com');
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await snapshot(page)).text).toBe('[texto](https://x.com)');
    });
  });

  it('Ctrl+K num link existente edita só o endereço', async () => {
    await withNote('[a](x|)', async (page) => {
      await page.keyboard.press('Control+k');
      expect(await dialog(page).inputValue()).toBe('x');
      await dialog(page).fill('y');
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await snapshot(page)).text).toBe('[a](y)');
    });
  });

  it('Ctrl+K sem seleção usa o endereço como texto', async () => {
    await withNote('|', async (page) => {
      await page.keyboard.press('Control+k');
      await dialog(page).fill('https://x.com');
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await snapshot(page)).text).toBe('[https://x.com](https://x.com)');
    });
  });

  it('botões da barra: negrito sem tirar o foco da seleção, e o botão acende com o cursor', async () => {
    await withNote('Olá «mundo»', async (page) => {
      await page.getByTitle('Negrito (Ctrl+B)').click();
      expect((await snapshot(page)).marked).toBe('Olá **«mundo»**');
      await expect.poll(() => page.getByTitle('Negrito (Ctrl+B)').getAttribute('aria-pressed')).toBe('true');
      expect(await page.getByTitle('Itálico (Ctrl+I)').getAttribute('aria-pressed')).toBe('false');
      await page.keyboard.type('!'); // o foco continua no texto
      expect((await snapshot(page)).text).toBe('Olá **!**');
    });
  });

  it('o seletor de estilo muda o título e mostra o nível do cursor', async () => {
    await withNote('Tit|ulo', async (page) => {
      await page.getByLabel('Estilo').selectOption('2');
      expect((await snapshot(page)).text).toBe('## Titulo');
      await expect.poll(() => page.getByLabel('Estilo').inputValue()).toBe('2');
      await page.getByLabel('Estilo').selectOption('0');
      expect((await snapshot(page)).text).toBe('Titulo');
    });
  });

  it('botões de lista, citação, bloco, tabela e linha horizontal', async () => {
    await withNote('a|', async (page) => {
      await page.getByRole('button', { name: '☑ Tarefas' }).click();
      expect((await snapshot(page)).text).toBe('- [ ] a');
      await setDoc(page, '|');
      await page.getByRole('button', { name: 'Tabela' }).click();
      const t = await snapshot(page);
      expect(t.text).toBe('| Coluna 1 | Coluna 2 | Coluna 3 |\n| --- | --- | --- |\n|  |  |  |\n');
      expect(t.marked).toContain('|  |  |  |⏎'.replace('|  |', '|')); // o cursor está na primeira célula do corpo
      expect(await view<number>(page, '(v) => v.state.selection.main.head')).toBe(t.text.indexOf('|  |  |  |') + 2);
      await setDoc(page, 'topo|');
      await page.getByRole('button', { name: '—' }).click();
      expect((await snapshot(page)).text).toBe('topo\n\n---\n');
    });
  });

  it('botão Imagem envia o arquivo para anexos/ e põe o link no cursor', async () => {
    await withNote('|', async (page, app) => {
      await page.locator('.fmt-bar input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
      await expect.poll(async () => (await snapshot(page)).text).toBe('![](anexos/foto.png)');
      expect((await readFile(path.join(app.vault, 'anexos/foto.png'))).length).toBe(PNG.length);
    });
  });

  it('a barra não aparece em Ler (impressão) nem em quadro ou .txt', async () => {
    await withNote('x', async (page) => {
      expect(await page.locator('.fmt-bar').count()).toBe(1);
    });
    const quadro = '---\n\nkanban-plugin: board\n\n---\n\n## A\n\n- [ ] x\n';
    await doc({ 'q.md': quadro }, async (page) => {
      await open(page, 'q.md');
      await page.locator('.board').waitFor();
      expect(await page.locator('.fmt-bar').count()).toBe(0);
    });
  });
});
