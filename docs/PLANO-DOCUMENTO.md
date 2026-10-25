# Plano: modo Documento (editar como no Google Docs, salvando Markdown)

Para quem vai executar: leia tudo antes de começar. As decisões da seção 2 estão fechadas. Não as reabra.

## 1. Pedido e resultado esperado

Hoje a nota abre em painel duplo: texto Markdown à esquerda, preview à direita. O pedido é um **modo padrão em que a pessoa digita e aplica formatação e a tela já mostra o resultado**, como num editor de documentos. Por baixo, o arquivo continua sendo Markdown puro, aberto sem conversão no Obsidian, VS Code e GitHub.

O app passa a ter quatro modos para notas `.md`:

| Modo | O que mostra | Padrão |
|---|---|---|
| **Documento** | Uma coluna. Título aparece grande, negrito aparece em negrito, lista tem marcador, tabela e diagrama aparecem prontos. A marcação (`**`, `#`) só aparece onde o cursor está. | sim |
| **Código** | O Markdown cru, como hoje em "Editar". | |
| **Dividido** | Código à esquerda e preview à direita, como hoje. | |
| **Ler** | Só o preview. Fica fora da barra; o botão PDF usa este modo para imprimir. | |

Quadros kanban (modo "Texto"), arquivos `.txt` e outros textos continuam no editor de código. Desenhos continuam no iframe do Excalidraw.

## 2. Decisões fechadas

| Decisão | Motivo |
|---|---|
| **Continuar no CodeMirror 6.** O texto do arquivo é o documento do editor. A formatação é desenhada por cima com *decorations* ("visualização ao vivo", como o Obsidian). | O arquivo nunca é reescrito a partir de outra estrutura. Se a pessoa não digitou, o byte não muda. Desfazer, autosave, conflito com outra ferramenta e histórico continuam iguais. Custa só código novo, sem biblioteca nova. |
| **Não usar ProseMirror, TipTap nem Milkdown.** | Eles guardam o documento numa árvore própria e regravam o Markdown inteiro ao salvar: troca `*` por `-`, muda espaçamento e quebra a sintaxe dos plugins do Obsidian. Pesam mais de 100 KB comprimidos. |
| **A marcação aparece no trecho onde o cursor está** e some no resto. | É o preço da escolha acima. Ao entrar em um negrito, os `**` aparecem; ao sair, somem. Isso difere do Google Docs, onde nunca aparecem. Em troca, a pessoa sempre vê e controla o que está no arquivo. |
| Formatar = **inserir ou remover a marcação no texto** (`**`, `#`, `- `), por atalho ou botão. | Não existe estado de formatação fora do texto. |
| Modo escolhido fica salvo em `localStorage` (`superapp.mode`), padrão `doc`. | Os testes antigos fixam `split` por esse mesmo canal (seção 8). |
| Orçamento: o JS inicial **cresce no máximo 25 KB comprimidos** (hoje 152 KB, limite 220 KB). | A regra do projeto é ser extremamente leve. |

## 3. O que já foi verificado (não refaça)

Um teste descartável rodou no Chromium com o editor atual. Resultado:

1. `ViewPlugin` com `Decoration.replace({})` esconde a marcação e `EditorView.atomicRanges` faz o cursor pular o trecho escondido. Funciona. O título perde o `# ` quando o cursor sai da linha e ganha de volta quando volta.
2. Decorations de **bloco** (diagrama, tabela) precisam vir de um **`StateField`**. O CodeMirror recusa decorations de bloco vindas de plugin.
3. Clicar num widget de bloco e fazer `dispatch({ selection })` para dentro dele troca o widget pelo código-fonte.
4. Custo por tecla num documento de **20.000 linhas**: mediana 17 ms, pior 28 ms. É o tempo de um quadro de tela; as decorations só cobrem o que está visível.
5. Nomes dos nós da árvore (lezer markdown com GFM, como em `web/src/editor/markdownLang.ts`):

