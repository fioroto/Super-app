import { WidgetType, type EditorView } from '@codemirror/view';
import { api } from '../../api/client.ts';
import { resolveRel } from '../../app/files.ts';
import { renderMarkdown } from '../../preview/markdown.ts';
import { cached, renderDiagram } from '../../preview/mermaid.ts';


/** Marcador de lista no lugar do `-`, `*` ou `+`. */
export class BulletWidget extends WidgetType {
  readonly level: number;
  constructor(level: number) { super(); this.level = level; }
  eq(o: BulletWidget) { return o.level === this.level; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-live-bullet';
    s.textContent = ['•', '◦', '▪'][this.level % 3]!;
    return s;
  }
}

/** Recuo de um item de lista aninhado, no lugar dos espaços do começo da linha. */
export class IndentWidget extends WidgetType {
  readonly level: number;
  constructor(level: number) { super(); this.level = level; }
  eq(o: IndentWidget) { return o.level === this.level; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-live-indent';
    s.style.width = `${this.level * 1.4}em`;
    return s;
  }
}

export class HrWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-live-hr';
    return s;
  }
}

const TASK = /^\s*(?:>\s*)*[-*+]\s+\[[ xX]\]/;

/** Caixa de tarefa no lugar de `- [ ]`. Clicar troca `[ ]` por `[x]` no texto e deixa o cursor onde estava. */
export class CheckboxWidget extends WidgetType {
  readonly checked: boolean;
  constructor(checked: boolean) { super(); this.checked = checked; }
  eq(o: CheckboxWidget) { return o.checked === this.checked; }
  toDOM(view: EditorView) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-live-check';
    box.checked = this.checked;
    box.setAttribute('aria-label', 'Tarefa concluída');
    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      toggleTask(view, view.posAtDOM(box));
    });
    return box;
  }
  ignoreEvent() { return true; }
}

function toggleTask(view: EditorView, pos: number): void {
  const line = view.state.doc.lineAt(pos);
  const m = TASK.exec(line.text);
  if (!m) return;
  const at = line.from + m[0].length - 2; // o caractere entre os colchetes
  view.dispatch({ changes: { from: at, to: at + 1, insert: view.state.sliceDoc(at, at + 1) === ' ' ? 'x' : ' ' } });
}

// ---------- imagem, diagrama e tabela ----------


const EXTERNAL = /^(https?:|\/\/)/i;

/** Clicar num widget leva o cursor para o texto-fonte dele, e o widget dá lugar ao código. */
function revealOnMouseDown(el: HTMLElement, view: EditorView, target: (pos: number) => number): void {
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    view.dispatch({ selection: { anchor: target(view.posAtDOM(el)) }, scrollIntoView: true });
    view.focus();
  });
}

export class ImageWidget extends WidgetType {
  readonly src: string;
  readonly alt: string;
  readonly note: string;
  constructor(src: string, alt: string, note: string) { super(); this.src = src; this.alt = alt; this.note = note; }
  eq(o: ImageWidget) { return o.src === this.src && o.alt === this.alt && o.note === this.note; }
  toDOM(view: EditorView) {
    const blocked = (why: string) => {
      const s = document.createElement('span');
      s.className = 'cm-live-img-blocked';
      s.textContent = `[${why}${this.alt ? `: ${this.alt}` : ''}]`;
      revealOnMouseDown(s, view, (p) => p);
      return s;
    };
    // Nada de buscar imagem na internet: o app é offline e isso vazaria quais notas você abre.
    if (EXTERNAL.test(this.src)) return blocked('imagem externa bloqueada');
    let url = this.src;
    if (!/^data:image\//i.test(url)) {
      const target = resolveRel(this.note, this.src);
      if (target === null) return blocked('imagem fora da pasta');
      url = api.rawUrl(target);
    }
    const img = document.createElement('img');
    img.className = 'cm-live-img';
    img.alt = this.alt;
    img.src = url;
    img.addEventListener('load', () => view.requestMeasure());
    img.addEventListener('error', () => img.replaceWith(blocked('imagem não encontrada')));
    revealOnMouseDown(img, view, (p) => p);
    return img;
  }
  ignoreEvent() { return true; }
}

const heights = new Map<string, number>();

export class MermaidWidget extends WidgetType {
  readonly code: string;
  readonly dark: boolean;
  constructor(code: string, dark: boolean) { super(); this.code = code; this.dark = dark; }
  eq(o: MermaidWidget) { return o.code === this.code && o.dark === this.dark; }
  get estimatedHeight() { return heights.get(this.code) ?? 160; }
  toDOM(view: EditorView) {
    const box = document.createElement('div');
    box.className = 'cm-live-block cm-live-mermaid';
    const fill = (res: { svg: string } | { error: string }) => {
      if ('svg' in res) { box.innerHTML = res.svg; } else {
        box.className = 'cm-live-block cm-live-mermaid-error';
        box.textContent = `Diagrama com erro\n${res.error}`;
      }
      heights.set(this.code, box.offsetHeight || 160);
      view.requestMeasure();
    };
    const hit = cached(this.code, this.dark);
    if (hit) fill(hit);
    else {
      box.textContent = 'Desenhando o diagrama…';
      box.style.minHeight = `${this.estimatedHeight}px`;
      void renderDiagram(this.code, this.dark).then((res) => { box.style.minHeight = ''; fill(res); });
    }
    revealOnMouseDown(box, view, (p) => view.state.doc.lineAt(p).to);
    return box;
  }
  ignoreEvent() { return true; }
}

export class TableWidget extends WidgetType {
  readonly src: string;
  readonly note: string;
  constructor(src: string, note: string) { super(); this.src = src; this.note = note; }
  eq(o: TableWidget) { return o.src === this.src && o.note === this.note; }
  get estimatedHeight() { return (this.src.split('\n').length + 1) * 30; }
  toDOM(view: EditorView) {
    const box = document.createElement('div');
    box.className = 'cm-live-block cm-live-table';
    box.innerHTML = renderMarkdown(this.src, this.note); // marked + DOMPurify, o mesmo caminho do preview
    revealOnMouseDown(box, view, (p) => p);
    return box;
  }
  ignoreEvent() { return true; }
}
