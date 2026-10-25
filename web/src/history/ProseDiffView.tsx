import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { IconHtml } from '../app/icons.tsx';
import { renderMarkdown } from '../preview/markdown.ts';
import { IconDown, IconFold, IconInline, IconSplit, IconUnfold, IconUp } from './diffIcons.tsx';
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

const VIEW_KEY = 'superapp.diffview';
const readView = (): 'split' | 'inline' => {
  try { return localStorage.getItem(VIEW_KEY) === 'inline' ? 'inline' : 'split'; } catch { return 'split'; }
};
const NARROW = '(max-width: 800px)';

/** Janela estreita: só cabe a visão em linha (como o useInlineViewWhenSpaceIsLimited do VS Code). */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

interface Mark { id: number; top: number; height: number; kind: string }

/**
 * Duas versões, alinhadas por parágrafo, com a palavra mudada em destaque e o texto formatado,
 * na moldura do editor de diferenças do VS Code: calha com − e +, listras onde um lado não tem nada,
 * seta → no meio para voltar o trecho, régua à direita, trechos iguais recolhidos e visão em linha.
 * `actions` desenha os botões de cada mudança: na calha do meio (`gutter`) ou numa coluna no fim (`end`).
 * `diff` evita refazer a comparação quando quem chama já a tem.
 */
