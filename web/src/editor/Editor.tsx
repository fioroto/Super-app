import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { useEffect, useRef } from 'preact/hooks';
import { api } from '../api/client.ts';
import { relativeTo } from '../app/files.ts';
import { theme } from '../app/theme.ts';
import { refreshBlocks } from './live/blocks.ts';
import { livePreview } from './live/livePreview.ts';
import { continueList, markdownSupport } from './markdownLang.ts';
import { edit, error, save } from '../app/store.ts';

const highlight = HighlightStyle.define([
  { tag: [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: 'var(--hl-head)', fontWeight: '600' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.monospace, color: 'var(--hl-code)' },
  { tag: [t.quote, t.comment], color: 'var(--muted)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--muted)' },
]);

const baseTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--fg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-cursor': { borderLeftColor: 'var(--fg)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--sel)' },
});

// Só no modo de código: fonte mono e linha ativa destacada.
const codeTheme: Extension = [
  highlightActiveLine(),
  EditorView.theme({
    '.cm-scroller': { fontFamily: 'var(--mono)', fontSize: '13.5px', lineHeight: '1.65' },
    '.cm-content': { padding: '12px 16px', caretColor: 'var(--fg)' },
    '.cm-activeLine': { backgroundColor: 'var(--bg-2)' },
  }),
];

/** Troca o modo Documento sem recriar o editor (o desfazer continua valendo). */
const liveSlot = new Compartment();

let activeView: EditorView | undefined;
// Gancho dos testes: deixa posicionar a seleção com precisão. Só existe com a chave ligada.
try {
  if (localStorage.getItem('superapp.test') === '1') (window as unknown as { __cmView: () => EditorView | undefined }).__cmView = () => activeView;
} catch { /* sem armazenamento */ }
/** O editor em uso, para recursos de fora (inserir diagrama) escreverem no texto. */
export const getView = (): EditorView | undefined => activeView;

interface Cached { state: EditorState; rev: number }
const cache = new Map<string, Cached>();

export function Editor({ path, text, rev, live }: { path: string; text: string; rev: number; live: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const current = useRef({ path, rev, live });
  current.current = { path, rev, live };

  const modeExt = (on: boolean): Extension => (on ? livePreview({ notePath: () => current.current.path }) : codeTheme);

  const makeState = (doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        markdownSupport,
        syntaxHighlighting(highlight),
        keymap.of([{ key: 'Enter', run: continueList }, { key: 'Mod-s', preventDefault: true, run: () => (void save(current.current.path), true) }, indentWithTab, ...defaultKeymap, ...historyKeymap]),
        baseTheme,
        liveSlot.of(modeExt(current.current.live)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) edit(current.current.path, u.state.doc.toString());
        }),
        EditorView.domEventHandlers({ paste: (e, v) => pasteImage(e, v, () => current.current.path) }),
      ],
    });

  // Uma única instância; trocar de aba troca o estado (mantém desfazer por aba).
  useEffect(() => {
    view.current = activeView = new EditorView({ parent: host.current!, state: makeState(text) });
    return () => {
      view.current?.destroy();
      view.current = activeView = undefined;
    };
  }, []);

  const shown = useRef<{ path: string; rev: number } | null>({ path, rev });
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const prev = shown.current;
    if (prev && prev.path === path && prev.rev === rev) return;
    if (prev && prev.path !== path) cache.set(prev.path, { state: v.state, rev: prev.rev });
    const hit = cache.get(path);
    v.setState(hit && hit.rev === rev ? hit.state : makeState(text));
    // Um estado guardado pode ter sido criado no outro modo.
    v.dispatch({ effects: liveSlot.reconfigure(modeExt(live)) });
    shown.current = { path, rev };
    v.focus();
  }, [path, rev]);

  useEffect(() => {
    view.current?.dispatch({ effects: liveSlot.reconfigure(modeExt(live)) });
  }, [live]);

  // Diagramas são desenhados com as cores do tema: trocar de tema pede para refazê-los.
  const themeNow = theme.value;
  useEffect(() => {
    view.current?.dispatch({ effects: refreshBlocks.of(null) });
  }, [themeNow]);

  return <div class="cm-host" ref={host} />;
}

function pasteImage(e: ClipboardEvent, v: EditorView, notePath: () => string): boolean {
  const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
  if (!file) return false;
  e.preventDefault();
  const name = file.name && file.name !== 'image.png' ? file.name : `colado-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
  api.attach(file, name).then(
    ({ path }) => {
      const md = `![](${relativeTo(notePath(), path)})`;
      const { from, to } = v.state.selection.main;
      v.dispatch({ changes: { from, to, insert: md }, selection: { anchor: from + md.length } });
    },
    (err) => { error.value = (err as Error).message; },
  );
  return true;
}
