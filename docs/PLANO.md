# Plano: Super-app — notas, diagramas e kanban em Markdown, leve e local

## Contexto

O repositório `fioroto/Super-app` está vazio (branch `ccr-8058b25a-u6woo8`, sem commits). O objetivo é uma ferramenta pessoal para o computador do trabalho, que já tem Node.js:

- ver e editar Markdown;
- desenhar fluxos e diagramas: Mermaid e canvas livre (Excalidraw);
- to-do em formato Kanban;
- exportar notas e guardar histórico de versões;
- tudo gravado em `.md` que Obsidian, VS Code e GitHub abrem sem conversão;
- **extremamente leve**.

Duas regras orientam as decisões:
1. **O arquivo em disco é o produto.** O app é só uma janela sobre uma pasta. Não há banco de dados nem formato próprio.
2. **O que você não usa não carrega.** O núcleo (árvore, editor, preview, kanban) carrega sempre e é pequeno. Mermaid, Excalidraw, histórico e exportação ficam em pedaços separados, carregados na primeira vez que você os usa.

## Orçamento de peso

Tamanhos medidos nos pacotes do npm (versões de out/2026), comprimidos com gzip:

| Peça | Tamanho | Quando carrega |
|---|---|---|
| Preact | 4 KB | sempre |
| marked + DOMPurify | 13 + 11 KB | sempre |
| CodeMirror 6, só núcleo + markdown | ~130 KB (estimativa; medir no primeiro build) | sempre |
| Código do app (sem as ilhas) | meta ≤ 50 KB | sempre |
| Mermaid | 11 KB de entrada + o pedaço do tipo de diagrama | só quando a nota tem um bloco mermaid |
| Excalidraw + React | 1,4 MB + 111 KB | só ao abrir um desenho |
| Fontes do Excalidraw | ~500 KB (a CJK Xiaolai, de 13 MB, fica de fora) | só ao abrir um desenho |

Com React no app todo, o núcleo ganharia 111 KB a mais. Com Excalidraw no pacote principal, cada abertura carregaria 1,5 MB, inclusive para abrir uma nota de três linhas.

**Metas verificadas pelo build e pelos testes** (um item estourado reprova):
- JS carregado ao abrir o app: **≤ 220 KB gzip**
- heap JS da aba com uma nota de 1.000 linhas aberta: **≤ 30 MB**
- memória do servidor (RSS) parado: **≤ 60 MB**
- servidor pronto em **< 300 ms**; primeira tela em **< 500 ms**
- `.zip` de distribuição: **≤ 5 MB**

## Decisões

