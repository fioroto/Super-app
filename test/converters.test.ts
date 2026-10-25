import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compressToBase64 } from 'lz-string';
import { describe, expect, it } from 'vitest';
import { emptyScene, HEADER, serializeDrawing, type Scene } from '../web/src/diagrams/canvas/excalidrawMd.ts';
import { parseDrawing } from '../web/src/diagrams/canvas/excalidrawParse.ts';

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');

const scene: Scene = {
  ...emptyScene(),
  elements: [
    { id: 'r1', type: 'rectangle', x: 10, y: 20, width: 100, height: 50, version: 3, isDeleted: false },
    { id: 't1', type: 'text', x: 15, y: 30, text: 'Aprovação\nrápida', originalText: 'Aprovação\nrápida', version: 2, isDeleted: false },
    { id: 't2', type: 'text', x: 0, y: 0, text: 'apagado', version: 1, isDeleted: true },
  ],
};

describe('desenho (.excalidraw.md)', () => {
  it('escrever → ler → escrever devolve o mesmo arquivo, byte a byte', () => {
    const md = serializeDrawing(scene);
    const parsed = parseDrawing(md)!;
    expect(parsed.scene.elements).toEqual(scene.elements);
    expect(serializeDrawing(parsed.scene, parsed)).toBe(md);
  });

  it('lista o texto dos elementos para busca em outras ferramentas (sem os apagados)', () => {
    const md = serializeDrawing(scene);
    expect(md).toContain('## Text Elements\nAprovação rápida ^t1\n\n%%');
    const section = md.slice(md.indexOf('## Text Elements'), md.indexOf('%%'));
    expect(section).not.toContain('apagado');
  });

  it('lê o formato comprimido do plugin do Obsidian e chega na mesma cena', () => {
    const json = JSON.stringify(scene);
    const packed = compressToBase64(json).replace(/(.{256})/g, '$1\n');
    const md = `---\n\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n\n---\n==⚠  aviso ⚠==\n\n\n# Excalidraw Data\n\n## Text Elements\nAprovação rápida ^t1\n\n%%\n## Drawing\n\`\`\`compressed-json\n${packed}\n\`\`\`\n%%`;
    const parsed = parseDrawing(md)!;
    expect(parsed.scene.elements).toEqual(scene.elements);
    expect(parsed.suffix).toBe('');
  });

  it('preserva o que o app não entende: frontmatter do usuário, arquivos embutidos e texto depois', () => {
    const custom = '---\nexcalidraw-plugin: parsed\ntags: [excalidraw, projeto-x]\nautor: eu\n---\n';
    const md =
      `${custom}# Excalidraw Data\n\n## Text Elements\n## Embedded Files\nabc123: [[foto.png]]\n\n%%\n## Drawing\n\`\`\`json\n${JSON.stringify(scene)}\n\`\`\`\n%%\nnota solta\n`;
    const parsed = parseDrawing(md)!;
    expect(parsed.prefix).toBe(custom);
    expect(parsed.embedded).toBe('## Embedded Files\nabc123: [[foto.png]]\n\n');
    expect(parsed.suffix).toBe('nota solta\n');
    const again = serializeDrawing({ ...parsed.scene, elements: [...parsed.scene.elements] }, parsed);
    expect(parseDrawing(again)!.prefix).toBe(custom);
    expect(again.endsWith('%%\nnota solta\n')).toBe(true);
    expect(again).toContain('## Embedded Files\nabc123: [[foto.png]]');
  });

  it('um desenho vazio é lido de volta', () => {
    const md = serializeDrawing(emptyScene());
    expect(md.startsWith(HEADER)).toBe(true);
    expect(parseDrawing(md)!.scene.elements).toEqual([]);
  });

  it.each([
    ['texto comum', '# Só uma nota\n\nsem desenho\n'],
    ['JSON quebrado', '# Excalidraw Data\n\n## Text Elements\n%%\n## Drawing\n```json\n{ quebrado\n```\n%%\n'],
    ['não é um desenho', '# Excalidraw Data\n\n## Text Elements\n%%\n## Drawing\n```json\n{"a":1}\n```\n%%\n'],
    ['compressão inválida', '# Excalidraw Data\n\n## Text Elements\n%%\n## Drawing\n```compressed-json\n!!!\n```\n%%\n'],
  ])('devolve null para %s', (_nome, md) => {
    expect(parseDrawing(md)).toBeNull();
  });

  it('lê o arquivo de exemplo guardado em test/fixtures', () => {
    const parsed = parseDrawing(fixture('exemplo.excalidraw.md'))!;
    expect(parsed.scene.elements.length).toBeGreaterThan(0);
  });
});