| Elemento | Nós |
|---|---|
| Título `#` | `ATXHeading1`…`6`, filho `HeaderMark` (o `#`) |
| Título sublinhado | `SetextHeading1`/`2`, filho `HeaderMark` (a linha `===`/`---`) |
| Negrito / itálico | `StrongEmphasis` / `Emphasis`, filhos `EmphasisMark` |
| Riscado | `Strikethrough`, filhos `StrikethroughMark` |
| Código em linha | `InlineCode`, filhos `CodeMark` |
| Link | `Link`, filhos `LinkMark` (`[` `]` `(` `)`), `URL`, `LinkTitle` |
| Imagem | `Image`, mesmos filhos do link, `LinkMark` inicial é `![` |
| Listas | `BulletList`/`OrderedList` > `ListItem` > `ListMark`, `Paragraph` |
| Tarefa | `ListItem` > `ListMark`, `Task` > `TaskMarker` (`[ ]` ou `[x]`) |
| Citação | `Blockquote` > `QuoteMark` |
| Bloco de código | `FencedCode` > `CodeMark`, `CodeInfo`, `CodeText` |
| Tabela | `Table` > `TableHeader`/`TableRow` > `TableDelimiter`, `TableCell` (a linha `\|---\|` é um `TableDelimiter` solto) |
| Linha horizontal | `HorizontalRule` |
| HTML cru | `HTMLBlock` |

6. **Armadilha:** o frontmatter (`---` … `---` no começo do arquivo) **não existe para o lezer**. Ele lê como `HorizontalRule` + `SetextHeading2`. Detecte o frontmatter com a mesma regex de `isKanban` (`^---\r?\n[\s\S]*?\r?\n---`), ignore todos os nós dentro dele e estilize o trecho à parte.

## 4. Comportamento por elemento

"Tocado" = qualquer seleção (`state.selection.ranges`) cruza o intervalo do nó, bordas incluídas. Para elementos de linha (título, citação), "tocado" = a seleção cruza a **linha**.

| Markdown | Não tocado | Tocado |
|---|---|---|
| `# ` a `###### ` | Linha grande (`cm-live-h1`…`h6`), sem `#` | `# ` visível e esmaecido |
| `**x**` `__x__` | Negrito, sem marcas | Marcas visíveis |
| `*x*` `_x_` | Itálico, sem marcas | Marcas visíveis |
| `~~x~~` | Riscado, sem marcas | Marcas visíveis |
| `` `x` `` | Fonte mono com fundo, sem crases | Crases visíveis |
| `[t](u "título")` | Texto de link; esconde `[`, `](u "título")` | Tudo visível |
| URL solta (`Autolink`) | Estilo de link | igual |
| `![alt](src)` | **Widget inline** com a imagem (`max-width:100%`) no lugar do texto | Texto-fonte |
| `- ` `* ` `+ ` | Marcador `•` (nível 2 `◦`, nível 3 `▪`). O `-` é trocado por widget, sempre. | igual |
| `1. ` | Número em cor suave. Nada escondido. | igual |
| `- [ ]` `- [x]` | Caixa de seleção (widget no lugar do `TaskMarker`). Clicar alterna `[ ]`↔`[x]` sem mover o cursor. Marcado: texto riscado e suave. | igual |
| `> ` | Barra à esquerda, texto suave, sem `>` | `> ` visível |
| Bloco ` ``` ` comum | Linhas com fundo mono. Cercas e linguagem esmaecidas e pequenas, **não escondidas**. | igual |
| Bloco ` ```mermaid ` | **Widget de bloco** com o SVG (usa `renderDiagram`/`cached` de `preview/mermaid.ts`). Erro de sintaxe aparece no widget. | Código-fonte |
| Tabela GFM | **Widget de bloco** com a tabela (HTML de `renderMarkdown`, já limpo pelo DOMPurify) | Código-fonte em fonte mono |
| `---` (não frontmatter) | Linha horizontal | `---` visível |
| Frontmatter | Bloco discreto: mono, pequeno, fundo suave. Nunca escondido. | igual |
| `HTMLBlock` | Código esmaecido. **Nunca renderize HTML cru.** | igual |
| Título sublinhado (`===`) | Linha de texto estilizada como título; linha sublinhada esmaecida | igual |

Regras de interação:

