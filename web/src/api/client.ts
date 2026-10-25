export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number;
  mtime?: number;
  children?: TreeNode[];
}
export interface FileData { content: string; hash: string; mtime: number }
export interface VaultInfo { name: string; root: string }
export interface DirList { path: string; parent: string | null; dirs: string[] }

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error ?? `erro ${status}`));
    this.status = status;
    this.body = body;
  }
  get conflict(): boolean { return this.status === 409 && this.body.code === 'conflict'; }
}

async function call<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  state: () => call<{ vault: VaultInfo | null; recents: string[] }>('GET', '/api/state'),
  dirs: (path: string) => call<DirList>('GET', `/api/dirs?path=${enc(path)}`),
  openVault: (path: string) => call<{ vault: VaultInfo }>('POST', '/api/vault', { path }),
  tree: () => call<TreeNode>('GET', '/api/tree'),
  read: (path: string) => call<FileData>('GET', `/api/file?path=${enc(path)}`),
  write: (path: string, content: string, hash: string | null, force = false) =>
    call<{ hash: string; mtime: number }>('PUT', '/api/file', { path, content, hash, force }),
  remove: (path: string) => call<{ trash: string }>('DELETE', `/api/file?path=${enc(path)}`),
  rename: (from: string, to: string) => call<{ ok: true }>('POST', '/api/rename', { from, to }),
  mkdir: (path: string) => call<{ ok: true }>('POST', '/api/mkdir', { path }),
  attach: (file: Blob, name: string) =>
    call<{ path: string }>('POST', '/api/attachment', undefined, {
      body: file,
      headers: { 'x-filename': enc(name) },
    }),
  rawUrl: (path: string) => `/api/raw?path=${enc(path)}`,
};
