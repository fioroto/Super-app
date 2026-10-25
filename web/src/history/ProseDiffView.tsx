import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { renderMarkdown } from '../preview/markdown.ts';
import { DiffView } from './DiffView.tsx';
import { cellOf, proseDiff, type Block, type Cell, type Change, type Mode, type ProseDiff, type Row, type Seg } from './proseDiff.ts';

/** Notas e texto puro comparam por parágrafo e palavra; o resto (json, yaml, csv) continua linha a linha. */
export const proseMode = (path: string): Mode | null => (/\.(md|markdown)$/i.test(path) ? 'md' : /\.txt$/i.test(path) ? 'txt' : null);

const cells = (n: number) => (n === 1 ? '' : ' | '.repeat(n - 1));

/** Uma linha de tabela sozinha não vira tabela no Markdown: ganha um cabeçalho invisível. */
function rowMarkdown(block: Block, md: string): string {
  if (block.kind !== 'row' || block.text.includes('\n')) return md;
  const pipes = block.text.replace(/\\\|/g, '').match(/\|/g)?.length ?? 0;
  const n = Math.max(1, pipes - (block.text.trimEnd().endsWith('|') ? 1 : 0));
  return `|${cells(n)} |\n|${' --- |'.repeat(n)}\n${md}`;
}

