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
