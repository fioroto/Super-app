// Células copiadas de uma planilha viram uma tabela Markdown.
// Excel, Google Planilhas e LibreOffice copiam como texto separado por tabulação (TSV):
// uma linha por linha da planilha, um Tab entre células, e aspas em volta da célula que tem Tab,
// quebra de linha ou aspas (aspas dentro da célula dobradas).

export type Delimiter = 'auto' | 'tab' | ';' | ',';

export interface TableOptions {
  /** A primeira linha é o cabeçalho. Desligado, a tabela ganha um cabeçalho vazio. */
  header: boolean;
  /** Preenche com espaços para as colunas ficarem alinhadas no texto. */
  pad: boolean;
  /** Coluna só de números fica alinhada à direita. */
  alignNumbers: boolean;
}

function split(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let start = true; // no início de uma célula
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
    } else if (c === '"' && start) {
      quoted = true;
      start = false;
    } else if (c === sep) {
      row.push(field);
      field = '';
      start = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      start = true;
    } else {
      field += c;
      start = false;
    }
  }
  row.push(field);
  rows.push(row);
  // A planilha termina a última linha com quebra: não é uma linha a mais.
  while (rows.length && rows[rows.length - 1]!.every((c) => c === '')) rows.pop();
  return rows;
}

/** Linhas curtas ganham células vazias no fim (a planilha às vezes omite as últimas). */
function square(rows: string[][]): string[][] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => (r.length < width ? [...r, ...Array<string>(width - r.length).fill('')] : r));
}

/** Lê o texto colado. No modo automático, Tab é o padrão; ";" e "," só valem se todas as linhas têm o mesmo número de colunas. */
export function parseSheet(text: string, delimiter: Delimiter = 'auto'): string[][] {
  const t = text.replace(/^\uFEFF/, '');
  if (delimiter === 'tab') return square(split(t, '\t'));
  if (delimiter !== 'auto') return square(split(t, delimiter));
  if (t.includes('\t')) return square(split(t, '\t'));
  for (const sep of [';', ',']) {
    const rows = split(t, sep);
    if (rows[0] && rows[0].length > 1 && rows.every((r) => r.length === rows[0]!.length)) return rows;
  }
  return square(split(t, '\t')); // sem separador: uma coluna só
}

const NUMBER = /^[-+(]?\s*(?:R\$|US\$|\$|€|£)?\s*\d[\d.,]*\s*[%)]?$/;
const isNumber = (s: string) => NUMBER.test(s.trim());

/** Uma célula numa linha só: quebra vira <br> e a barra vertical é escapada. */
const clean = (s: string) => s.trim().replace(/\r\n|\r|\n/g, '<br>').replace(/\|/g, '\\|');

/** Colunas alinhadas à direita: as que só têm números (o cabeçalho não conta). */
export function rightColumns(rows: string[][], opts: Pick<TableOptions, 'header' | 'alignNumbers'>): boolean[] {
  const width = rows[0]?.length ?? 0;
  const body = opts.header ? rows.slice(1) : rows;
  return Array.from({ length: width }, (_, c) => {
    if (!opts.alignNumbers) return false;
    const col = body.map((r) => r[c]!).filter((v) => v.trim() !== '');
    return col.length > 0 && col.every(isNumber);
  });
}

export function toMarkdownTable(rows: string[][], opts: TableOptions): string {
  if (!rows.length || !rows[0]!.length) return '';
  const width = rows[0]!.length;
  const cells = rows.map((r) => r.map(clean));
  const head = opts.header ? cells[0]! : Array<string>(width).fill('');
  const body = opts.header ? cells.slice(1) : cells;

  const right = rightColumns(rows, opts);
  const size = head.map((h, c) => (opts.pad ? Math.max(3, h.length, ...body.map((r) => r[c]!.length)) : 3));

  const line = (r: string[]) => `| ${r.map((v, c) => (opts.pad ? (right[c] ? v.padStart(size[c]!) : v.padEnd(size[c]!)) : v)).join(' | ')} |`;
  const rule = head.map((_, c) => (right[c] ? `${'-'.repeat(size[c]! - 1)}:` : '-'.repeat(size[c]!)));
  return [line(head), `| ${rule.join(' | ')} |`, ...body.map(line)].join('\n');
}

// Célula que começa com = + - @ vira fórmula ao colar no Excel; com apóstrofo na frente, fica texto.
// Número negativo ou com sinal (-3, +5,2) continua número.
const FORMULA = /^[=+\-@\t\r]/;
const guard = (s: string) => (FORMULA.test(s) && !/^[-+]\d[\d.,]*%?$/.test(s) ? `'${s}` : s);

/** O inverso de parseSheet: texto separado por Tab, que a planilha cola já em células. */
export function toTsv(rows: string[][]): string {
  const cell = (raw: string) => {
    const s = guard(raw);
    return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join('\t')).join('\n');
}
