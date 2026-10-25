import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { openFile } from '../../app/store.ts';
import { resolveRel } from '../../app/files.ts';
import { notePathFacet } from './context.ts';
import { BulletWidget, CheckboxWidget, HrWidget, ImageWidget, IndentWidget } from './widgets.ts';

/**
 * Esconder a marcação (`**`, `#`) fora do trecho em que o cursor está.
 * Se o cursor travar ou saltar perto de um trecho escondido, ponha `false`: a marcação
 * passa a ficar apenas esmaecida, sem sumir.
 */
export const HIDE_MARKS = true;

const hide = Decoration.replace({});
const dim = Decoration.mark({ class: 'cm-live-dim' });
const marks = new Map<string, Decoration>();
const mark = (cls: string) => marks.get(cls) ?? (marks.set(cls, Decoration.mark({ class: cls })), marks.get(cls)!);
const lines = new Map<string, Decoration>();
const line = (cls: string) => lines.get(cls) ?? (lines.set(cls, Decoration.line({ class: cls })), lines.get(cls)!);

/** Algum cursor ou seleção encosta no trecho (as bordas contam). */
export const touches = (state: EditorState, from: number, to: number) => state.selection.ranges.some((r) => r.from <= to && r.to >= from);

const FRONTMATTER = /^---[ \t]*\r?\n[\w"'.-]+[ \t]*:[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/;

/** Fim do frontmatter (`---` … `---` no começo), ou -1. O parser não o conhece: lê como linha horizontal e título. */
export function frontmatterEnd(state: EditorState): number {
  const m = FRONTMATTER.exec(state.doc.sliceString(0, Math.min(state.doc.length, 20_000)));
  return m ? m[0].length : -1;
}

const depthOf = (n: SyntaxNode): number => {
  let d = 0;
  for (let p: SyntaxNode | null = n.parent; p; p = p.parent) if (p.name === 'BulletList' || p.name === 'OrderedList') d++;
  return d;
};

interface Built { all: DecorationSet; atomic: DecorationSet }

function build(view: EditorView): Built {
  const { state } = view;
  const { doc } = state;
  const all: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const fmEnd = frontmatterEnd(state);

  const lineTouched = (pos: number) => { const l = doc.lineAt(pos); return touches(state, l.from, l.to); };
  const eachLine = (from: number, to: number, vFrom: number, vTo: number, fn: (l: ReturnType<typeof doc.lineAt>) => void) => {
    for (let pos = Math.max(from, vFrom); pos <= Math.min(to, vTo); ) {
      const l = doc.lineAt(pos);
      fn(l);
      pos = l.to + 1;
    }
  };
  const lineClass = (cls: string, from: number, to: number, vFrom: number, vTo: number) =>
    eachLine(from, to, vFrom, vTo, (l) => all.push(line(cls).range(l.from)));
  const hideRange = (from: number, to: number) => {
    if (to <= from) return;
    if (!HIDE_MARKS) { all.push(dim.range(from, to)); return; }
    const r = hide.range(from, to);
    all.push(r);
    atomic.push(r);
  };
  const replaceWith = (from: number, to: number, widget: IndentWidget | BulletWidget | CheckboxWidget | HrWidget | ImageWidget) => {
    const r = Decoration.replace({ widget }).range(from, to);
    all.push(r);
    atomic.push(r);
  };
  const markOf = (n: SyntaxNode, names: string[]) => n.getChildren(names[0]!);

  for (const { from: vFrom, to: vTo } of view.visibleRanges) {
    if (fmEnd >= 0) lineClass('cm-live-fm', 0, fmEnd, vFrom, vTo);

    syntaxTree(state).iterate({
      from: vFrom,
      to: vTo,
      enter(ref) {
        if (fmEnd >= 0 && ref.from < fmEnd && ref.name !== 'Document') return false;
        const name = ref.name;
        const node = ref.node;

        let m = /^ATXHeading([1-6])$/.exec(name);
        if (m) {
          lineClass(`cm-live-h${m[1]}`, ref.from, ref.to, vFrom, vTo);
          const mk = node.getChild('HeaderMark');
          if (mk && !lineTouched(mk.from)) hideRange(mk.from, Math.min(mk.to + 1, doc.lineAt(mk.from).to));
          return;
        }
        m = /^SetextHeading([12])$/.exec(name);
        if (m) {
          const last = doc.lineAt(ref.to).number;
          eachLine(ref.from, ref.to, vFrom, vTo, (l) => all.push(line(l.number === last ? 'cm-live-dim' : `cm-live-h${m![1]}`).range(l.from)));
          return;
        }

        switch (name) {
          case 'StrongEmphasis':
          case 'Emphasis':
          case 'Strikethrough':
          case 'InlineCode': {
            const cls = { StrongEmphasis: 'strong', Emphasis: 'em', Strikethrough: 'strike', InlineCode: 'code' }[name];
            all.push(mark(`cm-live-${cls}`).range(ref.from, ref.to));
            const markName = { StrongEmphasis: 'EmphasisMark', Emphasis: 'EmphasisMark', Strikethrough: 'StrikethroughMark', InlineCode: 'CodeMark' }[name]!;
            if (!touches(state, ref.from, ref.to)) for (const mk of markOf(node, [markName])) hideRange(mk.from, mk.to);
            return;
          }
          case 'Link': {
            const parts = node.getChildren('LinkMark');
            if (parts.length >= 4) {
              all.push(mark('cm-live-link').range(parts[0]!.to, parts[1]!.from));
              if (!touches(state, ref.from, ref.to)) {
                hideRange(parts[0]!.from, parts[0]!.to);
                hideRange(parts[1]!.from, ref.to);
              }
            } else all.push(mark('cm-live-link').range(ref.from, ref.to));
            return;
          }
          case 'Image': {
            const parts = node.getChildren('LinkMark');
            const url = node.getChild('URL');
            if (parts.length >= 4 && url && !touches(state, ref.from, ref.to)) {
              replaceWith(ref.from, ref.to, new ImageWidget(doc.sliceString(url.from, url.to), doc.sliceString(parts[0]!.to, parts[1]!.from), state.facet(notePathFacet)()));
            }
            return false;
          }
          case 'URL':
            if (node.parent && node.parent.name !== 'Link' && node.parent.name !== 'Image') all.push(mark('cm-live-link').range(ref.from, ref.to));
            return;
          case 'ListMark': {
            const item = node.parent;
            const ln = doc.lineAt(ref.from);
            const depth = depthOf(node);
            const lead = ref.from - ln.from;
            if (lead > 0 && depth > 1 && /^\s+$/.test(doc.sliceString(ln.from, ref.from))) replaceWith(ln.from, ref.from, new IndentWidget(depth - 1));
            const task = item?.getChild('Task');
            const taskMark = task?.getChild('TaskMarker');
            if (task && taskMark) {
              const checked = /[xX]/.test(doc.sliceString(taskMark.from, taskMark.to));
              // O espaço depois do `]` entra no trecho trocado: a caixa já tem a sua margem.
              const end = doc.sliceString(taskMark.to, taskMark.to + 1) === ' ' ? taskMark.to + 1 : taskMark.to;
              replaceWith(ref.from, end, new CheckboxWidget(checked));
              if (checked && task.to > end) all.push(mark('cm-live-done').range(end, task.to));
            } else if (item?.parent?.name === 'OrderedList') {
              all.push(mark('cm-live-olmark').range(ref.from, ref.to));
            } else {
              replaceWith(ref.from, ref.to, new BulletWidget(depth - 1));
            }
            return;
          }
          case 'Blockquote':
            lineClass('cm-live-quote', ref.from, ref.to, vFrom, vTo);
            return;
          case 'QuoteMark': {
            // Nas linhas seguintes de uma citação a marca fica dentro do parágrafo, não do Blockquote.
            if (lineTouched(ref.from)) return;
            const l = doc.lineAt(ref.from);
            hideRange(ref.from, doc.sliceString(ref.to, ref.to + 1) === ' ' ? Math.min(ref.to + 1, l.to) : ref.to);
            return;
          }
          case 'FencedCode': {
            lineClass('cm-live-codeblock', ref.from, ref.to, vFrom, vTo);
            const first = doc.lineAt(ref.from);
            all.push(line('cm-live-codefence').range(first.from));
            if (node.getChildren('CodeMark').length >= 2) all.push(line('cm-live-codefence').range(doc.lineAt(ref.to).from));
            return false;
          }
          case 'HTMLBlock':
            lineClass('cm-live-html', ref.from, ref.to, vFrom, vTo);
            return false;
          case 'Table':
            lineClass('cm-live-table-src', ref.from, ref.to, vFrom, vTo);
            return false;
          case 'HorizontalRule':
            if (lineTouched(ref.from)) all.push(line('cm-live-dim').range(doc.lineAt(ref.from).from));
            else replaceWith(ref.from, ref.to, new HrWidget());
            return;
        }
      },
    });
  }
  return { all: Decoration.set(all, true), atomic: Decoration.set(atomic, true) };
}

const inlinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;
    constructor(view: EditorView) {
      ({ all: this.decorations, atomic: this.atomic } = build(view));
    }
    update(u: ViewUpdate) {
      // Durante a composição (acento, IME) só acompanha as mudanças; refazer aqui atrapalha o texto em curso.
      if (u.view.composing && !u.viewportChanged) {
        this.decorations = this.decorations.map(u.changes);
        this.atomic = this.atomic.map(u.changes);
        return;
      }
      if (u.docChanged || u.selectionSet || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        ({ all: this.decorations, atomic: this.atomic } = build(u.view));
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.atomic ?? Decoration.none),
  },
);

export const liveInline = inlinePlugin;

/** Ctrl+clique (Cmd no Mac) abre o link: página externa numa aba nova, nota relativa no próprio app. */
export function linkOpener(notePath: () => string) {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos == null) return false;
      let n: SyntaxNode | null = null;
      // Sobre o texto de um link escondido o clique pode cair na borda do trecho: tenta os dois lados.
      for (const side of [0, -1, 1] as const) {
        n = syntaxTree(view.state).resolveInner(pos, side);
        while (n && n.name !== 'Link' && n.name !== 'URL') n = n.parent;
        if (n) break;
      }
      if (!n) return false;
      const url = n.name === 'URL' ? n : n.getChild('URL');
      if (!url) return false;
      const href = view.state.sliceDoc(url.from, url.to);
      e.preventDefault();
      if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener');
      else if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#')) {
        const target = resolveRel(notePath(), href);
        if (target) void openFile(target);
      }
      return true;
    },
  });
}
