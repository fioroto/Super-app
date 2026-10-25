import { getView } from '../editor/Editor.tsx';
import { basename, relativeTo } from './files.ts';
import { activePath, picker } from './store.ts';

/** Escolhe um desenho e coloca o link da imagem (.svg) no cursor da nota aberta. */
export function insertDrawing(): void {
  picker.value = {
    title: 'Escolha o desenho para inserir…',
    filter: (p) => p.endsWith('.excalidraw.md'),
    onPick: (p) => {
      const note = activePath.value;
      const view = getView();
      if (!note || !view) return;
      const name = basename(p).replace(/\.excalidraw\.md$/, '');
      const link = `![${name}](${relativeTo(note, p.replace(/\.md$/, '.svg'))})`;
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: link }, selection: { anchor: from + link.length } });
      view.focus();
    },
  };
}

/** Coloca um bloco (tabela, por exemplo) no cursor da nota aberta, separado do resto por linhas em branco. */
export function insertBlock(markdown: string): boolean {
  const view = getView();
  if (!view) return false;
  const { doc, selection } = view.state;
  const line = doc.lineAt(selection.main.head);
  const prev = line.number > 1 ? doc.line(line.number - 1).text.trim() : '';
  const next = line.number < doc.lines ? doc.line(line.number + 1).text.trim() : '';
  let from = line.from, to = line.to, lead = '';
  if (line.text.trim()) { from = to = line.to; lead = '\n\n'; } else if (prev) lead = '\n';
  // Depois do bloco sempre fica uma linha em branco; o cursor vai para ela, fora da tabela, que assim já aparece pronta.
  const insert = lead + markdown + (next || line.number === doc.lines ? '\n' : '');
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + lead.length + markdown.length + 1 }, scrollIntoView: true });
  view.focus();
  return true;
}
