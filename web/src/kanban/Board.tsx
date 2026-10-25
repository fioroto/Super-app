import { useMemo, useRef, useState } from 'preact/hooks';
import { ask, confirmBox } from '../app/dialog.ts';
import { edit } from '../app/store.ts';
import * as K from './kanbanMd.ts';

type Drag = { type: 'card'; lane: number; index: number } | { type: 'lane'; lane: number } | null;
// O dataTransfer só pode ser lido no "drop"; durante o arrasto o estado fica aqui.
let drag: Drag = null;

const TOKEN = /(@\{\d{4}-\d{2}-\d{2}\}|@@\{[^}]*\}|(?<![\p{L}\p{N}])#[\p{L}\p{N}_/-]+)/gu;
const today = () => new Date().toISOString().slice(0, 10);

function CardText({ text, done }: { text: string; done: boolean }) {
  return (
    <>
      {text.split(TOKEN).map((part, i) => {
        if (i % 2 === 0) return part;
        if (part.startsWith('@@')) return <span class="chip">{part.slice(3, -1)}</span>;
        if (part.startsWith('@')) {
          const day = part.slice(2, -1);
          return <span class={`chip date${!done && day < today() ? ' late' : ''}`}>{day.split('-').reverse().join('/')}</span>;
        }
        return <span class="chip tag">{part}</span>;
      })}
    </>
  );
}

/** Caixa de texto de um cartão: Enter confirma, Shift+Enter quebra a linha, Esc cancela. */
function CardInput({ initial, placeholder, onDone, keepOpen }: {
  initial: string; placeholder?: string; onDone: (text: string | null) => void; keepOpen?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const finished = useRef(false);
  const grow = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; };
  const finish = (value: string | null) => {
    if (finished.current) return;
    finished.current = !keepOpen || value === null;
    onDone(value);
    if (keepOpen && ref.current && value !== null) { ref.current.value = ''; grow(ref.current); }
  };
  return (
    <textarea
      ref={(el) => { ref.current = el; if (el && !el.dataset.ready) { el.dataset.ready = '1'; el.focus(); el.setSelectionRange(el.value.length, el.value.length); grow(el); } }}
      class="card-input"
      defaultValue={initial}
      placeholder={placeholder}
      rows={1}
      spellcheck={false}
      onInput={(e) => grow(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const v = e.currentTarget.value.trim(); finish(v || null); }
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => {
        const v = e.currentTarget.value.trim();
        if (finished.current) return;
        if (keepOpen) { finished.current = true; if (v) onDone(v); onDone(null); } else finish(v && v !== initial ? v : null);
      }}
    />
  );
}

