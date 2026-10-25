import { WidgetType, type EditorView } from '@codemirror/view';

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
