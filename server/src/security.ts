import { randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';

export class PathError extends Error {}

export const newToken = (): string => randomBytes(24).toString('base64url');

export function tokenValid(given: string | null | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cookieToken(req: IncomingMessage): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === 'sa') return part.slice(i + 1).trim();
  }
  return null;
}

/** Bloqueia DNS rebinding: o Host precisa ser o endereço local com a porta do servidor. */
export function hostAllowed(req: IncomingMessage, port: number): boolean {
  const host = req.headers.host;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/** Quando o navegador manda Origin, ele precisa ser o próprio servidor. */
export function originAllowed(req: IncomingMessage, port: number): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const BAD_CHARS = /[<>:"|?*\\\x00-\x1f]/;

/** Regras do Windows valem em qualquer sistema: o vault pode ser aberto lá depois. */
export function validSegment(name: string): boolean {
  if (!name || name === '.' || name === '..') return false;
  if (BAD_CHARS.test(name)) return false;
  if (/[. ]$/.test(name)) return false;
  if (RESERVED.test(name.split('.')[0]!)) return false;
  return name.length <= 200;
}

export function sanitizeName(name: string): string {
  let out = name.replace(/[<>:"|?*\\/\x00-\x1f]/g, '-').replace(/[. ]+$/, '').trim();
  if (RESERVED.test(out.split('.')[0]!)) out = `_${out}`;
  return out || 'sem-nome';
}

/** Pastas internas que a API de arquivos não toca. */
const PROTECTED = new Set(['.superapp', '.git']);

export function splitRel(rel: string): string[] {
  if (typeof rel !== 'string' || rel.includes('\0')) throw new PathError('caminho inválido');
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel) || rel.startsWith('/') || rel.startsWith('\\')) {
    throw new PathError('caminho absoluto não permitido');
  }
  const parts = rel.split('/').filter((p) => p !== '');
  for (const p of parts) {
    if (p === '..' || p === '.') throw new PathError('caminho inválido');
    if (PROTECTED.has(p.toLowerCase())) throw new PathError('pasta reservada');
    if (!validSegment(p)) throw new PathError(`nome inválido: ${p}`);
  }
  return parts;
}

function inside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Converte um caminho relativo do vault em caminho absoluto e garante que o
 * resultado, depois de seguir symlinks, continua dentro do vault.
 * `root` precisa ser o realpath do vault.
 */
export async function resolveInside(root: string, rel: string): Promise<string> {
  const parts = splitRel(rel);
  const abs = path.join(root, ...parts);
  // Sobe até o ancestral que existe e confere o realpath dele.
  let probe = abs;
  for (;;) {
    try {
      await lstat(probe);
      break;
    } catch {
      const up = path.dirname(probe);
      if (up === probe) break;
      probe = up;
    }
  }
  const real = await realpath(probe);
  if (!inside(root, real)) throw new PathError('caminho fora do vault');
  return abs;
}
