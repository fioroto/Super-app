# Super-app

Notas em Markdown, diagramas Mermaid e canvas (desenhos), kanban, histórico e exportação.
Tudo é salvo como arquivo `.md`, sem banco de dados.
Roda no seu computador, local e offline.

## Requisitos

- Node.js 22 ou superior.

## Como usar

1. Descompacte o arquivo `.zip`.
2. No Windows, dê dois cliques em `iniciar.bat`. No Linux ou macOS, rode `./iniciar.sh`.
3. Escolha a pasta onde ficarão as suas notas.

Também dá para passar a pasta direto: `iniciar.bat "C:\Notas"` ou `./iniciar.sh ~/Notas`.
Sem pasta, o app lembra a última usada ou mostra um seletor de pasta no navegador.

## Onde ficam os dados

Suas notas ficam na pasta que você escolheu.
A pasta `.superapp/` guarda o histórico e a lixeira. Você pode apagá-la, mas perde o histórico e a lixeira.

## Formatos

- Nota: arquivo Markdown (`.md`).
- Quadro (kanban): formato do plugin Obsidian Kanban.
- Desenho: arquivo `.excalidraw.md` do plugin Obsidian Excalidraw, com um `.svg` ao lado.
- Diagrama: bloco de código ` ```mermaid ` dentro da nota.

## Segurança

- O servidor só escuta em `127.0.0.1`. Só o seu computador consegue acessar.
- Cada sessão exige um token.

## Desenvolvimento

```
npm install
npm run dev     # modo de desenvolvimento
npm run build   # gera dist/
npm run size    # confere o peso do build
npm test        # roda os testes
```

## Limites de peso

- JS inicial: até 220 KB (gzip).
- Arquivo `.zip`: até 5 MB.
