// Comparação feita para texto: primeiro por bloco (parágrafo, título, item, linha de tabela),
// depois, dentro do bloco que mudou, por palavra. Quebrar o parágrafo em outras linhas não conta.

import { diffLines, diffSteps, type Step } from './diff.ts';

export type Mode = 'md' | 'txt';
export type BlockKind = 'para' | 'heading' | 'item' | 'quote' | 'code' | 'row' | 'rule' | 'front';

export interface Block {
  kind: BlockKind;
  text: string;
  /** Posição no texto de origem: [from, to), sem a quebra de linha final. */
  from: number;
  to: number;
  /** Texto com espaços e quebras reduzidos: dois blocos com a mesma chave são iguais. */
  key: string;
}

/** Um pedaço do bloco já comparado. `markup` nunca recebe destaque (quebraria o Markdown). */
export interface Seg { text: string; changed: boolean; markup: boolean }

export interface Change {
  id: number;
  kind: 'changed' | 'added' | 'removed' | 'moved';
  left: Block | null;
  right: Block | null;
  leftSegs?: Seg[];
  rightSegs?: Seg[];
  /** Mudou a marcação (negrito, nível do título, tipo do bloco). */
  format?: boolean;
  /** Onde o bloco da esquerda entraria no texto da direita: depois desta posição; null = no começo. */
  anchor: number | null;
}

export type Row =
  | { kind: 'same'; left: Block; right: Block }
  | { kind: 'change'; change: Change; side: 'both' | 'left' | 'right' }
  | { kind: 'skip'; rows: Row[] };

export interface Stats { added: number; removed: number; changed: number; moved: number }
export interface ProseDiff { rows: Row[]; changes: Change[]; stats: Stats }

/** Parecença mínima (Dice sobre as palavras) para um bloco removido e um adicionado virarem "mudado". */
export const PAIR_MIN = 0.4;
const MOVE_MIN = 0.9;
const CONTEXT = 1;

// ---------- blocos ----------

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}#{1,6}(\s|$)/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^\s*([-*+]|\d{1,9}[.)])(\s|$)/;
const QUOTE = /^\s{0,3}>/;
const ROW = /^\s*\|/;
const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const BLANK = /^\s*$/;

const startsBlock = (l: string) => FENCE.test(l) || HEADING.test(l) || RULE.test(l) || ITEM.test(l) || QUOTE.test(l) || ROW.test(l);
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

export function splitBlocks(src: string, mode: Mode): Block[] {
  const lines: { text: string; from: number }[] = [];
  for (let pos = 0; ;) {
    const nl = src.indexOf('\n', pos);
    lines.push({ text: src.slice(pos, nl < 0 ? src.length : nl).replace(/\r$/, ''), from: pos });
    if (nl < 0) break;
    pos = nl + 1;
  }
  const out: Block[] = [];
  const push = (kind: BlockKind, first: number, last: number) => {
    const from = lines[first]!.from;
    const to = lines[last]!.from + lines[last]!.text.length;
    const text = src.slice(from, to);
    const indent = kind === 'item' ? (/^\s*/.exec(text)![0].length ? `${/^\s*/.exec(text)![0].length}|` : '') : '';
    out.push({ kind, text, from, to, key: indent + collapse(text) });
  };

  let i = 0;
  if (mode === 'md' && /^---\s*$/.test(lines[0]?.text ?? '')) {
    const end = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l.text));
    if (end > 0) { push('front', 0, end); i = end + 1; }
  }
  while (i < lines.length) {
    const l = lines[i]!.text;
    if (BLANK.test(l)) { i++; continue; }
    const first = i;
    if (mode === 'txt') {
      while (i + 1 < lines.length && !BLANK.test(lines[i + 1]!.text)) i++;
      push('para', first, i);
    } else if (FENCE.test(l)) {
      const fence = FENCE.exec(l)![1]!;
      let end = i + 1;
      while (end < lines.length && !new RegExp(`^\\s{0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`).test(lines[end]!.text)) end++;
      i = Math.min(end, lines.length - 1);
      push('code', first, i);
    } else if (HEADING.test(l)) {
      push('heading', i, i);
    } else if (RULE.test(l)) {
      push('rule', i, i);
    } else if (ROW.test(l)) {
      if (i + 1 < lines.length && DELIM.test(lines[i + 1]!.text)) i++; // cabeçalho e separador andam juntos
      push('row', first, i);
    } else if (QUOTE.test(l)) {
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1]!.text)) i++;
      push('quote', first, i);
    } else if (ITEM.test(l)) {
      while (i + 1 < lines.length && !BLANK.test(lines[i + 1]!.text) && !startsBlock(lines[i + 1]!.text)) i++;
      push('item', first, i);
    } else {
      while (i + 1 < lines.length && !BLANK.test(lines[i + 1]!.text) && !startsBlock(lines[i + 1]!.text)) i++;
      push('para', first, i);
    }
    i++;
  }
  return out;
}

