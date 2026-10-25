import { Language, defineLanguageFacet } from '@codemirror/language';
import { EditorSelection, type Extension } from '@codemirror/state';
import type { Command } from '@codemirror/view';
import { GFM, parser } from '@lezer/markdown';

// Montado à mão: o pacote @codemirror/lang-markdown traz junto os analisadores de
// HTML, CSS e JavaScript (cerca de 45 KB comprimidos) que um editor de notas não usa.
const data = defineLanguageFacet({ commentTokens: { block: { open: '<!--', close: '-->' } } });
const lang = new Language(data, parser.configure([GFM]), [], 'markdown');

export const markdownSupport: Extension = lang.extension;

// 1 citação, 2 recuo, 3 marcador, 4 número, 5 delimitador, 6 espaço, 7 tarefa
const LINE = /^(\s*(?:>[ ]?)*)(\s*)(?:([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?)?/;

/** Enter continua lista e citação; Enter num item ou citação vazios encerra. */
export const continueList: Command = (view) => {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const m = LINE.exec(line.text)!;
  const [whole, quote, indent, marker, num, delim, space, task] = m;
  if (!quote!.includes('>') && !marker) return false;
  if (sel.head < line.from + whole.length) return false;

  if (line.text.slice(whole.length).trim() === '') {
    // Vazio: apaga o marcador e a citação e deixa a linha em branco.
    view.dispatch({ changes: { from: line.from, to: line.to, insert: '' }, selection: EditorSelection.cursor(line.from), userEvent: 'input' });
    return true;
  }
  const next = marker ? `${num ? `${Number(num) + 1}${delim}` : marker}${space}${task ? '[ ] ' : ''}` : '';
  const insert = `\n${quote}${indent}${next}`;
  view.dispatch({
    changes: { from: sel.head, insert },
    selection: EditorSelection.cursor(sel.head + insert.length),
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
};
