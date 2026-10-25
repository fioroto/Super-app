import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  PathError, cookieToken, hostAllowed, newToken, originAllowed, tokenValid,
} from './security.ts';
import { ConflictError, NotFoundError, Vault } from './vault.ts';

export interface Options {
  vaultPath?: string;
  port?: number;
  webRoot: string;
  /** Pasta onde a lista de vaults recentes é guardada. */
  home: string;
  open?: boolean;
  token?: string;
}

export interface Running {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};
const mimeOf = (file: string) => MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

class HttpError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  });
  res.end(data);
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, 'conteúdo grande demais');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const buf = await readBody(req, 12 * 1024 * 1024);
  try {
    const v = JSON.parse(buf.toString('utf8') || '{}');
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string') throw new HttpError(400, `campo "${name}" inválido`);
  return v;
};

// ---------- lista de vaults recentes ----------

async function loadRecents(home: string): Promise<string[]> {
  try {
    const v = JSON.parse(await readFile(path.join(home, 'recents.json'), 'utf8'));
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 10) : [];
  } catch {
    return [];
  }
}

async function saveRecents(home: string, dir: string): Promise<void> {
  const list = [dir, ...(await loadRecents(home)).filter((d) => d !== dir)].slice(0, 10);
  try {
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, 'recents.json'), JSON.stringify(list, null, 2));
  } catch {
    // Pasta do app somente leitura: a lista é só uma conveniência.
  }
}

async function listDirs(target: string): Promise<{ path: string; parent: string | null; dirs: string[] }> {
  if (!target) {
    if (process.platform === 'win32') {
      const drives: string[] = [];
      for (let c = 65; c <= 90; c++) {
        const d = `${String.fromCharCode(c)}:\\`;
        if (await access(d).then(() => true, () => false)) drives.push(d);
      }
      return { path: '', parent: null, dirs: drives };
    }
    target = os.homedir();
  }
  const abs = path.resolve(target);
  const entries = await readdir(abs, { withFileTypes: true }).catch(() => {
    throw new HttpError(404, 'pasta não encontrada ou sem permissão');
  });
  const parent = path.dirname(abs);
  return {
    path: abs,
    parent: parent === abs ? (process.platform === 'win32' ? '' : null) : parent,
    dirs: entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort((a, b) => a.localeCompare(b, 'pt-BR')),
  };
}

// ---------- servidor ----------

