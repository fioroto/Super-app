import { tool } from '../app/store.ts';
import { JsonCompare } from './JsonCompare.tsx';
import { SheetToMarkdown } from './SheetToMarkdown.tsx';

const TITLE = { json: 'Comparar JSON', sheet: 'Planilha para tabela Markdown' } as const;

export function ToolDialog() {
  const t = tool.value!;
  const close = () => { tool.value = null; };
  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="dialog tool" role="dialog" aria-label={TITLE[t]} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <header>
          <strong>{TITLE[t]}</strong>
          <button class="btn" onClick={close}>Fechar</button>
        </header>
        {t === 'json' ? <JsonCompare close={close} /> : <SheetToMarkdown close={close} />}
      </div>
    </div>
  );
}
