import { useRef, useState } from 'preact/hooks';
import { insertBlock } from '../app/insert.ts';
import { active, createNote } from '../app/store.ts';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* sem permissão: tenta pelo caminho antigo */ }
  const back = document.activeElement as HTMLElement | null;
  const area = document.createElement('textarea');
  area.value = text;
  area.style.cssText = 'position:fixed;opacity:0';
  document.body.append(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  back?.focus();
  return ok;
}

/** Copiar, inserir na nota aberta ou guardar numa nota nova: o resultado sempre acaba em Markdown. */
export function ToolActions({ markdown, disabled, hint, close }: { markdown: string; disabled: boolean; hint: string; close: () => void }) {
  const [msg, setMsg] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const say = (m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(''), 2500);
  };
  const canInsert = active.value?.kind === 'md';

  return (
    <div class="actions">
      <span class="muted" role="status">{msg || hint}</span>
      <button type="button" class="btn" disabled={disabled} onClick={() => void createNote(`${markdown}\n`, 'tabela').then((ok) => ok && close())}>Salvar como nota</button>
      <button type="button" class="btn" disabled={disabled || !canInsert} title={canInsert ? 'Colocar no cursor da nota aberta' : 'Abra uma nota para inserir'} onClick={() => { if (insertBlock(markdown)) close(); }}>Inserir na nota</button>
      <button type="button" class="btn primary" disabled={disabled} onClick={() => void copyText(markdown).then((ok) => say(ok ? 'Copiado.' : 'Não consegui copiar.'))}>Copiar</button>
    </div>
  );
}
