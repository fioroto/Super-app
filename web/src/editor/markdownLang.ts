import { Language, defineLanguageFacet } from '@codemirror/language';
import { EditorSelection, type Extension } from '@codemirror/state';
import type { Command } from '@codemirror/view';
import { GFM, parser } from '@lezer/markdown';

// Montado à mão: o pacote @codemirror/lang-markdown traz junto os analisadores de
// HTML, CSS e JavaScript (cerca de 45 KB comprimidos) que um editor de notas não usa.
const data = defineLanguageFacet({ commentTokens: { block: { open: '<!--', close: '-->' } } });
const lang = new Language(data, parser.configure([GFM]), [], 'markdown');

export const markdownSupport: Extension = lang.extension;

const ITEM = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/;

/** Enter dentro de uma lista continua a lista; Enter num item vazio encerra a lista. */
export const continueList: Command = (view) => {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const m = ITEM.exec(line.text);
  if (!m || sel.head < line.from + m[0].length) return false;

  const [whole, indent, marker, num, delim, space, task] = m;
  if (line.text.slice(whole.length).trim() === '') {
    // Item vazio: apaga o marcador e deixa a linha em branco.
    view.dispatch({ changes: { from: line.from, to: line.to, insert: '' }, selection: EditorSelection.cursor(line.from), userEvent: 'input' });
    return true;
  }
  const next = num ? `${Number(num) + 1}${delim}` : marker;
  const insert = `\n${indent}${next}${space}${task ? '[ ] ' : ''}`;
  view.dispatch({
    changes: { from: sel.head, insert },
    selection: EditorSelection.cursor(sel.head + insert.length),
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
};