// ---------- palavras ----------

interface Tok { text: string; markup: boolean; space: boolean; word: boolean }

// Ordem importa: código em linha e destino de link inteiros; marcação; número com vírgula e %; palavra; espaço.
const TOKEN = /`+[^`\n]*?`+|\]\([^)\n]*\)|!?\[|\]|<\/?[A-Za-z][^>\n]*>|\\[\s\S]|\*\*|__|~~|\*|\||[-+]?\d+(?:[.,]\d+)*%?|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*|\s+|[\s\S]/gu;
const MARKUP = /^(?:\]\(|!?\[$|\]$|<|\*|__|~~|\|)/;
const WORD = /[\p{L}\p{N}]/u;
const PREFIX: Partial<Record<BlockKind, RegExp>> = {
  heading: /^\s{0,3}#{1,6}[ \t]*/,
  item: /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/,
};

function tokenize(block: Block, mode: Mode): Tok[] {
  const out: Tok[] = [];
  if (mode === 'txt') {
    // Texto puro: não há marcação, tudo pode ser destacado.
    for (const m of block.text.matchAll(TOKEN)) {
      const t = m[0], space = /^\s+$/.test(t);
      out.push({ text: t, markup: false, space, word: !space && WORD.test(t) });
    }
    return out;
  }
  let text = block.text;
  const prefix = PREFIX[block.kind]?.exec(text)?.[0];
  if (prefix) { out.push({ text: prefix, markup: true, space: false, word: false }); text = text.slice(prefix.length); }
  if (block.kind === 'row') {
    // A linha separadora da tabela (|---|:--:|) é toda marcação.
    const nl = text.indexOf('\n');
    if (nl >= 0) {
      tokenizeInline(text.slice(0, nl), out);
      out.push({ text: text.slice(nl), markup: true, space: false, word: false });
      return out;
    }
  }
  tokenizeInline(text, out);
  return out;
}

function tokenizeInline(text: string, out: Tok[]): void {
  for (const m of text.matchAll(TOKEN)) {
    const t = m[0];
    const space = /^\s+$/.test(t);
    // ">" no começo de linha da citação também é marcação.
    const quote = t === '>' && (m.index === 0 || text[m.index - 1] === '\n' || /\n\s*$/.test(text.slice(0, m.index)));
    out.push({ text: t, markup: MARKUP.test(t) || quote, space, word: !space && WORD.test(t) && !t.startsWith('`') });
  }
}

const tokEq = (a: Tok, b: Tok) => a.text === b.text || (a.space && b.space);

/** Compara dois blocos palavra a palavra e devolve os pedaços de cada lado, já limpos. */
export function diffWords(a: Block, b: Block, mode: Mode = 'md'): { left: Seg[]; right: Seg[]; format: boolean } {
  const A = tokenize(a, mode), B = tokenize(b, mode);
  const steps = cleanup(diffSteps(A.length, B.length, (i, j) => tokEq(A[i]!, B[j]!)), A, B);
  const left: Seg[] = [], right: Seg[] = [];
  for (const s of steps) {
    if (s.t !== '+') left.push({ text: A[s.i]!.text, changed: s.t === '-', markup: A[s.i]!.markup });
    if (s.t !== '-') right.push({ text: B[s.j]!.text, changed: s.t === '+', markup: B[s.j]!.markup });
  }
  const marks = (toks: Tok[]) => toks.filter((t) => t.markup).map((t) => t.text.trim()).join(' ');
  return { left, right, format: marks(A) !== marks(B) };
}

