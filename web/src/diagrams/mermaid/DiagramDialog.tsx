import type { EditorState } from '@codemirror/state';
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getView } from '../../editor/Editor.tsx';
import { renderDiagram, type Rendered } from '../../preview/mermaid.ts';
import { mermaidTemplates } from './templates.ts';

interface Target { code: string; from?: number; to?: number }
export const diagramDialog = signal<Target | null>(null);

/** Bloco ```mermaid que contém o cursor, se houver. */
export function mermaidBlockAt(state: EditorState): { from: number; to: number; code: string } | null {
  const { doc } = state;
  const cursorLine = doc.lineAt(state.selection.main.head).number;
  let open = 0;
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (!open) {
      if (/^\s*```\s*mermaid\b/i.test(text)) open = n;
    } else if (/^\s*```\s*$/.test(text)) {
      if (cursorLine >= open && cursorLine <= n) {
        const body: string[] = [];
        for (let i = open + 1; i < n; i++) body.push(doc.line(i).text);
        return { from: doc.line(open).from, to: doc.line(n).to, code: body.join('\n') };
      }
      open = 0;
    }
  }
  return null;
}

export function openDiagramDialog(): void {
  const view = getView();
  const block = view ? mermaidBlockAt(view.state) : null;
  diagramDialog.value = block ?? { code: mermaidTemplates[0]!.code };
}

export function DiagramDialog() {
  const target = diagramDialog.value;
  const [code, setCode] = useState(target?.code ?? '');
  const [result, setResult] = useState<Rendered | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const editing = target?.from !== undefined;

  useEffect(() => { area.current?.focus(); }, []);
  useEffect(() => {
    const id = setTimeout(() => void renderDiagram(code).then(setResult), 300);
    return () => clearTimeout(id);
  }, [code]);

  const close = () => { diagramDialog.value = null; };
  const insert = () => {
    const view = getView();
    if (!view || !target) return close();
    const block = `\`\`\`mermaid\n${code.trimEnd()}\n\`\`\``;
    if (target.from !== undefined && target.to !== undefined) {
      view.dispatch({ changes: { from: target.from, to: target.to, insert: block } });
    } else {
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const blank = line.text.trim() === '';
      view.dispatch({
        changes: blank ? { from: line.from, to: line.to, insert: block } : { from: line.to, insert: `\n\n${block}` },
      });
    }
    close();
    view.focus();
  };

  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="dialog diagram" onKeyDown={(e) => {
        if (e.key === 'Escape') close();
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) insert();
      }}>
        <header>
          <strong>{editing ? 'Editar diagrama' : 'Inserir diagrama'}</strong>
          <select aria-label="Modelo" onChange={(e) => {
            const t = mermaidTemplates.find((x) => x.id === e.currentTarget.value);
            if (t) setCode(t.code);
            e.currentTarget.value = '';
          }}>
            <option value="">Usar modelo…</option>
            {mermaidTemplates.map((t) => <option value={t.id} key={t.id}>{t.name}</option>)}
          </select>
        </header>
        <div class="diagram-body">
          <textarea ref={area} value={code} spellcheck={false} onInput={(e) => setCode(e.currentTarget.value)} />
          <div class="diagram-view">
            {!result && <p class="muted">Desenhando…</p>}
            {result && 'svg' in result && <div class="mermaid-out" dangerouslySetInnerHTML={{ __html: result.svg }} />}
            {result && 'error' in result && <div class="mermaid-error"><strong>Diagrama com erro</strong><pre>{result.error}</pre></div>}
          </div>
        </div>
        <div class="actions">
          <span class="muted">Ctrl+Enter {editing ? 'salva' : 'insere'}</span>
          <button type="button" class="btn" disabled={!result || !('svg' in result)} onClick={() => result && 'svg' in result && void import('../../export/exporters.ts').then((m) => m.downloadSvg(result.svg))}>Baixar SVG</button>
          <button type="button" class="btn" disabled={!result || !('svg' in result)} onClick={() => result && 'svg' in result && void import('../../export/exporters.ts').then((m) => m.downloadPng(result.svg))}>Baixar PNG</button>
          <button type="button" class="btn" onClick={close}>Cancelar</button>
          <button type="button" class="btn primary" onClick={insert}>{editing ? 'Salvar' : 'Inserir'}</button>
        </div>
      </div>
    </div>
  );
}
