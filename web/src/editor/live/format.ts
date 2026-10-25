// Comandos de formatação: inserem ou removem a marcação do Markdown no próprio texto.
// Não existe estado de formatação fora do texto; cada comando é uma única transação (um Ctrl+Z desfaz).
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorSelection, type ChangeSpec, type EditorState, type SelectionRange } from '@codemirror/state';
import type { Command, EditorView, KeyBinding } from '@codemirror/view';
import { signal } from '@preact/signals';
import type { SyntaxNode } from '@lezer/common';
import { api } from '../../api/client.ts';
import { ask } from '../../app/dialog.ts';
import { relativeTo } from '../../app/files.ts';
import { error } from '../../app/store.ts';

export type InlineMark = '**' | '*' | '~~' | '`';
const NODE: Record<InlineMark, string> = { '**': 'StrongEmphasis', '*': 'Emphasis', '~~': 'Strikethrough', '`': 'InlineCode' };
const MARK_CHILD: Record<InlineMark, string> = { '**': 'EmphasisMark', '*': 'EmphasisMark', '~~': 'StrikethroughMark', '`': 'CodeMark' };

/** Comandos esperam o parser chegar perto do cursor; o estado dos botões (a cada tecla) usa o que já existe. */
const treeNear = (state: EditorState, force: boolean) =>
  (force ? ensureSyntaxTree(state, Math.min(state.doc.length, state.selection.main.to + 3000), 50) : null) ?? syntaxTree(state);

/** Nó `name` que contém o trecho [from, to], ou null. */
function enclosing(state: EditorState, from: number, to: number, name: string, force = true): SyntaxNode | null {
  const t = treeNear(state, force);
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = t.resolveInner(from, side); n; n = n.parent) {
      if (n.name === name && n.from <= from && n.to >= to) return n;
    }
  }
  return null;
}

const inCode = (state: EditorState, pos: number) => enclosing(state, pos, pos, 'FencedCode') !== null;

type Line = ReturnType<EditorState['doc']['lineAt']>;

/** Linhas tocadas pela seleção, sem repetir. Seleção que termina no começo de uma linha não inclui essa linha. */
function selectedLines(state: EditorState): Line[] {
  const seen = new Set<number>();
  const out: Line[] = [];
  for (const r of state.selection.ranges) {
    const last = r.empty || r.to === state.doc.lineAt(r.to).from ? state.doc.lineAt(Math.max(r.from, r.to - (r.empty ? 0 : 1))).number : state.doc.lineAt(r.to).number;
    for (let n = state.doc.lineAt(r.from).number; n <= last; n++) {
      if (!seen.has(n)) { seen.add(n); out.push(state.doc.line(n)); }
    }
  }
  return out;
}

const apply = (view: EditorView, changes: ChangeSpec[]) => {
  if (!changes.length) return;
  const cs = view.state.changes(changes);
  view.dispatch({ changes: cs, selection: view.state.selection.map(cs, 1), userEvent: 'input.format', scrollIntoView: true });
};

// ---------- inline ----------

function inlineChange(state: EditorState, range: SelectionRange, mark: InlineMark): { changes: ChangeSpec; range: SelectionRange } {
  const node = enclosing(state, range.from, range.to, NODE[mark]);
  if (node) {
    const marks = node.getChildren(MARK_CHILD[mark]);
    const first = marks[0];
    const last = marks[marks.length - 1];
    if (first && last && first !== last) {
      const changes = state.changes([{ from: first.from, to: first.to }, { from: last.from, to: last.to }]);
      return { changes, range: range.map(changes) };
    }
  }
  if (!range.empty) {
    const inserts: ChangeSpec[] = [];
    for (let pos = range.from; pos <= range.to; ) {
      const line = state.doc.lineAt(pos);
      const from = Math.max(line.from, range.from);
      const to = Math.min(line.to, range.to);
      const text = state.doc.sliceString(from, to);
      if (text.trim()) {
        inserts.push({ from: from + (text.length - text.trimStart().length), insert: mark });
        inserts.push({ from: to - (text.length - text.trimEnd().length), insert: mark });
      }
      pos = line.to + 1;
    }
    if (!inserts.length) return { changes: [], range };
    const changes = state.changes(inserts);
    return { changes, range: range.map(changes) };
  }
  const word = state.wordAt(range.head);
  if (word) {
    return {
      changes: [{ from: word.from, insert: mark }, { from: word.to, insert: mark }],
      range: EditorSelection.cursor(range.head + mark.length),
    };
  }
  return { changes: { from: range.head, insert: mark + mark }, range: EditorSelection.cursor(range.head + mark.length) };
}

