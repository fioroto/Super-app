import { signal } from '@preact/signals';
import { useMemo, useState } from 'preact/hooks';
import { DiffView } from '../history/DiffView.tsx';
import { canonical, changesToMarkdown, compareJson, KIND_LABEL, parseJson, problem, show, summary } from './jsonDiff.ts';
import { clearSource, JsonSource, source, swapSources } from './JsonSource.tsx';
import { ToolActions } from './ToolActions.tsx';

// O rascunho fica guardado enquanto o app está aberto.
const left = source();
const right = source();
const unordered = signal(false);

const MAX_ROWS = 500;

export function JsonCompare({ close }: { close: () => void }) {
  const [tab, setTab] = useState<'list' | 'side'>('list');
  const a = useMemo(() => (left.text.value.trim() ? parseJson(left.text.value) : null), [left.text.value]);
  const b = useMemo(() => (right.text.value.trim() ? parseJson(right.text.value) : null), [right.text.value]);
  const opts = { unorderedArrays: unordered.value };
  const result = useMemo(() => {
    if (!a?.ok || !b?.ok) return null;
    const changes = compareJson(a.value, b.value, opts);
    return { changes, markdown: changesToMarkdown(changes), a: canonical(a.value, opts, '  '), b: canonical(b.value, opts, '  ') };
  }, [a, b, unordered.value]);

  return (
    <>
      <div class="tool-grid">
        <JsonSource src={left} label="A (original)" name="JSON A" error={problem(a)} autofocus />
        <JsonSource src={right} label="B (novo)" name="JSON B" error={problem(b)} />
      </div>

      <div class="tool-opts">
        <label class="inline"><input type="checkbox" checked={unordered.value} onChange={(e) => { unordered.value = e.currentTarget.checked; }} />Ignorar a ordem dos itens dos arrays</label>
        <button type="button" class="btn" onClick={() => swapSources(left, right)}>Trocar A e B</button>
        <button type="button" class="btn" disabled={!left.text.value && !right.text.value} onClick={() => { clearSource(left); clearSource(right); }}>Limpar</button>
        {result && (
          <span class="seg" role="tablist">
            <button role="tab" aria-selected={tab === 'list'} class={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>Diferenças</button>
            <button role="tab" aria-selected={tab === 'side'} class={tab === 'side' ? 'on' : ''} onClick={() => setTab('side')}>Lado a lado</button>
          </span>
        )}
      </div>

      <div class="tool-result">
        {!result ? (
          <p class="muted pad">{!a && !b ? 'Cole um JSON em cada lado para comparar.' : !a || !b ? `Falta o JSON do lado ${a ? 'B' : 'A'}.` : 'Corrija o JSON com erro para comparar.'}</p>
        ) : tab === 'side' ? (
          <DiffView left={result.a} right={result.b} leftLabel="A" rightLabel="B" />
        ) : !result.changes.length ? (
          <p class="pad">Os dois JSON têm o mesmo conteúdo.</p>
        ) : (
          <table class="changes">
            <thead><tr><th>Caminho</th><th>Diferença</th><th>A</th><th>B</th></tr></thead>
            <tbody>
              {result.changes.slice(0, MAX_ROWS).map((c, i) => (
                <tr key={i} class={`k-${c.kind}`}>
                  <td>{c.path}</td>
                  <td>{KIND_LABEL[c.kind]}</td>
                  <td>{c.kind === 'added' ? '—' : show(c.before)}</td>
                  <td>{c.kind === 'removed' ? '—' : show(c.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {result && tab === 'list' && result.changes.length > MAX_ROWS && <p class="muted pad">Mostrando as primeiras {MAX_ROWS} de {result.changes.length}. O Markdown tem todas.</p>}
      </div>

      <ToolActions markdown={result?.markdown ?? ''} disabled={!result} close={close} hint={result ? summary(result.changes) : ''} />
    </>
  );
}
