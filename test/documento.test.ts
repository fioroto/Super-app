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
