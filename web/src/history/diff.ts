export type Op = { t: '=' | '+' | '-'; line: string };
/** Um passo da diferença por posição: '=' tem as duas posições, '-' só a de A, '+' só a de B. */
export type Step = { t: '='; i: number; j: number } | { t: '-'; i: number } | { t: '+'; j: number };

const MAX_EDITS = 1500;

/** Diferença linha a linha (algoritmo de Myers), depois de tirar o começo e o fim iguais. */
export function diffLines(a: string[], b: string[]): Op[] {
  return diffSteps(a.length, b.length, (i, j) => a[i] === b[j]).map((s): Op => (s.t === '+' ? { t: '+', line: b[s.j]! } : { t: s.t, line: a[s.i]! }));
}

/** Myers sobre posições: serve para linhas, blocos ou palavras, com a igualdade que quem chama escolher. */
export function diffSteps(n: number, m: number, eq: (i: number, j: number) => boolean): Step[] {
  let start = 0;
  while (start < n && start < m && eq(start, start)) start++;
  let endA = n, endB = m;
  while (endA > start && endB > start && eq(endA - 1, endB - 1)) { endA--; endB--; }
  const out: Step[] = [];
  for (let k = 0; k < start; k++) out.push({ t: '=', i: k, j: k });
  out.push(...myers(start, endA, start, endB, eq));
  for (let k = 0; k < n - endA; k++) out.push({ t: '=', i: endA + k, j: endB + k });
  return out;
}

function myers(a0: number, a1: number, b0: number, b1: number, eq: (i: number, j: number) => boolean): Step[] {
  const n = a1 - a0, m = b1 - b0;
  const removed = () => Array.from({ length: n }, (_, k): Step => ({ t: '-', i: a0 + k }));
  const added = () => Array.from({ length: m }, (_, k): Step => ({ t: '+', j: b0 + k }));
  if (!n) return added();
  if (!m) return removed();

  const maxD = Math.min(n + m, MAX_EDITS);
  const off = maxD + 1;
  const V = new Int32Array(2 * maxD + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= maxD; d++) {
    trace.push(V.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && V[off + k - 1]! < V[off + k + 1]!) ? V[off + k + 1]! : V[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && eq(a0 + x, b0 + y)) { x++; y++; }
      V[off + k] = x;
      if (x >= n && y >= m) return backtrack(n, m, trace, d, off, a0, b0);
    }
  }
  // Mudou demais para valer a pena alinhar: mostra tudo como trocado.
  return [...removed(), ...added()];
}

function backtrack(n: number, m: number, trace: Int32Array[], dEnd: number, off: number, a0: number, b0: number): Step[] {
  const out: Step[] = [];
  let x = n, y = m;
  for (let d = dEnd; d > 0; d--) {
    const prev = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && prev[off + k - 1]! < prev[off + k + 1]!) ? k + 1 : k - 1;
    const prevX = prev[off + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { out.push({ t: '=', i: a0 + x - 1, j: b0 + y - 1 }); x--; y--; }
    if (x === prevX) { out.push({ t: '+', j: b0 + y - 1 }); y--; } else { out.push({ t: '-', i: a0 + x - 1 }); x--; }
  }
  while (x > 0 && y > 0) { out.push({ t: '=', i: a0 + x - 1, j: b0 + y - 1 }); x--; y--; }
  return out.reverse();
}

export interface Row { l: string | null; r: string | null; kind: 'same' | 'change' | 'skip' }

/** Alinha as duas colunas: linhas iguais lado a lado, trocas pareadas, trechos longos iguais recolhidos. */
export function sideBySide(ops: Op[], context = 3): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < ops.length; ) {
    if (ops[i]!.t === '=') {
      rows.push({ l: ops[i]!.line, r: ops[i]!.line, kind: 'same' });
      i++;
      continue;
    }
    const del: string[] = [], add: string[] = [];
    while (i < ops.length && ops[i]!.t !== '=') { (ops[i]!.t === '-' ? del : add).push(ops[i]!.line); i++; }
    for (let j = 0; j < Math.max(del.length, add.length); j++) rows.push({ l: del[j] ?? null, r: add[j] ?? null, kind: 'change' });
  }
  // Recolhe os trechos iguais, deixando `context` linhas de cada lado de uma mudança.
  const out: Row[] = [];
  for (let i = 0; i < rows.length; ) {
    if (rows[i]!.kind !== 'same') { out.push(rows[i++]!); continue; }
    let j = i;
    while (j < rows.length && rows[j]!.kind === 'same') j++;
    const before = i > 0 ? context : 0, after = j < rows.length ? context : 0;
    if (j - i > before + after + 1) {
      out.push(...rows.slice(i, i + before));
      out.push({ l: `… ${j - i - before - after} linhas iguais …`, r: null, kind: 'skip' });
      out.push(...rows.slice(j - after, j));
    } else out.push(...rows.slice(i, j));
    i = j;
  }
  return out;
}
