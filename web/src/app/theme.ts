import { signal } from '@preact/signals';

export type Theme = 'auto' | 'light' | 'dark';
const KEY = 'superapp.theme';

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch { /* sem armazenamento: segue o sistema */ }
  return 'auto';
}

export const theme = signal<Theme>(read());

export function applyTheme(): void {
  const t = theme.value;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

export function cycleTheme(): void {
  theme.value = ({ auto: 'light', light: 'dark', dark: 'auto' } as const)[theme.value];
  applyTheme();
  try {
    if (theme.value === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme.value);
  } catch { /* ignora */ }
}
