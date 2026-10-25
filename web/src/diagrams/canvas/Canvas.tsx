import { useEffect, useRef, useState } from 'preact/hooks';
import { isDark } from '../../preview/mermaid.ts';
import { theme } from '../../app/theme.ts';
import { asText, edit, registerFlusher, saveDerived } from '../../app/store.ts';

/** Ponte entre a aba e o iframe do Excalidraw. O texto do arquivo só viaja no 'init'. */
export function Canvas({ path, text }: { path: string; text: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const initial = useRef(text);
  const [bad, setBad] = useState<string | null>(null);
  const dark = (theme.value, isDark());
  const darkNow = useRef(dark);
  darkNow.current = dark;

  const send = (msg: unknown) => frame.current?.contentWindow?.postMessage(msg, location.origin);

  useEffect(() => {
    let flushed: (() => void) | undefined;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      const m = e.data;
      if (m?.type === 'ready') send({ type: 'init', text: initial.current, dark: darkNow.current });
      else if (m?.type === 'text') edit(path, m.text);
      else if (m?.type === 'svg') void saveDerived(path.replace(/\.md$/i, '.svg'), m.svg);
      else if (m?.type === 'bad') setBad(m.message);
      else if (m?.type === 'flushed') flushed?.();
    };
    addEventListener('message', onMessage);
    // Antes de trocar ou fechar a aba, pede o último estado ao desenho.
    const unregister = registerFlusher(path, () => new Promise<void>((resolve) => {
      flushed = resolve;
      send({ type: 'flush' });
      setTimeout(resolve, 3000);
    }));
    return () => { removeEventListener('message', onMessage); unregister(); };
  }, [path]);

  useEffect(() => send({ type: 'theme', dark }), [dark]);

  if (bad) {
    return (
      <div class="empty">
        <p>{bad}</p>
        <button class="btn" onClick={() => asText(path)}>Abrir como texto</button>
      </div>
    );
  }
  return <iframe ref={frame} class="canvas-frame" src="/canvas.html" title="Desenho" />;
}
