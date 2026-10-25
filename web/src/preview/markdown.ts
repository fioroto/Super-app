import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { api } from '../api/client.ts';
import { resolveRel } from '../app/files.ts';

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const SCHEME = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

let notePath = '';

// Roda em cada elemento depois da limpeza: aponta imagens e links relativos para o vault.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof HTMLImageElement) {
    const src = node.getAttribute('src') ?? '';
    if (src && !SCHEME.test(src)) {
      const target = resolveRel(notePath, src);
      if (target !== null) node.setAttribute('src', api.rawUrl(target));
      else node.removeAttribute('src');
    } else if (/^https?:|^\/\//i.test(src)) {
      // Nada de buscar imagem na internet: o app é offline e isso vazaria quais notas você abre.
      node.removeAttribute('src');
      node.setAttribute('alt', node.getAttribute('alt') || src);
    }
  } else if (node instanceof HTMLAnchorElement) {
    const href = node.getAttribute('href') ?? '';
    if (/^https?:/i.test(href)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    } else if (href && !href.startsWith('#') && !SCHEME.test(href)) {
      const target = resolveRel(notePath, href);
      if (target !== null) node.setAttribute('data-note', target);
      node.removeAttribute('href');
    }
  }
});

export function stripFrontmatter(src: string): string {
  return src.replace(FRONTMATTER, '');
}

export function renderMarkdown(src: string, path: string): string {
  notePath = path;
  const html = marked.parse(stripFrontmatter(src), { gfm: true, async: false });
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
