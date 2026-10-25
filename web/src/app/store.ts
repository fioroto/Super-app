import { signal } from '@preact/signals';
import { api, ApiError, type TreeNode, type VaultInfo } from '../api/client.ts';

/** undefined = ainda carregando; null = nenhuma pasta aberta. */
export const vault = signal<VaultInfo | null | undefined>(undefined);
export const recents = signal<string[]>([]);
export const tree = signal<TreeNode | null>(null);
export const error = signal<string | null>(null);

export interface Doc {
  path: string;
  text: string;
  hash: string | null;
  state: 'ok' | 'dirty' | 'saving' | 'conflict' | 'error';
}
export const doc = signal<Doc | null>(null);

export async function boot(): Promise<void> {
  const s = await api.state();
  vault.value = s.vault;
  recents.value = s.recents;
  if (s.vault) await refreshTree();
}

export async function chooseVault(path: string): Promise<void> {
  try {
    const r = await api.openVault(path);
    doc.value = null;
    vault.value = r.vault;
    await refreshTree();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

export async function refreshTree(): Promise<void> {
  tree.value = await api.tree();
}

export async function openFile(path: string): Promise<void> {
  try {
    await flush();
    const f = await api.read(path);
    doc.value = { path, text: f.content, hash: f.hash, state: 'ok' };
    error.value = null;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;

export function edit(text: string): void {
  const d = doc.value;
  if (!d || d.text === text) return;
  doc.value = { ...d, text, state: 'dirty' };
  clearTimeout(timer);
  timer = setTimeout(() => void save(), 800);
}

export async function flush(): Promise<void> {
  clearTimeout(timer);
  if (doc.value?.state === 'dirty') await save();
}

export async function save(): Promise<void> {
  const d = doc.value;
  if (!d || d.state === 'saving') return;
  doc.value = { ...d, state: 'saving' };
  try {
    const r = await api.write(d.path, d.text, d.hash);
    const now = doc.value;
    if (now?.path === d.path) {
      doc.value = { ...now, hash: r.hash, state: now.text === d.text ? 'ok' : 'dirty' };
      if (doc.value.state === 'dirty') timer = setTimeout(() => void save(), 800);
    }
  } catch (e) {
    const now = doc.value;
    if (now?.path === d.path) {
      doc.value = { ...now, state: e instanceof ApiError && e.conflict ? 'conflict' : 'error' };
      if (!(e instanceof ApiError && e.conflict)) error.value = (e as Error).message;
    }
  }
}
