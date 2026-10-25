import { decompressFromBase64 } from 'lz-string';
import type { Drawing } from './excalidrawMd.ts';

const HEAD = /^# Excalidraw Data[ \t]*\r?$/m;
const EMBEDDED = /^## Embedded Files[ \t]*\r?$/m;
const DRAWING = /^%%[ \t]*\r?\n## Drawing[ \t]*\r?\n```(compressed-json|json)[ \t]*\r?\n([\s\S]*?)\r?\n?```[ \t]*\r?\n%%[ \t]*(?:\r?\n|$)/m;

/**
 * Lê um .excalidraw.md. Entende o desenho em JSON puro e em `compressed-json`
 * (o padrão do plugin do Obsidian). Devolve null se o arquivo não tiver esse formato.
 */
export function parseDrawing(md: string): Drawing | null {
  const head = HEAD.exec(md);
  const drawing = DRAWING.exec(md);
  if (!head || !drawing || drawing.index < head.index) return null;

  let json = drawing[2]!;
  if (drawing[1] === 'compressed-json') {
    const out = decompressFromBase64(json.replace(/\s+/g, ''));
    if (!out) return null;
    json = out;
  }
  let scene: any;
  try { scene = JSON.parse(json); } catch { return null; }
  if (scene?.type !== 'excalidraw' || !Array.isArray(scene.elements)) return null;

  const middle = md.slice(head.index, drawing.index);
  const emb = EMBEDDED.exec(middle);
  return {
    prefix: md.slice(0, head.index),
    embedded: emb ? middle.slice(emb.index) : '',
    suffix: md.slice(drawing.index + drawing[0].length),
    // A ordem das chaves do arquivo é mantida: reescrever sem mudar nada não gera diff.
    scene: { ...scene, appState: scene.appState ?? {}, files: scene.files ?? {} },
  };
}
