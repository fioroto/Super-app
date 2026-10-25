import { computed, signal } from '@preact/signals';
import { api, ApiError, type TreeNode, type VaultInfo } from '../api/client.ts';
import { basename, dirname, join, kindOf, sanitizePath, type Kind } from './files.ts';
import { ask, confirmBox } from './dialog.ts';
import { emptyScene, serializeDrawing } from '../diagrams/canvas/excalidrawMd.ts';
import { emptyBoardText, isKanban } from '../kanban/kanbanMd.ts';

/** undefined = carregando; null = nenhuma pasta aberta. */
export const vault = signal<VaultInfo | null | undefined>(undefined);
export const recents = signal<string[]>([]);
export const tree = signal<TreeNode | null>(null);
export const error = signal<string | null>(null);
export const selectedDir = signal('');
export const mode = signal<'editor' | 'split' | 'preview'>('split');
export interface Picker {
  title: string;
  filter?: (path: string) => boolean;
  onPick: (path: string) => void;
}
/** Seletor de arquivo por nome (Ctrl+P e "inserir desenho"). */
export const picker = signal<Picker | null>(null);
export const openQuick = (): void => {
  picker.value = { title: 'Buscar arquivo pelo nome…', onPick: (p) => void openFile(p) };
};

export interface Doc {
  path: string;
  kind: Kind;
  text: string;
  /** Hash do disco que esta aba conhece. null = o arquivo ainda não existe. */
  hash: string | null;
  state: 'ok' | 'dirty' | 'saving' | 'conflict' | 'error';
  /** Aumenta quando o texto é trocado de fora (recarregado do disco). */
  rev: number;
  disk?: { content: string; hash: string };
  missing?: boolean;
  /** Quadro mostrado como texto Markdown em vez de quadro. */
  raw?: boolean;
}

export const docs = signal<Doc[]>([]);
export const activePath = signal<string | null>(null);
export const active = computed(() => docs.value.find((d) => d.path === activePath.value) ?? null);

const patch = (path: string, p: Partial<Doc> | ((d: Doc) => Partial<Doc>)) => {
  docs.value = docs.value.map((d) => (d.path === path ? { ...d, ...(typeof p === 'function' ? p(d) : p) } : d));
};
const find = (path: string) => docs.value.find((d) => d.path === path);
const fail = (e: unknown) => { error.value = (e as Error).message; };

// ---------- abrir / fechar ----------

export async function boot(): Promise<void> {
  const s = await api.state();
  vault.value = s.vault;
  recents.value = s.recents;
  if (s.vault) await refreshTree();
  connectEvents();
}

export async function chooseVault(path: string): Promise<void> {
  try {
    const r = await api.openVault(path);
    docs.value = [];
    activePath.value = null;
    selectedDir.value = '';
    vault.value = r.vault;
    await refreshTree();
  } catch (e) {
    fail(e);
  }
}

export async function refreshTree(): Promise<void> {
  try { tree.value = await api.tree(); } catch (e) { fail(e); }
}

export async function openFile(path: string): Promise<void> {
  error.value = null;
  selectedDir.value = dirname(path);
  if (find(path)) { await activate(path); return; }
  const kind = kindOf(path);
  try {
    await flushers.get(activePath.value ?? '')?.();
    if (kind === 'md' || kind === 'text' || kind === 'canvas') {
      const f = await api.read(path);
      const real: Kind = kind === 'md' && isKanban(f.content) ? 'kanban' : kind;
      docs.value = [...docs.value, { path, kind: real, text: f.content, hash: f.hash, state: 'ok', rev: 0 }];
    } else {
      docs.value = [...docs.value, { path, kind, text: '', hash: null, state: 'ok', rev: 0 }];
    }
    activePath.value = path;
  } catch (e) {
    fail(e);
  }
}

/** Abas de desenho vivem num iframe: antes de sair delas, pede-se o último estado. */
const flushers = new Map<string, () => Promise<void>>();
export function registerFlusher(path: string, fn: () => Promise<void>): () => void {
  flushers.set(path, fn);
  return () => { if (flushers.get(path) === fn) flushers.delete(path); };
}