- Clicar num widget de bloco ou de imagem leva o cursor para dentro do código-fonte dele (`dispatch({ selection })` e `view.focus()`). Para o diagrama, o cursor vai para o fim da linha da cerca de abertura. Para a tabela, para o início da primeira linha.
- Ctrl+clique (Cmd no Mac) num link: URL `http(s)` abre com `window.open(url, '_blank', 'noopener')`; caminho relativo abre a nota com `resolveRel` + `openFile`. Clique simples só posiciona o cursor.
- Imagem com URL externa (`http:`, `https:`, `//`) **não é carregada**. O widget mostra o texto `alt` em cinza. É a mesma regra do preview.
- Selecionar tudo e copiar copia o Markdown cru. Isso vem do CodeMirror; não mexa.
- Nada de `display:none` por CSS para esconder marcação. Use só `Decoration.replace`, para o cursor e a seleção respeitarem o que está escondido.
- Durante composição de texto (`view.composing`, acentos e IME), não reconstrua as decorations.

## 5. Arquitetura

Pasta nova `web/src/editor/live/`. Prefixo de classes CSS: `cm-live-`. As regras CSS ficam em `web/src/styles.css`, sob `.cm-live`.

| Arquivo | Conteúdo |
|---|---|
| `livePreview.ts` | `livePreview(opts: { notePath: () => string }): Extension`. Junta o resto e adiciona a classe `cm-live` ao editor (`EditorView.editorAttributes`). |
| `inline.ts` | `ViewPlugin` para marcas inline, classes de linha (título, citação, bloco de código, frontmatter), bullet e checkbox. Reconstrói só em `docChanged`, `selectionSet`, `viewportChanged`, e só para `view.visibleRanges`. Também fornece `atomicRanges`. |
| `blocks.ts` | `StateField` para widgets de bloco (mermaid, tabela, imagem em linha própria se preferir). Reconstrói em `docChanged` ou quando a seleção entra/sai de um bloco. Fornece `decorations` e `atomicRanges`. |
| `widgets.ts` | `BulletWidget`, `CheckboxWidget`, `ImageWidget`, `MermaidWidget`, `TableWidget`, `HrWidget`, todos com `eq()` correto (o CodeMirror reaproveita o DOM) e `estimatedHeight` nos de bloco, para o scroll não pular. |
| `format.ts` | Comandos de formatação (seção 6). Só dependem de `EditorState` e `syntaxTree`. |
| `Toolbar.tsx` | Barra de formatação (seção 7). |
| `paste.ts` | (Fase W4) colar HTML vira Markdown. |

Pontos de encaixe no código existente:

- `web/src/app/store.ts`: `mode` passa a `'doc' | 'editor' | 'split' | 'preview'`, padrão `'doc'`, lido e gravado em `localStorage` (`superapp.mode`) dentro de `try/catch`, como `theme.ts`.
- `web/src/app/App.tsx`: o seletor de modo (hoje `editor`/`split`/`preview`, rótulos Editar/Dividido/Ler) vira **Documento / Código / Dividido**. `printNote` continua usando `'preview'`. O div `panes` recebe a classe do modo; `doc` mostra só `.pane-edit`. O painel `Preview` só monta em `split` e `preview`.
- `web/src/editor/Editor.tsx`: nova prop `live: boolean` (`kind === 'md' && mode === 'doc'`). Use um `Compartment` para a extensão `livePreview`. Ao mudar `live` ou ao restaurar um estado do `cache`, faça `dispatch({ effects: compartment.reconfigure(...) })` para casar com o modo atual. `highlightActiveLine` e a fonte mono do `theme` atual passam para o lado **não-live** do `Compartment`. O lado live usa a fonte de texto (seção 9) e liga o corretor ortográfico (`EditorView.contentAttributes.of({ spellcheck: 'true', lang: 'pt-BR' })`).
- `web/src/editor/markdownLang.ts`: `continueList` ganha continuação de citação (`> `): Enter numa linha `> texto` cria `> `; Enter numa `> ` vazia sai da citação.
- Gancho de teste: quando `localStorage['superapp.test'] === '1'`, `Editor.tsx` expõe `window.__cmView = () => getView()`. Sem isso, os testes de formatação não conseguem posicionar a seleção com precisão.

## 6. Comandos de formatação (`format.ts`)

