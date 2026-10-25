import { useRef } from 'preact/hooks';
import type { Command } from '@codemirror/view';
import { getView } from '../Editor.tsx';
import { attachImage, formats, indentList, insertHr, insertLink, insertTable, setHeading, toggleCodeBlock, toggleInline, toggleList, toggleQuote } from './format.ts';
import { activePath } from '../../app/store.ts';

/** Faixa de botões de formatação. Cada botão chama o mesmo comando do atalho. */
export function Toolbar() {
  const f = formats.value;
  const file = useRef<HTMLInputElement>(null);

  const run = (cmd: Command) => () => {
    const v = getView();
    if (!v) return;
    cmd(v);
    v.focus();
  };
  // Clicar num botão não pode tirar o foco (e a seleção) do texto.
  const keepFocus = (e: MouseEvent) => e.preventDefault();

  const btn = (label: string, title: string, cmd: Command, on = false, style?: Record<string, string | number>) => (
    <button type="button" class={`fmt-btn${on ? ' on' : ''}`} title={title} aria-pressed={on} onMouseDown={keepFocus} onClick={run(cmd)} style={style}>{label}</button>
  );

  return (
    <div class="fmt-bar" role="toolbar" aria-label="Formatação">
      <select class="fmt-select" title="Estilo do parágrafo" aria-label="Estilo" value={f.heading <= 4 ? f.heading : 0}
        onChange={(e) => { run(setHeading(Number(e.currentTarget.value)))(); }}>
        <option value="0">Parágrafo</option>
        {[1, 2, 3, 4].map((n) => <option value={n}>Título {n}</option>)}
      </select>
      <span class="fmt-group">
        {btn('N', 'Negrito (Ctrl+B)', toggleInline('**'), f.bold, { fontWeight: 700 })}
        {btn('I', 'Itálico (Ctrl+I)', toggleInline('*'), f.italic, { fontStyle: 'italic' })}
        {btn('S', 'Riscado (Ctrl+Shift+X)', toggleInline('~~'), f.strike, { textDecoration: 'line-through' })}
        {btn('</>', 'Código em linha (Ctrl+`)', toggleInline('`'), f.code)}
        {btn('Link', 'Link (Ctrl+K)', insertLink, f.link)}
      </span>
      <span class="fmt-sep" />
      <span class="fmt-group">
        {btn('• Lista', 'Lista (Ctrl+Shift+8)', toggleList('bullet'), f.list === 'bullet')}
        {btn('1. Lista', 'Lista numerada (Ctrl+Shift+7)', toggleList('number'), f.list === 'number')}
        {btn('☑ Tarefas', 'Lista de tarefas (Ctrl+Shift+9)', toggleList('task'), f.list === 'task')}
        {btn('→', 'Aninhar item (Tab)', indentList(1))}
        {btn('←', 'Desaninhar item (Shift+Tab)', indentList(-1))}
      </span>
      <span class="fmt-sep" />
      <span class="fmt-group">
        {btn('Citação', 'Citação (Ctrl+Shift+.)', toggleQuote, f.quote)}
        {btn('{ }', 'Bloco de código (Ctrl+Alt+C)', toggleCodeBlock, f.codeblock)}
        {btn('Tabela', 'Inserir tabela', insertTable)}
        {btn('—', 'Linha horizontal', insertHr)}
        <button type="button" class="fmt-btn" title="Inserir imagem" onMouseDown={keepFocus} onClick={() => file.current?.click()}>Imagem</button>
      </span>
      <input ref={file} type="file" accept="image/*" hidden aria-label="Escolher imagem"
        onChange={(e) => {
          const picked = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          const v = getView();
          const path = activePath.value;
          if (picked && v && path) void attachImage(v, path, picked).then(() => v.focus());
        }} />
    </div>
  );
}
