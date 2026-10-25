import { watch, type FSWatcher } from 'node:fs';

export interface VaultWatcher {
  close(): void;
}

const DEBOUNCE_MS = 200;

/**
 * Avisa quando qualquer ferramenta cria, muda ou apaga um arquivo do vault.
 * Junta rajadas de eventos (um salvamento gera vários) numa lista só.
 * Arquivos e pastas que começam com ponto (.superapp, .git, temporários) ficam de fora.
 */
export function watchVault(root: string, onChange: (paths: string[]) => void): VaultWatcher {
  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let w: FSWatcher | undefined;

  const flush = () => {
    timer = undefined;
    const paths = [...pending];
    pending = new Set();
    if (paths.length) onChange(paths);
  };

  try {
    w = watch(root, { recursive: true, persistent: false }, (_event, filename) => {
      if (!filename) return;
      const rel = filename.toString().split('\\').join('/');
      const parts = rel.split('/');
      if (parts.some((p) => p.startsWith('.') || p === 'node_modules')) return;
      pending.add(rel);
      timer ??= setTimeout(flush, DEBOUNCE_MS);
    });
    w.on('error', () => w?.close());
  } catch (e) {
    // Sem suporte (ou limite de watchers esgotado): o app segue sem atualização ao vivo.
    console.warn('Aviso: não consegui observar a pasta; mudanças externas só aparecem ao recarregar.', (e as Error).message);
  }

  return {
    close() {
      clearTimeout(timer);
      w?.close();
    },
  };
}
