export type Op = { t: '=' | '+' | '-'; line: string };

const MAX_EDITS = 1500;

/** Diferença linha a linha (algoritmo de Myers), depois de tirar o começo e o fim iguais. */
export function diffLines(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const head = a.slice(0, start).map((line): Op => ({ t: '=', line }));
  const tail = a.slice(endA).map((line): Op => ({ t: '=', line }));
  return [...head, ...myers(a.slice(start, endA), b.slice(start, endB)), ...tail];
}

function myers(A: string[], B: string[]): Op[] {
  const n = A.length, m = B.length;
  if (!n) return B.map((line) => ({ t: '+', line }));
  if (!m) return A.map((line) => ({ t: '-', line }));

  const maxD = Math.min(n + m, MAX_EDITS);
  const off = maxD + 1;
  const V = new Int32Array(2 * maxD + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= maxD; d++) {
    trace.push(V.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && V[off + k - 1]! < V[off + k + 1]!) ? V[off + k + 1]! : V[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) { x++; y++; }
      V[off + k] = x;
      if (x >= n && y >= m) return backtrack(A, B, trace, d, off);
    }
  }
  // Mudou demais para valer a pena alinhar: mostra tudo como trocado.
  return [...A.map((line): Op => ({ t: '-', line })), ...B.map((line): Op => ({ t: '+', line }))];
}

function backtrack(A: string[], B: string[], trace: Int32Array[], dEnd: number, off: number): Op[] {
  const out: Op[] = [];
  let x = A.length, y = B.length;
  for (let d = dEnd; d > 0; d--) {
    const prev = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && prev[off + k - 1]! < prev[off + k + 1]!) ? k + 1 : k - 1;
    const prevX = prev[off + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { out.push({ t: '=', line: A[x - 1]! }); x--; y--; }
    if (x === prevX) { out.push({ t: '+', line: B[y - 1]! }); y--; } else { out.push({ t: '-', line: A[x - 1]! }); x--; }
  }
  while (x > 0 && y > 0) { out.push({ t: '=', line: A[x - 1]! }); x--; y--; }
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
