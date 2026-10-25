import { signal } from '@preact/signals';

export interface DialogState {
  kind: 'ask' | 'confirm';
  title: string;
  initial: string;
  done: (value: string | boolean | null) => void;
}

export const dialog = signal<DialogState | null>(null);

export const ask = (title: string, initial = ''): Promise<string | null> =>
  new Promise((resolve) => {
    dialog.value = { kind: 'ask', title, initial, done: (v) => { dialog.value = null; resolve(v as string | null); } };
  });

export const confirmBox = (title: string): Promise<boolean> =>
  new Promise((resolve) => {
    dialog.value = { kind: 'confirm', title, initial: '', done: (v) => { dialog.value = null; resolve(v === true); } };
  });
