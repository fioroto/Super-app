export type Kind = 'md' | 'text' | 'image' | 'canvas' | 'other';

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
const TEXT = /\.(md|markdown|txt|json|ya?ml|csv|log)$/i;

export function kindOf(path: string): Kind {
  if (/\.excalidraw\.md$/i.test(path)) return 'canvas';
  if (/\.(md|markdown)$/i.test(path)) return 'md';
  if (IMAGE.test(path)) return 'image';
  if (TEXT.test(path)) return 'text';
  return 'other';
}

export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Mesmas regras do servidor (nomes do Windows valem em qualquer sistema). */
export function sanitizeSegment(name: string): string {
  let out = name.replace(/[<>:"|?*\\\x00-\x1f]/g, '-').replace(/[. ]+$/, '').trim();
  if (RESERVED.test(out.split('.')[0]!)) out = `_${out}`;
  return out;
}

export function sanitizePath(input: string): string {
  return input.split('/').map(sanitizeSegment).filter(Boolean).join('/');
}

/** Resolve `href` (relativo à nota em `from`) para um caminho do vault. Devolve null se sair da pasta. */
export function resolveRel(from: string, href: string): string | null {
  let target = href.split('#')[0]!.split('?')[0]!;
  try { target = decodeURIComponent(target); } catch { /* mantém como veio */ }
  const parts = (target.startsWith('/') ? [] : dirname(from).split('/').filter(Boolean));
  for (const seg of target.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return parts.join('/');
}

/** Caminho de `to` visto da pasta de `fromFile`, já com espaços codificados. */
export function relativeTo(fromFile: string, to: string): string {
  const a = dirname(fromFile).split('/').filter(Boolean);
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const up = a.length - i;
  return [...Array(up).fill('..'), ...b.slice(i)].map(encodeURIComponent).join('/');
}

export function flatten(node: { type: string; path: string; children?: any[] }, out: string[] = []): string[] {
  for (const c of node.children ?? []) (c.type === 'dir' ? flatten(c, out) : out.push(c.path));
  return out;
}
