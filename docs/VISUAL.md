# Sistema visual

Inspirado em https://www.pixel-perfect.space/ (lido do HTML e do CSS do site). É um conjunto de tokens no padrão shadcn/ui, **monocromático**, com acabamento de pixel. Só o visual foi emprestado: o app continua em Preact com CSS próprio, sem Tailwind, sem biblioteca de componentes.

## O que o site faz

- Cantos retos: os botões usam `rounded-none`.
- Borda tracejada (`border-dashed`) nos botões de contorno.
- Botão primário quase preto sobre branco; secundário em cinza claro. Alturas de 36 e 40 px, `text-sm font-medium`, ícones de 16 px.
- Foco: borda `--ring` e anel de 3 px a 50%.
- Movimento: `transition-all` de 150 ms e `active:scale` de 0,95 a 0,98.
- Cabeçalho fino (48 px) com a marca em fonte de pixel (Pixelify Sans). Texto em Inter Tight.

## Tokens

| Variável | Claro | Escuro |
|---|---|---|
| `--bg` | `#ffffff` | `#171717` |
| `--bg-2` (barra lateral, barras) | `#fafafa` | `#171717` |
| `--bg-3` (hover, superfícies de apoio) | `#f5f5f5` | `#262626` |
| `--fg` | `#0a0a0a` | `#fafafa` |
| `--muted` | `#6b6b6b` | `#a1a1a1` |
| `--line` | `#e5e5e5` | `rgb(255 255 255 / .10)` |
| `--input` (borda de campo) | `#8a8a8a` | `#737373` |
| `--accent` (primário) | `#171717` | `#e5e5e5` |
| `--accent-fg` | `#fafafa` | `#171717` |
| `--ring` | `#737373` | `#737373` |
| `--bad` | `#e40014` | `#ff6568` |
| `--ok` | `#008236` | `#00bb7f` |
| `--warn` | `#b45309` | `#f99c00` |
| `--sel` | `#d4d4d4` | `#404040` |

Valores que **desviam do site de propósito**, para passar no contraste (`node scripts/check-contrast.mjs`): `--muted` claro (o site usa `#737373`, que dá 4,35:1 sobre `#f5f5f5`), `--ring` claro (`#a1a1a1` dá 2,6:1), `--input` nos dois temas (`#e5e5e5` e 15% de branco dão 1,2:1 e 1,7:1), `--ok` e `--warn` claros (os verdes e laranjas do site dão 3,2:1 sobre branco).

Sombras: cartão `0 1px 3px #0000001a, 0 1px 2px -1px #0000001a`; diálogo `0 25px 50px -12px #00000040`. Fundo atrás do diálogo: `rgb(0 0 0 / .5)`.

## Forma

- `--radius: 0` em botões, campos, abas, lanes, cartões e diálogos.
- Botão de contorno (`.btn`) tracejado; botão da barra de formatação (`.fmt-btn`) sem borda, só com hover.
- Altura dos controles: 2 rem (`--control-h`), 2,25 rem nos campos de diálogo.
- Movimento só em CSS, 150 ms, desligado com `prefers-reduced-motion`.

## Fontes

| Papel | Fonte | Arquivo | Tamanho |
|---|---|---|---|
| Interface e modo Documento | Inter Tight (variável, latino) | `@fontsource-variable/inter-tight` | 44,9 KB |
| Nome da pasta e título da escolha de pasta | Pixelify Sans 400 (latino) | `@fontsource/pixelify-sans` | 7,7 KB |
| Código | pilha do sistema | nenhum | 0 |

Ambas OFL-1.1. O latino cobre o português (U+0000–00FF). Os arquivos entram no `dist/web/assets/` com nome por conteúdo, pelo `@font-face` de `web/src/styles.css`. Nada é baixado da internet.
