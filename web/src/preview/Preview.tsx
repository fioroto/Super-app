import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { error, openFile } from '../app/store.ts';
import { theme } from '../app/theme.ts';
import { renderMarkdown } from './markdown.ts';
import { cached, isDark, renderDiagram, type Rendered } from './mermaid.ts';

function show(pre: HTMLElement, res: Rendered, last: Map<number, string>, i: number): void {
  const div = document.createElement('div');
  if ('svg' in res) {
    div.className = 'mermaid-out';
    div.innerHTML = res.svg;
    div.insertAdjacentHTML('beforeend', '<span class="mermaid-tools"><button data-export="svg" title="Baixar SVG">SVG</button><button data-export="png" title="Baixar PNG">PNG</button></span>');
    last.set(i, res.svg);
  } else {
    div.className = 'mermaid-error';
    const title = document.createElement('strong');
    title.textContent = 'Diagrama com erro';
    const msg = document.createElement('pre');
    msg.textContent = res.error;
    div.append(title, msg);
    last.delete(i);
  }
  pre.replaceWith(div);
}

function hydrate(root: HTMLElement, last: Map<number, string>): void {
  const dark = isDark();
  root.querySelectorAll<HTMLElement>('pre.mermaid-src').forEach((pre, i) => {
    const code = pre.textContent ?? '';
    const hit = cached(code, dark);
    if (hit) return show(pre, hit, last, i);
    // Mostra o desenho anterior (esmaecido) enquanto o novo é calculado, para a tela não piscar.
    const prev = last.get(i);
    const holder = document.createElement('div');
    holder.className = 'mermaid-out stale';
    if (prev) { holder.innerHTML = prev; pre.replaceWith(holder); } else pre.classList.add('loading');
    void renderDiagram(code, dark).then((res) => {
      const target = prev ? holder : pre;
      if (target.isConnected) show(target, res, last, i);
    });
  });
}

export function Preview({ path, text }: { path: string; text: string }) {
  const dark = (theme.value, isDark());
  const [html, setHtml] = useState(() => renderMarkdown(text, path));
  const first = useRef(true);
  const root = useRef<HTMLElement>(null);
  const last = useRef(new Map<number, string>());

  // Espera 150 ms sem digitação antes de redesenhar.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const id = setTimeout(() => setHtml(renderMarkdown(text, path)), 150);
    return () => clearTimeout(id);
  }, [text, path]);

  useLayoutEffect(() => { if (root.current) hydrate(root.current, last.current); }, [html, dark]);
  useEffect(() => { last.current = new Map(); }, [path]);

  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const a = target.closest('a[data-note]');
    if (a) { e.preventDefault(); void openFile(a.getAttribute('data-note')!); return; }
    const btn = target.closest<HTMLElement>('button[data-export]');
    const svg = btn?.closest('.mermaid-out')?.querySelector('svg');
    if (btn && svg) {
      const kind = btn.dataset.export;
      void import('../export/exporters.ts').then((m) => (kind === 'png' ? m.downloadPng(svg.outerHTML) : m.downloadSvg(svg.outerHTML)))
        .catch((err) => { error.value = (err as Error).message; });
    }
  };

  // key={dark}: trocar o tema remonta o artigo e redesenha os diagramas com as cores novas.
  return <article key={String(dark)} ref={root} class="preview" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
