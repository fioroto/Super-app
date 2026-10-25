import { useEffect } from 'preact/hooks';
import { Tree } from './Tree.tsx';
import { VaultPicker } from './VaultPicker.tsx';
import { boot, doc, edit, error, tree, vault } from './store.ts';

export function App() {
  useEffect(() => void boot().catch((e) => (error.value = e.message)), []);

  if (vault.value === undefined) return <main class="picker"><p class="muted">Carregando…</p></main>;
  if (vault.value === null) return <VaultPicker />;

  const d = doc.value;
  return (
    <div class="app">
      <aside class="sidebar">
        <header class="side-head">{vault.value.name}</header>
        {tree.value && <Tree root={tree.value} />}
      </aside>
      <section class="main">
        {d ? (
          <>
            <header class="bar">
              <span>{d.path}</span>
              <span class={`status ${d.state}`}>{{ ok: 'salvo', dirty: 'editando…', saving: 'salvando…', conflict: 'conflito', error: 'erro' }[d.state]}</span>
            </header>
            <textarea class="raw" value={d.text} onInput={(e) => edit(e.currentTarget.value)} spellcheck={false} />
          </>
        ) : (
          <p class="muted empty">Escolha um arquivo na barra lateral.</p>
        )}
        {error.value && <p class="err">{error.value}</p>}
      </section>
    </div>
  );
}
