import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startApp, type App } from './helpers.ts';

const MIN = 60_000, DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 10, 12, 0, 0);

let app: App;
let clock = T0;
afterEach(() => app?.close());

async function setup(files: Record<string, string> = {}) {
  clock = T0;
  app = await startApp(files, { now: () => clock });
}
const put = async (rel: string, content: string) => {
  const cur = await (await app.fetch(`/api/file?path=${encodeURIComponent(rel)}`)).json();
  const r = await app.fetch('/api/file', { method: 'PUT', body: JSON.stringify({ path: rel, content, hash: cur.hash ?? null }) });
  expect(r.status).toBe(200);
};
const versions = async (rel: string) => ((await (await app.fetch(`/api/history?path=${encodeURIComponent(rel)}`)).json()) as { versions: { id: string; time: number }[] }).versions;
const version = async (rel: string, id: string) => (await (await app.fetch(`/api/history/version?path=${encodeURIComponent(rel)}&id=${id}`)).json()).content as string;
const at = (offset: number) => { clock = T0 + offset; };

describe('histórico de versões', () => {
  it('guarda o estado anterior ao sobrescrever, no máximo uma vez a cada 5 minutos', async () => {
    await setup({ 'a.md': 'v1' });
    await put('a.md', 'v2');                 // guarda v1 (o arquivo já existia)
    expect((await versions('a.md')).length).toBe(1);
    at(1 * MIN); await put('a.md', 'v3');    // dentro dos 5 min: não guarda v2
    expect((await versions('a.md')).length).toBe(1);
    at(6 * MIN); await put('a.md', 'v4');    // guarda v3
    const list = await versions('a.md');
    expect(list.length).toBe(2);
    expect(await version('a.md', list[0]!.id)).toBe('v3');
    expect(await version('a.md', list[1]!.id)).toBe('v1');
    expect(await readFile(path.join(app.vault, 'a.md'), 'utf8')).toBe('v4');
  });

  it('as cópias ficam em .superapp/history e abrem em qualquer editor', async () => {
    await setup({ 'notas/a.md': 'antes' });
    await put('notas/a.md', 'depois');
    const dir = path.join(app.vault, '.superapp/history/notas/a.md');
    const [name] = await readdir(dir);
    expect(name).toMatch(/^2026-01-10T12-00-00-000Z\.md$/);
    expect(await readFile(path.join(dir, name!), 'utf8')).toBe('antes');
  });

  it('não guarda versão repetida nem arquivo que não é texto', async () => {
    await setup({ 'a.md': 'igual', 'x.svg': '<svg/>' });
    await put('a.md', 'novo'); at(10 * MIN); await put('a.md', 'igual'); at(20 * MIN); await put('a.md', 'novo');
    const list = await versions('a.md');
    expect(list.length).toBe(3);
    await put('x.svg', '<svg id="2"/>');
    expect((await versions('x.svg')).length).toBe(0);
  });

  it('excluir guarda a versão mesmo dentro dos 5 minutos', async () => {
    await setup({ 'a.md': 'v1' });
    await put('a.md', 'v2');
    at(1 * MIN); await put('a.md', 'v3');
    await app.fetch('/api/file?path=a.md', { method: 'DELETE' });
    const list = await versions('a.md');
    expect(list.length).toBe(2);
    expect(await version('a.md', list[0]!.id)).toBe('v3');
  });

  it('renomear leva o histórico junto', async () => {
    await setup({ 'a.md': 'v1' });
    await put('a.md', 'v2');
    await app.fetch('/api/rename', { method: 'POST', body: JSON.stringify({ from: 'a.md', to: 'b.md' }) });
    expect((await versions('a.md')).length).toBe(0);
    expect((await versions('b.md')).length).toBe(1);
  });

  it('restaurar volta o conteúdo e guarda o estado atual como nova versão', async () => {
    await setup({ 'a.md': 'v1' });
    await put('a.md', 'v2');
    const [first] = await versions('a.md');
    at(1 * MIN);
    const r = await app.fetch('/api/history/restore', { method: 'POST', body: JSON.stringify({ path: 'a.md', id: first!.id }) });
    expect(r.status).toBe(200);
    expect(await readFile(path.join(app.vault, 'a.md'), 'utf8')).toBe('v1');
    const list = await versions('a.md');
    expect(list.length).toBe(2);
    expect(await version('a.md', list[0]!.id)).toBe('v2');
  });

  it('retenção: tudo por 7 dias, uma por dia até 90 dias, nada além disso', async () => {
    await setup({ 'a.md': 'inicio' });
    // Dia 0: quatro estados guardados (um a cada 6 minutos) e depois um por dia nos dias 1 a 4.
    for (let i = 0; i < 5; i++) { at(i * 6 * MIN); await put('a.md', `dia0-${i}`); }
    for (let d = 1; d <= 4; d++) { at(d * DAY); await put('a.md', `dia${d}`); }
    expect((await versions('a.md')).length).toBe(9);

    // Dia 20: o que tem mais de 7 dias fica com uma versão por dia.
    at(20 * DAY); await put('a.md', 'dia20');
    let list = await versions('a.md');
    const day0 = list.filter((v) => v.time < T0 + DAY);
    expect(day0.length).toBe(1);
    expect(await version('a.md', day0[0]!.id)).toBe('dia0-3'); // a mais nova do dia 0
    expect(list.length).toBe(1 + 4 + 1); // dia 0, dias 1–4 (estado anterior), e o do dia 20

    // Dia 100: o que passou de 90 dias some; sobram a versão do dia 20 (80 dias) e a nova.
    at(100 * DAY); await put('a.md', 'dia100');
    list = await versions('a.md');
    expect(list.every((v) => 100 * DAY + T0 - v.time <= 90 * DAY)).toBe(true);
    expect(await Promise.all(list.map((v) => version('a.md', v.id)))).toEqual(['dia20', 'dia4']);
  });

  it('recusa caminho fora do vault e versão inventada', async () => {
    await setup({ 'a.md': 'x' });
    expect((await app.fetch('/api/history?path=../../etc')).status).toBe(400);
    expect((await app.fetch('/api/history/version?path=a.md&id=../../a')).status).toBe(404);
    expect((await app.fetch('/api/history/version?path=a.md&id=2026-01-01T00-00-00-000Z')).status).toBe(404);
  });
});
