import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readdir, readFile, realpath, rename, stat, writeFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { PathError, resolveInside, sanitizeName, splitRel } from './security.ts';

export class ConflictError extends Error {
  currentHash: string | null;
  constructor(currentHash: string | null) {
    super('o arquivo mudou no disco');
    this.currentHash = currentHash;
  }
}
export class NotFoundError extends Error {}

export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number;
  mtime?: number;
  children?: TreeNode[];
}

export interface FileData {
  content: string;
  hash: string;
  mtime: number;
}

const HIDDEN_DIRS = new Set(['node_modules']);
const MAX_TEXT = 8 * 1024 * 1024;

export const hashOf = (data: Buffer | string): string => createHash('sha1').update(data).digest('hex');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** O OneDrive e antivírus travam arquivos por instantes: tenta de novo antes de desistir. */
async function retrying<T>(fn: () => Promise<T>): Promise<T> {
  const waits = [50, 150, 400];
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= waits.length || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw e;
      await sleep(waits[i]!);
    }
  }
}

export interface SavedEvent {
  rel: string;
  previous: string | null;
}

export class Vault extends EventEmitter<{ saved: [SavedEvent]; removing: [string, string] }> {
  readonly root: string;

  private constructor(root: string) {
    super();
    this.root = root;
  }

  static async open(dir: string): Promise<Vault> {
    const real = await realpath(dir);
    if (!(await stat(real)).isDirectory()) throw new PathError('não é uma pasta');
    return new Vault(real);
  }

  get name(): string {
    return path.basename(this.root) || this.root;
  }

  abs(rel: string): Promise<string> {
    return resolveInside(this.root, rel);
  }

  /** Pasta interna do app. Só o servidor escreve aqui. */
  internal(...parts: string[]): string {
    return path.join(this.root, '.superapp', ...parts);
  }

  async tree(): Promise<TreeNode> {
    const walk = async (abs: string, rel: string): Promise<TreeNode[]> => {
      const entries = await readdir(abs, { withFileTypes: true });
      const out: TreeNode[] = [];
      for (const e of entries) {
        if (e.name.startsWith('.') || HIDDEN_DIRS.has(e.name) || e.isSymbolicLink()) continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        const childAbs = path.join(abs, e.name);
        if (e.isDirectory()) {
          out.push({ name: e.name, path: childRel, type: 'dir', children: await walk(childAbs, childRel) });
        } else if (e.isFile()) {
          const s = await stat(childAbs);
          out.push({ name: e.name, path: childRel, type: 'file', size: s.size, mtime: Math.floor(s.mtimeMs) });
        }
      }
      out.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, 'pt-BR')));
      return out;
    };
    return { name: this.name, path: '', type: 'dir', children: await walk(this.root, '') };
  }

  async read(rel: string): Promise<FileData> {
    const abs = await this.abs(rel);
    let buf: Buffer;
    try {
      const s = await stat(abs);
      if (!s.isFile()) throw new NotFoundError('não é um arquivo');
      if (s.size > MAX_TEXT) throw new PathError('arquivo grande demais para editar');
      buf = await readFile(abs);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError('arquivo não existe');
      throw e;
    }
    return { content: buf.toString('utf8'), hash: hashOf(buf), mtime: Math.floor((await stat(abs)).mtimeMs) };
  }

  async readRaw(rel: string): Promise<{ abs: string; size: number }> {
    const abs = await this.abs(rel);
    try {
      const s = await stat(abs);
      if (!s.isFile()) throw new NotFoundError('não é um arquivo');
      return { abs, size: s.size };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError('arquivo não existe');
      throw e;
    }
  }

  /**
   * Grava de forma atômica. `expectedHash` é o hash que o cliente viu:
   * string = precisa bater com o disco; null = o arquivo não pode existir ainda.
   */
  async write(rel: string, content: string | Buffer, expectedHash: string | null): Promise<{ hash: string; mtime: number }> {
    const abs = await this.abs(rel);
    let previous: Buffer | null = null;
    try {
      previous = await readFile(abs);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const currentHash = previous ? hashOf(previous) : null;
    if (currentHash !== expectedHash) throw new ConflictError(currentHash);

    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    if (previous && previous.equals(data)) return { hash: currentHash!, mtime: Math.floor((await stat(abs)).mtimeMs) };

    await mkdir(path.dirname(abs), { recursive: true });
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${randomBytes(4).toString('hex')}.tmp`);
    await writeFile(tmp, data);
    try {
      await retrying(() => rename(tmp, abs));
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    this.emit('saved', { rel, previous: previous ? previous.toString('utf8') : null });
    return { hash: hashOf(data), mtime: Math.floor((await stat(abs)).mtimeMs) };
  }

  async mkdir(rel: string): Promise<void> {
    await mkdir(await this.abs(rel), { recursive: true });
  }

  async rename(from: string, to: string): Promise<void> {
    const a = await this.abs(from);
    const b = await this.abs(to);
    try {
      await lstat(b);
      throw new ConflictError(null);
    } catch (e) {
      if (e instanceof ConflictError) throw e;
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    await mkdir(path.dirname(b), { recursive: true });
    await retrying(() => rename(a, b));
  }

  /** Excluir = mover para a lixeira do vault. */
  async remove(rel: string): Promise<string> {
    const abs = await this.abs(rel);
    const s = await lstat(abs).catch(() => null);
    if (!s) throw new NotFoundError('não existe');
    if (s.isFile()) {
      const old = await readFile(abs, 'utf8').catch(() => null);
      if (old !== null) this.emit('removing', rel, old);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = this.internal('trash', `${stamp}-${sanitizeName(path.basename(abs))}`);
    await mkdir(path.dirname(dest), { recursive: true });
    await retrying(() => rename(abs, dest));
    return path.relative(this.root, dest).split(path.sep).join('/');
  }

  /** Imagem colada: vai para anexos/ com nome que não colide. */
  async saveAttachment(filename: string, data: Buffer): Promise<string> {
    const clean = sanitizeName(path.basename(filename));
    const ext = path.extname(clean);
    const stem = clean.slice(0, clean.length - ext.length) || 'imagem';
    for (let i = 0; i < 1000; i++) {
      const rel = `anexos/${stem}${i ? `-${i}` : ''}${ext}`;
      splitRel(rel);
      try {
        await this.write(rel, data, null);
        return rel;
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
      }
    }
    throw new PathError('não foi possível nomear o anexo');
  }
}
