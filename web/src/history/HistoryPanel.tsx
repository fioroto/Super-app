import { useEffect, useState } from 'preact/hooks';
import { api, type Version } from '../api/client.ts';
import { basename } from '../app/files.ts';
import { docs, error, historyFor, reloadFromDisk } from '../app/store.ts';
import { DiffView } from './DiffView.tsx';

const when = (t: number) => new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

export function HistoryPanel() {
  const path = historyFor.value!;
  const current = docs.value.find((d) => d.path === path)?.text ?? '';
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [old, setOld] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => { historyFor.value = null; };

  useEffect(() => {
    api.history(path).then(({ versions: v }) => { setVersions(v); setSel(v[0]?.id ?? null); }, (e) => { error.value = e.message; close(); });
  }, [path]);
  useEffect(() => {
    setOld(null);
    if (sel) api.historyVersion(path, sel).then((r) => setOld(r.content), (e) => (error.value = e.message));
  }, [path, sel]);

  const restore = async () => {
    if (!sel || busy) return;
    setBusy(true);
    try {
      await api.restore(path, sel);
      await reloadFromDisk(path);
      close();
    } catch (e) {
      error.value = (e as Error).message;
      setBusy(false);
    }
  };

  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="dialog history" onKeyDown={(e) => e.key === 'Escape' && close()} tabIndex={-1} ref={(el) => el?.focus()}>
        <header>
          <strong>Histórico de {basename(path)}</strong>
          <button class="btn" onClick={close}>Fechar</button>
        </header>
        {versions && !versions.length ? (
          <p class="muted pad">Ainda não há versões anteriores. Elas aparecem depois que a nota é salva de novo.</p>
        ) : (
          <div class="history-body">
            <ul class="versions">
              {(versions ?? []).map((v) => (
                <li key={v.id} class={v.id === sel ? 'sel' : ''} onClick={() => setSel(v.id)}>
                  <span>{when(v.time)}</span><span class="muted">{kb(v.size)}</span>
                </li>
              ))}
            </ul>
            <div class="history-diff">
              {old === null ? <p class="muted pad">Carregando…</p> : (
                <DiffView left={old} right={current} leftLabel="Versão escolhida" rightLabel="Atual (no editor)" />
              )}
            </div>
          </div>
        )}
        <div class="actions">
          <span class="muted">Restaurar guarda o estado atual como uma versão nova antes de trocar.</span>
          <button class="btn primary" disabled={!sel || busy} onClick={restore}>Restaurar esta versão</button>
        </div>
      </div>
    </div>
  );
}
