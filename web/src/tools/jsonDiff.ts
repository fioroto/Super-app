// Comparação de dois JSON pelo conteúdo: a ordem das chaves de um objeto não conta.
// A ordem dos itens de um array conta, a menos que `unorderedArrays` esteja ligado.
// Limites: JSON.parse lê números como ponto flutuante (inteiros acima de 2^53 perdem dígitos)
// e, com chave repetida num objeto, vale a última.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface CompareOptions { unorderedArrays: boolean }

export type Change =
  | { kind: 'added'; path: string; after: Json }
  | { kind: 'removed'; path: string; before: Json }
  | { kind: 'changed'; path: string; before: Json; after: Json }
  | { kind: 'type'; path: string; before: Json; after: Json };

export type ParseResult = { ok: true; value: Json } | { ok: false; message: string; line?: number; column?: number };

/** Lê o JSON. Em caso de erro, diz em que linha e coluna o texto deixou de ser válido. */
export function parseJson(text: string): ParseResult {
  const t = text.replace(/^\uFEFF/, '');
  try {
    return { ok: true, value: JSON.parse(t) as Json };
  } catch (e) {
    // As mensagens do motor nem sempre trazem a posição; este leitor sempre traz.
    const at = locateError(t);
    if (!at) return { ok: false, message: (e as Error).message };
    const before = t.slice(0, at.pos);
    return { ok: false, message: at.message, line: before.split('\n').length, column: before.length - before.lastIndexOf('\n') };
  }
}

/** Percorre o texto como o JSON manda e devolve o primeiro ponto em que ele deixa de valer. */
function locateError(text: string): { pos: number; message: string } | null {
  let i = 0;
  const fail = (message: string, pos = i): never => {
    const ended = pos >= text.length && !message.startsWith('texto sem aspas');
    throw { pos, message: ended ? 'o texto terminou antes do esperado' : message };
  };
  const blank = () => { while (i < text.length && ' \t\n\r'.includes(text[i]!)) i++; };
  const string = () => {
    i++; // aspas de abertura
    while (i < text.length) {
      const c = text[i]!;
      if (c === '"') { i++; return; }
      if (c === '\\') {
        const n = text[i + 1];
        if (n === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail('\\u precisa de 4 dígitos hexadecimais');
          i += 6;
        } else if (n !== undefined && '"\\/bfnrt'.includes(n)) i += 2;
        else fail('barra invertida seguida de caractere que não existe em JSON');
        continue;
      }
      if (c < ' ') fail('quebra de linha ou caractere de controle dentro do texto');
      i++;
    }
    fail('texto sem aspas de fechamento');
  };
  const scalar = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;
  const value = (): void => {
    blank();
    const c = text[i];
    if (c === undefined) fail('o texto terminou antes do esperado');
    if (c === '{') {
      i++;
      blank();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        blank();
        if (text[i] !== '"') fail(text[i] === '}' ? 'vírgula sobrando antes de "}"' : 'esperava o nome de uma chave entre aspas duplas');
        string();
        blank();
        if (text[i] !== ':') fail('esperava ":" depois do nome da chave');
        i++;
        value();
        blank();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return; }
        fail('esperava "," ou "}"');
      }
    }
    if (c === '[') {
      i++;
      blank();
      if (text[i] === ']') { i++; return; }
      for (;;) {
        blank();
        if (text[i] === ']') fail('vírgula sobrando antes de "]"');
        value();
        blank();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return; }
        fail('esperava "," ou "]"');
      }
    }
    if (c === '"') return string();
    scalar.lastIndex = i;
    const m = scalar.exec(text);
    if (!m) fail(`caractere inesperado "${c}"`);
    i += m![0].length;
  };
  try {
    value();
    blank();
    if (i < text.length) fail('há texto depois do fim do JSON');
    return null;
  } catch (e) {
    if (typeof e === 'object' && e !== null && 'pos' in e) return e as { pos: number; message: string };
    return null; // aninhamento fundo demais para este leitor
  }
}

