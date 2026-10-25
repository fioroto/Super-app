import { useEffect, useState } from 'preact/hooks';
import { api, type DirList } from '../api/client.ts';
import { chooseVault, error, recents } from './store.ts';

export function VaultPicker() {
  const [list, setList] = useState<DirList | null>(null);
  const go = (p: string) => api.dirs(p).then(setList, (e) => (error.value = e.message));
  useEffect(() => void go(''), []);

  return (
    <main class="picker">
      <h1>Escolha a pasta das suas notas</h1>
      <p class="muted">Tudo fica em arquivos Markdown dentro dela. Uma pasta nova e vazia também serve.</p>
      {recents.value.length > 0 && (
        <section>
          <h2>Recentes</h2>
          {recents.value.map((r) => (
            <button class="row" onClick={() => chooseVault(r)}>{r}</button>
          ))}
        </section>
      )}
      {list && (
        <section>
          <h2>{list.path || 'Unidades'}</h2>
          {list.path && (
            <button class="btn primary" onClick={() => chooseVault(list.path)}>Usar esta pasta</button>
          )}
          {list.parent !== null && <button class="row" onClick={() => go(list.parent!)}>↑ ..</button>}
          {list.dirs.map((d) => (
            <button class="row" onClick={() => go(list.path ? `${list.path.replace(/[\\/]$/, '')}${list.path.includes('\\') ? '\\' : '/'}${d}` : d)}>
              📁 {d}
            </button>
          ))}
        </section>
      )}
      {error.value && <p class="err">{error.value}</p>}
    </main>
  );
}
