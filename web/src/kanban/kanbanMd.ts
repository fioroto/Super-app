// Formato de quadro do plugin Obsidian Kanban: frontmatter `kanban-plugin`, cada lane é um
// `## Título`, cada cartão um item `- [ ] texto`. Regra deste módulo: tudo que o app não
// mexeu volta byte a byte (espaçamento, `***` do arquivo, bloco de configurações, quebras
// de linha CRLF). Cada cartão guarda as linhas originais e só é reescrito se for editado.

export interface Card {
  kind: 'card';
  checked: boolean;
  text: string;
  /** Linhas como estavam no arquivo. Some quando o texto é editado. */
  raw?: string[];
}
export interface Other {
  kind: 'other';
  lines: string[];
}
export type Item = Card | Other;

export interface Lane {
  title: string;
  heading: string;
  /** Linhas em branco entre o título e o primeiro item. */
  head: string[];
  items: Item[];
  /** Linhas em branco e `***` depois do último item. */
  trail: string[];
  /** A lane "Archive", que vem depois de uma linha `***`. */
  archive?: boolean;
}

export interface Board {
  eol: string;
  front: string[];
  pre: string[];
  lanes: Lane[];
  /** Bloco `%% kanban:settings … %%`, devolvido como veio. */
  settings: string[];
  tail: string[];
}

const CARD = /^- \[( |x|X)\] ?(.*)$/;
const LANE = /^## /;
const isContinuation = (l: string) => (l.startsWith('  ') || l.startsWith('\t')) && l.trim() !== '';

export function isKanban(md: string): boolean {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  return !!m && /^kanban-plugin:\s*\S/m.test(m[1]!);
}

export function parseBoard(md: string): Board | null {
  if (!isKanban(md)) return null;
  const eol = md.includes('\r\n') ? '\r\n' : '\n';
  const lines = md.split(eol);
  const end = lines.indexOf('---', 1);
  if (lines[0] !== '---' || end < 0) return null;

  let rest = lines.slice(end + 1);
  let settings: string[] = [];
  let tail: string[] = [];
  const si = rest.findIndex((l) => l.startsWith('%% kanban:settings'));
  if (si >= 0) {
    let ci = rest.findIndex((l, i) => i > si && l.trimEnd() === '%%');
    if (ci < 0) ci = rest.length - 1;
    settings = rest.slice(si, ci + 1);
    tail = rest.slice(ci + 1);
    rest = rest.slice(0, si);
  }

  const firstLane = rest.findIndex((l) => LANE.test(l));
  const pre = firstLane < 0 ? rest : rest.slice(0, firstLane);
  const body = firstLane < 0 ? [] : rest.slice(firstLane);

  const lanes: Lane[] = [];
  for (let i = 0; i < body.length; ) {
    let j = i + 1;
    while (j < body.length && !LANE.test(body[j]!)) j++;
    lanes.push(parseLane(body[i]!, body.slice(i + 1, j)));
    i = j;
  }
  lanes.forEach((l, i) => { if (i > 0 && l.title === 'Archive' && lanes[i - 1]!.trail.includes('***')) l.archive = true; });

  return { eol, front: lines.slice(0, end + 1), pre, lanes, settings, tail };
}

function parseLane(heading: string, body: string[]): Lane {
  const trail: string[] = [];
  while (body.length && (body[body.length - 1] === '' || body[body.length - 1] === '***')) trail.unshift(body.pop()!);
  const head: string[] = [];
  let k = 0;
  while (k < body.length && body[k] === '') head.push(body[k++]!);

  const items: Item[] = [];
  while (k < body.length) {
    const m = CARD.exec(body[k]!);
    if (m) {
      const raw = [body[k++]!];
      while (k < body.length && isContinuation(body[k]!)) raw.push(body[k++]!);
      const text = [m[2]!, ...raw.slice(1).map((l) => l.replace(/^(  |\t)/, ''))].join('\n');
      items.push({ kind: 'card', checked: m[1] !== ' ', text, raw });
    } else {
      const lines = [body[k++]!];
      while (k < body.length && !CARD.test(body[k]!)) lines.push(body[k++]!);
      items.push({ kind: 'other', lines });
    }
  }
  return { title: heading.slice(3).trimEnd(), heading, head, items, trail };
}

export function renderCard(c: Card): string[] {
  const [first, ...more] = c.text.split('\n');
  return [`- [${c.checked ? 'x' : ' '}] ${first}`, ...more.map((l) => `  ${l}`)];
}

export function serializeBoard(b: Board): string {
  const out = [...b.front, ...b.pre];
  for (const l of b.lanes) {
    out.push(l.heading, ...l.head);
    for (const it of l.items) out.push(...(it.kind === 'card' ? (it.raw ?? renderCard(it)) : it.lines));
    out.push(...l.trail);
  }
  out.push(...b.settings, ...b.tail);
  return out.join(b.eol);
}

// ---------- operações (devolvem um quadro novo; o original não muda) ----------

const clone = (b: Board): Board => structuredClone(b);
export const cardsOf = (l: Lane): Card[] => l.items.filter((i): i is Card => i.kind === 'card');

/** Posição em `items` onde entra o cartão de número `index` (contando só cartões). */
function slotOf(l: Lane, index: number): number {
  let seen = 0;
  for (let p = 0; p < l.items.length; p++) {
    if (l.items[p]!.kind === 'card') {
      if (seen === index) return p;
      seen++;
    }
  }
  return l.items.length;
}

