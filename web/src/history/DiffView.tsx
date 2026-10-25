import { useMemo } from 'preact/hooks';
import { diffLines, sideBySide } from './diff.ts';

/** Duas versões do mesmo texto, lado a lado, com as linhas diferentes em destaque. */
export function DiffView({ left, right, leftLabel, rightLabel }: { left: string; right: string; leftLabel: string; rightLabel: string }) {
  const rows = useMemo(() => sideBySide(diffLines(left.split('\n'), right.split('\n'))), [left, right]);
  const same = left === right;
  return (
    <div class="diff">
      <div class="diff-head"><span>{leftLabel}</span><span>{rightLabel}</span></div>
      {same && <p class="muted pad">Nenhuma diferença.</p>}
      <div class="diff-body">
        {!same && rows.map((r, i) =>
          r.kind === 'skip' ? (
            <div class="diff-skip" key={i}>{r.l}</div>
          ) : (
            <div class={`diff-row ${r.kind}`} key={i}>
              <pre class={r.kind === 'change' && r.l !== null ? 'del' : r.l === null ? 'blank' : ''}>{r.l ?? ''}</pre>
              <pre class={r.kind === 'change' && r.r !== null ? 'add' : r.r === null ? 'blank' : ''}>{r.r ?? ''}</pre>
            </div>
          ))}
      </div>
    </div>
  );
}