| Tema | Escolha | Critério |
|---|---|---|
| Arquitetura | Servidor Node em `127.0.0.1` + interface no navegador (Edge/Chrome) | O servidor dá acesso real ao disco e percebe quando outra ferramenta muda um arquivo. |
| Servidor | Só módulos nativos do Node (`http`, `fs`, `path`, `crypto`), empacotado num único `server.mjs` | Zero dependências em tempo de execução: nada de `npm install` no trabalho, onde o proxy costuma bloquear o npm. |
| Interface | Preact + `@preact/signals` | Mesma forma de escrever do React, com 4 KB em vez de 111 KB. |
| Editor | CodeMirror 6 montado à mão (sem `basicSetup`): histórico, atalhos, linguagem markdown, quebra de linha | Edita o texto-fonte, então o app nunca reescreve o que você não digitou. Desenha só as linhas visíveis, então arquivo grande não pesa. Editores WYSIWYG regravam o arquivo inteiro e são maiores. |
| Preview | marked (GFM e task lists nativos) + DOMPurify | 13 KB contra 35 KB do markdown-it, que exigiria plugins para o mesmo resultado. |
| Diagrama em texto | Blocos ` ```mermaid `. O Mermaid carrega sob demanda; o SVG fica em cache por hash do bloco, e o preview espera 300 ms sem digitação para redesenhar | Formato aberto no GitHub, GitLab, Obsidian, VS Code e Notion. O cache evita redesenhar o diagrama a cada tecla. |
| Canvas livre | Excalidraw numa **ilha isolada**: React + Excalidraw carregam no primeiro desenho aberto e são desmontados ao fechar a aba | O peso só existe enquanto há desenho aberto. Ao fechar, a memória volta. |
| Formato do canvas | `.excalidraw.md` (formato do plugin Obsidian Excalidraw, JSON **sem compressão**) + `.svg` ao lado | O `.md` reabre no Obsidian; o `.svg` aparece como imagem em qualquer ferramenta. |
| Kanban | Formato do plugin Obsidian Kanban; arrastar com a API nativa de drag-and-drop do HTML | Sem biblioteca de arrastar. |
| Histórico | Cópias `.md` em `.superapp/history/`; diff de linhas próprio (~60 linhas, algoritmo de Myers), carregado com a tela de histórico | Sem git e sem biblioteca. A cópia se lê em qualquer editor. |
| Estilo | Um arquivo CSS com variáveis (tema claro/escuro), sem framework de CSS | — |
| Rede | Offline: fontes do Excalidraw servidas localmente (`window.EXCALIDRAW_ASSET_PATH`), Mermaid no build, recursos de IA do Excalidraw desligados | Nenhuma chamada a CDN. |
| Busca e índice | Nenhum índice de conteúdo na v1; Ctrl+P busca só por nome de arquivo | Índice ocuparia memória para um recurso que não está no escopo. |

**A ilha do Excalidraw.** É o único módulo que conhece React. Expõe uma interface estreita:

`mount(el, cena, aoMudar) → { cenaAtual(), exportarSvg(), destruir() }`

O lado Preact faz `await import('./diagrams/canvas/island')` e só fala com essa interface. A ilha usa `createElement` em vez de JSX, para o Vite não precisar de duas configurações de JSX. Não usar `preact/compat` no lugar do React: o Excalidraw depende de detalhes do React 19 e a economia (111 KB) só vale enquanto há desenho aberto.

## Formatos em disco (contrato de interoperabilidade)

**Nota comum** — Markdown GFM. O frontmatter YAML é preservado byte a byte.

**Quadro Kanban** (`quadros/projeto-x.md`):
````md
---

kanban-plugin: board

---

## A fazer

- [ ] Revisar proposta @{2026-11-03} #cliente
- [ ] Montar apresentação

## Fazendo

- [ ] Fluxo de aprovação

## Feito

- [x] Kickoff

%% kanban:settings
```
{"kanban-plugin":"board"}
```
%%
````
Colunas = `##`. Cartões = itens de lista. Data = `@{AAAA-MM-DD}`. Tags = `#tag`. O bloco de settings, se existir, é preservado.

**Desenho** (`diagramas/fluxo-x.excalidraw.md` + `diagramas/fluxo-x.excalidraw.svg`):
````md
---
excalidraw-plugin: parsed
tags: [excalidraw]
---
# Excalidraw Data
## Text Elements
Aprovação ^a1b2c3
%%
## Drawing
```json
{ "type": "excalidraw", "version": 2, "elements": [...], "appState": {...}, "files": {} }
```
%%
````
Na nota, o desenho entra como `![fluxo](diagramas/fluxo-x.excalidraw.svg)`, link de imagem padrão.

> Ponto a validar: os cabeçalhos exatos dos dois formatos vêm de documentação de terceiros. Nas Fases 3 e 4, conferir contra arquivos gerados pelo próprio Obsidian e guardá-los como fixtures de teste.

**Pasta do usuário (vault)** — nenhuma pasta é obrigatória. O tipo do arquivo vem do frontmatter, não do lugar onde ele está.
```
MeuVault/
  notas/  quadros/  diagramas/  anexos/
  .superapp/  config.json  history/  trash/
```

## Estrutura do repositório