Notação: `«»` é a seleção, `|` é o cursor sem seleção. Todos os comandos trabalham sobre o texto e usam `syntaxTree` para saber se já existe a marca. Cada comando é uma única transação (um Ctrl+Z desfaz tudo).

**Inline: `toggleInline(marca)`** com `**` (negrito), `*` (itálico), `~~` (riscado), `` ` `` (código).

| Antes | Comando | Depois |
|---|---|---|
| `Olá «mundo»` | negrito | `Olá **«mundo»**` |
| `Olá **«mundo»**` | negrito | `Olá «mundo»` |
| `Olá «**mundo**»` | negrito | `Olá «mundo»` |
| `Olá **mu\|ndo**` | negrito | `Olá mu\|ndo` |
| `Olá mu\|ndo` | negrito | `Olá **mu\|ndo**` (palavra inteira) |
| `Olá \|` | negrito | `Olá **\|**` |
| `«·mundo·»` (· = espaço) | negrito | `·**mundo**·` (espaços ficam fora) |
| `«linha 1⏎linha 2»` | negrito | `**linha 1**⏎**linha 2**` (por linha; marca não atravessa parágrafo) |
| `**mu\|ndo**` | itálico | `***mu\|ndo***` |
| `«a*b»` | código | `` `«a*b»` `` |

Regra de desfazer a marca: se a seleção (ou o cursor) está dentro de um nó do mesmo tipo, remova as duas marcas desse nó. Identifique a marca pelo texto do filho (`EmphasisMark` com `**` ou `__` é negrito; com `*` ou `_` é itálico). Para escrever, use sempre `**` e `*`.

**Título: `setHeading(n)`**, n de 0 a 4 (0 = parágrafo). Em cada linha selecionada: troque o prefixo `^#{1,6}\s+` por `#`×n + espaço; n = 0 remove. Se a linha já está no nível n, volta a parágrafo. Linha que é item de lista ou citação **não muda**.

| Antes | Comando | Depois |
|---|---|---|
| `\|Texto` | título 2 | `## \|Texto` |
| `## \|Texto` | título 2 | `\|Texto` |
| `## \|Texto` | título 1 | `# \|Texto` |
| `- \|item` | título 1 | sem mudança |

**Listas: `toggleList('bullet' \| 'number' \| 'task')`**. Em cada linha não vazia selecionada, depois da indentação e de um `> ` opcional: se **todas** já são do tipo pedido, remova o marcador; senão, troque ou ponha o marcador do tipo pedido. Marcadores: `- `, `N. `, `- [ ] `. Numeração: 1, 2, 3… e **reinicia depois de linha vazia**.

| Antes | Comando | Depois |
|---|---|---|
| `«a⏎b»` | lista | `- a⏎- b` |
| `«- a⏎- b»` | lista | `a⏎b` |
| `«- a⏎- b»` | numerada | `1. a⏎2. b` |
| `«a⏎⏎b»` | numerada | `1. a⏎⏎1. b` |
| `«- [ ] a»` | tarefa | `a` |
| `«a»` | tarefa | `- [ ] a` |

**Citação: `toggleQuote`** põe ou tira `> ` em cada linha selecionada (todas já citadas = tira).