export const toggleInline = (mark: InlineMark): Command => (view) => {
  const { state } = view;
  view.dispatch(state.update(state.changeByRange((r) => inlineChange(state, r, mark)), { scrollIntoView: true, userEvent: 'input.format' }));
  return true;
};

// ---------- título, listas, citação ----------

const LIST_OR_QUOTE = /^\s*(?:[-*+]\s|\d+[.)]\s|>)/;

/** Título de 0 (parágrafo) a 6. Item de lista e citação não mudam. Repetir o nível volta a parágrafo. */
export const setHeading = (n: number): Command => (view) => {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  for (const line of selectedLines(state)) {
    if (LIST_OR_QUOTE.test(line.text) || inCode(state, line.from)) continue;
    const m = /^(#{1,6})[ \t]+/.exec(line.text);
    const cur = m ? m[1]!.length : 0;
    const target = n === 0 || cur === n ? 0 : n;
    if (target === cur) continue;
    changes.push({ from: line.from, to: line.from + (m ? m[0].length : 0), insert: target ? `${'#'.repeat(target)} ` : '' });
  }
  apply(view, changes);
  return true;
};

// 1 recuo, 2 citação, 3 marcador, 4 tarefa, 5 número
const PREFIX = /^(\s*)((?:>\s?)*)(?:([-*+])\s+(\[[ xX]\]\s+)?|(\d+)[.)]\s+)?/;
type ListKind = 'bullet' | 'number' | 'task';
const kindOfLine = (m: RegExpExecArray): ListKind | null => (m[4] ? 'task' : m[3] ? 'bullet' : m[5] ? 'number' : null);

export const toggleList = (kind: ListKind): Command => (view) => {
  const { state } = view;
  const lines = selectedLines(state).filter((l) => l.text.trim() !== '' && !/^#{1,6}\s/.test(l.text) && !inCode(state, l.from));
  if (!lines.length) return true;
  const parsed = lines.map((l) => PREFIX.exec(l.text)!);
  const remove = parsed.every((m) => kindOfLine(m) === kind);
  const changes: ChangeSpec[] = [];
  let n = 0;
  let prev = -2;
  lines.forEach((l, i) => {
    const m = parsed[i]!;
    const cur = kindOfLine(m);
    if (l.number !== prev + 1) n = 0;
    n++;
    prev = l.number;
    const head = m[1]! + m[2]!;
    let marker: string;
    if (remove) marker = '';
    else if (kind === 'number') marker = `${n}. `;
    else if (cur === kind) return; // já é do tipo pedido: deixa como está
    else marker = kind === 'task' ? '- [ ] ' : `${m[3] ?? '-'} `;
    changes.push({ from: l.from, to: l.from + m[0].length, insert: head + marker });
  });
  apply(view, changes);
  return true;
};

export const toggleQuote: Command = (view) => {
  const { state } = view;
  const lines = selectedLines(state).filter((l) => l.text.trim() !== '');
  if (!lines.length) return true;
  const QUOTE = /^(\s*)>[ ]?/;
  const remove = lines.every((l) => QUOTE.test(l.text));
  apply(view, lines.flatMap((l): ChangeSpec[] => {
    const m = QUOTE.exec(l.text);
    if (remove) return [{ from: l.from + m![1]!.length, to: l.from + m![0].length, insert: '' }];
    if (m) return [];
    const indent = /^\s*/.exec(l.text)![0].length;
    return [{ from: l.from + indent, insert: '> ' }];
  }));
  return true;
};

// ---------- blocos ----------

/** Insere um bloco em linhas próprias, com linha em branco antes e depois. Devolve a posição do começo do bloco. */
function insertBlock(view: EditorView, text: string, cursorOffset: number): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const empty = line.text.trim() === '';
  const lead = empty ? '' : '\n\n';
  const from = empty ? line.from : line.to;
  const insert = `${lead}${text}\n`;
  view.dispatch({
    changes: { from, to: line.to, insert },
    selection: { anchor: from + lead.length + cursorOffset },
    userEvent: 'input.format',
    scrollIntoView: true,
  });
}

