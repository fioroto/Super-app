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
}

export class BadVersion extends Error {}

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
    const names = await readdir(this.dir(rel)).catch(() => [] as string[]);
    const out: Version[] = [];
    for (const name of names) {
      const id = name.slice(0, name.length - path.extname(name).length);
      const time = timeOf(id);
      if (Number.isNaN(time)) continue;
      const info = await stat(path.join(this.dir(rel), name)).catch(() => null);
      if (info) out.push({ id, time, size: info.size });
    }
    return out.sort((a, b) => b.time - a.time || (a.id < b.id ? 1 : -1));
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
      await this.prune(rel, [{ id, time: timeOf(id), size: 0 }, ...versions]);
    }).catch((e) => console.warn('histórico:', (e as Error).message));
  }

  private async prune(rel: string, versions: Version[]): Promise<void> {
    const now = this.now();
    const days = new Set<number>();
    for (const v of [...versions].sort((a, b) => b.time - a.time)) {
      const age = now - v.time;
      if (age <= KEEP_ALL) continue;
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
