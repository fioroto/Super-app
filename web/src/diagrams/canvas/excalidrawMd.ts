// Formato .excalidraw.md do plugin Obsidian Excalidraw. Este arquivo só escreve;
// a leitura (que entende também o formato comprimido) fica em excalidrawParse.ts
// para o app principal não carregar a biblioteca de descompressão.

export interface Scene {
  type: 'excalidraw';
  version: 2;
  source: string;
  elements: any[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

/** Partes do arquivo que o app não entende e precisa devolver como vieram. */
export interface Keep {
  prefix: string;
  embedded: string;
  suffix: string;
}

export interface Drawing extends Keep {
  scene: Scene;
}

export const HEADER =
  '---\n\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n\n---\n' +
  "==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠== You can decompress Drawing data with the command palette: 'Decompress current Excalidraw file'. For more info check in plugin settings under 'Saving'\n\n\n";

export const emptyScene = (): Scene => ({
  type: 'excalidraw',
  version: 2,
  source: 'super-app',
  elements: [],
  appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
  files: {},
});

/** Texto dos elementos de texto, uma linha por elemento, para busca em outras ferramentas. */
function textSection(scene: Scene): string {
  return scene.elements
    .filter((e) => e.type === 'text' && !e.isDeleted && typeof (e.originalText ?? e.text) === 'string')
    .map((e) => `${String(e.originalText ?? e.text).replace(/\s*\n\s*/g, ' ').trim()} ^${e.id}\n\n`)
    .join('');
}

export function serializeDrawing(scene: Scene, keep: Partial<Keep> = {}): string {
  const prefix = keep.prefix ?? HEADER;
  return (
    `${prefix}# Excalidraw Data\n\n## Text Elements\n${textSection(scene)}${keep.embedded ?? ''}` +
    `%%\n## Drawing\n\`\`\`json\n${JSON.stringify(scene)}\n\`\`\`\n%%\n${keep.suffix ?? ''}`
  );
}
