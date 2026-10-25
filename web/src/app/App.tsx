import { useEffect } from 'preact/hooks';
import { Editor } from '../editor/Editor.tsx';
import { Toolbar } from '../editor/live/Toolbar.tsx';
import { Preview } from '../preview/Preview.tsx';
import { DiagramDialog, diagramDialog, openDiagramDialog } from '../diagrams/mermaid/DiagramDialog.tsx';
import { Canvas } from '../diagrams/canvas/Canvas.tsx';
import { KanbanBoard } from '../kanban/Board.tsx';
import { Dialog } from './Dialog.tsx';
import { IconBoard, IconDiagram, IconDraw, IconFolder, IconHistory, IconHtml, IconNote, IconPrint } from './icons.tsx';
import { useLazy } from './lazy.ts';
import { insertDrawing } from './insert.ts';
import { QuickOpen } from './QuickOpen.tsx';
import { Tree } from './Tree.tsx';
import { VaultPicker } from './VaultPicker.tsx';
import { applyTheme, cycleTheme, theme } from './theme.ts';
import {
  activate, active, activePath, boot, closeFile, docs, error, diffView, historyFor, keepMine, mode, newBoard, newDrawing, newFolder, newNote, openQuick, picker, save, takeDisk, tool, toggleRaw, tree, vault,
} from './store.ts';
import { api } from '../api/client.ts';

function LazyHistory() {
  const m = useLazy(() => import('../history/HistoryPanel.tsx'));
  return m ? <m.HistoryPanel /> : null;
}
function LazyDiff() {
  const m = useLazy(() => import('../history/DiffDialog.tsx'));
  return m ? <m.DiffDialog /> : null;
}

function LazyTool() {
  const m = useLazy(() => import('../tools/ToolDialog.tsx'));
  return m ? <m.ToolDialog /> : null;
}

/** Imprime só a nota: passa para o modo "Ler" e volta ao que estava. */
function printNote() {
  const before = mode.value;
  mode.value = 'preview';
  addEventListener('afterprint', () => { mode.value = before; }, { once: true });
  setTimeout(() => print(), 150);
}

const STATE_LABEL = { ok: 'salvo', dirty: 'editando…', saving: 'salvando…', conflict: 'conflito', error: 'erro' } as const;
const THEME_LABEL = { auto: 'Tema: sistema', light: 'Tema: claro', dark: 'Tema: escuro' } as const;

