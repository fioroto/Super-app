// Colar conteúdo formatado (páginas, Google Docs, Word) vira Markdown.
// Carregado só na primeira vez que alguém cola HTML: o turndown fica fora do pacote inicial.

/** Google Docs e Word guardam negrito e itálico em `style`, não em <strong> e <em>: traduz antes de converter. */
function normalize(doc: Document): void {
  doc.querySelectorAll('meta, style, script, link, title').forEach((n) => n.remove());
  doc.querySelectorAll('b[id^="docs-internal-guid"]').forEach((b) => b.replaceWith(...b.childNodes));
  for (const span of doc.querySelectorAll<HTMLElement>('span[style]')) {
    const style = span.getAttribute('style') ?? '';
    const bold = /font-weight:\s*(?:bold|[6-9]00)/i.test(style) && !span.closest('h1, h2, h3, h4, h5, h6, b, strong');
    const italic = /font-style:\s*italic/i.test(style) && !span.closest('em, i');
    const strike = /text-decoration[^;]*line-through/i.test(style) && !span.closest('del, s, strike');
    for (const [on, tag] of [[strike, 'del'], [italic, 'em'], [bold, 'strong']] as const) {
      if (!on) continue;
      const wrap = doc.createElement(tag);
      wrap.append(...span.childNodes);
      span.append(wrap);
    }
  }
}

export async function htmlToMarkdown(html: string): Promise<string> {
  const [{ default: Turndown }, { gfm }] = await Promise.all([import('turndown'), import('turndown-plugin-gfm')]);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  normalize(doc);

  const td = new Turndown({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*', strongDelimiter: '**', hr: '---' });
  // O padrão do turndown é "-   item" (três espaços); o resto do app usa "- item".
  td.addRule('item', {
    filter: 'li',
    replacement(content: string, node: HTMLElement, options: { bulletListMarker: string }) {
      const parent = node.parentNode as HTMLElement;
      let prefix = `${options.bulletListMarker} `;
      if (parent.nodeName === 'OL') {
        const start = parent.getAttribute('start');
        const index = Array.prototype.indexOf.call(parent.children, node) as number;
        prefix = `${(start ? Number(start) : 1) + index}. `;
      }
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '').replace(/\n/g, `\n${' '.repeat(prefix.length)}`);
      return prefix + body + (node.nextSibling ? '\n' : '');
    },
  });
  td.use(gfm); // tabelas, riscado e tarefas (entram depois, então têm preferência sobre a regra acima)
  // O plugin escreve o riscado com um til só; o Markdown do app (e o GitHub) usam dois.
  td.addRule('riscado', { filter: ['del', 's', 'strike'], replacement: (content: string) => `~~${content}~~` });
  return (td.turndown(doc.body) as string).replace(/\n{3,}/g, '\n\n').trim();
}