```
Super-app/
  package.json              npm workspaces: server, web; scripts dev/build/test/size
  server/src/
    index.ts                node:http; serve a UI estática + /api; abre o navegador
    vault.ts                caminho seguro, listar, ler, gravar atômico (tmp+rename), renomear, lixeira
    watcher.ts              um fs.watch recursivo → eventos SSE (debounce 200 ms)
    history.ts              snapshots + retenção
    security.ts             só 127.0.0.1, checagem de Host/Origin, token de sessão
  web/src/
    app/                    layout, árvore, abas, Ctrl+P por nome, tema
    api/client.ts           fetch + SSE
    editor/                 CodeMirror mínimo, autosave, colar imagem → anexos/
    preview/                marked + DOMPurify; mermaid.ts (import dinâmico + cache)
    diagrams/mermaid/       editor de Mermaid com modelos (pedaço sob demanda)
    diagrams/canvas/        island.ts (React + Excalidraw, sob demanda) + excalidrawMd.ts
    kanban/                 kanbanMd.ts (parse/serialize) + quadro com drag-and-drop nativo
    history/                lista de versões, diff.ts, restaurar (pedaço sob demanda)
    export/                 HTML autônomo, PDF via impressão, SVG/PNG (pedaço sob demanda)
  scripts/build.mjs         vite build + esbuild do servidor + cópia das fontes latinas → dist/
  scripts/check-size.mjs    mede o JS inicial e o .zip; falha se passar do orçamento
  iniciar.bat  iniciar.sh   duplo clique: node dist/server.mjs
  docs/PLANO.md             este plano
```

**Dependências.**
- Núcleo: `preact`, `@preact/signals`, `@codemirror/{state,view,commands,language,lang-markdown}`, `marked`, `dompurify`.
- Sob demanda: `mermaid`; `react`, `react-dom` e `@excalidraw/excalidraw`, estes três só dentro da ilha.
- Desenvolvimento: `vite`, `typescript`, `esbuild`, `vitest`, `playwright`.
- Node ≥ 22.

## API do servidor

| Rota | Função |
|---|---|
| `GET /api/tree` | Árvore da pasta (ignora `.superapp/`, `.git/`) |
| `GET /api/file?path=` | Conteúdo + hash |
| `PUT /api/file` | Grava. Recebe o hash que o cliente viu; se o disco mudou, responde **409** |
| `POST /api/rename`, `DELETE /api/file` | Renomear; excluir = mover para `.superapp/trash/` |
| `POST /api/attachment` | Salva imagem colada em `anexos/` e devolve o caminho relativo |
| `GET /api/events` | SSE: arquivo criado, alterado ou removido por qualquer ferramenta |
| `GET /api/history?path=` · `GET /api/history/version` · `POST /api/history/restore` | Histórico |
| `GET /api/dirs?path=` | Navegador de pastas para escolher o vault no primeiro uso |

Os arquivos estáticos saem com `Cache-Control: immutable` (os nomes levam hash), então só o primeiro uso de cada pedaço lê do disco.

**Conflito com outra ferramenta.** Você edita a nota no app e o VS Code grava o mesmo arquivo. O watcher avisa a UI. Sem edição pendente, a UI recarrega em silêncio. Com edição pendente, mostra uma faixa: *manter a minha*, *carregar do disco*, *ver diferença*. O 409 no `PUT` cobre o caso em que o aviso chega tarde.

**Segurança** (é máquina de trabalho):
- escutar só em `127.0.0.1`;
- recusar `Host` diferente de `localhost`/`127.0.0.1`, o que bloqueia DNS rebinding;
- token aleatório por sessão, entregue na URL de abertura e guardado em cookie `SameSite=Strict`, para que outros sites abertos no navegador não chamem a API;
- todo caminho passa por `realpath` e precisa ficar dentro do vault, o que bloqueia `../` e symlinks que saem da pasta.

## Fases

Cada fase termina com algo usável, com `npm run size` passando, e com commit + push na branch `ccr-8058b25a-u6woo8`.

**Fase 0 — Esqueleto e orçamento.** Workspaces, TypeScript, servidor com árvore/ler/gravar, `security.ts`, `iniciar.bat`, escolha do vault no primeiro uso, `check-size.mjs` já valendo. *Pronto quando:* abrir uma pasta, ver a árvore, abrir um `.md` cru.

**Fase 1 — Markdown.**
- CodeMirror mínimo.
- Preview nos modos editor / dividido / preview.
- Autosave 800 ms após a última tecla.
- Abas; Ctrl+P por nome; criar, renomear e excluir.
- Colar imagem; watcher + faixa de conflito; tema claro/escuro.
- Nomes de arquivo higienizados para o Windows (`<>:"/\|?*`, nomes reservados).