export const toggleCodeBlock: Command = (view) => {
  const { state } = view;
  const { from, to } = state.selection.main;
  const block = enclosing(state, from, to, 'FencedCode');
  if (block) {
    const first = state.doc.lineAt(block.from);
    const closed = block.getChildren('CodeMark').length >= 2;
    const last = state.doc.lineAt(block.to);
    const changes: ChangeSpec[] = [{ from: first.from, to: Math.min(first.to + 1, state.doc.length), insert: '' }];
    if (closed) changes.push({ from: Math.max(last.from - 1, first.to + 1), to: last.to, insert: '' });
    apply(view, changes);
    return true;
  }
  if (from !== to) {
    const first = state.doc.lineAt(from);
    const last = state.doc.lineAt(to === state.doc.lineAt(to).from && to > from ? to - 1 : to);
    view.dispatch({
      changes: [{ from: first.from, insert: '```\n' }, { from: last.to, insert: '\n```' }],
      userEvent: 'input.format',
      scrollIntoView: true,
    });
    return true;
  }
  insertBlock(view, '```\n\n```', 4);
  return true;
};

export const insertHr: Command = (view) => {
  insertBlock(view, '---', 4); // cursor na linha em branco depois da linha
  return true;
};

export const insertTable: Command = (view) => {
  const table = '| Coluna 1 | Coluna 2 | Coluna 3 |\n| --- | --- | --- |\n|  |  |  |';
  insertBlock(view, table, table.length - 8); // primeira célula do corpo
  return true;
};

// ---------- link e imagem ----------

export const insertLink: Command = (view) => {
  const { state } = view;
  const { from, to } = state.selection.main;
  const link = enclosing(state, from, to, 'Link');
  const urlNode = link?.getChild('URL');
  const label = state.doc.sliceString(from, to);
  void ask('Endereço do link', urlNode ? state.doc.sliceString(urlNode.from, urlNode.to) : 'https://').then((url) => {
    if (!url) return view.focus();
    if (urlNode) view.dispatch({ changes: { from: urlNode.from, to: urlNode.to, insert: url }, userEvent: 'input.format' });
    else {
      const md = `[${label || url}](${url})`;
      view.dispatch({ changes: { from, to, insert: md }, selection: { anchor: from + md.length }, userEvent: 'input.format' });
    }
    view.focus();
  });
  return true;
};