export function ProseDiffView({ left, right, leftLabel, rightLabel, path, actions, diff: given, actionsAt = 'gutter' }: {
  left: string; right: string; leftLabel: string; rightLabel: string; path: string;
  actions?: (change: Change, diff: ProseDiff) => ComponentChildren;
  diff?: ProseDiff;
  actionsAt?: 'gutter' | 'end';
}) {
  const mode = proseMode(path) ?? 'txt';
  const [raw, setRaw] = useState(false);
  const diff = useMemo(() => given ?? proseDiff(left, right, mode), [given, left, right, mode]);
  const [opened, setOpened] = useState<ReadonlySet<Row>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [view, setView] = useState(readView);
  const narrow = useNarrow();
  const inline = view === 'inline' || narrow;
  const [cur, setCur] = useState(-1);
  const [marks, setMarks] = useState<Mark[]>([]);
  const body = useRef<HTMLDivElement>(null);
  const total = diff.changes.length;
  const end = actionsAt === 'end';

  const focusRow = (el: HTMLElement | null | undefined) => {
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  };
  const go = (dir: 1 | -1) => {
    if (!total) return;
    const next = cur < 0 ? (dir === 1 ? 0 : total - 1) : (cur + dir + total) % total;
    setCur(next);
    focusRow(body.current?.querySelector<HTMLElement>(`[data-change="${next}"]`));
  };
  const jump = (id: number, side: 'left' | 'right') => focusRow(body.current?.querySelector<HTMLElement>(`[data-change="${id}"][data-side="${side}"]`));
  const toggleView = () => {
    const next = view === 'inline' ? 'split' : 'inline';
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* sem armazenamento */ }
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

  // Régua: onde cada mudança fica na altura do documento. Mede de novo quando o tamanho muda.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || raw) { setMarks([]); return; }
    const measure = () => {
      const h = el.scrollHeight || 1;
      setMarks([...el.querySelectorAll<HTMLElement>('[data-change]')].map((row) => ({
        id: Number(row.dataset.change),
        top: (row.offsetTop / h) * 100,
        height: (row.offsetHeight / h) * 100,
        kind: row.dataset.kind!,
      })));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [diff, opened, showAll, inline, raw]);

  const cell = (block: Block | null, segs: Seg[] | undefined, cls: 'd' | 'a', label: string) => (
    <CellView block={block} segs={segs} cls={cls} mode={mode} path={path} label={label} />
  );

  const renderRow = (r: Row, key: number): ComponentChildren => {
    if (r.kind === 'skip') {
      if (showAll || opened.has(r)) return r.rows.map((x, k) => renderRow(x, key * 1000 + k));
      return (
        <button key={key} type="button" class="pdiff-skip" title="Mostrar este trecho" onClick={() => setOpened(new Set([...opened, r]))}>
          <span aria-hidden="true">⋯</span> {plural(r.rows.length, 'parágrafo oculto', 'parágrafos ocultos')}
        </button>
      );
    }
    if (r.kind === 'same') {
      return inline ? (
        <div key={key} class="pdiff-row same">
          <div class="pdiff-line"><span class="pdiff-gut" />{cell(r.right, undefined, 'a', rightLabel)}<span class="pdiff-mid" /></div>
        </div>
      ) : (
        <div key={key} class="pdiff-row same">
          <span class="pdiff-gut" />{cell(r.left, undefined, 'd', leftLabel)}<span class="pdiff-mid" /><span class="pdiff-gut" />
          <div class="pdiff-right">{cell(r.right, undefined, 'a', rightLabel)}</div>
          {end && <div class="pdiff-act" />}
        </div>
      );
    }

    const c = r.change;
    const showLeft = r.side !== 'right', showRight = r.side !== 'left';
    const moved = c.kind === 'moved';
    const cls = moved ? `moved ${r.side === 'left' ? 'from' : 'to'}` : c.kind;
    const kind = moved ? 'moved' : c.kind;
    // Removido só aparece à esquerda; movido ganha o botão na posição nova.
    const action = actions && (c.kind === 'removed' || r.side !== 'left') ? actions(c, diff) : null;
    const note = (c.format || moved) && (
      <span class="pdiff-note">
        {moved && (
          <button type="button" class="link-btn" onClick={() => jump(c.id, r.side === 'left' ? 'right' : 'left')}>
            {r.side === 'left' ? '↓ movido para outro lugar' : '↑ veio de outro lugar'}
          </button>
        )}
        {c.format && r.side !== 'left' && <span>formatação mudou</span>}
      </span>
    );
    const sign = (s: '−' | '+') => (moved ? '' : s);
    const attrs = { 'data-change': c.id, 'data-side': r.side, 'data-kind': kind, tabIndex: -1 };

    if (inline) {
      return (
        <div key={key} class={`pdiff-row ${cls}${cur === c.id ? ' cur' : ''}`} {...attrs}>
          <div class="pdiff-lines">
            {showLeft && (
              <div class="pdiff-line del"><span class="pdiff-gut">{sign('−')}</span>{cell(c.left, c.leftSegs, 'd', leftLabel)}<span class="pdiff-mid">{!showRight && !end && action}</span></div>
            )}
            {showRight && (
              <div class="pdiff-line ins"><span class="pdiff-gut">{sign('+')}</span><div class="pdiff-right">{cell(c.right, c.rightSegs, 'a', rightLabel)}{note}</div><span class="pdiff-mid">{!end && action}</span></div>
            )}
            {showLeft && !showRight && note}
          </div>
          {end && <div class="pdiff-act">{action}</div>}
        </div>
      );
    }
    return (
      <div key={key} class={`pdiff-row ${cls}${cur === c.id ? ' cur' : ''}`} {...attrs}>
        <span class={`pdiff-gut${showLeft ? ' del' : ''}`}>{showLeft ? sign('−') : ''}</span>
        {cell(showLeft ? c.left : null, c.leftSegs, 'd', leftLabel)}
        <span class="pdiff-mid">{!end && action}</span>
        <span class={`pdiff-gut${showRight ? ' ins' : ''}`}>{showRight ? sign('+') : ''}</span>
        <div class="pdiff-right">{cell(showRight ? c.right : null, c.rightSegs, 'a', rightLabel)}{note}</div>
        {end && <div class="pdiff-act">{action}</div>}
      </div>
    );
  };

  return (
    <div class={`pdiff ${inline ? 'inline' : 'split'}${end ? ' wide' : ''}`}>
      <div class="pdiff-head">
        <div class="pdiff-bar">
          <span class="pdiff-sum">{summary(diff.stats, total)}</span>
          {total > 0 && <span class="muted">{cur < 0 ? `${total} ${total === 1 ? 'mudança' : 'mudanças'}` : `${cur + 1} de ${total}`}</span>}
          <span class="pdiff-tools">
            <button type="button" class="icon-btn" disabled={!total || raw} aria-label="Mudança anterior" title="Mudança anterior (Alt+↑)" onClick={() => go(-1)}><IconUp /></button>
            <button type="button" class="icon-btn" disabled={!total || raw} aria-label="Próxima mudança" title="Próxima mudança (Alt+↓)" onClick={() => go(1)}><IconDown /></button>
            <button type="button" class="icon-btn" disabled={narrow || raw} aria-label={inline ? 'Lado a lado' : 'Em linha'}
              title={narrow ? 'Pouco espaço: só em linha' : inline ? 'Mostrar lado a lado' : 'Mostrar em linha (antes em cima, depois embaixo)'} onClick={toggleView}>
              {inline ? <IconSplit /> : <IconInline />}
            </button>
            <button type="button" class="icon-btn" disabled={raw} aria-pressed={showAll} aria-label={showAll ? 'Recolher trechos iguais' : 'Mostrar trechos iguais'}
              title={showAll ? 'Recolher trechos iguais' : 'Mostrar trechos iguais'} onClick={() => { setShowAll(!showAll); setOpened(new Set()); }}>
              {showAll ? <IconFold /> : <IconUnfold />}
            </button>
            <button type="button" class="icon-btn" aria-pressed={raw} aria-label={raw ? 'Ver o texto' : 'Ver o Markdown'} title={raw ? 'Voltar ao texto formatado' : 'Ver o Markdown, linha a linha'} onClick={() => setRaw(!raw)}><IconHtml /></button>
          </span>
        </div>
        {!raw && (inline
          ? <div class="pdiff-labels"><span><b class="del">−</b> {leftLabel}</span><span><b class="ins">+</b> {rightLabel}</span></div>
          : <div class="pdiff-labels"><span /><span>{leftLabel}</span><span /><span /><span>{rightLabel}</span>{end && <span />}</div>)}
      </div>
      {raw ? (
        <div class="pdiff-scroll"><div class="pdiff-body"><DiffView left={left} right={right} leftLabel={leftLabel} rightLabel={rightLabel} /></div></div>
      ) : (
        <div class="pdiff-scroll">
          <div class="pdiff-body" ref={body}><div>{diff.rows.map((r, k) => renderRow(r, k))}</div></div>
          <div class="pdiff-ruler" aria-hidden="true">
            {marks.map((m, k) => (
              <span key={k} class={`pdiff-mark ${m.kind}`} style={{ top: `${m.top}%`, height: `max(3px, ${m.height}%)` }}
                onClick={() => { setCur(m.id); jump(m.id, (body.current?.querySelector<HTMLElement>(`[data-change="${m.id}"]`)?.dataset.side as 'left' | 'right') ?? 'left'); }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