**Fase 2 — Mermaid.** Import dinâmico só quando há bloco mermaid; cache de SVG; erro de sintaxe exibido no próprio bloco; editor dedicado (botão "Inserir diagrama") com modelos de fluxograma, sequência, estado, Gantt, ER e mapa mental, que insere o bloco no cursor.

**Fase 3 — Canvas.**
- Ilha do Excalidraw sob demanda.
- "Novo desenho" cria `.excalidraw.md` + `.svg`; cada salvamento regrava os dois.
- "Inserir na nota" adiciona o link da imagem.
- "Converter Mermaid em canvas" usa a conversão que já vem no Excalidraw.
- Fontes latinas servidas localmente.
- `destruir()` ao fechar a aba.

**Fase 4 — Kanban.** `kanbanMd.ts` com parse/serialize; quadro com arrastar cartões e colunas; cartão com texto, data, tags e check; marcar como feito; arquivar; alternar entre quadro e Markdown cru.

**Fase 5 — Histórico e exportação** (ambos sob demanda).
- Snapshot ao salvar, no máximo 1 por arquivo a cada 5 min, e sempre antes de restaurar ou excluir.
- Retenção: tudo dos últimos 7 dias; depois, 1 por dia até 90 dias.
- Tela de versões com diff lado a lado e "restaurar".
- Exportar nota como HTML autônomo (CSS embutido, Mermaid já em SVG), PDF pela impressão do navegador (CSS de impressão), diagramas como SVG/PNG.

**Fase 6 — Distribuição.** `npm run build` gera `dist/` (UI estática + `server.mjs`). Workflow do GitHub Actions roda `size` e testes e publica o `.zip` a cada tag. No trabalho: descompactar e dar duplo clique em `iniciar.bat`.

## Riscos conhecidos

- **OneDrive.** Se o vault estiver no OneDrive, o `rename` atômico pode falhar enquanto o OneDrive trava o arquivo. Tentar de novo com espera curta (3×).
- **Formatos de plugin.** Se Obsidian Kanban ou Excalidraw mudarem de formato, a compatibilidade quebra. Mitigação: fixtures reais + testes de ida e volta.
- **Tamanho do Mermaid por tipo.** A tabela mostra só a entrada (11 KB). O pedaço de cada tipo de diagrama (fluxograma, sequência…) precisa ser medido no build. Se algum passar de 400 KB, avaliar alternativas antes da Fase 2 terminar.

## Fora da v1

Wikilinks e backlinks, busca no conteúdo, notas diárias e modelos, juntar no kanban os `- [ ]` espalhados pelas notas, sincronização entre máquinas.

## Verificação

Os testes atacam o app em **dois pontos**, decididos com o usuário:
- **(A) o app rodando:** servidor real numa pasta temporária, acessado por Playwright, pelo navegador e por requisições HTTP diretas. O teste confere os arquivos no disco.
- **(B) os conversores de formato:** kanban e Excalidraw ↔ `.md`.

Nada de testar módulo interno (diff, watcher, store) isoladamente: eles se provam pelo ponto A.

1. **Peso (`npm run size`, também no CI).**
   - Soma o JS que o `index.html` carrega antes de qualquer import dinâmico e compara com 220 KB gzip.
   - Mede o `.zip` e compara com 5 MB.
   - Lista o tamanho de cada pedaço sob demanda.
2. **Memória e tempo (Playwright/Chromium já instalado no ambiente).**
   - Abrir uma nota de 1.000 linhas, forçar coleta de lixo via CDP (`HeapProfiler.collectGarbage`) e ler `usedJSHeapSize`: ≤ 30 MB.
   - Abrir e fechar um desenho, coletar de novo: o heap volta a ≤ 1,5× o valor anterior, prova de que a ilha foi desmontada.
   - RSS do servidor parado ≤ 60 MB; tempo até responder a primeira requisição < 300 ms.