export function App() {
  useEffect(() => {
    applyTheme();
    boot().catch((e) => (error.value = e.message));
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); if (picker.value) picker.value = null; else openQuick(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); const p = activePath.value; if (p) void save(p); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (vault.value === undefined) return <main class="picker"><p class="muted">Carregando…</p></main>;
  if (vault.value === null) return <VaultPicker />;

  const d = active.value;
  const board = d?.kind === 'kanban' && !d.raw;
  const text = d && (d.kind === 'md' || d.kind === 'text' || (d.kind === 'kanban' && d.raw));
  return (
    <div class="app">
      <aside class="sidebar">
        <header class="side-head">
          <strong title={vault.value.root}>{vault.value.name}</strong>
          <span class="side-tools">
            <button class="btn create icon" onClick={newNote} aria-label="+ Nota" title="Nova nota"><IconNote /></button>
            <button class="btn create icon" onClick={newBoard} aria-label="+ Quadro" title="Novo quadro kanban"><IconBoard /></button>
            <button class="btn create icon" onClick={newDrawing} aria-label="+ Desenho" title="Novo desenho livre"><IconDraw /></button>
            <button class="btn create icon" onClick={newFolder} aria-label="+ Pasta" title="Nova pasta"><IconFolder /></button>
          </span>
        </header>
        {tree.value && <Tree root={tree.value} />}
        <footer class="side-foot">
          <div class="side-foot-tools">
            <button onClick={() => (tool.value = 'json')} title="Comparar dois JSON pelo conteúdo">Comparar JSON</button>
            <button onClick={() => (tool.value = 'table')} title="Transformar um JSON (colado ou arquivo arrastado) em tabela Markdown ou de planilha">JSON → tabela</button>
            <button onClick={() => (tool.value = 'sheet')} title="Transformar células copiadas de uma planilha em tabela Markdown">Planilha → tabela</button>
          </div>
          <button onClick={openQuick}>Buscar (Ctrl+P)</button>
          <button onClick={cycleTheme}>{THEME_LABEL[theme.value]}</button>
        </footer>
      </aside>

      <section class="main">
        <div class="tabs" role="tablist">
          {docs.value.map((t) => (
            <div key={t.path} role="tab" class={`tab${t.path === activePath.value ? ' active' : ''}`} onClick={() => void activate(t.path)} title={t.path}>
              <span>{t.path.slice(t.path.lastIndexOf('/') + 1)}</span>
              {t.state !== 'ok' && <i class={`dot ${t.state}`} />}
              <button title="Fechar" onClick={(e) => { e.stopPropagation(); void closeFile(t.path); }}>×</button>
            </div>
          ))}
        </div>

        {d ? (
          <>
            <header class="bar">
              <span class="bar-path muted" title={d.path}>{d.path}</span>
              <span class="bar-mode">
                {text && d.kind === 'md' && (
                  <span class="seg">
                    {(['doc', 'editor', 'split'] as const).map((m) => (
                      <button class={mode.value === m ? 'on' : ''} onClick={() => (mode.value = m)}>{{ doc: 'Documento', editor: 'Código', split: 'Dividido' }[m]}</button>
                    ))}
                  </span>
                )}
                {d.kind === 'kanban' && (
                  <span class="seg">
                    <button class={!d.raw ? 'on' : ''} onClick={() => d.raw && toggleRaw(d.path)}>Quadro</button>
                    <button class={d.raw ? 'on' : ''} onClick={() => !d.raw && toggleRaw(d.path)}>Texto</button>
                  </span>
                )}
              </span>
              <span class="bar-actions">
                {text && d.kind === 'md' && (
                  <>
                    <button class="icon-btn" onClick={openDiagramDialog} aria-label="Diagrama" title="Inserir ou editar diagrama Mermaid"><IconDiagram /></button>
                    <button class="icon-btn" onClick={insertDrawing} aria-label="Desenho" title="Inserir um desenho livre na nota"><IconDraw /></button>
                    <button class="icon-btn" onClick={() => void import('../export/exporters.ts').then((m) => m.exportHtml(d.path, d.text)).catch((e) => (error.value = e.message))} aria-label="HTML" title="Baixar a nota como uma página HTML única"><IconHtml /></button>
                    <button class="icon-btn" onClick={printNote} aria-label="PDF" title="Imprimir ou salvar como PDF"><IconPrint /></button>
                  </>
                )}
                {(d.kind === 'md' || d.kind === 'text') && <button class="icon-btn" onClick={() => (historyFor.value = d.path)} aria-label="Histórico" title="Ver e restaurar versões anteriores"><IconHistory /></button>}
                <span class={`status ${d.state}`}>{STATE_LABEL[d.state]}</span>
              </span>
            </header>

            {d.state === 'conflict' && (
              <div class="banner">
                <span>Este arquivo mudou no disco enquanto você editava.</span>
                <button class="btn" onClick={() => keepMine(d.path)}>Manter a minha</button>
                <button class="btn" disabled={!d.disk} onClick={() => d.disk && (diffView.value = { title: `Diferença em ${d.path}`, path: d.path, left: d.disk.content, right: d.text, leftLabel: 'No disco', rightLabel: 'No editor (a minha)' })}>Ver diferença</button>
                <button class="btn" disabled={!d.disk} onClick={() => takeDisk(d.path)}>Carregar do disco</button>
              </div>
            )}
            {d.missing && <div class="banner"><span>O arquivo foi removido do disco. Salvar vai recriá-lo.</span></div>}

            {board ? (
              <KanbanBoard path={d.path} text={d.text} />
            ) : text ? (
              <>
              {d.kind === 'md' && mode.value !== 'preview' && <Toolbar />}
              <div class={`panes ${d.kind === 'md' ? mode.value : 'editor'}`}>
                <div class="pane-edit"><Editor path={d.path} text={d.text} rev={d.rev} live={d.kind === 'md' && mode.value === 'doc'} md={d.kind === 'md'} /></div>
                {d.kind === 'md' && (mode.value === 'split' || mode.value === 'preview') && <div class="pane-view"><Preview path={d.path} text={d.text} /></div>}
              </div>
              </>
            ) : d.kind === 'canvas' ? (
              <Canvas key={d.rev} path={d.path} text={d.text} />
            ) : d.kind === 'image' ? (
              <div class="imgview"><img src={api.rawUrl(d.path)} alt={d.path} /></div>
            ) : (
              <p class="muted empty">Este tipo de arquivo não abre aqui.</p>
            )}
          </>
        ) : (
          <p class="muted empty">Escolha um arquivo na barra lateral ou aperte Ctrl+P.</p>
        )}
        {error.value && <p class="err" onClick={() => (error.value = null)}>{error.value}</p>}
      </section>

      {picker.value && <QuickOpen />}
      {diagramDialog.value && <DiagramDialog key={diagramDialog.value.from ?? -1} />}
      {historyFor.value && <LazyHistory />}
      {diffView.value && <LazyDiff />}
      {tool.value && <LazyTool />}
      <Dialog />
    </div>
  );
}