export function KanbanBoard({ path, text }: { path: string; text: string }) {
  const board = useMemo(() => K.parseBoard(text), [text]);
  const [editing, setEditing] = useState<{ lane: number; index: number } | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<{ lane: number; index: number } | null>(null);
  const [laneDrop, setLaneDrop] = useState<number | null>(null);
  const [openArchive, setOpenArchive] = useState(false);
  if (!board) return <p class="empty muted">Não consegui ler este quadro.</p>;

  const commit = (b: K.Board) => edit(path, K.serializeBoard(b));
  const clearDrag = () => { drag = null; setDropAt(null); setLaneDrop(null); };

  const cardIndexAt = (container: HTMLElement, y: number) => {
    const els = [...container.querySelectorAll<HTMLElement>(':scope > .card')];
    const i = els.findIndex((el) => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2; });
    return i < 0 ? els.length : i;
  };

  const renameLane = async (i: number) => {
    const name = await ask('Nome da lane', board.lanes[i]!.title);
    if (name && name !== board.lanes[i]!.title) commit(K.renameLane(board, i, name));
  };
  const deleteLane = async (i: number) => {
    const lane = board.lanes[i]!;
    if (await confirmBox(`Excluir a lane "${lane.title}" e seus ${K.cardsOf(lane).length} cartões?`)) commit(K.removeLane(board, i));
  };
  const addLane = async () => {
    const name = await ask('Nome da nova lane');
    if (name) commit(K.addLane(board, name));
  };

  return (
    <div class="board" onDragEnd={clearDrag}>
      {board.lanes.map((lane, li) => {
        const cards = K.cardsOf(lane);
        const collapsed = lane.archive && !openArchive;
        return (
          <section
            key={li}
            class={`lane${lane.archive ? ' archive' : ''}${laneDrop === li ? ' lane-drop' : ''}`}
            onDragOver={(e) => {
              if (drag?.type === 'lane' && !lane.archive) { e.preventDefault(); setLaneDrop(li); }
            }}
            onDrop={(e) => {
              if (drag?.type === 'lane' && !lane.archive) { e.preventDefault(); const from = drag.lane; clearDrag(); if (from !== li) commit(K.moveLane(board, from, li)); }
            }}
          >
            <header
              class="lane-head"
              draggable={!lane.archive}
              onDragStart={(e) => { drag = { type: 'lane', lane: li }; e.dataTransfer!.effectAllowed = 'move'; e.dataTransfer!.setData('text/plain', lane.title); }}
            >
              <strong class="lane-title" onDblClick={() => renameLane(li)} title="Duplo clique para renomear">{lane.archive ? 'Arquivo' : lane.title}</strong>
              <span class="count">{cards.length}</span>
              {lane.archive ? (
                <button title={openArchive ? 'Recolher' : 'Mostrar'} onClick={() => setOpenArchive(!openArchive)}>{openArchive ? '▾' : '▸'}</button>
              ) : (
                <>
                  <button title="Renomear lane" onClick={() => renameLane(li)}>✎</button>
                  <button title="Excluir lane" onClick={() => deleteLane(li)}>×</button>
                </>
              )}
            </header>

            {!collapsed && (
              <div
                class="cards"
                onDragOver={(e) => {
                  if (drag?.type !== 'card') return;
                  e.preventDefault();
                  const index = cardIndexAt(e.currentTarget, e.clientY);
                  if (dropAt?.lane !== li || dropAt.index !== index) setDropAt({ lane: li, index });
                }}
                onDrop={(e) => {
                  if (drag?.type !== 'card') return;
                  e.preventDefault();
                  const { lane: from, index: fromIndex } = drag;
                  const index = cardIndexAt(e.currentTarget, e.clientY);
                  clearDrag();
                  commit(K.moveCard(board, from, fromIndex, li, index));
                }}
              >
                {cards.map((card, ci) => (
                  <>
                    {dropAt?.lane === li && dropAt.index === ci && <div class="drop-line" />}
                    <article
                      key={ci}
                      class={`card${card.checked ? ' done' : ''}`}
                      draggable={editing?.lane !== li || editing.index !== ci}
                      onDragStart={(e) => { drag = { type: 'card', lane: li, index: ci }; e.dataTransfer!.effectAllowed = 'move'; e.dataTransfer!.setData('text/plain', card.text); e.stopPropagation(); }}
                    >
                      <input type="checkbox" checked={card.checked} aria-label="Concluído" onChange={() => commit(K.toggleCard(board, li, ci))} />
                      {editing?.lane === li && editing.index === ci ? (
                        <CardInput
                          initial={card.text}
                          onDone={(v) => { setEditing(null); if (v !== null) commit(K.setCardText(board, li, ci, v)); }}
                        />
                      ) : (
                        <div class="card-text" onClick={() => setEditing({ lane: li, index: ci })}><CardText text={card.text} done={card.checked} /></div>
                      )}
                      <span class="card-actions">
                        {!lane.archive && <button title="Arquivar" onClick={() => commit(K.archiveCard(board, li, ci))}>⤓</button>}
                        <button title="Excluir cartão" onClick={() => commit(K.removeCard(board, li, ci))}>×</button>
                      </span>
                    </article>
                  </>
                ))}
                {dropAt?.lane === li && dropAt.index >= cards.length && <div class="drop-line" />}

                {!lane.archive && (adding === li ? (
                  <CardInput
                    initial=""
                    placeholder="Texto do cartão (Enter adiciona)"
                    keepOpen
                    onDone={(v) => { if (v === null) setAdding(null); else commit(K.addCard(board, li, v)); }}
                  />
                ) : (
                  <button class="add-card" onClick={() => setAdding(li)}>+ Cartão</button>
                ))}
              </div>
            )}
          </section>
        );
      })}
      <button class="add-lane" onClick={addLane}>+ Lane</button>
    </div>
  );
}
