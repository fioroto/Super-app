import { mkdir, readFile, readdir, rename as fsRename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launch, newContext, startApp, type App } from './helpers.ts';

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(() => browser?.close());

async function withPage(files: Record<string, string>, fn: (page: Page, app: App) => Promise<void>) {
  const app = await startApp(files);
  const ctx = await newContext(browser, app);
  try {
    const page = await ctx.newPage();
    await page.goto(app.base);
    await page.locator('.side-head').waitFor();
    await fn(page, app);
  } finally {
    await ctx.close();
    await app.close();
  }
}

const disk = (app: App, rel: string) => readFile(path.join(app.vault, rel), 'utf8');
const diskNow = (app: App, rel: string) => () => disk(app, rel).catch(() => null);
const openNote = (page: Page, name: string) => page.locator('.tree-item', { hasText: name }).first().click();
const editor = (page: Page) => page.locator('.cm-content');
const dialogInput = (page: Page, text: string) => page.locator('.dialog input').fill(text).then(() => page.keyboard.press('Enter'));

describe('abrir, editar e salvar', () => {
  it('abre uma nota, mostra o preview e grava o que foi digitado', async () => {
    await withPage({ 'notas/a.md': '# Título\n\ntexto\n' }, async (page, app) => {
      await openNote(page, 'a.md');
      await expect.poll(() => editor(page).innerText()).toContain('# Título');
      await expect.poll(() => page.locator('.preview h1').innerText()).toBe('Título');

      await editor(page).click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type('mais uma linha');
      await expect.poll(diskNow(app, 'notas/a.md'), { timeout: 5000 }).toBe('# Título\n\ntexto\nmais uma linha');
      await expect.poll(() => page.locator('.status').innerText()).toBe('salvo');
      await expect.poll(() => page.locator('.preview').innerText()).toContain('mais uma linha');
    });
  });

  it('Enter continua a lista e Enter num item vazio encerra', async () => {
    await withPage({ 'l.md': '- um' }, async (page, app) => {
      await openNote(page, 'l.md');
      await editor(page).click();
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('dois');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await expect.poll(diskNow(app, 'l.md'), { timeout: 5000 }).toBe('- um\n- dois\n');
    });
  });

  it('troca de aba mantém o texto de cada nota e fecha a aba', async () => {
    await withPage({ 'a.md': 'AAA\n', 'b.md': 'BBB\n' }, async (page) => {
      await openNote(page, 'a.md');
      await openNote(page, 'b.md');
      await expect.poll(() => page.locator('.tab').count()).toBe(2);
      await expect.poll(() => editor(page).innerText()).toContain('BBB');
      await page.locator('.tab', { hasText: 'a.md' }).click();
      await expect.poll(() => editor(page).innerText()).toContain('AAA');
      await page.locator('.tab', { hasText: 'a.md' }).getByTitle('Fechar').click();
      await expect.poll(() => page.locator('.tab').count()).toBe(1);
      await expect.poll(() => editor(page).innerText()).toContain('BBB');
    });
  });
});

describe('mudanças feitas por outra ferramenta', () => {
  it('recarrega em silêncio quando não há edição pendente', async () => {
    await withPage({ 'a.md': 'antes\n' }, async (page, app) => {
      await openNote(page, 'a.md');
      await expect.poll(() => editor(page).innerText()).toContain('antes');
      await writeFile(path.join(app.vault, 'a.md'), 'depois, por fora\n');
      await expect.poll(() => editor(page).innerText(), { timeout: 5000 }).toContain('depois, por fora');
      expect(await page.locator('.banner').count()).toBe(0);
    });
  });

  it('com edição pendente mostra o conflito; "carregar do disco" descarta a minha', async () => {
    await withPage({ 'a.md': 'base\n' }, async (page, app) => {
      await openNote(page, 'a.md');
      await editor(page).click();
      // Edita e muda o disco antes do autosave (800 ms) disparar.
      await page.keyboard.type('minha ');
      await writeFile(path.join(app.vault, 'a.md'), 'versão externa\n');
      await expect.poll(() => page.locator('.banner').innerText(), { timeout: 5000 }).toContain('mudou no disco');
      expect(await disk(app, 'a.md')).toBe('versão externa\n');
      await page.getByRole('button', { name: 'Carregar do disco' }).click();
      await expect.poll(() => editor(page).innerText()).toContain('versão externa');
      expect(await page.locator('.banner').count()).toBe(0);
    });
  });

  it('com edição pendente, "manter a minha" sobrescreve o disco', async () => {
    await withPage({ 'a.md': 'base\n' }, async (page, app) => {
      await openNote(page, 'a.md');
      await editor(page).click();
      await page.keyboard.type('minha ');
      await writeFile(path.join(app.vault, 'a.md'), 'versão externa\n');
      await page.getByRole('button', { name: 'Manter a minha' }).click();
      await expect.poll(diskNow(app, 'a.md'), { timeout: 5000 }).toBe('base\nminha ');
      await expect.poll(() => page.locator('.banner').count()).toBe(0);
    });
  });

  it('arquivo criado por fora aparece na árvore', async () => {
    await withPage({}, async (page, app) => {
      await mkdir(path.join(app.vault, 'novas'));
      await writeFile(path.join(app.vault, 'novas/x.md'), 'x');
      await expect.poll(() => page.locator('.tree-item', { hasText: 'novas' }).count(), { timeout: 5000 }).toBe(1);
    });
  });
});

