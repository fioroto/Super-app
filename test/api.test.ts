import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type App } from './helpers.ts';

let app: App;
beforeAll(async () => {
  app = await startApp({ 'notas/a.md': '# oi\n' });
});
afterAll(() => app.close());

const put = (p: string, content: string, hash: string | null) =>
  app.fetch('/api/file', { method: 'PUT', body: JSON.stringify({ path: p, content, hash }) });

describe('segurança', () => {
  it('recusa requisição sem cookie', async () => {
    const r = await fetch(`${app.base}/api/tree`);
    expect(r.status).toBe(401);
  });

  it('recusa Host de fora (DNS rebinding)', async () => {
    // O fetch do Node ignora o cabeçalho Host; http.request deixa trocá-lo.
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port: app.run.port, path: '/api/tree', headers: { host: 'evil.example.com', cookie: `sa=${app.run.token}` } },
        (res) => { res.resume(); resolve(res.statusCode!); },
      );
      req.on('error', reject).end();
    });
    expect(status).toBe(403);
  });

  it('recusa Origin de outro site', async () => {
    const r = await app.fetch('/api/file', { method: 'PUT', headers: { origin: 'http://evil.example.com' }, body: '{}' });
    expect(r.status).toBe(403);
  });

  it('troca o token da URL por cookie e limpa a URL', async () => {
    const r = await fetch(`${app.base}/?t=${app.run.token}`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('set-cookie')).toMatch(/sa=.*HttpOnly.*SameSite=Strict/);
    const bad = await fetch(`${app.base}/?t=errado`, { redirect: 'manual' });
    expect(bad.status).toBe(401);
  });

  it.each([
    '../fora.md', 'notas/../../fora.md', '/etc/passwd', 'C:/Windows/x.md', '.superapp/x.md', '.git/config', 'notas/CON.md', 'a<b>.md',
  ])('bloqueia o caminho %s', async (p) => {
    const r = await app.fetch(`/api/file?path=${encodeURIComponent(p)}`);
    expect(r.status).toBe(400);
    expect((await put(p, 'x', null)).status).toBe(400);
  });

  it('bloqueia symlink que sai do vault', async () => {
    await symlink('/etc', path.join(app.vault, 'saida'));
    const r = await app.fetch(`/api/file?path=${encodeURIComponent('saida/passwd')}`);
    expect(r.status).toBe(400);
    const tree = await (await app.fetch('/api/tree')).json();
    expect(JSON.stringify(tree)).not.toContain('saida');
  });
});

describe('arquivos', () => {
  it('lê, grava e detecta conflito (409)', async () => {
    const f = await (await app.fetch('/api/file?path=notas/a.md')).json();
    expect(f.content).toBe('# oi\n');

    const ok = await put('notas/a.md', '# novo\n', f.hash);
    expect(ok.status).toBe(200);
    expect(await readFile(path.join(app.vault, 'notas/a.md'), 'utf8')).toBe('# novo\n');

    // Outra ferramenta muda o arquivo; o hash antigo não vale mais.
    await writeFile(path.join(app.vault, 'notas/a.md'), '# por fora\n');
    const stale = await put('notas/a.md', '# meu\n', (await ok.json()).hash);
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('conflict');
    expect(await readFile(path.join(app.vault, 'notas/a.md'), 'utf8')).toBe('# por fora\n');
  });

  it('cria arquivo novo só se ele não existir', async () => {
    expect((await put('novo/b.md', 'b', null)).status).toBe(200);
    expect((await put('novo/b.md', 'b2', null)).status).toBe(409);
  });

  it('não deixa arquivos temporários para trás', async () => {
    await put('notas/c.md', 'c', null);
    const names = await readdir(path.join(app.vault, 'notas'));
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('excluir move para a lixeira', async () => {
    await put('lixo.md', 'x', null);
    const r = await app.fetch('/api/file?path=lixo.md', { method: 'DELETE' });
    expect(r.status).toBe(200);
    const { trash } = await r.json();
    expect(await readFile(path.join(app.vault, trash), 'utf8')).toBe('x');
    expect((await app.fetch('/api/file?path=lixo.md')).status).toBe(404);
  });

  it('renomeia sem sobrescrever', async () => {
    await put('r1.md', '1', null);
    await put('r2.md', '2', null);
    const post = (from: string, to: string) => app.fetch('/api/rename', { method: 'POST', body: JSON.stringify({ from, to }) });
    expect((await post('r1.md', 'r2.md')).status).toBe(409);
    expect((await post('r1.md', 'sub/r3.md')).status).toBe(200);
    expect(await readFile(path.join(app.vault, 'sub/r3.md'), 'utf8')).toBe('1');
  });

  it('salva anexo em anexos/ sem colidir', async () => {
    const send = () => app.fetch('/api/attachment', { method: 'POST', headers: { 'x-filename': 'foto.png' }, body: Buffer.from([1, 2, 3]) });
    const a = await (await send()).json();
    const b = await (await send()).json();
    expect(a.path).toBe('anexos/foto.png');
    expect(b.path).toBe('anexos/foto-1.png');
  });
});

describe('escolha da pasta', () => {
  it('sem pasta aberta a API de arquivos responde no-vault', async () => {
    const empty = await startApp({}, { vault: false });
    try {
      const r = await empty.fetch('/api/tree');
      expect(r.status).toBe(409);
      expect((await r.json()).code).toBe('no-vault');
      const open = await empty.fetch('/api/vault', { method: 'POST', body: JSON.stringify({ path: app.vault }) });
      expect(open.status).toBe(200);
      expect((await empty.fetch('/api/tree')).status).toBe(200);
      const state = await (await empty.fetch('/api/state')).json();
      expect(state.recents[0]).toContain('vault');
    } finally {
      await empty.close();
    }
  });
});
