import { Facet } from '@codemirror/state';

/** Caminho da nota aberta; os widgets usam para achar imagens e links relativos. */
export const notePathFacet = Facet.define<() => string, () => string>({ combine: (v) => v[0] ?? (() => '') });
