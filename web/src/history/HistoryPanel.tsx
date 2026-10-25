import { useEffect, useRef, useState } from 'preact/hooks';
import { api, type Version } from '../api/client.ts';
import { ask } from '../app/dialog.ts';
import { basename } from '../app/files.ts';
import { IconDraw } from '../app/icons.tsx';
import { docs, error, flush, historyFor, reloadFromDisk } from '../app/store.ts';
import { getView } from '../editor/Editor.tsx';
import { IconRevert } from './diffIcons.tsx';
import { revertEdits, type Change, type ProseDiff } from './proseDiff.ts';
import { DiffView } from './DiffView.tsx';
import { ProseDiffView, proseMode } from './ProseDiffView.tsx';

const when = (t: number) => new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const countWords = (s: string) => s.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
const delta = (n: number | null) => (n === null ? '' : n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');
const titleOf = (v: Version) => (v.name ? `⚑ ${v.name} (${when(v.time)})` : when(v.time));

/**
 * Linha do tempo de um arquivo: versões automáticas e marcos (versões com nome, como um commit).
 * À esquerda escolhe-se uma versão; o seletor escolhe com o que comparar (o agora ou outra versão).
 */
export function HistoryPanel() {
  const path = historyFor.value!;
  const doc = docs.value.find((d) => d.path === path);
  const current = doc?.text ?? '';
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [other, setOther] = useState(''); // '' = agora, no editor
  const contents = useRef(new Map<string, string>());
  const [, loaded] = useState(0);
  const [busy, setBusy] = useState(false);

  const close = () => { historyFor.value = null; };
  const refresh = async (select?: string) => {
    const { versions: v } = await api.history(path);
    setVersions(v);
    setSel((s) => select ?? (s && v.some((x) => x.id === s) ? s : v[0]?.id ?? null));
  };

  useEffect(() => { refresh().catch((e) => { error.value = (e as Error).message; close(); }); }, [path]);
  useEffect(() => {
    for (const id of [sel, other]) {
      if (!id || contents.current.has(id)) continue;
      api.historyVersion(path, id).then((r) => { contents.current.set(id, r.content); loaded((n) => n + 1); }, (e) => (error.value = e.message));
    }
  }, [path, sel, other]);

  const left = sel ? contents.current.get(sel) ?? null : null;
  const right = other ? contents.current.get(other) ?? null : current;
  const selVersion = versions?.find((v) => v.id === sel);
  const otherVersion = versions?.find((v) => v.id === other);

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

  /** Grava a nota e guarda o estado atual como um marco com nome. */
  const mark = async () => {
    const name = await ask('Nome do marco (por exemplo: "Enviado ao jurídico")', '');
    if (!name) return;
    try {
      await flush(path);
      const { version } = await api.mark(path, name);
      await refresh(version.id);
      setOther('');
    } catch (e) { error.value = (e as Error).message; }
  };

  const rename = async (v: Version) => {
    const name = await ask(v.name ? 'Nome do marco (vazio tira o nome)' : 'Nome do marco', v.name ?? '');
    if (name === null || name === (v.name ?? '')) return;
    try {
      await api.label(path, v.id, name);
      await refresh();
    } catch (e) { error.value = (e as Error).message; }
  };

  /** Volta um trecho na nota aberta, como uma edição comum: o Ctrl+Z desfaz e o salvamento automático grava. */
  const revert = (c: Change, diff: ProseDiff) => {
    const view = getView();
    if (!view || view.state.doc.toString() !== current) { error.value = 'A nota mudou enquanto a comparação abria. Tente de novo.'; return; }
    view.dispatch({ changes: revertEdits(diff, [c.id], current).map(({ from, to, insert }) => ({ from, to, insert })), userEvent: 'input' });
  };

  const leftLabel = selVersion ? titleOf(selVersion) : 'Versão escolhida';
  const rightLabel = otherVersion ? titleOf(otherVersion) : 'Agora (no editor)';
  const mode = proseMode(path);

  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="dialog history" onKeyDown={(e) => e.key === 'Escape' && close()} tabIndex={-1} ref={(el) => el?.focus()}>
        <header>
          <strong>Histórico de {basename(path)}</strong>
          <span class="history-tools">
            <button class="btn" disabled={doc?.state === 'conflict'} title={doc?.state === 'conflict' ? 'Resolva o conflito antes de marcar' : 'Guardar o estado atual com um nome, que a limpeza automática nunca apaga'} onClick={() => void mark()}>Marcar versão…</button>
            <button class="btn" onClick={close}>Fechar</button>
          </span>
        </header>
        {versions && !versions.length ? (
          <p class="muted pad">Ainda não há versões anteriores. Elas aparecem depois que a nota é salva de novo, ou quando você marca uma versão.</p>
        ) : (
          <div class="history-body">
            <div class="timeline">
              <div class="history-now"><span>Agora</span><span class="muted">{versions?.[0] ? delta(countWords(current) - versions[0].words) : ''}</span></div>
              <ul class="versions">
                {(versions ?? []).map((v, i) => (
                  <li key={v.id} class={`${v.id === sel ? 'sel' : ''}${v.name ? ' marco' : ''}`} onClick={() => { setSel(v.id); if (v.id === other) setOther(''); }}>
                    <span class="v-main">
                      {v.name ? <><b>⚑ {v.name}</b><small>{when(v.time)}</small></> : <span>{when(v.time)}</span>}
                    </span>
                    <span class="v-side">
                      <span class="muted" title="Palavras a mais ou a menos que a versão anterior">{delta(versions![i + 1] ? v.words - versions![i + 1]!.words : null)}</span>
                      <button type="button" class="icon-btn" aria-label={`Nome da versão de ${when(v.time)}`} title={v.name ? 'Trocar ou tirar o nome' : 'Dar um nome (vira marco)'} onClick={(e) => { e.stopPropagation(); void rename(v); }}><IconDraw /></button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div class="history-right">
              <label class="compare-bar">
                <span>Comparar <b>{leftLabel}</b> com</span>
                <select value={other} onChange={(e) => setOther(e.currentTarget.value)}>
                  <option value="">Agora (no editor)</option>
                  {(versions ?? []).filter((v) => v.id !== sel).map((v) => <option key={v.id} value={v.id}>{titleOf(v)}</option>)}
                </select>
              </label>
              <div class="history-diff">
                {left === null || right === null ? <p class="muted pad">Carregando…</p> : mode ? (
                  <ProseDiffView left={left} right={right} leftLabel={leftLabel} rightLabel={rightLabel} path={path}
                    actions={other ? undefined : (c, diff) => <button type="button" class="icon-btn" aria-label="Voltar este trecho" title="Voltar este trecho para a versão da esquerda (Ctrl+Z na nota desfaz)" onClick={() => revert(c, diff)}><IconRevert /></button>} />
                ) : (
                  <DiffView left={left} right={right} leftLabel={leftLabel} rightLabel={rightLabel} />
                )}
              </div>
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