export async function startServer(opts: Options): Promise<Running> {
  const token = opts.token ?? newToken();
  let vault: Vault | null = null;
  let port = 0;

  const setVault = async (dir: string): Promise<void> => {
    try {
      vault = await Vault.open(dir);
    } catch (e) {
      throw new HttpError(400, e instanceof PathError ? e.message : 'não consegui abrir a pasta');
    }
    await saveRecents(opts.home, vault.root);
  };

  if (opts.vaultPath) await setVault(opts.vaultPath);
  else {
    const last = (await loadRecents(opts.home))[0];
    if (last) vault = await Vault.open(last).catch(() => null);
  }

  const needVault = (): Vault => {
    if (!vault) throw new HttpError(409, 'nenhuma pasta aberta', { code: 'no-vault' });
    return vault;
  };

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const route = `${req.method} ${url.pathname}`;
    const q = (name: string) => url.searchParams.get(name) ?? '';

    switch (route) {
      case 'GET /api/state':
        return json(res, 200, { vault: vault ? { name: vault.name, root: vault.root } : null, recents: await loadRecents(opts.home) });
      case 'GET /api/dirs':
        return json(res, 200, await listDirs(q('path')));
      case 'POST /api/vault': {
        const body = await readJson(req);
        await setVault(str(body.path, 'path'));
        return json(res, 200, { vault: { name: vault!.name, root: vault!.root } });
      }
      case 'GET /api/tree':
        return json(res, 200, await needVault().tree());
      case 'GET /api/file': {
        const f = await needVault().read(q('path'));
        return json(res, 200, f);
      }
      case 'PUT /api/file': {
        const body = await readJson(req);
        const expected = body.hash === null || body.hash === undefined ? null : str(body.hash, 'hash');
        const r = await needVault().write(str(body.path, 'path'), str(body.content, 'content'), expected);
        return json(res, 200, r);
      }
      case 'DELETE /api/file': {
        const trash = await needVault().remove(q('path'));
        return json(res, 200, { trash });
      }
      case 'POST /api/rename': {
        const body = await readJson(req);
        await needVault().rename(str(body.from, 'from'), str(body.to, 'to'));
        return json(res, 200, { ok: true });
      }
      case 'POST /api/mkdir': {
        const body = await readJson(req);
        await needVault().mkdir(str(body.path, 'path'));
        return json(res, 200, { ok: true });
      }
      case 'POST /api/attachment': {
        const data = await readBody(req, 25 * 1024 * 1024);
        const name = decodeURIComponent(String(req.headers['x-filename'] ?? 'imagem.png'));
        return json(res, 200, { path: await needVault().saveAttachment(name, data) });
      }
      case 'GET /api/raw': {
        const { abs, size } = await needVault().readRaw(q('path'));
        res.writeHead(200, {
          'content-type': mimeOf(abs), 'content-length': size, 'cache-control': 'no-store',
          // SVG e HTML do vault nunca rodam script na origem do app.
          'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
          'x-content-type-options': 'nosniff',
        });
        createReadStream(abs).pipe(res);
        return;
      }
      default:
        throw new HttpError(404, 'rota não existe');
    }
  }

  async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const abs = path.resolve(opts.webRoot, rel);
    if (path.relative(opts.webRoot, abs).startsWith('..')) throw new HttpError(404, 'não encontrado');
    const s = await stat(abs).catch(() => null);
    if (!s?.isFile()) throw new HttpError(404, 'não encontrado');
    const hashed = rel.startsWith('assets/');
    res.writeHead(200, {
      'content-type': mimeOf(abs), 'content-length': s.size,
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    createReadStream(abs).pipe(res);
  }

  const server: Server = createServer(async (req, res) => {
    try {
      if (!hostAllowed(req, port) || !originAllowed(req, port)) throw new HttpError(403, 'origem não permitida');
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

      // Troca o token da URL de abertura por um cookie e limpa a URL.
      if (url.pathname === '/' && url.searchParams.has('t')) {
        if (!tokenValid(url.searchParams.get('t'), token)) throw new HttpError(401, 'token inválido');
        res.writeHead(302, { 'set-cookie': `sa=${token}; HttpOnly; SameSite=Strict; Path=/`, location: '/' });
        return void res.end();
      }
      if (!tokenValid(cookieToken(req), token)) {
        throw new HttpError(401, 'Abra o app pelo endereço que apareceu no terminal.');
      }

      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'método não permitido');
      return await serveStatic(res, url.pathname);
    } catch (e) {
      if (res.headersSent) return void res.destroy();
      if (e instanceof HttpError) return json(res, e.status, { error: e.message, ...e.extra });
      if (e instanceof ConflictError) return json(res, 409, { error: e.message, code: 'conflict', currentHash: e.currentHash });
      if (e instanceof NotFoundError) return json(res, 404, { error: e.message });
      if (e instanceof PathError) return json(res, 400, { error: e.message });
      console.error(e);
      json(res, 500, { error: 'erro interno' });
    }
  });

  const first = opts.port ?? 4317;
  await new Promise<void>((resolve, reject) => {
    let attempt = 0;
    const tryListen = () => {
      port = first === 0 ? 0 : first + attempt;
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && first !== 0 && attempt < 20) {
          attempt++;
          tryListen();
        } else reject(err);
      });
      server.listen(port, '127.0.0.1', () => {
        server.removeAllListeners('error');
        port = (server.address() as { port: number }).port;
        resolve();
      });
    };
    tryListen();
  });

  const url = `http://127.0.0.1:${port}/?t=${token}`;
  if (opts.open) openBrowser(url);

  return {
    url, port, token,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {
    // Sem navegador padrão: o endereço já foi impresso no terminal.
  }
}
