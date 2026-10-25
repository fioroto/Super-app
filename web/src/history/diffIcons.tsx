import { svg } from '../app/icons.tsx';

// Ícones da comparação, no mesmo traço dos outros. Ficam aqui para irem só no pedaço do histórico.
export const IconUp = () => svg(<path d="M12 19V5M5 12l7-7 7 7" />);
export const IconDown = () => svg(<path d="M12 5v14M5 12l7 7 7-7" />);
export const IconSplit = () => svg(<><rect x="3" y="4" width="18" height="16" /><path d="M12 4v16" /></>);
export const IconInline = () => svg(<><rect x="3" y="4" width="18" height="16" /><path d="M3 12h18" /></>);
export const IconUnfold = () => svg(<path d="M7 9l5-5 5 5M7 15l5 5 5-5" />);
export const IconFold = () => svg(<path d="M7 4l5 5 5-5M7 20l5-5 5 5" />);
export const IconRevert = () => svg(<path d="M4 12h15M13 6l6 6-6 6" />);