/** Envia a imagem para anexos/ e põe o link no cursor. Usada por colar, soltar e pelo botão. */
export async function attachImage(view: EditorView, notePath: string, file: File): Promise<void> {
  const name = file.name && file.name !== 'image.png' ? file.name : `colado-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
  try {
    const { path } = await api.attach(file, name);
    const md = `![](${relativeTo(notePath, path)})`;
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to, insert: md }, selection: { anchor: from + md.length }, userEvent: 'input.paste' });
  } catch (e) {
    error.value = (e as Error).message;
  }
}

// ---------- estado da barra e atalhos ----------

export interface Formats {
  bold: boolean; italic: boolean; strike: boolean; code: boolean; link: boolean;
  heading: number; list: ListKind | null; quote: boolean; codeblock: boolean;
}
export const NO_FORMATS: Formats = { bold: false, italic: false, strike: false, code: false, link: false, heading: 0, list: null, quote: false, codeblock: false };

/** O que está ligado no cursor, para o estado dos botões da barra. */
export function activeFormats(state: EditorState): Formats {
  const { from, to, head } = state.selection.main;
  const has = (name: string) => enclosing(state, from, to, name, false) !== null;
  const line = state.doc.lineAt(head);
  const m = PREFIX.exec(line.text)!;
  const h = /^(#{1,6})[ \t]+/.exec(line.text);
  return {
    bold: has('StrongEmphasis'), italic: has('Emphasis'), strike: has('Strikethrough'), code: has('InlineCode'), link: has('Link'),
    heading: h ? h[1]!.length : 0, list: kindOfLine(m), quote: m[2]!.length > 0, codeblock: has('FencedCode'),
  };
}

export const formats = signal<Formats>(NO_FORMATS);

// ---------- Tab e Shift+Tab em itens de lista ----------

const ITEM = /^(\s*)([-*+]|\d+[.)])\s/;

const markerWidth = (text: string) => ITEM.exec(text)![2]!.length + 1;

/** Aninha (`dir` 1) ou desaninha (-1) os itens de lista da seleção. Fora de lista devolve false e o Tab segue o caminho normal. */
export const indentList = (dir: 1 | -1): Command => (view) => {
  const { state } = view;
  const lines = selectedLines(state).filter((l) => ITEM.test(l.text));
  if (!lines.length) return false;
  const changes: ChangeSpec[] = [];
  for (const l of lines) {
    const indent = ITEM.exec(l.text)![1]!.length;
    if (dir === 1) {
      // Só dá para aninhar sob um irmão anterior (item acima, com o mesmo recuo).
      let sibling: Line | null = null;
      for (let n = l.number - 1; n >= 1; n--) {
        const above = state.doc.line(n);
        if (above.text.trim() === '') continue;
        const m = ITEM.exec(above.text);
        const ind = m ? m[1]!.length : /^\s*/.exec(above.text)![0].length;
        if (m && ind === indent) { sibling = above; break; }
        if (ind <= indent && !m) break;
        if (m && ind < indent) break;
      }
      if (sibling) changes.push({ from: l.from, insert: ' '.repeat(markerWidth(sibling.text)) });
    } else if (indent > 0) {
      let parent: Line | null = null;
      for (let n = l.number - 1; n >= 1; n--) {
        const above = state.doc.line(n);
        const m = ITEM.exec(above.text);
        if (m && m[1]!.length < indent) { parent = above; break; }
      }
      const to = parent ? ITEM.exec(parent.text)![1]!.length : Math.max(0, indent - 2);
      changes.push({ from: l.from, to: l.from + indent, insert: ' '.repeat(to) });
    }
  }
  apply(view, changes);
  return true;
};

/** Atalhos de formatação. `enabled` desliga tudo fora das notas `.md`. */
export function formatKeymap(enabled: () => boolean): KeyBinding[] {
  const bind = (keys: string[], cmd: Command): KeyBinding[] =>
    keys.map((key) => ({ key, preventDefault: true, run: (v: EditorView) => (enabled() ? cmd(v) : false) }));
  return [
    ...bind(['Mod-b'], toggleInline('**')),
    ...bind(['Mod-i'], toggleInline('*')),
    ...bind(['Mod-Shift-x'], toggleInline('~~')),
    ...bind(['Mod-`'], toggleInline('`')),
    ...bind(['Mod-k'], insertLink),
    ...[0, 1, 2, 3, 4].flatMap((n) => bind([`Mod-Alt-${n}`], setHeading(n))),
    // Com Shift o navegador entrega o símbolo da tecla; registra os dois nomes.
    ...bind(['Mod-Shift-7', 'Mod-Shift-&'], toggleList('number')),
    ...bind(['Mod-Shift-8', 'Mod-Shift-*'], toggleList('bullet')),
    ...bind(['Mod-Shift-9', 'Mod-Shift-('], toggleList('task')),
    ...bind(['Mod-Shift-.', 'Mod-Shift->'], toggleQuote),
    ...bind(['Mod-Alt-c'], toggleCodeBlock),
    { key: 'Tab', run: (v) => (enabled() ? indentList(1)(v) : false) },
    { key: 'Shift-Tab', run: (v) => (enabled() ? indentList(-1)(v) : false) },
  ];
}
