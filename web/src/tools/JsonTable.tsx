import { signal } from '@preact/signals';
import { useMemo } from 'preact/hooks';
import { parseJson, problem } from './jsonDiff.ts';
import { buildTable, defaultLevel, findLevels } from './jsonTable.ts';
import { clearSource, JsonSource, source } from './JsonSource.tsx';
import { rightColumns, toMarkdownTable, toTsv } from './sheet.ts';
import { ToolActions } from './ToolActions.tsx';

// O rascunho fica guardado enquanto o app está aberto.
const src = source();
const levelKey = signal<string | null>(null);
/** Colunas desmarcadas, pelo nome: sobrevivem à troca de nível. */
const hidden = signal<ReadonlySet<string>>(new Set());
const pad = signal(true);

const PREVIEW_ROWS = 200;
const TEXT_ROWS = 2000;

export function JsonTable({ close }: { close: () => void }) {
  const parsed = useMemo(() => (src.text.value.trim() ? parseJson(src.text.value) : null), [src.text.value]);
  const levels = useMemo(() => (parsed?.ok ? findLevels(parsed.value) : []), [parsed]);
  const level = levels.find((l) => l.key === levelKey.value) ?? defaultLevel(levels);
  const table = useMemo(() => (parsed?.ok && level ? buildTable(parsed.value, level) : null), [parsed, level?.key]);

  const view = useMemo(() => {
    if (!table) return null;
    const keep = table.columns.map((c, i) => [c, i] as const).filter(([c]) => !hidden.value.has(c));
    const columns = keep.map(([c]) => c);
    const rows = table.rows.map((r) => keep.map(([, i]) => r[i]!));
    return { columns, rows, right: rightColumns([columns, ...rows], { header: true, alignNumbers: true }) };
  }, [table, hidden.value]);

  const out = useMemo(() => {
    if (!view?.columns.length) return null;
    const opts = { header: true, pad: pad.value, alignNumbers: true };
    const markdown = toMarkdownTable([view.columns, ...view.rows], opts);
    // Muitas linhas: a caixa mostra o começo; copiar e salvar levam tudo.
    const shown = view.rows.length > TEXT_ROWS ? toMarkdownTable([view.columns, ...view.rows.slice(0, TEXT_ROWS)], opts) : markdown;
    return { markdown, shown, tsv: toTsv([view.columns, ...view.rows]) };
  }, [view, pad.value]);

  const toggle = (c: string, on: boolean) => {
    const next = new Set(hidden.value);
    if (on) next.delete(c); else next.add(c);
    hidden.value = next;
  };
  const n = view?.rows.length ?? 0;
  const hint = !view ? '' : `${n} ${n === 1 ? 'linha' : 'linhas'} × ${view.columns.length} ${view.columns.length === 1 ? 'coluna' : 'colunas'}`;

  return (
    <>
      <JsonSource src={src} label="Entrada" name="JSON" error={problem(parsed)} autofocus />

      <div class="tool-opts">
        <label class="inline">Uma linha por
          <select value={level?.key ?? ''} disabled={!levels.length} onChange={(e) => { levelKey.value = e.currentTarget.value; }}>
            {levels.map((l) => <option key={l.key} value={l.key}>{l.segments ? `${l.label} (${l.count})` : `${l.label} (Campo | Valor)`}</option>)}
          </select>
        </label>
        <label class="inline"><input type="checkbox" checked={pad.value} onChange={(e) => { pad.value = e.currentTarget.checked; }} />Alinhar as colunas no texto</label>
        <button type="button" class="btn" disabled={!src.text.value} onClick={() => { clearSource(src); levelKey.value = null; }}>Limpar</button>
      </div>

      {table && table.columns.length > 0 && (
        <details class="tool-cols">
          <summary>Colunas: {view!.columns.length} de {table.columns.length}</summary>
          <div class="tool-cols-actions">
            <button type="button" class="btn" onClick={() => { hidden.value = new Set(); }}>Todas</button>
            <button type="button" class="btn" onClick={() => { hidden.value = new Set(table.columns); }}>Nenhuma</button>
          </div>
          <div class="tool-cols-list">
            {table.columns.map((c) => (
              <label class="inline" key={c}><input type="checkbox" checked={!hidden.value.has(c)} onChange={(e) => toggle(c, e.currentTarget.checked)} />{c}</label>
            ))}
          </div>
        </details>
      )}

      <div class="tool-grid json-out">
        <div class="tool-result preview tool-preview" aria-label="Como a tabela fica">
          {!parsed || !parsed.ok ? <p class="muted">A tabela aparece aqui.</p>
            : !levels.length ? <p class="muted">Este JSON é um valor só; não há o que pôr em tabela.</p>
            : !view?.columns.length ? <p class="muted">{table?.columns.length ? 'Nenhuma coluna marcada.' : 'Esta lista está vazia.'}</p>
            : (
              <table>
                <thead><tr>{view.columns.map((c, i) => <th key={c} class={view.right[i] ? 'r' : ''}>{c}</th>)}</tr></thead>
                <tbody>{view.rows.slice(0, PREVIEW_ROWS).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} class={view.right[j] ? 'r' : ''} title={v.length > 40 ? v : undefined}>{v}</td>)}</tr>)}</tbody>
              </table>
            )}
          {n > PREVIEW_ROWS && <p class="muted">Mostrando as primeiras {PREVIEW_ROWS} linhas.</p>}
        </div>
        <div class="tool-side">
          <textarea aria-label="Tabela Markdown" readOnly wrap="off" spellcheck={false} value={out?.shown ?? ''} />
          {n > TEXT_ROWS && <span class="tool-label">A caixa mostra {TEXT_ROWS} de {n} linhas. Copiar e salvar levam todas.</span>}
        </div>
      </div>

      <ToolActions markdown={out?.markdown ?? ''} tsv={out?.tsv ?? ''} disabled={!out} close={close} hint={hint} />
    </>
  );
}
