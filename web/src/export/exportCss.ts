// CSS embutido no HTML exportado de uma nota. Autônomo: não depende do app.
export const exportCss = `
:root {
  --bg: #fdfdfc;
  --fg: #1f2328;
  --muted: #656d76;
  --line: #d0d7de;
  --accent: #0969da;
  --code: #f3f4f6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --fg: #e6edf3;
    --muted: #9198a1;
    --line: #3d444d;
    --accent: #4493f8;
    --code: #161b22;
  }
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: system-ui, "Segoe UI", sans-serif;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.note {
  max-width: 80ch;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.6em; }
h1 { border-bottom: 1px solid var(--line); padding-bottom: 0.3em; }
p, ul, ol, blockquote, pre, table, .mermaid-out { margin: 0 0 1em; }
ul, ol { padding-left: 1.6em; }
li + li { margin-top: 0.25em; }
li:has(> input[type=checkbox]) { list-style: none; }
ul:has(> li > input[type=checkbox]) { padding-left: 0; }
input[type=checkbox] { margin: 0 0.5em 0 0; vertical-align: middle; }
a { color: var(--accent); }
img, svg { max-width: 100%; height: auto; }
hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }
blockquote { margin-left: 0; padding: 0 1em; border-left: 3px solid var(--line); color: var(--muted); }
code, pre { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; }
:not(pre) > code { font-size: 0.92em; background: var(--code); padding: 0.15em 0.35em; border-radius: 4px; }
pre { background: var(--code); border: 1px solid var(--line); border-radius: 6px; padding: 1rem; overflow: auto; font-size: 0.9em; line-height: 1.5; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid var(--line); padding: 0.4em 0.7em; text-align: left; vertical-align: top; }
th { background: var(--code); }
.mermaid-out { text-align: center; }
.mermaid-out svg { max-width: 100% !important; height: auto; }
@media print {
  @page { margin: 18mm; }
  :root { --bg: #fff; --fg: #000; --muted: #444; --line: #999; --accent: #000; --code: #f2f2f2; }
  body { background: #fff; color: #000; }
  .note { max-width: none; padding: 0; }
  pre, table, img, svg { break-inside: avoid; }
  a { color: inherit; }
}
`;
