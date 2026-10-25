import { tool } from '../app/store.ts';
import { JsonCompare } from './JsonCompare.tsx';
import { JsonTable } from './JsonTable.tsx';
import { SheetToMarkdown } from './SheetToMarkdown.tsx';

const TITLE = { json: 'Comparar JSON', table: 'JSON para tabela', sheet: 'Planilha para tabela Markdown' } as const;

export function ToolDialog() {
  const t = tool.value!;
  const close = () => { tool.value = null; };
  return (
    // Arquivo solto fora da caixa: sem isto o navegador abre o arquivo e sai do app.
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}
      onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; }} onDrop={(e) => e.preventDefault()}>
      <div class={`dialog tool tool-${t}`} role="dialog" aria-label={TITLE[t]} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <header>
          <strong>{TITLE[t]}</strong>
          <button class="btn" onClick={close}>Fechar</button>
        </header>
        {t === 'json' ? <JsonCompare close={close} /> : t === 'table' ? <JsonTable close={close} /> : <SheetToMarkdown close={close} />}
      </div>
    </div>
  );
}
