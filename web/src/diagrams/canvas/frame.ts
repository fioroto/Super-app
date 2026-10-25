// Roda DENTRO do iframe /canvas.html. É a única parte do app que usa React e Excalidraw.
// Fechar a aba remove o iframe e o navegador descarta todo o heap dele.
import '@excalidraw/excalidraw/index.css';
import { Excalidraw, exportToSvg, serializeAsJSON } from '@excalidraw/excalidraw';
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { serializeDrawing, type Drawing, type Scene } from './excalidrawMd.ts';
import { parseDrawing } from './excalidrawParse.ts';

// Fontes servidas pelo próprio app (nada de CDN).
(window as any).EXCALIDRAW_ASSET_PATH = '/excalidraw/';

const TEXT_DELAY = 300;
const SVG_DELAY = 1500;

const post = (msg: unknown) => parent.postMessage(msg, location.origin);

let root: any;
let drawing: Drawing;
let api: any;
let dark = false;
let version = -1;
let latest: { elements: any[]; appState: any; files: any } | undefined;
let textTimer: ReturnType<typeof setTimeout> | undefined;
let svgTimer: ReturnType<typeof setTimeout> | undefined;
let textPending = false;
let svgPending = false;

const versionOf = (elements: readonly any[]) => elements.reduce((n, e) => n + e.version, elements.length);

function currentScene(): Scene | null {
  if (!latest) return null;
  const json = JSON.parse(serializeAsJSON(latest.elements, latest.appState, latest.files, 'database'));
  return { ...drawing.scene, elements: json.elements, appState: json.appState, files: json.files };
}

function sendText() {
  textTimer = undefined;
  textPending = false;
  const scene = currentScene();
  if (scene) post({ type: 'text', text: serializeDrawing(scene, drawing) });
}

async function sendSvg() {
  svgTimer = undefined;
  svgPending = false;
  if (!latest) return;
  const elements = latest.elements.filter((e) => !e.isDeleted);
  if (!elements.length) return;
  const svg = await exportToSvg({
    elements,
    appState: { exportBackground: true, viewBackgroundColor: latest.appState.viewBackgroundColor, exportWithDarkMode: false },
    files: latest.files,
    exportPadding: 16,
  });
  post({ type: 'svg', svg: svg.outerHTML });
}

function onChange(elements: readonly any[], appState: any, files: any) {
  const v = versionOf(elements);
  if (v === version) return; // só moveu a tela ou mudou a seleção
  const first = version === -1;
  version = v;
  latest = { elements: [...elements], appState, files };
  if (first) return;
  textPending = svgPending = true;
  clearTimeout(textTimer);
  clearTimeout(svgTimer);
  textTimer = setTimeout(sendText, TEXT_DELAY);
  svgTimer = setTimeout(() => void sendSvg(), SVG_DELAY);
}

function render() {
  const props = {
    initialData: { elements: drawing.scene.elements, appState: { ...drawing.scene.appState, collaborators: new Map() }, files: drawing.scene.files, scrollToContent: true },
    excalidrawAPI: (a: unknown) => { api = a; },
    onChange,
    theme: dark ? 'dark' : 'light',
    langCode: 'pt-BR',
    aiEnabled: false,
    UIOptions: { canvasActions: { loadScene: false, export: false, saveAsImage: false, saveToActiveFile: false, toggleTheme: false } },
  };
  root ??= createRoot(document.getElementById('root')!);
  root.render(h(Excalidraw as any, props));
}

addEventListener('message', async (e) => {
  if (e.origin !== location.origin || e.source !== parent) return;
  const m = e.data;
  if (m?.type === 'init') {
    const parsed = parseDrawing(String(m.text ?? ''));
    if (!parsed) return post({ type: 'bad', message: 'Este arquivo não está no formato de desenho do Excalidraw.' });
    drawing = parsed;
    dark = !!m.dark;
    render();
  } else if (m?.type === 'theme') {
    dark = !!m.dark;
    if (root && drawing) render();
  } else if (m?.type === 'flush') {
    clearTimeout(textTimer);
    clearTimeout(svgTimer);
    if (textPending) sendText();
    if (svgPending) await sendSvg();
    post({ type: 'flushed' });
  }
});

post({ type: 'ready' });