export async function activate(path: string): Promise<void> {
  const cur = activePath.value;
  if (cur && cur !== path) await flushers.get(cur)?.();
  activePath.value = path;
}

export async function closeFile(path: string): Promise<void> {
  await flushers.get(path)?.();
  await flush(path);
  const list = docs.value;
  const i = list.findIndex((d) => d.path === path);
  if (i < 0) return;
  docs.value = list.filter((d) => d.path !== path);
  if (activePath.value === path) activePath.value = (list[i + 1] ?? list[i - 1])?.path ?? null;
}

// ---------- edição e salvamento ----------

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function edit(path: string, text: string): void {
  const d = find(path);
  if (!d || d.text === text) return;
  patch(path, { text, state: d.state === 'conflict' ? 'conflict' : 'dirty' });
  if (d.state === 'conflict') return;
  clearTimeout(timers.get(path));
  timers.set(path, setTimeout(() => void save(path), 800));
}

export async function flush(path: string): Promise<void> {
  clearTimeout(timers.get(path));
  timers.delete(path);
  if (find(path)?.state === 'dirty') await save(path);
}

export async function save(path: string): Promise<void> {
  const d = find(path);
  if (!d || d.state === 'saving' || d.state === 'conflict') return;
  patch(path, { state: 'saving' });
  try {
    const r = await api.write(path, d.text, d.hash);
    const now = find(path);
    if (!now) return;
    const changedMeanwhile = now.text !== d.text;
    patch(path, { hash: r.hash, missing: false, state: changedMeanwhile ? 'dirty' : 'ok' });
    if (changedMeanwhile) timers.set(path, setTimeout(() => void save(path), 800));
    else void refreshTreeSoon();
  } catch (e) {
    if (e instanceof ApiError && e.conflict) {
      // O disco mudou desde a última leitura: busca a versão de lá para o usuário decidir.
      const disk = await api.read(path).catch(() => null);
      patch(path, { state: 'conflict', disk: disk ? { content: disk.content, hash: disk.hash } : undefined });
    } else {
      patch(path, { state: 'dirty' });
      fail(e);
    }
  }
}

export function keepMine(path: string): void {
  const d = find(path);
  if (!d) return;
  patch(path, { hash: d.disk?.hash ?? null, disk: undefined, state: 'dirty' });
  void save(path);
}

export function takeDisk(path: string): void {
  const d = find(path);
  if (!d?.disk) return;
  patch(path, { text: d.disk.content, hash: d.disk.hash, disk: undefined, state: 'ok', rev: d.rev + 1 });
}

// ---------- mudanças feitas por outras ferramentas ----------

let treeTimer: ReturnType<typeof setTimeout> | undefined;
function refreshTreeSoon(): Promise<void> | void {
  clearTimeout(treeTimer);
  treeTimer = setTimeout(() => void refreshTree(), 250);
}

async function checkOpenDoc(path: string): Promise<void> {
  const d = find(path);
  if (!d || d.kind === 'image' || d.kind === 'other') return;
  try {
    const f = await api.read(path);
    if (f.hash === d.hash) return; // eco do nosso próprio salvamento
    if (d.state === 'ok') patch(path, { text: f.content, hash: f.hash, rev: d.rev + 1, missing: false });
    else patch(path, { state: 'conflict', disk: { content: f.content, hash: f.hash } });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      // Apagado por fora: a aba fica aberta; salvar recria o arquivo.
      patch(path, { hash: null, missing: true });
    }
  }
}

let events: EventSource | undefined;
export function connectEvents(): void {
  events?.close();
  let first = true;
  const es = (events = new EventSource('/api/events'));
  es.onopen = () => {
    if (first) { first = false; return; }
    void refreshTree(); // reconectou: o que mudou enquanto isso?
    docs.value.forEach((d) => void checkOpenDoc(d.path));
  };
  es.onmessage = (ev) => {
    const { paths } = JSON.parse(ev.data) as { paths: string[] };
    void refreshTree();
    for (const p of paths) void checkOpenDoc(p);
  };
}