/**
 * Um trecho igual entre duas mudanças, se for só espaço ou uma palavra curta, entra na mudança:
 * lê-se "continua em 0,5%" → "caiu para 0,4%" em vez de palavra sim, palavra não.
 */
function cleanup(steps: Step[], A: Tok[], B: Tok[]): Step[] {
  // Uma mudança "de texto" tem pelo menos uma palavra ou sinal que não é marcação.
  const textual = (s: Step) => (s.t === '-' ? !A[s.i]!.markup && !A[s.i]!.space : s.t === '+' ? !B[s.j]!.markup && !B[s.j]!.space : false);
  const regionHasText = (from: number, dir: 1 | -1) => {
    for (let k = from; k >= 0 && k < steps.length && steps[k]!.t !== '='; k += dir) if (textual(steps[k]!)) return true;
    return false;
  };
  const out: Step[] = [];
  let k = 0;
  while (k < steps.length) {
    if (steps[k]!.t !== '=') { out.push(steps[k++]!); continue; }
    let end = k;
    while (end < steps.length && steps[end]!.t === '=') end++;
    const run = steps.slice(k, end) as { t: '='; i: number; j: number }[];
    const between = k > 0 && end < steps.length && regionHasText(k - 1, -1) && regionHasText(end, 1);
    const words = run.filter((s) => !A[s.i]!.space);
    const small = words.length === 0 || (words.length === 1 && A[words[0]!.i]!.text.length <= 3 && !A[words[0]!.i]!.markup);
    if (between && small) {
      // Vira apagado + inserido: os dois lados ganham o trecho dentro do destaque.
      for (const s of run) out.push({ t: '-', i: s.i });
      for (const s of run) out.push({ t: '+', j: s.j });
    } else out.push(...run);
    k = end;
  }
  return out;
}

// ---------- alinhamento ----------

