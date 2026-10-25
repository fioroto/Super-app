import { useEffect } from 'preact/hooks';
import { Editor } from '../editor/Editor.tsx';
import { Preview } from '../preview/Preview.tsx';
import { DiagramDialog, diagramDialog, openDiagramDialog } from '../diagrams/mermaid/DiagramDialog.tsx';
import { Dialog } from './Dialog.tsx';
import { QuickOpen } from './QuickOpen.tsx';
import { Tree } from './Tree.tsx';
import { VaultPicker } from './VaultPicker.tsx';
import { applyTheme, cycleTheme, theme } from './theme.ts';
import {
  active, activePath, boot, closeFile, docs, error, keepMine, mode, newFolder, newNote, quickOpen, save, takeDisk, tree, vault,
} from './store.ts';
import { api } from '../api/client.ts';

const STATE_LABEL = { ok: 'salvo', dirty: 'editando…', saving: 'salvando…', conflict: 'conflito', error: 'erro' } as const;
const THEME_LABEL = { auto: 'Tema: sistema', light: 'Tema: claro', dark: 'Tema: escuro' } as const;

export function App() {
  useEffect(() => {
    applyTheme();
    boot().catch((e) => (error.value = e.message));
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); quickOpen.value = !quickOpen.value; }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); const p = activePath.value; if (p) void save(p); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (vault.value === undefined) return <main class="picker"><p class="muted">Carregando…</p></main>;
  if (vault.value === null) return <VaultPicker />;

  const d = active.value;
  const text = d && (d.kind === 'md' || d.kind === 'text');
  return (
    <div class="app">
      <aside class="sidebar">
        <header class="side-head">
          <strong title={vault.value.root}>{vault.value.name}</strong>
          <span class="side-tools">
            <button class="btn" onClick={newNote} title="Nova nota">+ Nota</button>
            <button class="btn" onClick={newFolder} title="Nova pasta">+ Pasta</button>
          </span>
        </header>
        {tree.value && <Tree root={tree.value} />}
        <footer class="side-foot">
          <button onClick={() => (quickOpen.value = true)}>Buscar (Ctrl+P)</button>
          <button onClick={cycleTheme}>{THEME_LABEL[theme.value]}</button>
        </footer>
      </aside>

      <section class="main">
        <div class="tabs" role="tablist">
          {docs.value.map((t) => (
            <div key={t.path} role="tab" class={`tab${t.path === activePath.value ? ' active' : ''}`} onClick={() => (activePath.value = t.path)} title={t.path}>
              <span>{t.path.slice(t.path.lastIndexOf('/') + 1)}</span>
              {t.state !== 'ok' && <i class={`dot ${t.state}`} />}
              <button title="Fechar" onClick={(e) => { e.stopPropagation(); void closeFile(t.path); }}>×</button>
            </div>
          ))}
        </div>

        {d ? (
          <>
            <header class="bar">
              <span class="muted">{d.path}</span>
              {text && d.kind === 'md' && <button class="btn" onClick={openDiagramDialog} title="Inserir ou editar diagrama Mermaid">Diagrama</button>}
              {text && d.kind === 'md' && (
                <span class="seg">
                  {(['editor', 'split', 'preview'] as const).map((m) => (
                    <button class={mode.value === m ? 'on' : ''} onClick={() => (mode.value = m)}>{{ editor: 'Editar', split: 'Dividido', preview: 'Ler' }[m]}</button>
                  ))}
                </span>
              )}
              <span class={`status ${d.state}`}>{STATE_LABEL[d.state]}</span>
            </header>

            {d.state === 'conflict' && (
              <div class="banner">
                <span>Este arquivo mudou no disco enquanto você editava.</span>
                <button class="btn" onClick={() => keepMine(d.path)}>Manter a minha</button>
                <button class="btn" disabled={!d.disk} onClick={() => takeDisk(d.path)}>Carregar do disco</button>
              </div>
            )}
            {d.missing && <div class="banner"><span>O arquivo foi removido do disco. Salvar vai recriá-lo.</span></div>}

            {text ? (
              <div class={`panes ${d.kind === 'md' ? mode.value : 'editor'}`}>
                <div class="pane-edit"><Editor path={d.path} text={d.text} rev={d.rev} /></div>
                {d.kind === 'md' && mode.value !== 'editor' && <div class="pane-view"><Preview path={d.path} text={d.text} /></div>}
              </div>
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

      {quickOpen.value && <QuickOpen />}
      {diagramDialog.value && <DiagramDialog key={diagramDialog.value.from ?? -1} />}
      <Dialog />
    </div>
  );
}
