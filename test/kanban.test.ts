import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addCard, addLane, archiveCard, cardsOf, emptyBoardText, isKanban, moveCard, moveLane, parseBoard, removeCard, removeLane,
  renameLane, serializeBoard, setCardText, toggleCard, type Board,
} from '../web/src/kanban/kanbanMd.ts';

const fixture = (n: string) => readFileSync(path.join(import.meta.dirname, 'fixtures', n), 'utf8');
const load = (n: string): Board => parseBoard(fixture(n))!;
const titles = (b: Board) => b.lanes.map((l) => l.title);
const texts = (b: Board, lane: number) => cardsOf(b.lanes[lane]!).map((c) => c.text);

/** Linhas que mudaram entre dois textos (na mesma ordem, mesmas quantidades). */
const diff = (a: string, b: string) => {
  const x = a.split('\n'), y = b.split('\n');
  return { removed: x.filter((l) => !y.includes(l)), added: y.filter((l) => !x.includes(l)) };
};

describe('quadro (.md do plugin Kanban): ler e escrever sem alterar nada', () => {
  it.each(['quadro-plugin.md', 'quadro-minimo.md', 'quadro-crlf.md'])('%s volta idêntico, byte a byte', (name) => {
    expect(serializeBoard(load(name))).toBe(fixture(name));
  });

  it('um quadro recém-criado pelo app também volta idêntico', () => {
    const md = emptyBoardText();
    expect(serializeBoard(parseBoard(md)!)).toBe(md);
    expect(titles(parseBoard(md)!)).toEqual(['A fazer', 'Fazendo', 'Feito']);
  });

  it('entende lanes, cartões de várias linhas, marcador de concluído e o arquivo', () => {
    const b = load('quadro-plugin.md');
    expect(titles(b)).toEqual(['A fazer', 'Fazendo', 'Feito', 'Archive']);
    expect(texts(b, 0)).toEqual(['Revisar proposta @{2026-11-03} #cliente', 'Montar apresentação\nsegunda linha do cartão\nterceira linha']);
    expect(cardsOf(b.lanes[1]!).map((c) => c.checked)).toEqual([false, true]);
    expect(b.lanes[3]!.archive).toBe(true);
    expect(b.lanes[2]!.archive).toBeUndefined();
    expect(b.settings[0]).toBe('%% kanban:settings');
  });

  it('só chama de quadro o arquivo com kanban-plugin no frontmatter', () => {
    expect(isKanban(fixture('quadro-minimo.md'))).toBe(true);
    expect(isKanban(fixture('nota-comum.md'))).toBe(false);
    expect(parseBoard(fixture('nota-comum.md'))).toBeNull();
    expect(parseBoard('# sem frontmatter\n')).toBeNull();
  });
});