**Bloco de código: `toggleCodeBlock`**. Seleção de linhas: envolve com cercas ` ``` `. Sem seleção: insere ` ```⏎|⏎``` `. Se o cursor está dentro de um `FencedCode`, remove as cercas.

**Link: `insertLink`** (Ctrl+K). Pede a URL com o diálogo `ask()` de `app/dialog.ts`. Com seleção: `[«texto»](url)`. Sem seleção: `[url](url)`. Com o cursor num `Link` existente: o diálogo já vem com a URL atual e só troca a parte `(…)`.

**Outros:** `insertHr` (`---` entre linhas em branco), `insertTable(3,3)`, `insertImage` (seletor de arquivo → `api.attach` → `![](caminho relativo)`; reaproveite a lógica de `pasteImage` em `Editor.tsx`).

Tabela inserida (cursor na primeira célula do corpo):

```
| Coluna 1 | Coluna 2 | Coluna 3 |
| --- | --- | --- |
|  |  |  |
```

**Tab e Shift+Tab em item de lista** aumentam e diminuem o aninhamento. O recuo vem do item anterior no mesmo nível: **2 espaços** sob `- ` e `- [ ] `, **3 espaços** sob `1. `. Critério de aceite: depois do Tab, a árvore tem um `ListItem` dentro do anterior. Numeração de listas ordenadas aninhadas não é exigida. Fora de lista, Tab continua como está (`indentWithTab`).

## 7. Barra de formatação e atalhos

Uma linha abaixo da barra existente (`.bar`), classe `fmt-bar`. Aparece em `doc`, `editor` e `split` para notas `.md`. Os botões chamam os mesmos comandos da seção 6.

Botões: `Estilo` (lista: Parágrafo, Título 1, 2, 3, 4), **N** negrito, *I* itálico, ~~S~~ riscado, `</>` código, link, lista, lista numerada, tarefas, citação, bloco de código, tabela, linha horizontal, imagem. O estado do botão (ligado/desligado) acompanha a seleção: atualize em `selectionSet`. Use texto ou símbolos Unicode; não adicione biblioteca de ícones.

| Atalho | Ação |
|---|---|
| `Mod-b` | negrito |
| `Mod-i` | itálico |
| `Mod-Shift-x` | riscado |
| ``Mod-` `` | código em linha |
| `Mod-k` | link |
| `Mod-Alt-0` a `Mod-Alt-4` | parágrafo, título 1 a 4 |
| `Mod-Shift-7` / `Mod-Shift-8` / `Mod-Shift-9` | lista numerada / lista / tarefas (como no Google Docs) |
| `Mod-Shift-.` | citação |
| `Mod-Alt-c` | bloco de código |
| `Tab` / `Shift-Tab` | aninhar / desaninhar item de lista |

Atalhos com Shift: o CodeMirror tenta o nome da tecla e depois o código físico dela, então `Mod-Shift-7` e `Mod-Shift-.` devem casar. Se um não casar nos testes (`page.keyboard.press('Control+Shift+7')`), registre também o nome produzido com Shift (`Mod-Shift-&`, `Mod-Shift->`).

Evite atalhos que o navegador não deixa interceptar (`Ctrl+N`, `Ctrl+T`, `Ctrl+W`, `Ctrl+Shift+Q`). `Mod-s` e `Ctrl+P` já existem; não os troque.

## 8. Fases

Em cada fase: escreva os testes junto com o código, rode tudo, e só então faça o commit e o push na branch `ccr-8058b25a-u6woo8`. **Não crie PR.**

Comando de verificação (rode antes de cada commit):

```
npx tsc -p server && npx tsc -p web && npx vitest run && node scripts/check-size.mjs
```

### W0: modo e encaixe (sem mudar o visual)

- `mode` com 4 valores e persistência. Seletor novo (Documento / Código / Dividido).
- `Editor` com prop `live` e `Compartment` (a extensão ainda vazia).
- **Migração dos testes:** `newContext` em `test/helpers.ts` ganha o parâmetro `mode` (padrão `'split'`) e faz `ctx.addInitScript` gravando `localStorage['superapp.mode']` e `localStorage['superapp.test'] = '1'`. `withPage` repassa o parâmetro (`opts?: { mode?: Mode }`). Assim os 105 testes de hoje rodam em `split`, como antes. **Exceção:** `test/package.test.ts` cria o contexto com `browser.newContext()` direto; troque por `newContext` do helper (ele precisa de `app.run.token`; adapte o helper para aceitar `{ base, token }`) ou grave o `localStorage` com `addInitScript` ali mesmo. Sem isso, o teste `.preview h1` quebra no modo Documento.
- Teste novo: abre uma nota sem mexer em nada, o modo padrão é Documento; trocar de modo mantém o texto e o desfazer; kanban em "Texto" e arquivo `.txt` não ganham o modo Documento nem a barra.
- **Pronto quando:** os 105 testes antigos passam, com mudanças só em `test/helpers.ts` e no contexto de `test/package.test.ts`. Nenhuma asserção é alterada.

### W1: aparência inline e de linha

`inline.ts` + `livePreview.ts` + CSS. Cobre: títulos, negrito, itálico, riscado, código em linha, link, citação, linha horizontal, listas (bullet, número), tarefa com caixa, bloco de código comum, frontmatter, `HTMLBlock`, título sublinhado.

