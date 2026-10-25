import { signal } from '@preact/signals';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { parseSheet, rightColumns, toMarkdownTable, type Delimiter } from './sheet.ts';
import { ToolActions } from './ToolActions.tsx';

// O rascunho fica guardado enquanto o app está aberto: fechar a janela sem querer não perde o que foi colado.
const text = signal('');
const delimiter = signal<Delimiter>('auto');
const header = signal(true);
const pad = signal(true);
const alignNumbers = signal(true);

const PREVIEW_ROWS = 200;

export function SheetToMarkdown({ close }: { close: () => void }) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const rows = useMemo(() => parseSheet(text.value, delimiter.value), [text.value, delimiter.value]);
  const markdown = useMemo(() => toMarkdownTable(rows, { header: header.value, pad: pad.value, alignNumbers: alignNumbers.value }), [rows, header.value, pad.value, alignNumbers.value]);
  const right = useMemo(() => rightColumns(rows, { header: header.value, alignNumbers: alignNumbers.value }), [rows, header.value, alignNumbers.value]);
  const head = header.value ? rows[0] : undefined;
  const body = header.value ? rows.slice(1) : rows;
  const cols = rows[0]?.length ?? 0;

  return (
    <>
      <div class="tool-grid">
        <div class="tool-side">
          <span class="tool-label">Células copiadas</span>
          <textarea ref={input} aria-label="Células da planilha" wrap="off" spellcheck={false} placeholder="Copie as células na planilha (Ctrl+C) e cole aqui (Ctrl+V)."
            value={text.value} onInput={(e) => { text.value = e.currentTarget.value; }} />
        </div>
        <div class="tool-side">
          <span class="tool-label">Tabela Markdown</span>
          <textarea aria-label="Tabela Markdown" readOnly wrap="off" spellcheck={false} value={markdown} />
        </div>
      </div>

      <div class="tool-opts">
        <label class="inline">Separador
          <select value={delimiter.value} onChange={(e) => { delimiter.value = e.currentTarget.value as Delimiter; }}>
            <option value="auto">Automático</option>
            <option value="tab">Tabulação (planilhas)</option>
            <option value=";">Ponto e vírgula</option>
            <option value=",">Vírgula</option>
          </select>
        </label>
        <label class="inline"><input type="checkbox" checked={header.value} onChange={(e) => { header.value = e.currentTarget.checked; }} />Primeira linha é o cabeçalho</label>
        <label class="inline"><input type="checkbox" checked={pad.value} onChange={(e) => { pad.value = e.currentTarget.checked; }} />Alinhar as colunas no texto</label>
        <label class="inline"><input type="checkbox" checked={alignNumbers.value} onChange={(e) => { alignNumbers.value = e.currentTarget.checked; }} />Números à direita</label>
        <button type="button" class="btn" disabled={!text.value} onClick={() => { text.value = ''; input.current?.focus(); }}>Limpar</button>
      </div>

      <div class="tool-result preview tool-preview" aria-label="Como a tabela fica">
        {!rows.length ? <p class="muted">A tabela aparece aqui.</p> : (
          <table>
            <thead><tr>{(head ?? Array<string>(cols).fill('')).map((h, i) => <th key={i} class={right[i] ? 'r' : ''}>{h}</th>)}</tr></thead>
            <tbody>{body.slice(0, PREVIEW_ROWS).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} class={right[j] ? 'r' : ''}>{c}</td>)}</tr>)}</tbody>
          </table>
        )}
        {body.length > PREVIEW_ROWS && <p class="muted">Mostrando as primeiras {PREVIEW_ROWS} linhas. O Markdown tem todas.</p>}
      </div>

      <ToolActions markdown={markdown} disabled={!rows.length} close={close}
        hint={rows.length ? `${rows.length} ${rows.length === 1 ? 'linha' : 'linhas'} × ${cols} ${cols === 1 ? 'coluna' : 'colunas'}` : 'Cole as células para começar.'} />
    </>
  );
}
