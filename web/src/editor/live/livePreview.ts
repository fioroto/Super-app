import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { liveBlocks } from './blocks.ts';
import { notePathFacet } from './context.ts';
import { liveInline, linkOpener } from './inline.ts';
import './live.css';

export interface LiveOptions {
  /** Caminho da nota aberta, para resolver imagens e links relativos. */
  notePath: () => string;
}

/** Modo Documento: a formatação do Markdown aparece desenhada; o texto do arquivo não muda. */
export function livePreview(opts: LiveOptions): Extension {
  return [
    EditorView.editorAttributes.of({ class: 'cm-live' }),
    EditorView.contentAttributes.of({ spellcheck: 'true', lang: 'pt-BR' }),
    notePathFacet.of(opts.notePath),
    liveInline,
    liveBlocks,
    linkOpener(opts.notePath),
  ];
}
