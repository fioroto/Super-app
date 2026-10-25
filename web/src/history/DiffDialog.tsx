import { diffView } from '../app/store.ts';
import { DiffView } from './DiffView.tsx';

export function DiffDialog() {
  const d = diffView.value!;
  const close = () => { diffView.value = null; };
  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="dialog history" onKeyDown={(e) => e.key === 'Escape' && close()} tabIndex={-1} ref={(el) => el?.focus()}>
        <header>
          <strong>{d.title}</strong>
          <button class="btn" onClick={close}>Fechar</button>
        </header>
        <div class="history-diff"><DiffView left={d.left} right={d.right} leftLabel={d.leftLabel} rightLabel={d.rightLabel} /></div>
      </div>
    </div>
  );
}
