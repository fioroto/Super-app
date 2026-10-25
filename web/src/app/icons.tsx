import type { ComponentChildren } from 'preact';

// Ícones de 16 px no estilo de traço fino (24×24, traço 2, pontas arredondadas), desenhados à mão.
// Só os que a interface usa: sem biblioteca de ícones.
const svg = (children: ComponentChildren) => (
  <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const IconNote = () => svg(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M12 11v6M9 14h6" /></>);
export const IconBoard = () => svg(<><rect x="3" y="4" width="5" height="16" /><rect x="10" y="4" width="5" height="10" /><rect x="17" y="4" width="4" height="13" /></>);
export const IconDraw = () => svg(<><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" /><path d="M14 7l3 3" /></>);
export const IconFolder = () => svg(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 11v5M9.5 13.5h5" /></>);
export const IconDiagram = () => svg(<><rect x="3" y="3" width="7" height="6" /><rect x="14" y="15" width="7" height="6" /><path d="M6.5 9v3a3 3 0 0 0 3 3H14" /></>);
export const IconHtml = () => svg(<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />);
export const IconPrint = () => svg(<><path d="M7 9V3h10v6" /><rect x="3" y="9" width="18" height="8" /><rect x="7" y="14" width="10" height="7" /></>);
export const IconHistory = () => svg(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></>);