describe('edições mudam só o que foi pedido', () => {
  const original = fixture('quadro-plugin.md');

  it('marcar como feito troca só o marcador daquela linha', () => {
    const out = serializeBoard(toggleCard(load('quadro-plugin.md'), 0, 0));
    expect(diff(original, out)).toEqual({
      removed: ['- [ ] Revisar proposta @{2026-11-03} #cliente'],
      added: ['- [x] Revisar proposta @{2026-11-03} #cliente'],
    });
  });

  it('editar o texto de um cartão reescreve só ele, inclusive as linhas extras', () => {
    const out = serializeBoard(setCardText(load('quadro-plugin.md'), 0, 1, 'Montar slides\ncom notas'));
    expect(diff(original, out)).toEqual({
      removed: ['- [ ] Montar apresentação', '  segunda linha do cartão', '  terceira linha'],
      added: ['- [ ] Montar slides', '  com notas'],
    });
  });

  it('mover um cartão para outra lane preserva o cartão e o resto do arquivo', () => {
    const b = moveCard(load('quadro-plugin.md'), 0, 1, 2, 0);
    expect(texts(b, 2)[0]).toBe('Montar apresentação\nsegunda linha do cartão\nterceira linha');
    expect(texts(b, 0)).toHaveLength(1);
    const out = serializeBoard(b);
    expect(out.split('\n')).toHaveLength(original.split('\n').length);
    expect(out).toContain('%% kanban:settings');
    expect(out).toContain('"show-checkboxes":true');
    expect(serializeBoard(parseBoard(out)!)).toBe(out);
  });

  it('reordenar cartões na mesma lane (para baixo e para cima)', () => {
    const base = load('quadro-plugin.md');
    expect(texts(moveCard(base, 1, 0, 1, 2), 1)).toEqual(['Cartão depois de linha em branco', 'Fluxo de aprovação']);
    expect(texts(moveCard(base, 1, 1, 1, 0), 1)).toEqual(['Cartão depois de linha em branco', 'Fluxo de aprovação']);
    expect(texts(moveCard(base, 1, 0, 1, 1), 1)).toEqual(['Fluxo de aprovação', 'Cartão depois de linha em branco']);
  });

  it('adicionar cartão em lane vazia e em lane com cartões', () => {
    const min = load('quadro-minimo.md');
    const out = serializeBoard(addCard(min, 1, 'primeiro'));
    expect(out).toContain('## Doing\n\n- [ ] primeiro\n\n## Done');
    expect(texts(parseBoard(out)!, 1)).toEqual(['primeiro']);
    expect(texts(addCard(load('quadro-plugin.md'), 0, 'novo'), 0).at(-1)).toBe('novo');
    expect(texts(addCard(load('quadro-plugin.md'), 0, 'no topo', 0), 0)[0]).toBe('no topo');
  });

  it('remover cartão', () => {
    const out = serializeBoard(removeCard(load('quadro-plugin.md'), 2, 0));
    expect(out).not.toContain('Kickoff');
    expect(serializeBoard(parseBoard(out)!)).toBe(out);
  });

  it('esvaziar uma lane e voltar a enchê-la não corrompe o arquivo', () => {
    let b = load('quadro-plugin.md');
    b = removeCard(b, 2, 0);
    b = addCard(b, 2, 'volta');
    const again = parseBoard(serializeBoard(b))!;
    expect(texts(again, 2)).toEqual(['volta']);
    expect(titles(again)).toEqual(['A fazer', 'Fazendo', 'Feito', 'Archive']);
  });

  it('nova lane entra antes do Archive e o `***` continua separando o arquivo', () => {
    const out = serializeBoard(addLane(load('quadro-plugin.md'), 'Revisão'));
    const b = parseBoard(out)!;
    expect(titles(b)).toEqual(['A fazer', 'Fazendo', 'Feito', 'Revisão', 'Archive']);
    expect(b.lanes[4]!.archive).toBe(true);
    expect(b.lanes[3]!.archive).toBeUndefined();
    expect(serializeBoard(b)).toBe(out);
  });

  it('nova lane em quadro sem Archive vai para o fim', () => {
    const b = parseBoard(serializeBoard(addLane(load('quadro-minimo.md'), 'Extra')))!;
    expect(titles(b)).toEqual(['Backlog', 'Doing', 'Done', 'Extra']);
    expect(texts(b, 2)).toEqual(['c']);
  });

  it('renomear, excluir e reordenar lanes', () => {
    const base = load('quadro-plugin.md');
    expect(titles(parseBoard(serializeBoard(renameLane(base, 0, 'Para fazer')))!)[0]).toBe('Para fazer');
    const del = parseBoard(serializeBoard(removeLane(base, 1)))!;
    expect(titles(del)).toEqual(['A fazer', 'Feito', 'Archive']);
    expect(del.lanes[2]!.archive).toBe(true);
    const mv = parseBoard(serializeBoard(moveLane(base, 0, 2)))!;
    expect(titles(mv)).toEqual(['Fazendo', 'Feito', 'A fazer', 'Archive']);
    expect(mv.lanes[3]!.archive).toBe(true);
    expect(serializeBoard(moveLane(moveLane(base, 0, 2), 2, 0))).toBe(original);
  });

  it('excluir a lane que fica antes do Archive mantém o `***` e o Archive', () => {
    const b = parseBoard(serializeBoard(removeLane(load('quadro-plugin.md'), 2)))!;
    expect(titles(b)).toEqual(['A fazer', 'Fazendo', 'Archive']);
    expect(b.lanes[2]!.archive).toBe(true);
    const last = parseBoard(serializeBoard(removeLane(load('quadro-minimo.md'), 2)))!;
    expect(titles(last)).toEqual(['Backlog', 'Doing']);
    expect(serializeBoard(last).endsWith('\n')).toBe(true);
  });

  it('arquivar cria a lane Archive (com `***`) quando ela ainda não existe', () => {
    const out = serializeBoard(archiveCard(load('quadro-minimo.md'), 0, 0));
    const b = parseBoard(out)!;
    expect(titles(b)).toEqual(['Backlog', 'Doing', 'Done', 'Archive']);
    expect(b.lanes[3]!.archive).toBe(true);
    expect(texts(b, 3)).toEqual(['a']);
    expect(texts(b, 0)).toEqual(['b']);
    expect(out).toContain('\n***\n\n## Archive\n');
  });

  it('arquivar com Archive existente só move o cartão', () => {
    const b = parseBoard(serializeBoard(archiveCard(load('quadro-plugin.md'), 2, 0)))!;
    expect(texts(b, 3)).toEqual(['Cartão antigo', 'Kickoff']);
    expect(titles(b)).toHaveLength(4);
  });

  it('CRLF continua CRLF depois de editar', () => {
    const out = serializeBoard(toggleCard(load('quadro-crlf.md'), 0, 0));
    expect(out.split('\r\n').length).toBe(fixture('quadro-crlf.md').split('\r\n').length);
    expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('as operações não alteram o quadro original', () => {
    const base = load('quadro-plugin.md');
    const before = serializeBoard(base);
    toggleCard(base, 0, 0); moveCard(base, 0, 0, 1, 0); removeLane(base, 0); addCard(base, 0, 'x');
    expect(serializeBoard(base)).toBe(before);
  });
});
