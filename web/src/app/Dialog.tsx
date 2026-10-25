import { useEffect, useRef } from 'preact/hooks';
import { dialog } from './dialog.ts';

export function Dialog() {
  const d = dialog.value;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (d?.kind === 'ask') { input.current?.focus(); input.current?.select(); } }, [d]);
  if (!d) return null;

  const submit = () => d.done(d.kind === 'ask' ? input.current!.value.trim() || null : true);
  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && d.done(null)}>
      <form class="dialog" onSubmit={(e) => { e.preventDefault(); submit(); }} onKeyDown={(e) => e.key === 'Escape' && d.done(null)}>
        <label>{d.title}
          {d.kind === 'ask' && <input ref={input} defaultValue={d.initial} spellcheck={false} />}
        </label>
        <div class="actions">
          <button type="button" class="btn" onClick={() => d.done(null)}>Cancelar</button>
          <button type="submit" class="btn primary" autofocus={d.kind === 'confirm'}>OK</button>
        </div>
      </form>
    </div>
  );
}