Testes (arquivo `test/documento.test.ts`, com `mode: 'doc'`):

1. Título sem `#` com o cursor fora da linha; `# ` na linha do cursor.
2. Negrito, itálico, riscado, código: sem marcas fora, com marcas dentro (`innerText` do `.cm-content`).
3. Link mostra só o texto; Ctrl+clique em link relativo abre a nota.
4. Lista mostra `•`; a caixa de tarefa alterna e grava `[x]` no **disco**.
5. **Fonte intacta:** abrir uma nota com construções variadas (use o arquivo `test/fixtures/` novo `nota-completa.md`), esperar 2 s sem digitar e conferir que o arquivo no disco é idêntico e que não há versão nova no histórico. Depois editar uma linha: só ela muda no disco.
6. Setas atravessam trechos escondidos sem "travar" (a posição do cursor avança em todo toque).
7. Frontmatter não vira linha horizontal nem título.

### W2: widgets de bloco e imagem

`blocks.ts` + `widgets.ts`. Cobre imagem, diagrama Mermaid, tabela.

Testes:

1. Imagem do vault aparece (`naturalWidth > 0`); imagem externa **não** gera requisição e mostra o `alt`.
2. Bloco `mermaid` vira SVG; ao clicar, vira código; ao sair, volta SVG; erro de sintaxe aparece no widget.
3. O Mermaid só é baixado quando a nota tem diagrama (copie o teste de `mermaid.test.ts`).
4. Tabela vira `<table>`; clique abre o código; o HTML do widget passou pelo DOMPurify (`<script>` na célula não executa).
5. Rolar um documento longo com 20 diagramas não faz o scroll pular (compare `scrollTop` antes e depois de os SVGs carregarem, tolerância de 40 px).

### W3: formatação, barra e atalhos

`format.ts` + `Toolbar.tsx` + `continueList` com citação.

Testes:

1. **Tabela de casos da seção 6, parametrizada.** Para cada linha: define o texto e a seleção por `window.__cmView()`, dispara o **atalho** (e, num subconjunto, o **botão**), lê texto e seleção finais e compara.
2. Um Ctrl+Z desfaz cada comando por inteiro.
3. Tab/Shift+Tab: a árvore (`syntaxTree`) mostra o aninhamento esperado.
4. Enter em citação continua; Enter em citação vazia sai.
5. Link: diálogo, edição de link existente. Tabela: o texto inserido casa com o modelo. Imagem: arquivo escolhido aparece em `anexos/`.
6. O estado dos botões (negrito ligado) acompanha o cursor.

### W4: acabamento

- Colar conteúdo formatado (HTML) vira Markdown. Use `turndown` (+ plugin GFM) **carregado sob demanda**, só quando o clipboard tem `text/html` com tags de estrutura (`h1`–`h6`, `ul`, `ol`, `table`, `strong`, `em`, `a`). Texto simples e imagens colam como hoje. Se `turndown` não couber no orçamento (seção 10), ponha a conversão num pedaço sob demanda e não no pacote inicial.
- Arrastar e soltar imagem no editor (`drop` com `dataTransfer.files`) segue o mesmo caminho do colar.
- Tabela: `Tab` e `Shift+Tab` andam entre células no código-fonte; `Tab` na última célula cria uma linha.
- Tipografia do modo Documento (seção 9), tema escuro, janela estreita.
- Imprimir (`printNote`) a partir do modo Documento continua funcionando.
- Atualize `README.md` (tabela "O que faz") e `docs/PLANO.md` (seção "Resultado").

Testes: colar HTML de exemplo gera Markdown esperado; soltar imagem; navegação de células; o teste de memória de `e2e.test.ts` repetido em `doc` (heap ≤ 30 MB com 1.000 linhas); digitar 30 teclas num documento de 5.000 linhas leva mediana ≤ 50 ms por tecla (margem larga para CI lento; o valor medido no protótipo foi 17 ms).

## 9. Tipografia do modo Documento

