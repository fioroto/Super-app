import { useState } from 'preact/hooks';
import type { TreeNode } from '../api/client.ts';
import { activePath, deleteItem, openFile, renameItem, selectedDir } from './store.ts';

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const pad = { paddingLeft: `${8 + depth * 14}px` };
  const isDir = node.type === 'dir';
  const cls = isDir ? (selectedDir.value === node.path ? ' sel-dir' : '') : activePath.value === node.path ? ' active' : '';
  const click = () => {
    if (isDir) { setOpen(!open); selectedDir.value = node.path; } else void openFile(node.path);
  };
  return (
    <>
      <div class={`tree-row${cls}`}>
        <button class={`tree-item${isDir ? ' dir' : ''}`} style={pad} onClick={click} title={node.path}>
          {isDir ? (open ? '▾ ' : '▸ ') : ''}{node.name}
        </button>
        <span class="tree-actions">
          <button title="Renomear" onClick={() => renameItem(node.path)}>✎</button>
          <button title="Excluir" onClick={() => deleteItem(node.path)}>×</button>
        </span>
      </div>
      {isDir && open && node.children?.map((c) => <Node key={c.path} node={c} depth={depth + 1} />)}
    </>
  );
}

export function Tree({ root }: { root: TreeNode }) {
  return (
    <nav class="tree" onClick={(e) => e.target === e.currentTarget && (selectedDir.value = '')}>
      {root.children?.map((c) => <Node key={c.path} node={c} depth={0} />)}
      {!root.children?.length && <p class="muted pad">Pasta vazia. Crie a primeira nota.</p>}
    </nav>
  );
}
