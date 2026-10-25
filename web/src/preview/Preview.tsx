import { useEffect, useRef, useState } from 'preact/hooks';
import { openFile } from '../app/store.ts';
import { renderMarkdown } from './markdown.ts';

export function Preview({ path, text }: { path: string; text: string }) {
  const [html, setHtml] = useState(() => renderMarkdown(text, path));
  const first = useRef(true);

  // Espera 150 ms sem digitação antes de redesenhar.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const id = setTimeout(() => setHtml(renderMarkdown(text, path)), 150);
    return () => clearTimeout(id);
  }, [text, path]);

  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a[data-note]');
    if (a) { e.preventDefault(); void openFile(a.getAttribute('data-note')!); }
  };

  return <article class="preview" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