function openLane(l: Lane): void {
  // Lane vazia ganha a linha em branco depois do título ao receber o primeiro item.
  if (!l.items.length) {
    l.head = [''];
    // Com duas ou mais linhas em branco no fim, uma passa para antes do cartão; com uma só, ela fica.
    if (l.trail.length >= 2 && l.trail[0] === '') l.trail = l.trail.slice(1);
  }
}

const newCard = (text: string, checked = false): Card => ({ kind: 'card', checked, text });

export function addCard(b: Board, lane: number, text: string, index?: number): Board {
  const n = clone(b);
  const l = n.lanes[lane]!;
  openLane(l);
  l.items.splice(slotOf(l, index ?? cardsOf(l).length), 0, newCard(text));
  return n;
}

export function setCardText(b: Board, lane: number, index: number, text: string): Board {
  const n = clone(b);
  const card = cardsOf(n.lanes[lane]!)[index]!;
  if (card.text === text) return b;
  card.text = text;
  delete card.raw;
  return n;
}

export function toggleCard(b: Board, lane: number, index: number): Board {
  const n = clone(b);
  const card = cardsOf(n.lanes[lane]!)[index]!;
  card.checked = !card.checked;
  // Só o marcador muda; o resto da linha continua como estava.
  if (card.raw) card.raw[0] = card.raw[0]!.replace(/^- \[.\]/, `- [${card.checked ? 'x' : ' '}]`);
  return n;
}

export function removeCard(b: Board, lane: number, index: number): Board {
  const n = clone(b);
  const l = n.lanes[lane]!;
  l.items.splice(slotOf(l, index), 1);
  return n;
}

export function moveCard(b: Board, from: number, fromIndex: number, to: number, toIndex: number): Board {
  const n = clone(b);
  const src = n.lanes[from]!;
  const [card] = src.items.splice(slotOf(src, fromIndex), 1) as Card[];
  const dst = n.lanes[to]!;
  openLane(dst);
  // Mesma lane: o índice de destino foi medido antes de tirar o cartão.
  const at = from === to && toIndex > fromIndex ? toIndex - 1 : toIndex;
  dst.items.splice(slotOf(dst, at), 0, card!);
  return n;
}

const DEFAULT_TRAIL = ['', ''];

export function addLane(b: Board, title: string): Board {
  const n = clone(b);
  const at = n.lanes.findIndex((l) => l.archive);
  const idx = at < 0 ? n.lanes.length : at;
  const prev = n.lanes[idx - 1];
  const lane: Lane = { title, heading: `## ${title}`, head: [], items: [], trail: prev ? [...prev.trail] : [...DEFAULT_TRAIL] };
  if (prev) {
    // O `***` fica entre a última lane comum e o Archive; a nova lane assume a posição.
    prev.trail = prev.trail.filter((l) => l !== '***');
    if (prev.trail.length < 2) prev.trail = [...DEFAULT_TRAIL];
  }
  n.lanes.splice(idx, 0, lane);
  return n;
}

export function renameLane(b: Board, lane: number, title: string): Board {
  const n = clone(b);
  n.lanes[lane]!.title = title;
  n.lanes[lane]!.heading = `## ${title}`;
  return n;
}

export function removeLane(b: Board, lane: number): Board {
  const n = clone(b);
  const trails = n.lanes.map((l) => l.trail);
  // As linhas finais ficam presas à posição, não à lane: o `***` (antes do Archive) e o fim do
  // arquivo não podem sumir. Se a lane removida guarda uma delas, descarta-se a da lane anterior.
  const holdsSpecial = lane === n.lanes.length - 1 || trails[lane]!.includes('***');
  const drop = holdsSpecial && lane > 0 ? lane - 1 : lane;
  n.lanes.splice(lane, 1);
  trails.splice(drop, 1);
  n.lanes.forEach((l, i) => { l.trail = trails[i]!; });
  return n;
}

export function moveLane(b: Board, from: number, to: number): Board {
  const n = clone(b);
  const trails = n.lanes.map((l) => l.trail);
  const [lane] = n.lanes.splice(from, 1);
  n.lanes.splice(to, 0, lane!);
  n.lanes.forEach((l, i) => { l.trail = trails[i]!; });
  return n;
}

export function archiveCard(b: Board, lane: number, index: number): Board {
  let n = clone(b);
  if (!n.lanes.some((l) => l.archive)) {
    const last = n.lanes[n.lanes.length - 1]!;
    const archive: Lane = { title: 'Archive', heading: '## Archive', head: [], items: [], trail: last.trail, archive: true };
    last.trail = ['', '', '***', ''];
    n.lanes.push(archive);
  }
  const to = n.lanes.findIndex((l) => l.archive);
  n = moveCard(n, lane, index, to, cardsOf(n.lanes[to]!).length);
  return n;
}

export const DEFAULT_LANES = ['A fazer', 'Fazendo', 'Feito'];

export function emptyBoardText(lanes = DEFAULT_LANES): string {
  const body = lanes.map((t) => `## ${t}\n\n\n`).join('\n');
  return `---\n\nkanban-plugin: board\n\n---\n\n${body}\n\n%% kanban:settings\n\`\`\`\n{"kanban-plugin":"board"}\n\`\`\`\n%%\n`;
}
