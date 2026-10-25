import { signal, type Signal } from '@preact/signals';
import { useEffect, useId, useRef, useState } from 'preact/hooks';

/** De onde vem o JSON: texto colado ou arquivo. Arquivo grande fica só na memória, fora da caixa de texto. */
export interface Source { text: Signal<string>; file: Signal<{ name: string; size: number } | null> }

export const source = (): Source => ({ text: signal(''), file: signal(null) });
export const clearSource = (s: Source): void => { s.text.value = ''; s.file.value = null; };
export function swapSources(a: Source, b: Source): void {
  [a.text.value, b.text.value] = [b.text.value, a.text.value];
  [a.file.value, b.file.value] = [b.file.value, a.file.value];
}

// Uma caixa de texto com dezenas de MB trava a página; acima disso, mostra só o nome do arquivo.
const SHOW_LIMIT = 2 * 1024 * 1024;
const MAX = 50 * 1024 * 1024;
const mb = (n: number) => `${(n / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;

/** Caixa de JSON: cola, solta um arquivo em cima ou abre pelo botão. */
export function JsonSource({ src, label, name, error, autofocus }: { src: Source; label: string; name: string; error: string | null; autofocus?: boolean }) {
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => { if (autofocus) area.current?.focus(); }, []);

  const load = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX) { setMsg(`Arquivo grande demais (${mb(f.size)}; o máximo é 50 MB).`); return; }
    setMsg('');
    src.text.value = await f.text();
    src.file.value = f.size > SHOW_LIMIT ? { name: f.name, size: f.size } : null;
  };
  const big = src.file.value;

  return (
    <div role="group" aria-labelledby={id} class={`tool-side json-source${over ? ' over' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={(e) => {
        if (!e.dataTransfer?.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        void load(e.dataTransfer.files[0]);
      }}>
      <span class="tool-label">
        <span id={id}>{label}</span>
        <button type="button" class="link-btn" title="Abrir um arquivo .json do computador (ou solte o arquivo na caixa)" onClick={() => picker.current?.click()}>Abrir arquivo…</button>
      </span>
      <input ref={picker} type="file" accept=".json,application/json,text/plain" hidden onChange={(e) => { void load(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
      {big ? (
        <div class="json-file">
          <span>{big.name} · {mb(big.size)}</span>
          <button type="button" class="btn" onClick={() => clearSource(src)}>Limpar</button>
        </div>
      ) : (
        <textarea ref={area} aria-label={name} wrap="off" spellcheck={false} placeholder="Cole o JSON aqui ou solte um arquivo .json."
          value={src.text.value} onInput={(e) => { src.text.value = e.currentTarget.value; }} />
      )}
      {(msg || error) && <p class="tool-err" role="alert">{msg || error}</p>}
    </div>
  );
}