Coluna centralizada, `max-width: 80ch`, `padding: 24px 32px`. Fonte `system-ui, "Segoe UI", sans-serif`, 16 px, `line-height: 1.7` (a mesma do preview). Títulos: h1 2em/700, h2 1.55em/700, h3 1.3em/600, h4 a h6 1.1em/600, todos com `line-height: 1.25`. Código em linha e blocos em `var(--mono)`. Use as variáveis de cor existentes (`--fg`, `--muted`, `--accent`, `--bg-2`, `--bg-3`, `--line`); nada de cores novas fixas. Em `Código` e `Dividido` o editor mantém a fonte mono atual.

Pode delegar ao Haiku: o CSS de `.cm-live-*` e `.fmt-bar` a partir desta seção e da tabela da seção 4, e a lista de textos e atalhos da barra.

## 10. Orçamento e verificação final

| Item | Limite | Como medir |
|---|---|---|
| JS inicial | ≤ 220 KB gzip (hoje 152 KB; este trabalho ≤ +25 KB) | `node scripts/check-size.mjs` |
| `.zip` | ≤ 5 MB (hoje 3,8 MB) | `npm run package && node scripts/check-size.mjs` |
| Heap JS, nota de 1.000 linhas em modo Documento | ≤ 30 MB | teste de memória repetido em `doc` |
| Custo por tecla, 5.000 linhas | mediana ≤ 50 ms | teste da W4 |
| Servidor, primeira tela | sem piora | `test/package.test.ts` |

Verificação manual no fim (peça a uma pessoa, o ambiente não tem como):

1. Abrir uma nota real do Obsidian no modo Documento, editar, e conferir no Obsidian que nada mudou além do que foi digitado.
2. Digitar com acentos e com o teclado de IME no Windows, em frases com negrito no meio.

## 11. Riscos e plano B

| Risco | O que fazer |
|---|---|
| O cursor "trava" ou salta em volta de trecho escondido | Revele a marcação também quando o cursor estiver a 1 caractere da borda. Se ainda travar, troque `Decoration.replace` por `Decoration.mark({ class: 'cm-live-dim' })` (marca esmaecida, não escondida) só para esse elemento e registre em `docs/PLANO.md`. Existe uma constante `HIDE_MARKS` em `inline.ts` que liga e desliga o esconder para todos. |
| Widget de bloco faz o scroll pular | Defina `estimatedHeight` e guarde a última altura medida por conteúdo (`Map` de código → altura). |
| Reconstruir o `StateField` a cada movimento do cursor pesa em notas grandes | Reconstrua só quando `docChanged`, ou quando a seleção entra/sai de um bloco (compare o conjunto de blocos tocados antes e depois). |
| Diferença entre o preview (`marked`) e o lezer (tabela sem barra inicial, autolink) | O modo Documento segue o lezer. Não tente igualar o `marked`. |
| Texto de IME some durante a composição | Não reconstrua decorations com `view.composing`. |
| `turndown` estoura o orçamento | Carregue sob demanda; se mesmo assim passar de 15 KB comprimidos, deixe o colar HTML fora e registre. |

## 12. Regras de trabalho

- Textos da interface, comentários e mensagens de commit em português, no estilo do código existente (comentário só onde o porquê não é óbvio).
- Um commit por fase. Termine a mensagem com as duas linhas de atribuição que o ambiente indicar (`Co-Authored-By` e `Claude-Session`). Faça `git push -u origin ccr-8058b25a-u6woo8`. Nada de PR nem de push em outra branch.
- Se um teste antigo falhar por causa do modo padrão, **corrija o helper**, não o teste.
- Não remova nem enfraqueça teste para passar. Se uma medida de orçamento estourar, ache a causa (use `scripts/check-size.mjs`); não suba o limite.
- Não mexa no formato dos arquivos (`kanbanMd.ts`, `excalidrawMd.ts`) nem no servidor.
- O que **não** fazer: trocar o CodeMirror; regravar o texto a partir de outra estrutura; esconder marcação por CSS; renderizar HTML cru; baixar qualquer coisa da internet.
- Sugestão de modelos: Sonnet 5.5 para W0 a W4. Haiku para o CSS e para textos fixos. Se o problema de cursor e marcação escondida (seção 11) resistir a duas tentativas, pare e peça revisão com Opus.
