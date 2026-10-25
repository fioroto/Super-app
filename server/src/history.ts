import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { splitRel } from './security.ts';
import type { Vault } from './vault.ts';

const DAY = 86_400_000;
const MIN_GAP = 5 * 60_000;
const KEEP_ALL = 7 * DAY;
const KEEP_DAILY = 90 * DAY;
const TEXT = /\.(md|markdown|txt|json|ya?ml|csv)$/i;
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(-\d+)?$/;

export interface Version {
  id: string;
  time: number;
  size: number;
  /** Quantas palavras a versão tem: a linha do tempo mostra quanto cada uma acrescentou ou tirou. */
  words: number;
  /** Nome do marco. Versão com nome nunca é apagada pela limpeza automática. */
  name?: string;
}

export class BadVersion extends Error {}
export class BadName extends Error {}

const MARKS = 'marcos.json';
const NAME_MAX = 120;

/** Nome de marco numa linha só, sem caracteres de controle, com até 120 caracteres. Vazio = sem nome. */
export function cleanName(name: string): string {
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(name)) throw new BadName('o nome tem caracteres inválidos');
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length > NAME_MAX) throw new BadName(`o nome passa de ${NAME_MAX} caracteres`);
  return clean;
}

const countWords = (s: string) => s.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;

const stampOf = (t: number) => new Date(t).toISOString().replace(/[:.]/g, '-');
const timeOf = (id: string): number => {
  const m = STAMP.exec(id);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN;
};

/**
 * Versões anteriores de cada arquivo de texto, em .superapp/history/<caminho>/<data>.<ext>.
 * Cada cópia é o arquivo como ele era antes de ser sobrescrito, legível em qualquer editor.
 * Guarda no máximo uma a cada 5 minutos; mantém tudo por 7 dias, uma por dia até 90 dias.
 */
export class History {
  private readonly vault: Vault;
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();
  /** Palavras por versão: o arquivo de uma versão nunca muda, então a conta vale para sempre. */
  private readonly words = new Map<string, number>();

  constructor(vault: Vault, now: () => number = Date.now) {
    this.vault = vault;
    this.now = now;
    vault.on('saved', ({ rel, previous }) => this.record(rel, previous));
    vault.on('removing', (rel, content) => this.record(rel, content, true));
    vault.on('renamed', (from, to) => this.moved(from, to));
  }

  private dir(rel: string): string {
    return this.vault.internal('history', ...splitRel(rel));
  }

  /** Um trabalho de cada vez: duas gravações seguidas não disputam a mesma pasta. */
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Espera o que está na fila: a resposta de uma gravação só sai com o histórico em dia. */
  idle(): Promise<unknown> {
    return this.queue;
  }

  async list(rel: string): Promise<Version[]> {
    const files = await readdir(this.dir(rel)).catch(() => [] as string[]);
    const marks = await this.marks(rel);
    const out: Version[] = [];
    for (const file of files) {
      const id = file.slice(0, file.length - path.extname(file).length);
      const time = timeOf(id);
      if (Number.isNaN(time)) continue;
      const info = await stat(path.join(this.dir(rel), file)).catch(() => null);
      if (!info) continue;
      const key = `${rel}\0${id}`;
      let words = this.words.get(key);
      if (words === undefined) {
        words = countWords(await readFile(path.join(this.dir(rel), file), 'utf8').catch(() => ''));
        this.words.set(key, words);
      }
      const v: Version = { id, time, size: info.size, words };
      if (marks[id]) v.name = marks[id];
      out.push(v);
    }
    return out.sort((a, b) => b.time - a.time || (a.id < b.id ? 1 : -1));
  }

  /** Os nomes dos marcos de um arquivo, em .superapp/history/<caminho>/marcos.json. */
  private async marks(rel: string): Promise<Record<string, string>> {
    try {
      const raw = JSON.parse(await readFile(path.join(this.dir(rel), MARKS), 'utf8')) as unknown;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      const out: Record<string, string> = Object.create(null);
      for (const [id, name] of Object.entries(raw)) if (STAMP.test(id) && typeof name === 'string' && name) out[id] = name;
      return out;
    } catch {
      return {};
    }
  }

  private async saveMarks(rel: string, marks: Record<string, string>): Promise<void> {
    await mkdir(this.dir(rel), { recursive: true });
    await writeFile(path.join(this.dir(rel), MARKS), `${JSON.stringify(marks, null, 2)}\n`);
  }