const typeOf = (v: Json) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const isObject = (v: Json): v is { [key: string]: Json } => typeof v === 'object' && v !== null && !Array.isArray(v);
// Monta o texto sem criar objetos: uma chave "__proto__" não pode mudar o protótipo de ninguém.
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Texto canônico (chaves em ordem alfabética), usado para comparar itens de array e para o modo lado a lado. */
export function canonical(v: Json, opts: CompareOptions, indent?: string, depth = 0): string {
  if (typeof v !== 'object' || v === null) return JSON.stringify(v);
  const pretty = indent !== undefined;
  const nl = pretty ? `\n${indent!.repeat(depth + 1)}` : '';
  const end = pretty ? `\n${indent!.repeat(depth)}` : '';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    let items = v.map((x) => canonical(x, opts, indent, depth + 1));
    if (opts.unorderedArrays) items = v.map((x, i) => [canonical(x, opts), items[i]!] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map((p) => p[1]);
    return `[${nl}${items.join(`,${nl}`)}${end}]`;
  }
  const keys = Object.keys(v).sort();
  if (!keys.length) return '{}';
  const sep = pretty ? ': ' : ':';
  return `{${nl}${keys.map((k) => `${JSON.stringify(k)}${sep}${canonical(v[k]!, opts, indent, depth + 1)}`).join(`,${nl}`)}${end}}`;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;
const step = (path: string, key: string) => (IDENT.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`);

export function compareJson(a: Json, b: Json, opts: CompareOptions): Change[] {
  const out: Change[] = [];
  walk(a, b, '$', opts, out);
  return out;
}

function walk(a: Json, b: Json, path: string, opts: CompareOptions, out: Change[]): void {
  if (typeOf(a) !== typeOf(b)) { out.push({ kind: 'type', path, before: a, after: b }); return; }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (opts.unorderedArrays) return unordered(a, b, path, opts, out);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= b.length) out.push({ kind: 'removed', path: `${path}[${i}]`, before: a[i]! });
      else if (i >= a.length) out.push({ kind: 'added', path: `${path}[${i}]`, after: b[i]! });
      else walk(a[i]!, b[i]!, `${path}[${i}]`, opts, out);
    }
    return;
  }
  if (isObject(a) && isObject(b)) {
    for (const k of Object.keys(a)) {
      if (!own(b, k)) out.push({ kind: 'removed', path: step(path, k), before: a[k]! });
      else walk(a[k]!, b[k]!, step(path, k), opts, out);
    }
    for (const k of Object.keys(b)) if (!own(a, k)) out.push({ kind: 'added', path: step(path, k), after: b[k]! });
    return;
  }
  if (a !== b) out.push({ kind: 'changed', path, before: a, after: b });
}

/** Itens iguais se anulam, na quantidade em que aparecem; o que sobra de cada lado é diferença. */
function unordered(a: Json[], b: Json[], path: string, opts: CompareOptions, out: Change[]): void {
  const pool = new Map<string, number[]>();
  b.forEach((x, i) => {
    const k = canonical(x, opts);
    pool.set(k, [...(pool.get(k) ?? []), i]);
  });
  const matched = new Set<number>();
  a.forEach((x, i) => {
    const hit = pool.get(canonical(x, opts))?.shift();
    if (hit === undefined) out.push({ kind: 'removed', path: `${path}[${i}]`, before: x });
    else matched.add(hit);
  });
  b.forEach((x, i) => { if (!matched.has(i)) out.push({ kind: 'added', path: `${path}[${i}]`, after: x }); });
}

export const KIND_LABEL: Record<Change['kind'], string> = {
  added: 'só no B',
  removed: 'só no A',
  changed: 'valor diferente',
  type: 'tipo diferente',
};

/** Valor numa linha só, cortado se for longo. */
export function show(v: Json, max = 80): string {
  const s = JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const beforeOf = (c: Change) => (c.kind === 'added' ? undefined : c.before);
const afterOf = (c: Change) => (c.kind === 'removed' ? undefined : c.after);

function code(s: string): string {
  const safe = s.replace(/\|/g, '\\|');
  return s.includes('`') ? `\`\` ${safe} \`\`` : `\`${safe}\``;
}

/** O resultado como tabela Markdown, para colar numa nota. */
export function changesToMarkdown(changes: Change[]): string {
  if (!changes.length) return 'Os dois JSON têm o mesmo conteúdo.';
  const rows = changes.map((c) => {
    const before = beforeOf(c), after = afterOf(c);
    return `| ${code(c.path)} | ${KIND_LABEL[c.kind]} | ${before === undefined ? '' : code(show(before))} | ${after === undefined ? '' : code(show(after))} |`;
  });
  return ['| Caminho | Diferença | A | B |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

export function summary(changes: Change[]): string {
  if (!changes.length) return 'Iguais.';
  const n = (k: Change['kind']) => changes.filter((c) => c.kind === k).length;
  const parts = [[n('changed'), 'com valor diferente'], [n('type'), 'com tipo diferente'], [n('removed'), 'só no A'], [n('added'), 'só no B']] as const;
  return parts.filter(([count]) => count).map(([count, label]) => `${count} ${label}`).join(' · ');
}
