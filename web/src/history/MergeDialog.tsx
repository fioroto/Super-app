import { useEffect, useMemo, useState } from 'preact/hooks';
import { basename } from '../app/files.ts';
import { docs, mergeFor, resolveConflict } from '../app/store.ts';
import { DiffView } from './DiffView.tsx';
import { applyEdits, proseDiff, revertEdits } from './proseDiff.ts';
import { ProseDiffView, proseMode } from './ProseDiffView.tsx';

/** Conflito com o disco: em cada trecho, fica a versão do disco ou a do editor. O padrão é a do editor. */
export function MergeDialog() {
  const path = mergeFor.value!;
  const d = docs.value.find((x) => x.path === path);
  const close = () => { mergeFor.value = null; };
  const mode = proseMode(path);
  const disk = d?.disk?.content ?? '', mine = d?.text ?? '';
  const diff = useMemo(() => (mode ? proseDiff(disk, mine, mode) : null), [disk, mine, mode]);
  const [fromDisk, setFromDisk] = useState<ReadonlySet<number>>(new Set());

  // O disco mudou de novo: as escolhas antigas não valem mais.
  useEffect(() => { setFromDisk(new Set()); }, [d?.disk?.hash]);
  // O conflito foi resolvido por outro caminho (banner, recarregar): nada a escolher.
  useEffect(() => { if (!d?.disk) close(); }, [d?.disk]);
  if (!d?.disk) return null;

  const pick = (id: number, useDisk: boolean) => {
    const next = new Set(fromDisk);
    if (useDisk) next.add(id); else next.delete(id);
    setFromDisk(next);
  };
  const apply = () => {
    resolveConflict(path, diff ? applyEdits(mine, revertEdits(diff, fromDisk, mine)) : mine);
    close();
  };
  const total = diff?.changes.length ?? 0;

  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="dialog history merge" role="dialog" aria-label={`Conflito em ${basename(path)}`} onKeyDown={(e) => e.key === 'Escape' && close()} tabIndex={-1} ref={(el) => el?.focus()}>
        <header>
          <strong>Conflito em {basename(path)}</strong>
          {diff && total > 0 && (
            <span class="merge-all">
              <button type="button" class="btn" onClick={() => setFromDisk(new Set(diff.changes.map((c) => c.id)))}>Tudo do disco</button>
              <button type="button" class="btn" onClick={() => setFromDisk(new Set())}>Tudo meu</button>
            </span>
          )}
          <button class="btn" onClick={close}>Fechar</button>
        </header>
        <div class="history-diff">
          {diff ? (
            <ProseDiffView left={disk} right={mine} leftLabel="No disco" rightLabel="No editor (o meu)" path={path} diff={diff} actionsAt="end"
              actions={(c) => (
                <span class="pick" role="group" aria-label="Qual versão fica">
                  <button type="button" aria-pressed={fromDisk.has(c.id)} class={fromDisk.has(c.id) ? 'on' : ''} onClick={() => pick(c.id, true)}>Do disco</button>
                  <button type="button" aria-pressed={!fromDisk.has(c.id)} class={fromDisk.has(c.id) ? '' : 'on'} onClick={() => pick(c.id, false)}>O meu</button>
                </span>
              )} />
          ) : (
            <DiffView left={disk} right={mine} leftLabel="No disco" rightLabel="No editor (o meu)" />
          )}
        </div>
        <div class="actions">
          <span class="muted">
            {diff ? `Em cada trecho, escolha qual versão fica. ${fromDisk.size} de ${total} do disco.` : 'Neste tipo de arquivo, use "Manter a minha" ou "Carregar do disco" no aviso.'}
          </span>
          <button type="button" class="btn" onClick={close}>Cancelar</button>
          {diff && <button type="button" class="btn primary" onClick={apply}>Aplicar</button>}
        </div>
      </div>
    </div>
  );
}
