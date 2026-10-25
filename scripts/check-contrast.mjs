// Confere o contraste dos tokens de cor de web/src/styles.css nos dois temas.
// Texto normal: 4,5:1. Borda de campo e anel de foco: 3:1. Sai com código 1 se algum par falhar.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(path.join(root, 'web/src/styles.css'), 'utf8');

const vars = (re, name) => {
  const m = re.exec(css);
  if (!m) throw new Error(`bloco "${name}" não encontrado em styles.css`);
  return Object.fromEntries([...m[1].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
};
const light = vars(/:root \{([\s\S]*?)\n\}/, 'claro');
const dark = vars(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/, 'escuro');
const media = vars(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n  \}/, 'escuro (automático)');

function rgba(value, theme) {
  const v = value.replace(/var\(--([a-z0-9-]+)\)/g, (_, n) => theme[n] ?? value);
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)).concat(1);
  m = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(v);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  throw new Error(`cor não entendida: ${value}`);
}
const lum = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const over = (top, bottom) => top.slice(0, 3).map((c, i) => c * top[3] + bottom[i] * (1 - top[3]));
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const TEXT = [
  ['fg', 'bg'], ['fg', 'bg-2'], ['fg', 'bg-3'], ['muted', 'bg'], ['muted', 'bg-2'], ['muted', 'bg-3'],
  ['accent-fg', 'accent'], ['accent-fg', 'bad'], ['ok', 'bg'], ['warn', 'bg'], ['bad', 'bg'], ['fg', 'sel'],
];
const CONTROL = [['ring', 'bg'], ['input', 'bg'], ['input', 'bg-3'], ['accent', 'bg']];

let failed = false;
for (const [name, theme] of [['claro', light], ['escuro', dark]]) {
  const bg = rgba(theme.bg, theme).slice(0, 3);
  const pick = (k) => over(rgba(theme[k], theme), bg); // cores com transparência são compostas sobre o fundo
  console.log(`\nTema ${name}`);
  for (const [group, pairs, min] of [['texto', TEXT, 4.5], ['controle', CONTROL, 3]]) {
    for (const [a, b] of pairs) {
      const r = ratio(pick(a), pick(b));
      const ok = r >= min;
      if (!ok) failed = true;
      console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${group.padEnd(8)} ${a} sobre ${b}`.padEnd(46) + `${r.toFixed(2)}:1 (mín. ${min})`);
    }
  }
}
// O tema escuro automático (preferência do sistema) precisa ser idêntico ao escuro escolhido à mão.
for (const k of Object.keys(dark)) {
  if (media[k] !== dark[k]) { failed = true; console.log(`\nFALHA: --${k} difere entre o escuro automático (${media[k]}) e o manual (${dark[k]})`); }
}
process.exit(failed ? 1 : 0);