describe('arquivos', () => {
  it('cria nota (nome higienizado), renomeia e exclui para a lixeira', async () => {
    await withPage({}, async (page, app) => {
      await page.getByRole('button', { name: '+ Nota' }).click();
      await dialogInput(page, 'ata: reunião?');
      await expect.poll(diskNow(app, 'ata- reunião-.md'), { timeout: 5000 }).toBe('');
      await expect.poll(() => page.locator('.tab').count()).toBe(1);

      await page.locator('.tree-row', { hasText: 'ata-' }).hover();
      await page.locator('.tree-row', { hasText: 'ata-' }).getByTitle('Renomear').click();
      await dialogInput(page, 'ata.md');
      await expect.poll(diskNow(app, 'ata.md'), { timeout: 5000 }).toBe('');
      await expect.poll(() => page.locator('.tab').innerText()).toContain('ata.md');

      await page.locator('.tree-row', { hasText: 'ata.md' }).hover();
      await page.locator('.tree-row', { hasText: 'ata.md' }).getByTitle('Excluir').click();
      await page.getByRole('button', { name: 'OK' }).click();
      await expect.poll(diskNow(app, 'ata.md'), { timeout: 5000 }).toBeNull();
      await expect.poll(() => page.locator('.tab').count()).toBe(0);
      const trash = await readdir(path.join(app.vault, '.superapp/trash'));
      expect(trash.some((n) => n.endsWith('ata.md'))).toBe(true);
    });
  });

  it('cria nota dentro da pasta selecionada', async () => {
    await withPage({ 'pasta/x.md': 'x' }, async (page, app) => {
      await page.locator('.tree-item', { hasText: 'pasta' }).click();
      await page.getByRole('button', { name: '+ Nota' }).click();
      await dialogInput(page, 'dentro');
      await expect.poll(diskNow(app, 'pasta/dentro.md'), { timeout: 5000 }).toBe('');
    });
  });

  it('Ctrl+P abre arquivo pelo nome', async () => {
    await withPage({ 'projetos/roadmap.md': 'R', 'outro.md': 'O' }, async (page) => {
      await page.keyboard.press('Control+p');
      await page.locator('.quick input').fill('rdmp');
      await expect.poll(() => page.locator('.quick li.sel').innerText()).toContain('roadmap.md');
      await page.keyboard.press('Enter');
      await expect.poll(() => editor(page).innerText()).toContain('R');
      await expect.poll(() => page.locator('.tab.active').innerText()).toContain('roadmap.md');
    });
  });
});

describe('preview', () => {
  it('abre link entre notas e mostra imagem do vault', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
    await withPage({ 'notas/a.md': '[ir](b.md)\n\n![foto](../anexos/f%201.png)\n', 'notas/b.md': 'BBB\n' }, async (page, app) => {
      await mkdir(path.join(app.vault, 'anexos'));
      await writeFile(path.join(app.vault, 'anexos/f 1.png'), png);
      await openNote(page, 'a.md');
      await expect.poll(() => page.locator('.preview img').getAttribute('src')).toBe('/api/raw?path=anexos%2Ff%201.png');
      await expect.poll(() => page.locator('.preview img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1);
      await page.locator('.preview a[data-note]').click();
      await expect.poll(() => page.locator('.tab.active').innerText()).toContain('b.md');
    });
  });

  it('não executa HTML perigoso nem busca imagem externa', async () => {
    const src = '<img src=x onerror="window.__pwned=1">\n\n<script>window.__pwned=1</script>\n\n![e](https://exemplo.com/p.png)\n';
    await withPage({ 'x.md': src }, async (page) => {
      const requests: string[] = [];
      page.on('request', (r) => requests.push(r.url()));
      await openNote(page, 'x.md');
      await page.locator('.preview').waitFor();
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
      expect(requests.some((u) => u.includes('exemplo.com'))).toBe(false);
    });
  });

  it('colar imagem salva em anexos/ e insere o link relativo', async () => {
    await withPage({ 'notas/a.md': '' }, async (page, app) => {
      await openNote(page, 'a.md');
      await editor(page).click();
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'print.png', { type: 'image/png' }));
        document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      });
      await expect.poll(diskNow(app, 'notas/a.md'), { timeout: 5000 }).toBe('![](../anexos/print.png)');
      expect((await stat(path.join(app.vault, 'anexos/print.png'))).size).toBe(4);
    });
  });
});

describe('uso de memória', () => {
  it('nota de 1.000 linhas aberta usa no máximo 30 MB de heap JS', async () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `## Seção ${i}\n\nLinha de texto com **negrito**, \`código\` e [link](https://x.com) número ${i}.\n`).join('\n');
    await withPage({ 'grande.md': lines }, async (page) => {
      await openNote(page, 'grande.md');
      await expect.poll(() => page.locator('.preview h2').count()).toBeGreaterThan(900);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('HeapProfiler.collectGarbage');
      const { usedSize } = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
      console.log(`heap JS: ${(usedSize / 1048576).toFixed(1)} MB`);
      expect(usedSize).toBeLessThan(30 * 1048576);
    });
  });
});