3. **Conversores (ponto B, Vitest).** Para cada fixture de kanban e de desenho, inclusive as geradas pelo Obsidian: `serialize(parse(arquivo)) === arquivo`, byte a byte.
4. **App rodando (ponto A, Playwright).**
   - Pela API HTTP: bloqueio de caminho (`../`, caminho absoluto, symlink), Host/token inválidos recusados, 409 em conflito, regra de retenção do histórico (com relógio controlado).
   - Pela interface, o servidor sobe num vault temporário e o teste:
     - cria e digita uma nota, depois confere o arquivo no disco;
     - altera o arquivo por fora e vê a UI atualizar;
     - arrasta um cartão e confere o `.md`;
     - desenha e confere que `.excalidraw.md` e `.svg` existem;
     - exporta HTML e confere que ele contém `<svg>`;
     - restaura uma versão e confere o diff exibido.
5. **Offline.** Rodar a suíte E2E bloqueando todo host que não seja `127.0.0.1` (`page.route`). Qualquer chamada externa reprova o teste.
6. **Interoperabilidade (manual).** Abrir o vault no Obsidian (Kanban e Excalidraw instalados) e no VS Code; conferir que quadro, desenho e Mermaid abrem e editam lá.
7. **Instalação.** Descompactar o `.zip` numa pasta limpa e rodar `iniciar.bat` sem `npm install`.


---

## Resultado (o que foi feito e o que mudou em relação ao plano)

Todas as fases foram implementadas, com testes de navegador, de API e de conversores (`npm test`).

**Medido no pacote final**

| Item | Meta | Resultado |
|---|---|---|
| JS ao abrir o app | ≤ 220 KB gzip | 156 KB |
| `.zip` | ≤ 5 MB | 3,8 MB |
| Servidor pronto | < 300 ms | ~80 ms |
| Primeira tela | < 500 ms | ~70 ms |
| Memória do servidor parado | ≤ 60 MB | ~57 MB (a base do Node já é ~40 MB) |
| Heap JS com nota de 1.000 linhas | ≤ 30 MB | abaixo de 30 MB (o teste reprova se passar) |

**Mudanças em relação ao plano**

1. **Desenho num iframe, não num `import()`.** Um módulo carregado fica na memória até a aba fechar. Com o desenho em `/canvas.html`, fechar a aba descarta o iframe inteiro: heap de 7,0 MB para 3,7 MB. O app principal não conhece React.
2. **Mermaid com layout `dagre` forçado.** O padrão do Mermaid 12 carrega o motor ELK (440 KB gzip) até para um fluxograma. Com `dagre`, um fluxograma custa 61 KB. O ELK foi trocado por um stub no build (`layout: elk` mostra um aviso).
3. **CodeMirror com linguagem markdown própria.** O pacote `@codemirror/lang-markdown` traz os analisadores de HTML, CSS e JS. Montar a linguagem direto de `@lezer/markdown` poupou ~70 KB gzip.
4. **"Converter Mermaid em canvas" não foi feito.** A conversão vem de um pacote à parte (`@excalidraw/mermaid-to-excalidraw`) que embute uma segunda cópia do Mermaid. Não vale o peso.
5. **Escrita do desenho em JSON puro; leitura também do formato comprimido** (`compressed-json`, padrão do plugin do Obsidian), com `lz-string` só dentro do iframe.
6. **Testes em dois pontos** (decisão do usuário): o app rodando (Vitest + Playwright) e os conversores de formato. Tudo roda com `vitest`; não há segundo executor de testes.
7. **Versões:** TypeScript 7, Vite 8, Vitest 5, Preact 11, React 18.3.1 (dentro do iframe; o Excalidraw 0.18 é feito para o 18).

**Ainda não verificado (precisa de uma pessoa)**

- Abrir um quadro e um desenho no **Obsidian real** (plugins Kanban e Excalidraw). Os formatos seguem a documentação e arquivos descritos por terceiros; não havia Obsidian no ambiente.
- Rodar `iniciar.bat` no **Windows** e o vault dentro do **OneDrive** (a regravação com nova tentativa existe, mas não foi exercitada lá).
- O workflow do **GitHub Actions** (escrito, nunca executado).
