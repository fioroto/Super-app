import { useState } from 'preact/hooks';
import type { TreeNode } from '../api/client.ts';
import { doc, openFile } from './store.ts';

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const pad = { paddingLeft: `${8 + depth * 14}px` };
  if (node.type === 'dir') {
    return (
      <>
        <button class="tree-item dir" style={pad} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} {node.name}
        </button>
        {open && node.children?.map((c) => <Node key={c.path} node={c} depth={depth + 1} />)}
      </>
    );
  }
  return (
    <button
      class={`tree-item${doc.value?.path === node.path ? ' active' : ''}`}
      style={pad}
      onClick={() => openFile(node.path)}
    >
      {node.name}
    </button>
  );
}

export function Tree({ root }: { root: TreeNode }) {
  return <nav class="tree">{root.children?.map((c) => <Node key={c.path} node={c} depth={0} />)}</nav>;
}
