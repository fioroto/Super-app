import { signal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { DiffView } from '../history/DiffView.tsx';
import { canonical, changesToMarkdown, compareJson, KIND_LABEL, parseJson, show, summary, type ParseResult } from './jsonDiff.ts';
import { ToolActions } from './ToolActions.tsx';

// O rascunho fica guardado enquanto o app está aberto.
const left = signal('');
const right = signal('');
const unordered = signal(false);

const MAX_ROWS = 500;

function problem(r: ParseResult | null): string | null {
  if (!r || r.ok) return null;
  return r.line ? `JSON inválido na linha ${r.line}, coluna ${r.column}: ${r.message}.` : `JSON inválido: ${r.message}`;
}

export function JsonCompare({ close }: { close: () => void }) {
  const [tab, setTab] = useState<'list' | 'side'>('list');
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { first.current?.focus(); }, []);

  const a = useMemo(() => (left.value.trim() ? parseJson(left.value) : null), [left.value]);
  const b = useMemo(() => (right.value.trim() ? parseJson(right.value) : null), [right.value]);
  const opts = { unorderedArrays: unordered.value };
  const result = useMemo(() => {
    if (!a?.ok || !b?.ok) return null;
    const changes = compareJson(a.value, b.value, opts);
    return { changes, markdown: changesToMarkdown(changes), a: canonical(a.value, opts, '  '), b: canonical(b.value, opts, '  ') };
  }, [a, b, unordered.value]);

  const side = (label: string, aria: string, sig: typeof left, parsed: ParseResult | null, ref?: typeof first) => (
    <div class="tool-side">
      <span class="tool-label">{label}</span>
      <textarea ref={ref} aria-label={aria} wrap="off" spellcheck={false} placeholder="Cole o JSON aqui." value={sig.value} onInput={(e) => { sig.value = e.currentTarget.value; }} />
      {problem(parsed) && <p class="tool-err" role="alert">{problem(parsed)}</p>}
    </div>
  );

  return (
    <>
      <div class="tool-grid">
        {side('A (original)', 'JSON A', left, a, first)}
        {side('B (novo)', 'JSON B', right, b)}
      </div>

      <div class="tool-opts">
        <label class="inline"><input type="checkbox" checked={unordered.value} onChange={(e) => { unordered.value = e.currentTarget.checked; }} />Ignorar a ordem dos itens dos arrays</label>
        <button type="button" class="btn" onClick={() => { [left.value, right.value] = [right.value, left.value]; }}>Trocar A e B</button>
        <button type="button" class="btn" disabled={!left.value && !right.value} onClick={() => { left.value = ''; right.value = ''; first.current?.focus(); }}>Limpar</button>
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
