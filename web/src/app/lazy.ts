import { useEffect, useState } from 'preact/hooks';

/** Carrega um módulo na primeira vez que o componente aparece. */
export function useLazy<T>(load: () => Promise<T>): T | null {
  const [mod, setMod] = useState<T | null>(null);
  useEffect(() => { void load().then((m) => setMod(() => m)); }, []);
  return mod;
}