  /**
   * Guarda o estado atual do arquivo como um marco com nome, sem esperar os 5 minutos.
   * Se a versão mais recente já é igual ao arquivo, ela vira o marco (nada de cópia repetida).
   */
  mark(rel: string, name: string): Promise<Version> {
    const clean = cleanName(name);
    if (!clean) return Promise.reject(new BadName('dê um nome ao marco'));
    if (!TEXT.test(rel)) return Promise.reject(new BadVersion('este tipo de arquivo não tem histórico'));
    return this.serial(async () => {
      const current = (await this.vault.read(rel)).content;
      const versions = await this.list(rel);
      let id = versions[0] && (await this.read(rel, versions[0].id)) === current ? versions[0].id : null;
      if (!id) {
        await mkdir(this.dir(rel), { recursive: true });
        id = stampOf(this.now());
        for (let n = 1; versions.some((v) => v.id === id); n++) id = `${stampOf(this.now())}-${n}`;
        await writeFile(await this.file(rel, id), current);
      }
      const marks = await this.marks(rel);
      marks[id] = clean;
      await this.saveMarks(rel, marks);
      return (await this.list(rel)).find((v) => v.id === id)!;
    });
  }

  /** Dá, troca ou (com nome vazio) tira o nome de uma versão. Sem nome, ela volta a seguir a limpeza automática. */
  label(rel: string, id: string, name: string): Promise<void> {
    const clean = cleanName(name);
    return this.serial(async () => {
      if (!(await this.list(rel)).some((v) => v.id === id)) throw new BadVersion('versão não encontrada');
      const marks = await this.marks(rel);
      if (clean) marks[id] = clean; else delete marks[id];
      await this.saveMarks(rel, marks);
    });
  }

  private async file(rel: string, id: string): Promise<string> {
    if (!STAMP.test(id)) throw new BadVersion('versão inválida');
    return path.join(this.dir(rel), `${id}${path.extname(rel)}`);
  }

  async read(rel: string, id: string): Promise<string> {
    return readFile(await this.file(rel, id), 'utf8').catch(() => {
      throw new BadVersion('versão não encontrada');
    });
  }

  record(rel: string, previous: string | null, force = false): Promise<void> {
    if (previous === null || !TEXT.test(rel)) return Promise.resolve();
    return this.serial(async () => {
      const versions = await this.list(rel);
      const latest = versions[0];
      if (latest) {
        if (!force && this.now() - latest.time < MIN_GAP) return;
        if ((await this.read(rel, latest.id)) === previous) return;
      }
      await mkdir(this.dir(rel), { recursive: true });
      let id = stampOf(this.now());
      for (let n = 1; versions.some((v) => v.id === id); n++) id = `${stampOf(this.now())}-${n}`;
      await writeFile(await this.file(rel, id), previous);
      await this.prune(rel, [{ id, time: timeOf(id) }, ...versions]);
    }).catch((e) => console.warn('histórico:', (e as Error).message));
  }

  private async prune(rel: string, versions: Pick<Version, 'id' | 'time'>[]): Promise<void> {
    const now = this.now();
    const days = new Set<number>();
    const marks = await this.marks(rel);
    for (const v of [...versions].sort((a, b) => b.time - a.time)) {
      const age = now - v.time;
      if (age <= KEEP_ALL || marks[v.id]) continue; // marco nunca sai
      const day = Math.floor(v.time / DAY);
      if (age <= KEEP_DAILY && !days.has(day)) { days.add(day); continue; }
      await rm(await this.file(rel, v.id), { force: true });
    }
  }

  /** Restaura uma versão. O estado atual vira uma versão nova antes de ser sobrescrito. */
  async restore(rel: string, id: string): Promise<{ hash: string }> {
    const old = await this.read(rel, id);
    const current = await this.vault.read(rel).then((f) => f.content, () => null);
    if (current !== null) await this.record(rel, current, true);
    return this.vault.write(rel, old, null, { force: true });
  }

  private moved(from: string, to: string): Promise<void> {
    return this.serial(async () => {
      const src = this.dir(from);
      if (!(await stat(src).catch(() => null))) return;
      await mkdir(path.dirname(this.dir(to)), { recursive: true });
      await rename(src, this.dir(to));
    }).catch(() => undefined);
  }
}