/** Grava um arquivo derivado (o .svg de um desenho) sem conferir conflito: ele é sempre refeito. */
export async function saveDerived(path: string, content: string): Promise<void> {
  try {
    await api.write(path, content, null, true);
    void refreshTreeSoon();
  } catch (e) { fail(e); }
}

/** Abre um desenho que o app não conseguiu ler como texto comum. */
export function asText(path: string): void {
  patch(path, { kind: 'text', rev: (find(path)?.rev ?? 0) + 1 });
}

// ---------- criar, renomear, excluir ----------

export async function newNote(): Promise<void> {
  const name = await ask('Nome da nota', 'sem-titulo');
  if (!name) return;
  const clean = sanitizePath(name);
  if (!clean) return;
  const path = join(selectedDir.value, /\.[a-z0-9]+$/i.test(clean) ? clean : `${clean}.md`);
  try {
    await api.write(path, '', null);
    await refreshTree();
    await openFile(path);
  } catch (e) {
    fail(e instanceof ApiError && e.conflict ? new Error('Já existe um arquivo com esse nome.') : e);
  }
}

export async function newDrawing(): Promise<void> {
  const name = await ask('Nome do desenho', 'desenho');
  if (!name) return;
  const base = sanitizePath(name).replace(/(\.excalidraw)?(\.md)?$/i, '');
  if (!base) return;
  const path = join(selectedDir.value, `${base}.excalidraw.md`);
  try {
    await api.write(path, serializeDrawing(emptyScene()), null);
    await refreshTree();
    await openFile(path);
  } catch (e) {
    fail(e instanceof ApiError && e.conflict ? new Error('Já existe um arquivo com esse nome.') : e);
  }
}

export function toggleRaw(path: string): void {
  patch(path, (d) => ({ raw: !d.raw }));
}

export async function newBoard(): Promise<void> {
  const name = await ask('Nome do quadro', 'quadro');
  const clean = name ? sanitizePath(name) : '';
  if (!clean) return;
  const path = join(selectedDir.value, /\.md$/i.test(clean) ? clean : `${clean}.md`);
  try {
    await api.write(path, emptyBoardText(), null);
    await refreshTree();
    await openFile(path);
  } catch (e) {
    fail(e instanceof ApiError && e.conflict ? new Error('Já existe um arquivo com esse nome.') : e);
  }
}

export async function newFolder(): Promise<void> {
  const name = await ask('Nome da pasta');
  if (!name) return;
  const clean = sanitizePath(name);
  if (!clean) return;
  try {
    await api.mkdir(join(selectedDir.value, clean));
    await refreshTree();
  } catch (e) { fail(e); }
}

export async function renameItem(path: string): Promise<void> {
  const name = await ask('Novo nome', basename(path));
  const clean = name ? sanitizePath(name) : '';
  if (!clean || clean === basename(path)) return;
  const to = join(dirname(path), clean);
  try {
    await flush(path);
    await api.rename(path, to);
    docs.value = docs.value.map((d) =>
      d.path === path ? { ...d, path: to } : d.path.startsWith(`${path}/`) ? { ...d, path: to + d.path.slice(path.length) } : d);
    if (activePath.value === path) activePath.value = to;
    await refreshTree();
  } catch (e) {
    fail(e instanceof ApiError && e.conflict ? new Error('Já existe algo com esse nome.') : e);
  }
}

export async function deleteItem(path: string): Promise<void> {
  if (!(await confirmBox(`Mover "${basename(path)}" para a lixeira?`))) return;
  try {
    await api.remove(path);
    for (const d of docs.value) if (d.path === path || d.path.startsWith(`${path}/`)) await closeFile(d.path);
    await refreshTree();
  } catch (e) { fail(e); }
}
