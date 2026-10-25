import { basename } from '../app/files.ts';
import { renderMarkdown } from '../preview/markdown.ts';
import { renderDiagram } from '../preview/mermaid.ts';
import { exportCss } from './exportCss.ts';

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const MAX_INLINE = 8 * 1024 * 1024;

async function toDataUrl(src: string): Promise<string | null> {
  try {
    const blob = await (await fetch(src)).blob();
    if (blob.size > MAX_INLINE) return null;
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Página HTML única: texto, estilo, diagramas já desenhados e imagens embutidas. */
export async function noteToHtml(path: string, text: string): Promise<string> {
  const box = document.createElement('div');
  box.innerHTML = renderMarkdown(text, path); // já passou pelo DOMPurify

  for (const pre of box.querySelectorAll<HTMLElement>('pre.mermaid-src')) {
    const res = await renderDiagram(pre.textContent ?? '', false);
    const out = document.createElement('div');
    if ('svg' in res) { out.className = 'mermaid-out'; out.innerHTML = res.svg; } else { out.className = 'mermaid-error'; out.textContent = `Diagrama com erro: ${res.error}`; }
    pre.replaceWith(out);
  }
  for (const img of box.querySelectorAll<HTMLImageElement>('img[src^="/api/raw"]')) {
    const data = await toDataUrl(img.getAttribute('src')!);
    if (data) img.setAttribute('src', data); else img.removeAttribute('src');
  }
  for (const a of box.querySelectorAll<HTMLElement>('a[data-note]')) a.replaceWith(...a.childNodes);

  const title = box.querySelector('h1')?.textContent?.trim() || basename(path).replace(/\.md$/i, '');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n<style>${exportCss}</style>\n</head>\n<body>\n<article class="note">\n${box.innerHTML}\n</article>\n</body>\n</html>\n`;
}

export async function exportHtml(path: string, text: string): Promise<void> {
  download(new Blob([await noteToHtml(path, text)], { type: 'text/html;charset=utf-8' }), basename(path).replace(/\.md$/i, '') + '.html');
}

export function downloadSvg(svg: string, name = 'diagrama'): void {
  const xml = svg.startsWith('<?xml') ? svg : `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`;
  download(new Blob([xml], { type: 'image/svg+xml' }), `${name}.svg`);
}

/** Rasteriza o SVG em PNG (2x) com fundo branco. */
export async function downloadPng(svg: string, name = 'diagrama'): Promise<void> {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const vb = doc.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  const w = vb?.[2] || parseFloat(doc.getAttribute('width') ?? '') || 800;
  const h = vb?.[3] || parseFloat(doc.getAttribute('height') ?? '') || 600;
  doc.setAttribute('width', String(w));
  doc.setAttribute('height', String(h));
  doc.removeAttribute('style');
  if (!doc.getAttribute('xmlns')) doc.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(doc))}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * 2);
  canvas.height = Math.ceil(h * 2);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
  if (!blob) throw new Error('não consegui gerar o PNG');
  download(blob, `${name}.png`);
}