const wordsOf = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Dice sobre o multiconjunto de palavras: 1 = mesmas palavras, 0 = nenhuma em comum. */
function similarity(a: Block, b: Block): number {
  const wa = wordsOf(a.text), wb = wordsOf(b.text);
  if (!wa.length && !wb.length) return a.key === b.key ? 1 : 0;
  const count = new Map<string, number>();
  for (const w of wa) count.set(w, (count.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of wb) {
    const n = count.get(w) ?? 0;
    if (n > 0) { common++; count.set(w, n - 1); }
  }
  return (2 * common) / (wa.length + wb.length);
}

type Item = { t: 'same'; i: number; j: number } | { t: 'pair'; i: number; j: number } | { t: 'del'; i: number } | { t: 'add'; j: number };

/**
 * Dentro de um trecho de removidos e adicionados, casa cada removido com o adicionado mais parecido, em ordem.
 * Entre dois pares, se sobram tantos removidos quanto adicionados do mesmo tipo, eles casam pela posição:
 * é o caso de quem reescreveu o parágrafo (ou trocou "pera" por "pêra") no mesmo lugar.
 */
function pairRegion(dels: number[], adds: number[], A: Block[], B: Block[]): Item[] {
  const pairs: [number, number][] = [];
  let from = 0;
  for (const i of dels) {
    let best = -1, score = PAIR_MIN;
    for (let k = from; k < adds.length; k++) {
      if (A[i]!.kind === 'code' !== (B[adds[k]!]!.kind === 'code')) continue;
      const s = similarity(A[i]!, B[adds[k]!]!);
      if (s >= score) { best = k; score = s; if (s === 1) break; }
    }
    if (best >= 0) { pairs.push([i, adds[best]!]); from = best + 1; }
  }
  const out: Item[] = [];
  let di = 0, ai = 0;
  const gap = (untilI: number, untilJ: number) => {
    const ds: number[] = [], as: number[] = [];
    while (di < dels.length && dels[di]! !== untilI) ds.push(dels[di++]!);
    while (ai < adds.length && adds[ai]! !== untilJ) as.push(adds[ai++]!);
    const sameShape = ds.length === as.length && ds.every((i, k) => A[i]!.kind === B[as[k]!]!.kind);
    if (sameShape) ds.forEach((i, k) => out.push({ t: 'pair', i, j: as[k]! }));
    else { for (const i of ds) out.push({ t: 'del', i }); for (const j of as) out.push({ t: 'add', j }); }
  };
  for (const [i, j] of pairs) {
    gap(i, j);
    out.push({ t: 'pair', i, j });
    di++; ai++;
  }
  gap(-1, -1);
  return out;
}

export function proseDiff(a: string, b: string, mode: Mode): ProseDiff {
  const A = splitBlocks(a, mode), B = splitBlocks(b, mode);
  const steps = diffSteps(A.length, B.length, (i, j) => A[i]!.key === B[j]!.key);

  // Bloco que saiu de um lugar e apareceu igual em outro é movido: fica fora do pareamento.
  const reservedA = new Set<number>(), reservedB = new Set<number>();
  const addedByKey = new Map<string, number[]>();
  for (const s of steps) if (s.t === '+') addedByKey.set(B[s.j]!.key, [...(addedByKey.get(B[s.j]!.key) ?? []), s.j]);
  for (const s of steps) {
    if (s.t !== '-') continue;
    const j = addedByKey.get(A[s.i]!.key)?.shift();
    if (j !== undefined) { reservedA.add(s.i); reservedB.add(j); }
  }

  const items: Item[] = [];
  for (let k = 0; k < steps.length;) {
    const s = steps[k]!;
    if (s.t === '=') { items.push({ t: 'same', i: s.i, j: s.j }); k++; continue; }
    const dels: number[] = [], adds: number[] = [];
    while (k < steps.length && steps[k]!.t !== '=') {
      const r = steps[k++]!;
      if (r.t === '-') {
        if (reservedA.has(r.i)) items.push({ t: 'del', i: r.i }); else dels.push(r.i);
      } else if (r.t === '+') {
        if (reservedB.has(r.j)) items.push({ t: 'add', j: r.j }); else adds.push(r.j);
      }
    }
    items.push(...pairRegion(dels, adds, A, B));
  }

  // Movidos: um bloco que saiu de um lugar e apareceu (igual ou quase) em outro.
  const moveTo = new Map<number, number>(); // item removido → item adicionado
  const moveFrom = new Map<number, number>(); // item adicionado → item removido
  items.forEach((it, n) => {
    if (it.t !== 'del') return;
    const old = A[it.i]!;
    const m = items.findIndex((x, k) => {
      if (x.t !== 'add' || moveFrom.has(k)) return false;
      const now = B[x.j]!;
      return old.key === now.key || (old.key.length > 40 && now.key.length > 40 && similarity(old, now) >= MOVE_MIN);
    });
    if (m >= 0) { moveTo.set(n, m); moveFrom.set(m, n); }
  });

  // Primeira passada: uma mudança por item (o movido é uma só, nas duas posições), na ordem em que aparece.
  const changes: Change[] = [];
  const changeOf = new Map<number, Change>();
  const make = (kind: Change['kind'], left: Block | null, right: Block | null): Change => {
    const c: Change = { id: changes.length, kind, left, right, anchor: null };
    if (left && right && left.key !== right.key) {
      if (left.kind === 'code' || left.kind === 'front') {
        const lines = diffLines(left.text.split('\n'), right.text.split('\n'));
        c.leftSegs = lines.filter((o) => o.t !== '+').map((o) => ({ text: `${o.line}\n`, changed: o.t === '-', markup: false }));
        c.rightSegs = lines.filter((o) => o.t !== '-').map((o) => ({ text: `${o.line}\n`, changed: o.t === '+', markup: false }));
      } else {
        const w = diffWords(left, right, mode);
        c.leftSegs = w.left;
        c.rightSegs = w.right;
        c.format = w.format;
      }
    }
    changes.push(c);
    return c;
  };
  items.forEach((it, n) => {
    if (it.t === 'same' || changeOf.has(n)) return;
    if (it.t === 'pair') { changeOf.set(n, make('changed', A[it.i]!, B[it.j]!)); return; }
    const other = it.t === 'del' ? moveTo.get(n) : moveFrom.get(n);
    if (other === undefined) {
      changeOf.set(n, it.t === 'del' ? make('removed', A[it.i]!, null) : make('added', null, B[it.j]!));
      return;
    }
    const del = (it.t === 'del' ? it : items[other]) as { i: number };
    const add = (it.t === 'add' ? it : items[other]) as { j: number };
    const c = make('moved', A[del.i]!, B[add.j]!);
    changeOf.set(n, c);
    changeOf.set(other, c);
  });

  // Segunda passada: as linhas, e onde cada bloco removido voltaria no texto da direita.
  const rows: Row[] = [];
  let anchor: number | null = null;
  items.forEach((it, n) => {
    if (it.t === 'same') {
      rows.push({ kind: 'same', left: A[it.i]!, right: B[it.j]! });
      anchor = B[it.j]!.to;
      return;
    }
    const change = changeOf.get(n)!;
    if (it.t === 'del') {
      change.anchor = anchor;
      rows.push({ kind: 'change', change, side: 'left' });
    } else {
      rows.push({ kind: 'change', change, side: it.t === 'pair' ? 'both' : 'right' });
      anchor = B[it.j]!.to;
    }
  });

  const segWords = (segs: Seg[] | undefined) => (segs ?? []).filter((x) => x.changed && !x.markup).reduce((k, x) => k + wordsOf(x.text).length, 0);
  const stats: Stats = { added: 0, removed: 0, changed: 0, moved: 0 };
  for (const c of changes) {
    if (c.kind === 'added') stats.added += wordsOf(c.right!.text).length;
    else if (c.kind === 'removed') stats.removed += wordsOf(c.left!.text).length;
    else {
      if (c.kind === 'changed') stats.changed++; else stats.moved++;
      stats.removed += segWords(c.leftSegs);
      stats.added += segWords(c.rightSegs);
    }
  }
  return { rows: collapseSame(rows), changes, stats };
}

/** Trechos iguais longos viram uma linha "… N blocos iguais …", com um bloco de contexto de cada lado. */
function collapseSame(rows: Row[]): Row[] {
  const out: Row[] = [];
  for (let k = 0; k < rows.length;) {
    if (rows[k]!.kind !== 'same') { out.push(rows[k++]!); continue; }
    let end = k;
    while (end < rows.length && rows[end]!.kind === 'same') end++;
    const before = k > 0 ? CONTEXT : 0, after = end < rows.length ? CONTEXT : 0;
    if (end - k > before + after + 1) {
      out.push(...rows.slice(k, k + before));
      out.push({ kind: 'skip', rows: rows.slice(k + before, end - after) });
      out.push(...rows.slice(end - after, end));
    } else out.push(...rows.slice(k, end));
    k = end;
  }
  return out;
}

// ---------- destaque ----------

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * O Markdown do bloco com <mark> em volta do que mudou. A marcação fica sempre fora do destaque:
 * a sequência fecha antes de um "**" ou "](url)" e reabre depois. Espaço nas pontas fica fora.
 */
export function markSegs(segs: Seg[], cls: 'd' | 'a', escape = false): string {
  let out = '';
  let run = '';
  const flush = () => {
    if (!run) return;
    const lead = /^\s*/.exec(run)![0], trail = /\s*$/.exec(run.slice(lead.length))![0];
    const core = run.slice(lead.length, run.length - trail.length);
    out += core ? `${lead}<mark class="${cls}">${core}</mark>${trail}` : run;
    run = '';
  };
  for (const s of segs) {
    const text = escape ? escapeHtml(s.text) : s.text;
    if (s.changed && !s.markup) run += text;
    else { flush(); out += text; }
  }
  flush();
  return out;
}

/** O que mostrar numa célula: Markdown para renderizar, ou HTML pronto (código e texto puro). */
export type Cell = { md: string } | { html: string };

export function cellOf(block: Block, segs: Seg[] | undefined, cls: 'd' | 'a', mode: Mode): Cell {
  if (block.kind === 'code' || block.kind === 'front') {
    const body = segs ? segs.map((s) => (s.changed ? `<mark class="${cls}">${escapeHtml(s.text.replace(/\n$/, ''))}</mark>\n` : escapeHtml(s.text))).join('') : escapeHtml(block.text);
    return { html: `<pre class="pdiff-code">${body.replace(/\n$/, '')}</pre>` };
  }
  if (mode === 'txt') return { html: `<p class="pdiff-txt">${segs ? markSegs(segs, cls, true) : escapeHtml(block.text)}</p>` };
  return { md: segs ? markSegs(segs, cls) : block.text };
}
