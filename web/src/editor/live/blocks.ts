import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateEffect, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { isDark } from '../../preview/mermaid.ts';
import { notePathFacet } from './context.ts';
import { frontmatterEnd, touches } from './inline.ts';
import { MermaidWidget, TableWidget } from './widgets.ts';

/** Pede para refazer os widgets de bloco (por exemplo, depois de trocar o tema claro/escuro). */
export const refreshBlocks = StateEffect.define<null>();

interface Block { from: number; to: number; kind: 'mermaid' | 'table'; code: string }
interface Value { blocks: Block[]; decos: DecorationSet }

/**
 * Diagramas e tabelas de primeiro nível. Os de dentro de lista ou citação ficam como código:
 * trocar linhas inteiras por um widget apagaria o recuo e o `>` que fazem parte do bloco.
 */
function findBlocks(state: EditorState): Block[] {
  const out: Block[] = [];
  const fmEnd = frontmatterEnd(state);
  const { doc } = state;
  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.name === 'Document') return true;
      if (ref.from < fmEnd) return false;
      const from = doc.lineAt(ref.from).from;
      const to = doc.lineAt(ref.to).to;
      if (ref.name === 'FencedCode') {
        const info = ref.node.getChild('CodeInfo');
        const closed = ref.node.getChildren('CodeMark').length >= 2;
        if (info && closed && doc.sliceString(info.from, info.to).trim().split(/\s/)[0]!.toLowerCase() === 'mermaid') {
          const text = ref.node.getChild('CodeText');
          out.push({ from, to, kind: 'mermaid', code: text ? doc.sliceString(text.from, text.to) : '' });
        }
      } else if (ref.name === 'Table') {
        out.push({ from, to, kind: 'table', code: doc.sliceString(from, to) });
      }
      return false;
    },
  });
  return out;
}

function decorate(state: EditorState, blocks: Block[]): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const note = state.facet(notePathFacet)();
  const dark = isDark();
  for (const blk of blocks) {
    if (touches(state, blk.from, blk.to)) continue; // o cursor está dentro: mostra o código
    const widget = blk.kind === 'mermaid' ? new MermaidWidget(blk.code, dark) : new TableWidget(blk.code, note);
    b.add(blk.from, blk.to, Decoration.replace({ widget, block: true }));
  }
  return b.finish();
}

/** Decorations de bloco só podem vir de um StateField (o CodeMirror recusa as vindas de plugin). */
export const liveBlocks = StateField.define<Value>({
  create(state) {
    const blocks = findBlocks(state);
    return { blocks, decos: decorate(state, blocks) };
  },
  update(value, tr) {
    const treeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState);
    let blocks = value.blocks;
    if (tr.docChanged || treeChanged) blocks = findBlocks(tr.state);
    // Só mexer no cursor não refaz a busca: reaproveita a lista e recalcula quais blocos ficam abertos.
    if (blocks !== value.blocks || tr.selection || tr.effects.some((e) => e.is(refreshBlocks))) {
      return { blocks, decos: decorate(tr.state, blocks) };
    }
    return value;
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.decos),
    EditorView.atomicRanges.of((view) => view.state.field(f).decos),
  ],
});
