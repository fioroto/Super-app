import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { basename, flatten } from './files.ts';
import { openFile, quickOpen, tree } from './store.ts';

/** Todas as letras da busca, em ordem. Quanto mais coladas e mais perto do fim (nome), melhor. */
function score(path: string, q: string): number {
  if (!q) return 0;
  const p = path.toLowerCase();
  const nameStart = p.length - basename(p).length;
  let pos = -1, s = 0, last = -2;
  for (const ch of q) {
    pos = p.indexOf(ch, pos + 1);
    if (pos < 0) return -1;
    s += pos === last + 1 ? 3 : 1;
    if (pos >= nameStart) s += 2;
    last = pos;
  }
  return s - p.length / 100;
}

export function QuickOpen() {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const all = useMemo(() => (tree.value ? flatten(tree.value) : []), [tree.value]);
  const results = useMemo(() => {
    const needle = q.toLowerCase().replace(/\s+/g, '');
    return all.map((p) => [p, score(p, needle)] as const).filter(([, s]) => s >= 0).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([p]) => p);
  }, [all, q]);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setSel(0), [q]);

  const close = () => { quickOpen.value = false; };
  const pick = (p: string | undefined) => { if (p) { close(); void openFile(p); } };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(sel + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(sel - 1, 0)); }
    else if (e.key === 'Enter') pick(results[sel]);
  };

  return (
    <div class="overlay top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="dialog quick" onKeyDown={onKey}>
        <input ref={input} value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Buscar arquivo pelo nome…" spellcheck={false} />
        <ul>
          {results.map((p, i) => (
            <li key={p} class={i === sel ? 'sel' : ''} onMouseEnter={() => setSel(i)} onClick={() => pick(p)}>
              <span>{basename(p)}</span><span class="muted">{p}</span>
            </li>
          ))}
          {!results.length && <li class="muted">Nada encontrado.</li>}
        </ul>
      </div>
    </div>
  );
}
