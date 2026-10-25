export interface MermaidTemplate {
  id: string;
  name: string;
  code: string;
}

export const mermaidTemplates: MermaidTemplate[] = [
  { id: 'fluxo', name: 'Fluxograma', code: `flowchart TD
  A(["Início"]) --> B["Preencher formulário"]
  B --> C{"Dados válidos?"}
  C -->|Sim| D["Salvar registro"]
  C -->|Não| E["Mostrar erro (campo obrigatório)"]
  E --> B
  D --> F(["Fim"])
` },
  { id: 'fluxo-aprovacao', name: 'Fluxo com raias', code: `flowchart LR
  subgraph SOL["Solicitante"]
    A(["Início"]) --> B["Preencher pedido de compra"]
    B --> C["Enviar para aprovação"]
  end
  subgraph APR["Aprovador"]
    D{"Valor até o limite?"}
    E["Aprovar pedido"]
    F["Rejeitar pedido"]
  end
  C --> D
  D -->|Sim| E
  D -->|Não| F
  E --> G(["Fim"])
  F --> B
` },
  { id: 'sequencia', name: 'Sequência', code: `sequenceDiagram
  participant U as Usuário
  participant S as Sistema
  participant B as Banco de dados
  U->>S: Enviar credenciais
  S->>B: Consultar usuário
  B-->>S: Retornar registro
  alt Credenciais válidas
    S-->>U: Acesso liberado
  else Credenciais inválidas
    S-->>U: Mensagem de erro
  end
  U->>S: Solicitar relatório
  S-->>U: Exibir relatório
` },
  { id: 'estados', name: 'Máquina de estados', code: `stateDiagram-v2
  [*] --> Rascunho
  state "Em revisão" as EmRevisao
  Rascunho --> EmRevisao: Enviar
  EmRevisao --> Rascunho: Pedir ajustes
  EmRevisao --> Aprovado: Aprovar
  EmRevisao --> Rejeitado: Rejeitar
  Aprovado --> [*]
  Rejeitado --> [*]
` },
  { id: 'gantt', name: 'Cronograma (Gantt)', code: `gantt
  title Cronograma do lançamento do app
  dateFormat YYYY-MM-DD
  section Planejamento
  Levantar requisitos :a1, 2026-03-02, 5d
  Desenhar protótipo :a2, 2026-03-09, 4d
  section Desenvolvimento
  Implementar telas :b1, 2026-03-16, 10d
  Testar e ajustar :b2, after b1, 5d
` },
  { id: 'er', name: 'Entidades e relações', code: `erDiagram
  CLIENTE ||--o{ PEDIDO : "faz"
  PEDIDO ||--|{ ITEM_PEDIDO : "contém"
  PRODUTO ||--o{ ITEM_PEDIDO : "aparece em"
  CLIENTE {
    int id PK
    string nome
  }
  PEDIDO {
    int id PK
    date criacao
    string status
  }
  ITEM_PEDIDO {
    int quantidade
  }
  PRODUTO {
    string descricao
  }
` },
  { id: 'mapa-mental', name: 'Mapa mental', code: `mindmap
  root((Projeto))
    Planejamento
      Escopo
      Cronograma
    Execução
      Equipe
      Ferramentas
    Entrega
      Testes
      Documentação
` },
  { id: 'linha-do-tempo', name: 'Linha do tempo', code: `timeline
  title Marcos do produto
  2024 : Lançamento da versão beta
       : Primeiros cem usuários
  2025 : Versão 1.0 publicada
       : Programa de indicação
  2026 : Integração com bancos
` },
  { id: 'pizza', name: 'Gráfico de pizza', code: `pie title Distribuição mensal do orçamento
  %% Valores em percentual do total
  %% Os valores somam 100
  "Moradia" : 40
  "Alimentação" : 35
  "Transporte" : 25
` },
  { id: 'classes', name: 'Diagrama de classes', code: `classDiagram
  class Usuario {
    +String nome
    +String email
    +autenticar() bool
  }
  class Administrador {
    +String nivel
    +gerenciarUsuarios() void
  }
  class Pedido {
    +int numero
    +calcularTotal() float
  }
  Usuario <|-- Administrador
  Usuario --> Pedido : realiza
` },
];
