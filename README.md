# Super-app

Notas em Markdown, diagramas, desenhos e quadros kanban. Tudo vira arquivo de texto numa pasta sua, sem banco de dados. Roda no seu computador, local e offline.

## Como usar

Precisa do Node.js 22 ou mais novo.

1. Descompacte o `.zip`.
2. No Windows, dê dois cliques em `iniciar.bat`. No Linux ou macOS, rode `./iniciar.sh`.
3. Escolha a pasta das notas. Uma pasta vazia serve.

O app abre no navegador. Para abrir uma pasta direto: `iniciar.bat "C:\Notas"` ou `./iniciar.sh ~/Notas`. Sem pasta, ele lembra a última usada.

## O que faz

| Recurso | Como |
|---|---|
| Notas | Três modos: **Documento** (padrão: o texto aparece formatado enquanto você digita), **Código** (o Markdown cru) e **Dividido** (código e preview lado a lado). Salva sozinho. Cole uma imagem ou solte um arquivo de imagem e ela vai para `anexos/`. |
| Formatação | Barra e atalhos como no Google Docs. A marcação (`**`, `#`) só aparece no trecho onde o cursor está. Colar do Google Docs, Word ou de uma página vira Markdown. |
| Busca | `Ctrl+P` abre arquivo pelo nome. |
| Diagramas | Bloco ` ```mermaid ` na nota. O botão **Diagrama** abre um editor com modelos e preview. Baixe cada diagrama em SVG ou PNG. |
| Desenho livre | **+ Desenho** cria um desenho (Excalidraw). Salva `nome.excalidraw.md` e `nome.excalidraw.svg`. O botão **Desenho** da nota insere a imagem. |
| Kanban | **+ Quadro** cria um quadro. Arraste cartões e colunas. Cartão aceita data `@{2026-11-03}` e `#tags`. O botão **Texto** mostra o Markdown cru. |
| Histórico | **Histórico** lista versões anteriores, mostra a diferença e restaura. |
| Exportar | **HTML** gera uma página única (diagramas e imagens embutidos). **PDF** abre a impressão do navegador. |
| Outras ferramentas | Se o VS Code, o Obsidian ou outro programa mudar um arquivo aberto, o app atualiza. Se você também editou, ele pergunta qual versão manter. |

## Atalhos de formatação

| Atalho | Ação |
|---|---|
| `Ctrl+B` `Ctrl+I` `Ctrl+Shift+X` | negrito, itálico, riscado |
| ``Ctrl+` `` | código em linha |
| `Ctrl+K` | link (num link existente, edita o endereço) |
| `Ctrl+Alt+0` a `Ctrl+Alt+4` | parágrafo, título 1 a 4 |
| `Ctrl+Shift+8` `Ctrl+Shift+7` `Ctrl+Shift+9` | lista, lista numerada, tarefas |
| `Ctrl+Shift+.` | citação |
| `Ctrl+Alt+C` | bloco de código |
| `Tab` / `Shift+Tab` | aninhar ou desaninhar item de lista; andar entre células de tabela (no código-fonte) |
| `Ctrl+P` | abrir arquivo pelo nome |
| `Ctrl+S` | salvar agora |

No Mac, use `Cmd` no lugar de `Ctrl`.

## Onde ficam os dados

Tudo na pasta que você escolheu. A subpasta `.superapp/` guarda o histórico e a lixeira. Apagá-la perde só essas duas coisas.

- Nota: Markdown comum.
- Quadro: formato do plugin Obsidian Kanban (`kanban-plugin: board`).
- Desenho: `.excalidraw.md` do plugin Obsidian Excalidraw. O app lê o formato comprimido e grava em JSON puro.
- Diagrama: bloco ` ```mermaid `, como no GitHub e no Obsidian.

## Limites conhecidos

- O app foi testado contra arquivos que ele mesmo gerou e contra o formato documentado dos plugins. Ainda não foi aberto num Obsidian real. Se um quadro ou desenho não abrir lá, abra um issue com o arquivo.
- Imagens coladas dentro de um desenho (Excalidraw) ficam no JSON do arquivo e podem não aparecer no plugin do Obsidian.
- O layout `elk` do Mermaid não vem no pacote (pesa 1,4 MB). Os diagramas usam o layout padrão.
- Texto em chinês, japonês ou coreano dentro de desenhos usa a fonte do sistema.
- No modo Documento, diagramas e tabelas dentro de listas ou citações aparecem como código (só os de primeiro nível viram desenho).
- Um único parágrafo gigante (milhares de linhas seguidas, sem linha em branco, com muitos links) deixa o analisador de Markdown lento, em qualquer modo. Notas normais não sofrem.
- Não tem busca no conteúdo das notas, `[[links]]` entre notas, nem sincronização entre máquinas.

## Visual

Monocromático, de cantos retos e botões de contorno tracejado, inspirado em pixel-perfect.space. Fonte Inter Tight no texto e Pixelify Sans no nome da pasta, as duas dentro do pacote (52 KB, sem rede). Cores, medidas e o que difere do site estão em [`docs/VISUAL.md`](docs/VISUAL.md); `npm run contrast` confere o contraste nos dois temas.

## Segurança

O servidor só escuta em `127.0.0.1`, recusa `Host` e `Origin` de fora e exige um token por sessão. Caminhos são presos à pasta escolhida, inclusive contra symlinks. O HTML das notas passa por DOMPurify. O app não faz nenhuma requisição à internet.

## Desenvolvimento

```
npm install
npm run dev       # reconstrói a cada mudança e reinicia o servidor
npm run build     # gera dist/
npm test          # servidor, conversores e navegador (precisa do Chromium do Playwright)
npm run package   # gera super-app.zip
npm run size      # confere o orçamento de peso
```

Orçamento (o build falha se estourar): JS inicial até 220 KB comprimidos, `.zip` até 5 MB. Mermaid, Excalidraw, histórico e exportação só carregam quando usados. O desenho roda num iframe, e fechar a aba descarta a memória dele.
