// JSON vira tabela. Cada lista de objetos é um "nível"; o usuário escolhe qual vira linha.
// Num nível de baixo (fundos → classes), cada linha é um item da lista de baixo e repete os campos dos pais;
// pai sem item nenhum não gera linha. Objeto dentro de objeto vira coluna com ponto (gestor.nome).

import type { Json } from './jsonDiff.ts';

/** Um nível: as chaves até cada lista, a partir da raiz e depois a partir de cada item. null = o objeto da raiz, campo a campo. */
export interface Level { key: string; label: string; count: number; segments: string[][] | null }
export interface Table { columns: string[]; rows: string[][] }

const MAX_DEPTH = 5; // listas dentro de listas
const IDENT = /^[A-Za-z_$][\w$]*$/;

const isObject = (v: Json | undefined): v is { [key: string]: Json } => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Caminho legível: chave simples com ponto, o resto entre colchetes, para "a.b" e a → b não darem a mesma coluna. */
const join = (prefix: string, key: string) =>
  IDENT.test(key) ? (prefix ? `${prefix}.${key}` : key) : `${prefix}[${JSON.stringify(key)}]`;
const joinAll = (prefix: string, keys: string[]) => keys.reduce(join, prefix);

function label(segments: string[][]): string {
  return segments.map((s, i) => (s.length ? joinAll('', s) : i === 0 ? 'itens' : '?')).join(' → ');
}

/** Todas as listas que têm objetos, na ordem em que aparecem, com quantas linhas cada uma dá. */
export function findLevels(value: Json): Level[] {
  const seen = new Map<string, { segments: string[][]; count: number; objects: boolean }>();
  const visit = (node: Json, segments: string[][], keys: string[]) => {
    if (Array.isArray(node)) {
      if (segments.length >= MAX_DEPTH) return;
      const here = [...segments, keys];
      const key = JSON.stringify(here);
      const entry = seen.get(key) ?? { segments: here, count: 0, objects: false };
      entry.count += node.length;
      entry.objects ||= node.some(isObject);
      seen.set(key, entry);
      for (const item of node) if (isObject(item)) visit(item, here, []);
    } else if (isObject(node)) {
      for (const k of Object.keys(node)) visit(node[k]!, segments, [...keys, k]);
    }
  };
  visit(value, [], []);
  const levels: Level[] = [...seen.entries()]
    .filter(([, e]) => e.objects || e.segments.length === 1 && e.segments[0]!.length === 0) // a raiz vale mesmo só com valores simples
    .map(([key, e]) => ({ key, label: label(e.segments), count: e.count, segments: e.segments }));
  if (isObject(value)) levels.push({ key: 'object', label: 'campos do objeto', count: fieldCount(value), segments: null });
  return levels;
}

/** O nível mais raso; sem lista nenhuma, o objeto campo a campo. */
export function defaultLevel(levels: Level[]): Level | undefined {
  const lists = levels.filter((l) => l.segments);
  if (!lists.length) return levels[0];
  return lists.reduce((best, l) => (l.segments!.length < best.segments!.length ? l : best));
}

function fieldCount(obj: Json): number {
  let n = 0;
  flatten(obj, '', () => n++, null, []);
  return n;
}

function text(v: Json): string {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v !== 'object') return String(v);
  if (Array.isArray(v)) {
    // Lista de valores simples cabe numa célula; com objeto dentro, vai o JSON.
    return v.some((x) => typeof x === 'object' && x !== null) ? JSON.stringify(v) : v.map((x) => (x === null ? 'null' : String(x))).join(', ');
  }
  return JSON.stringify(v);
}

/** Objeto aninhado vira colunas com ponto. `skip` é a lista que vai ser expandida em linhas: ela não vira coluna. */
function flatten(node: Json, col: string, out: (col: string, value: string) => void, skip: string[] | null, rel: string[]): void {
  if (!isObject(node)) { out(col, text(node)); return; }
  const keys = Object.keys(node);
  if (!keys.length) { if (rel.length) out(col, '{}'); return; }
  for (const k of keys) {
    const path = [...rel, k];
    if (skip && path.length === skip.length && path.every((p, i) => p === skip[i])) continue;
    flatten(node[k]!, join(col, k), out, skip, path);
  }
}

function follow(node: Json, keys: string[]): Json | undefined {
  let cur: Json | undefined = node;
  for (const k of keys) cur = isObject(cur) && Object.prototype.hasOwnProperty.call(cur, k) ? cur[k] : undefined;
  return cur;
}

export function buildTable(value: Json, level: Level): Table {
  if (!level.segments) {
    const rows: string[][] = [];
    flatten(value, '', (c, v) => rows.push([c, v]), null, []);
    return { columns: ['Campo', 'Valor'], rows };
  }
  const segments = level.segments;
  const index = new Map<string, number>(); // coluna → posição, na ordem em que aparece
  const sparse: string[][] = [];
  const emit = (cells: [string, string][]) => {
    const row: string[] = [];
    for (const [c, v] of cells) {
      let i = index.get(c);
      if (i === undefined) { i = index.size; index.set(c, i); }
      row[i] = v;
    }
    sparse.push(row);
  };
  const walk = (node: Json, depth: number, prefix: string, carry: [string, string][]) => {
    const list = follow(node, segments[depth]!);
    if (!Array.isArray(list)) return;
    const here = depth === 0 ? '' : joinAll(prefix, segments[depth]!);
    const last = depth === segments.length - 1;
    for (const item of list) {
      if (!last && !isObject(item)) continue;
      const cells = [...carry];
      if (isObject(item)) flatten(item, here, (c, v) => cells.push([c, v]), last ? null : segments[depth + 1]!, []);
      else cells.push([join(here, 'valor'), text(item)]);
      if (last) emit(cells);
      else walk(item, depth + 1, here, cells);
    }
  };
  walk(value, 0, '', []);
  const width = index.size;
  const columns = [...index.keys()];
  const rows = sparse.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
  // "gestor": null num item e "gestor": {"nome": …} no outro: a coluna "gestor", sempre vazia, sobra.
  const drop = columns.map((c, i) => rows.every((r) => r[i] === '') && columns.some((o) => o.startsWith(`${c}.`) || o.startsWith(`${c}[`)));
  if (!drop.includes(true)) return { columns, rows };
  return { columns: columns.filter((_, i) => !drop[i]), rows: rows.map((r) => r.filter((_, i) => !drop[i])) };
}
