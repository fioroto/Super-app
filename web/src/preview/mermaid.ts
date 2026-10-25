// O Mermaid só é baixado quando a primeira nota com diagrama é aberta.
type Lib = typeof import('mermaid').default;
export type Rendered = { svg: string } | { error: string };

const CACHE_MAX = 60;
const cache = new Map<string, Rendered>();
let lib: Promise<Lib> | undefined;
let configuredFor = '';
let counter = 0;
let queue: Promise<unknown> = Promise.resolve();

export function isDark(): boolean {
  const t = document.documentElement.getAttribute('data-theme');
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

const keyOf = (code: string, dark: boolean) => `${dark ? 'd' : 'l'}\0${code}`;

export const cached = (code: string, dark = isDark()): Rendered | undefined => cache.get(keyOf(code, dark));

function remember(key: string, value: Rendered): void {
  cache.set(key, value);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

async function load(dark: boolean): Promise<Lib> {
  lib ??= import('mermaid').then((m) => m.default);
  const m = await lib;
  // O tema 'default' do Mermaid é lilás; 'neutral' combina com o visual monocromático do app.
  const want = dark ? 'dark' : 'neutral';
  if (configuredFor !== want) {
    // layout 'dagre' é obrigatório: o padrão do Mermaid 12 carrega o motor ELK (440 KB gzip) só para desenhar um fluxograma.
    m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: want, fontFamily: 'inherit', layout: 'dagre' });
    configuredFor = want;
  }
  return m;
}

/** Desenha um diagrama. Chamadas são enfileiradas: o Mermaid usa elementos temporários na página. */
export function renderDiagram(code: string, dark = isDark()): Promise<Rendered> {
  const key = keyOf(code, dark);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);

  const job = queue.then(async (): Promise<Rendered> => {
    const again = cache.get(key);
    if (again) return again;
    const id = `mmd-${++counter}`;
    let out: Rendered;
    try {
      const m = await load(dark);
      await m.parse(code);
      out = { svg: (await m.render(id, code)).svg };
    } catch (e) {
      out = { error: (e as Error).message.split('\n').slice(0, 6).join('\n') };
      // Em erro o Mermaid pode deixar o elemento temporário no <body>.
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
    remember(key, out);
    return out;
  });
  queue = job.catch(() => undefined);
  return job;
}