function CellView({ block, segs, cls, mode, path, label }: { block: Block | null; segs?: Seg[]; cls: 'd' | 'a'; mode: Mode; path: string; label: string }) {
  const html = useMemo(() => {
    if (!block) return '';
    const cell: Cell = cellOf(block, segs, cls, mode);
    return 'md' in cell ? renderMarkdown(rowMarkdown(block, cell.md), path) : cell.html;
  }, [block, segs, cls, mode, path]);
  if (!block) return <div class="pdiff-cell pdiff-empty" data-label={label} />;
  return <div class={`pdiff-cell preview${block.kind === 'row' && !block.text.includes('\n') ? ' pdiff-rowonly' : ''}`} data-label={label} dangerouslySetInnerHTML={{ __html: html }} />;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function summary(s: { added: number; removed: number; changed: number; moved: number }, total: number): string {
  if (!total) return 'Nenhuma diferença.';
  const parts = [`+${plural(s.added, 'palavra', 'palavras')}`, `−${s.removed}`];
  if (s.changed) parts.push(plural(s.changed, 'parágrafo mudado', 'parágrafos mudados'));
  if (s.moved) parts.push(plural(s.moved, 'movido', 'movidos'));
  return parts.join(' · ');
}

/**
 * Duas versões lado a lado, alinhadas por parágrafo, com a palavra mudada em destaque e o texto formatado.
 * `actions` desenha botões na linha de cada mudança (voltar o trecho, escolher o lado no conflito);
 * `diff` evita refazer a comparação quando quem chama já a tem.
 */
export function ProseDiffView({ left, right, leftLabel, rightLabel, path, actions, diff: given, wide }: {
  left: string; right: string; leftLabel: string; rightLabel: string; path: string;
  actions?: (change: Change, diff: ProseDiff) => ComponentChildren;
  diff?: ProseDiff;
  wide?: boolean;
}) {
  const mode = proseMode(path) ?? 'txt';
  const [raw, setRaw] = useState(false);
  const diff = useMemo(() => given ?? proseDiff(left, right, mode), [given, left, right, mode]);
  const [opened, setOpened] = useState<ReadonlySet<Row>>(new Set());
  const [cur, setCur] = useState(-1);
  const body = useRef<HTMLDivElement>(null);
  const total = diff.changes.length;

  const go = (dir: 1 | -1) => {
    if (!total) return;
    const next = cur < 0 ? (dir === 1 ? 0 : total - 1) : (cur + dir + total) % total;
    setCur(next);
    const el = body.current?.querySelector<HTMLElement>(`[data-change="${next}"]`);
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  };
  // Alt+↓ e Alt+↑ andam entre as mudanças, como "próxima mudança" no VS Code.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      e.preventDefault();
      go(e.key === 'ArrowDown' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const jump = (id: number, side: 'left' | 'right') => {
    const el = body.current?.querySelector<HTMLElement>(`[data-change="${id}"][data-side="${side}"]`);
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  };

  const renderRow = (r: Row, key: number): ComponentChildren => {
    if (r.kind === 'skip') {
      if (opened.has(r)) return r.rows.map((x, k) => renderRow(x, key * 1000 + k));
      return (
        <button key={key} type="button" class="pdiff-skip" onClick={() => setOpened(new Set([...opened, r]))}>
          … {plural(r.rows.length, 'parágrafo igual', 'parágrafos iguais')} …
        </button>
      );
    }
    if (r.kind === 'same') {
      return (
        <div key={key} class="pdiff-row same">
          <CellView block={r.left} cls="d" mode={mode} path={path} label={leftLabel} />
          <CellView block={r.right} cls="a" mode={mode} path={path} label={rightLabel} />
          <div class="pdiff-act" />
        </div>
      );
    }
    const c = r.change;
    const showLeft = r.side !== 'right', showRight = r.side !== 'left';
    const cls = c.kind === 'moved' ? `moved ${r.side === 'left' ? 'from' : 'to'}` : c.kind;
    return (
      <div key={key} class={`pdiff-row ${cls}${cur === c.id ? ' cur' : ''}`} data-change={c.id} data-side={r.side} tabIndex={-1}>
        <CellView block={showLeft ? c.left : null} segs={c.leftSegs} cls="d" mode={mode} path={path} label={leftLabel} />
        <div class="pdiff-right">
          <CellView block={showRight ? c.right : null} segs={c.rightSegs} cls="a" mode={mode} path={path} label={rightLabel} />
          {(c.format || c.kind === 'moved') && (
            <span class="pdiff-note">
              {c.kind === 'moved' && (
                <button type="button" class="link-btn" onClick={() => jump(c.id, r.side === 'left' ? 'right' : 'left')}>
                  {r.side === 'left' ? '↓ movido para outro lugar' : '↑ veio de outro lugar'}
                </button>
              )}
              {c.format && r.side !== 'left' && <span>formatação mudou</span>}
            </span>
          )}
        </div>
        {/* Removido só aparece à esquerda; movido ganha o botão na posição nova. */}
        <div class="pdiff-act">{actions && (c.kind === 'removed' || r.side !== 'left') && actions(c, diff)}</div>
      </div>
    );
  };

  return (
    <div class={`pdiff${wide ? ' wide' : ''}`}>
      <div class="pdiff-head">
        <div class="pdiff-bar">
          <span class="pdiff-sum">{summary(diff.stats, total)}</span>
          {total > 0 && (
            <span class="pdiff-nav">
              <button type="button" class="icon-btn" aria-label="Mudança anterior" title="Mudança anterior (Alt+↑)" onClick={() => go(-1)}>▲</button>
              <button type="button" class="icon-btn" aria-label="Próxima mudança" title="Próxima mudança (Alt+↓)" onClick={() => go(1)}>▼</button>
              <span class="muted">{cur < 0 ? `${total} ${total === 1 ? 'mudança' : 'mudanças'}` : `${cur + 1} de ${total}`}</span>
            </span>
          )}
          <button type="button" class="link-btn" onClick={() => setRaw(!raw)}>{raw ? 'Ver o texto' : 'Ver o Markdown'}</button>
        </div>
        {!raw && <div class="pdiff-labels"><span>{leftLabel}</span><span>{rightLabel}</span><span /></div>}
      </div>
      {raw ? (
        <DiffView left={left} right={right} leftLabel={leftLabel} rightLabel={rightLabel} />
      ) : (
        <div class="pdiff-body" ref={body}>{diff.rows.map((r, k) => renderRow(r, k))}</div>
      )}
    </div>
  );
}
