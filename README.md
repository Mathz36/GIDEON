# 🛡️ Gideon — Inteligência Artificial Corporativa & RAG Text-to-SQL para Sankhya ERP

O **Gideon** é uma plataforma corporativa completa de **Inteligência Artificial Generativa e RAG (Retrieval-Augmented Generation)** integrada nativamente ao **Sankhya ERP**.

A solução permite que diretores, gerentes comerciais e equipes de gestão consultem dados estratégicos de vendas, clientes, financeiro, estoque e faturamento em **linguagem natural** através de uma interface conversacional moderna em tempo real (via streaming SSE), transformando automaticamente perguntas em consultas SQL seguras no PostgreSQL e respondendo com dados reais, gráficos interativos (Generative UI) e insights analíticos.

---

## 📑 Sumário

1. [Visão Geral e Proposta de Valor](#1-visão-geral-e-proposta-de-valor)
2. [Arquitetura Geral do Sistema](#2-arquitetura-geral-do-sistema)
3. [Pipeline RAG Text-to-SQL & Generative UI](#3-pipeline-rag-text-to-sql--generative-ui)
4. [Multi-Conversas FIFO, Compactação & Memória Pessoal](#4-multi-conversas-fifo-compactação--memória-pessoal)
5. [Seu Dashboard — Indicadores & Gráficos Personalizados](#5-seu-dashboard--indicadores--gráficos-personalizados)
6. [Sistema de Avaliação de Respostas & Qualidade da IA](#6-sistema-de-avaliação-de-respostas--qualidade-da-ia)
7. [Dicionário de Dados Dinâmico & Sincronizador ERP](#7-dicionário-de-dados-dinâmico--sincronizador-erp)
8. [Módulo de Segurança, Autenticação & RBAC](#8-módulo-de-segurança-autenticação--rbac)
9. [Referência Completa de Endpoints da API](#9-referência-completa-de-endpoints-da-api)
10. [Modelagem de Dados (Prisma & PostgreSQL)](#10-modelagem-de-dados-prisma--postgresql)
11. [Arquitetura Frontend (SPA) & Telas do Sistema](#11-arquitetura-frontend-spa--telas-do-sistema)
12. [Variáveis de Ambiente e Configuração](#12-variáveis-de-ambiente-e-configuração)
13. [Guia de Instalação e Execução Local](#13-guia-de-instalação-e-execução-local)

---

## 1. Visão Geral e Proposta de Valor

### O Desafio
Consultar bancos legados de ERPs robustos como o Sankhya exige conhecimento técnico avançado em SQL, navegação por menus burocráticos e entendimento das nomenclaturas internas das tabelas e campos (ex: `TGFPAR`, `TGFVEN`, `TGFCAB`, `TGFITE`, `CODPARC`, `VLRNOTA`, `VLRDESC`).

### A Solução Gideon
O Gideon atua como um analista autônomo e assistente estratégico entre o usuário de negócios e o banco de dados corporativo:
- **Linguagem Natural Sem Alucinações:** O gerente digita *"Qual foi o faturamento líquido de outubro?"* ou *"Top 5 produtos mais vendidos da filial 1"*. O motor RAG localiza as tabelas, constrói a query SQL, executa-a no banco com regras estritas (ex: dedução de devoluções e cancelamentos) e devolve a resposta contextualizada com números exatos.
- **Generative UI & Visualização de Dados:** Respostas com comparações, séries temporais ou rankings geram gráficos interativos em tempo real (`bar`, `horizontal-bar`, `line`, `area`, `pie` ou `table`).
- **Histórico Multi-Conversa & Memória Pessoal:** Fila FIFO de até 10 conversas por usuário, compactação automática de conversas longas e memória interna persistente das preferências de cada pessoa.
- **Seu Dashboard Integrado:** O usuário pode salvar qualquer gráfico gerado no chat diretamente em seu dashboard individual de indicadores com o mesmo layout e refresh dinâmico.
- **Auditoria de Qualidade & Feedback Humano:** Mecanismo de avaliação 👍 / 👎 com tags de diagnóstico e central administrativa de curadoria com métricas de evolução temporal.
- **Controle de Acesso Baseado em Perfis (RBAC):**
  - **Gerente:** Acesso focado ao Chat e ao Seu Dashboard, com isolamento total dos seus dados.
  - **Administrador:** Acesso irrestrito a Chat, Dashboard, Integrações do ERP Sankhya, Parâmetros da IA, Central de Feedbacks e Gestão de Usuários.

---

## 2. Arquitetura Geral do Sistema

O sistema é estruturado em **Clean Architecture**, com separação estrita de camadas, injeção de dependências e tipagem robusta ponta a ponta.

```
                        ┌─────────────────────────────────────────────────────────┐
                        │                 Frontend SPA (React 19)                 │
                        │    Vite + Tailwind CSS + Recharts + Lucide Icons        │
                        │  - Chat Conversacional com Sidebar ChatGPT-style        │
                        │  - "Seu Dashboard" com Grid Responsivo & Auto-Save      │
                        │  - Painel Admin: ERP, Config IA, Feedbacks & Usuários   │
                        └────────────┬───────────────────────────────┬─────────────┘
                                     │ HTTP / REST                   │ SSE Stream
                                     ▼                               ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                             Backend API (Node.js & Express)                              │
│                                                                                          │
│  ┌───────────────────────────────┐     ┌──────────────────────────────────────────────┐  │
│  │   Autenticação & RBAC         │     │         Multi-Conversa & Memória             │  │
│  │   JWT + bcrypt + Permissões   │     │   FIFO 10 conversas + Rolling Compaction     │  │
│  └───────────────────────────────┘     │   Extração e injeção de memórias do usuário  │  │
│                                        └──────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                     Pipeline RAG Text-to-SQL & Generative UI                       │  │
│  │  1. ExtractKeywordsUseCase -> 2. SearchMetadataUseCase                             │  │
│  │  3. ExpandRelationshipsUseCase -> 4. BuildSqlGenerationPromptUseCase               │  │
│  │  5. Gemini LLM (Text-to-SQL) -> 6. Validação Read-Only Segura                      │  │
│  │  7. Execução Postgres -> 8. ResponseReviewerService (Geração & Auto-Correção)      │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                          │
│  ┌───────────────────────────────┐     ┌──────────────────────────────────────────────┐  │
│  │      "Seu Dashboard"          │     │        Avaliação & Curadoria (Feedbacks)     │  │
│  │   Salvar Gráfico do Chat      │     │   Armazenamento de contexto, query e snapshot│  │
│  │   Refresh SQL em Tempo Real   │     │   Dashboard de tendências & resolução manual │  │
│  └───────────────────────────────┘     └──────────────────────────────────────────────┘  │
│                                                                                          │
│  ┌───────────────────────────────┐     ┌──────────────────────────────────────────────┐  │
│  │    DynamicTableManager        │     │         ErpSyncScheduler & Queue             │  │
│  │  Criação DDL, Sanitização     │     │  Agendamento Inteligente (Cron-like)         │  │
│  │  Sync FULL e HASH_COMPARATOR  │     │  Fila com controle de concorrência           │  │
│  └──────────────┬────────────────┘     └───────────────────┬──────────────────────────┘  │
└─────────────────┼──────────────────────────────────────────┼─────────────────────────────┘
                  │                                          │
                  │ PostgreSQL (Prisma ORM)                  │ Gateway REST / JSON
                  ▼                                          ▼
   ┌────────────────────────────────────────┐     ┌──────────────────────────────────────┐
   │         Banco de Dados Interno         │     │         Sankhya ERP Gateway          │
   │  - usuarios, ai_configurations         │     │  - Autenticação OAuth2 / Token       │
   │  - erp_configurations, meta_tables/cols│     │  - DbExplorerSP.executeQuery         │
   │  - chat_conversations, chat_messages   │     └──────────────────────────────────────┘
   │  - user_memories, chat_feedbacks       │
   │  - user_dashboards, dashboard_widgets  │
   │  - Tabelas dinâmicas espelho (erp_*)   │
   └────────────────────────────────────────┘
```

---

## 3. Pipeline RAG Text-to-SQL & Generative UI

O motor RAG garante que perguntas em linguagem natural sejam convertidas em dados auditáveis sem depender de adivinhações do LLM.

### Fluxo de Execução do Chat
1. **Entrada do Usuário:** Recebe a pergunta e recupera a memória pessoal do usuário (ex: como prefere ser chamado, formato de respostas favorito).
2. **Extração Conceitual (`ExtractKeywordsUseCase`):** Quebra a pergunta em entidades, datas, códigos e regras de negócio.
3. **Mapeamento Semântico (`SearchMetadataUseCase`):** Localiza no Dicionário de Dados as tabelas e colunas correspondentes.
4. **Resolução de Chaves e Relacionamentos (`ExpandRelationshipsUseCase`):** Detecta chaves estrangeiras (FKs) e anexa tabelas associadas para permitir `JOINs` automáticos.
5. **Geração do Prompt DDL (`BuildSqlGenerationPromptUseCase`):** Constrói o contexto restrito com nomes de colunas, tipos e regras de ouro de negócio (ex: `faturamento = Venda - Devolução`).
6. **Text-to-SQL via Gemini:** Gera a consulta SQL compatível com PostgreSQL.
7. **Validação Estrita Read-Only:** Bloqueia comandos destrutivos (DDL/DML), injeções de SQL, chamadas de sistema e tabelas internas confidenciais (`usuarios`, `chat_feedbacks`). Limita a query a `LIMIT 50`.
8. **Execução no PostgreSQL:** Executa a query de forma parametrizada e formata os dados reais.
9. **Revisor em Duas Camadas (`ResponseReviewerService`):**
   - Agente crítico que inspeciona a consistência numérica e a adequação da Matriz Visual de Gráficos.
   - Gera o bloco estruturado de visualização (Generative UI):
     ````markdown
     ```dashboard
     {
       "type": "bar",
       "title": "Faturamento por Vendedor",
       "data": [{ "name": "Carlos", "value": 142000 }]
     }
     ```
     ````
10. **Prompt de Ação para o Dashboard:** Quando a Gideon renderiza um gráfico, ela questiona automaticamente: *"Deseja salvar este gráfico no seu Dashboard?"*, disponibilizando botão de 1 clique ou aceitando confirmação conversacional ("Sim", "quero").

---

## 4. Multi-Conversas FIFO, Compactação & Memória Pessoal

### Fila FIFO de Conversas (Até 10 por Usuário)
- Cada usuário pode manter até **10 conversas ativas** separadas.
- Ao atingir o limite de 10 conversas, a criação de uma nova remove automaticamente a mais antiga não-fixada (**FIFO — First In, First Out**).
- Conversas podem ser **renomeadas**, **fixadas no topo** (não são removidas pelo FIFO) e **excluídas**.

### Compactação Contínua Inteligente (Rolling Compaction)
- Quando uma conversa ultrapassa o limite seguro de tokens/mensagens (16 mensagens ou 12.000 caracteres):
  - As mensagens anteriores são sintetizadas em um resumo executivo de contexto (`summary`), mantendo tópicos, decisões e dados já abordados.
  - As **últimas 6 mensagens permanecem intactas**, preservando a fluidez conversacional imediata.

### Memória Pessoal do Usuário (`user_memories`)
- A Gideon memoriza particularidades de cada usuário para personalizar o atendimento:
  - Como o usuário gosta de ser tratado (ex: *"Me chame de Sr. Matheus"*, apelidos, pronomes).
  - Preferências de comunicação (respostas diretas, bullet points, foco comercial).
  - Áreas de foco ou filiais prioritárias.
- **Extração Implícita e Gestão Explícita:** A IA detecta preferências automaticamente durante a conversa e também disponibiliza um modal para visualização, adição manual e exclusão de memórias.

---

## 5. Seu Dashboard — Indicadores & Gráficos Personalizados

A rota `/dashboard` oferece um painel analítico individual para cada usuário (Gerentes e Administradores):

- **Grid Responsivo com Reordenação:** Widgets de indicadores organizados em colunas com persistência automática de tamanho (`colSpan`), altura (`rowSpan`) e ordenação (`order`).
- **Do Chat Direto para o Dashboard:** Ao confirmar a pergunta da Gideon no chat, o gráfico é adicionado ao Dashboard com o **mesmo layout**, título, dados e query SQL subjacente.
- **Criação de Widgets por Linguagem Natural:** O usuário pode digitar um prompt (ex: *"Crie um gráfico de pizza dos 4 clientes com mais títulos em aberto"*) para gerar novos widgets diretamente na tela do Dashboard.
- **Refresh em Tempo Real:** Cada widget pode ser atualizado com 1 clique, executando a consulta SQL diretamente contra o banco de dados atualizado.
- **Isolamento Multi-tenant (RBAC):** Cada usuário visualiza e gerencia exclusivamente seus próprios dashboards e widgets.

---

## 6. Sistema de Avaliação de Respostas & Qualidade da IA

Para garantir a melhoria contínua sem automações cegas que possam degradar o modelo, o Gideon conta com um sistema de avaliação e curadoria assistida:

### Avaliação no Chat (`👍 Útil` / `👎 Precisa melhorar`)
- Presente abaixo de cada resposta concluída da Gideon.
- Gravação instantânea em 1 clique no banco de dados (`chat_feedbacks`).
- Opção de seleção de tags de diagnóstico:
  - **Negativas:** `Informação incorreta`, `Faltou informação`, `Valor / Cálculo incorreto`, `Gráfico inadequado`, `Não entendeu a pergunta`, `Outro motivo`.
  - **Positivas:** `Números exatos`, `Excelente explicação`, `Gráfico muito útil`, `Rápida e direta`.
- Campo opcional de observação livre.

### Central de Curadoria e Qualidade (`/admin/feedbacks`)
Painel exclusivo para Administradores com analytics executivo:
- **KPIs:** `% de Feedbacks Positivos vs Negativos`, total de avaliações, pendentes e resolvidos.
- **Gráfico de Tendência Temporal:** Evolução diária das avaliações positivas e negativas para diagnosticar se a IA está melhorando ou regredindo ao longo do tempo.
- **Ranking de Usuários:** Usuários que mais avaliam e taxa de aprovação individual.
- **Distribuição de Motivos/Tags:** Gráfico das causas mais recorrentes de insatisfação.
- **Inspeção Completa & Resolução Manual:** Visualização da pergunta, resposta, SQL gerado e histórico integral da conversa com botão **"Marcar como Resolvido"** / **"Reabrir"** após o ajuste das regras de negócio.

---

## 7. Dicionário de Dados Dinâmico & Sincronizador ERP

### Sincronização com o Sankhya ERP
O serviço `DynamicTableManager` gerencia o espelhamento das tabelas do Sankhya para tabelas locais no PostgreSQL prefixadas com `erp_*`:

- **Estratégias de Sync:**
  1. `FULL` **(Sincronização Completa):** Trunca a tabela local e faz carga total paginada via `ROWNUM` ou cursor.
  2. `HASH_COMPARATOR` **(Incremental Inteligente):** Calcula o hash MD5 determinístico (`_row_hash`) de cada registro. Registros inalterados são descartados da memória; registros novos ou modificados sofrem `UPSERT` atômico via `ON CONFLICT (primary_key) DO UPDATE`.
- **Fila com Limite de Concorrência (`SyncQueueManager`):** Enfileira sincronizações garantindo execução segura sem sobrecarregar o gateway do ERP.
- **Agendador Autônomo (`ErpSyncScheduler`):** Executa rotinas automáticas com frequências configuráveis: minutos, horas, diário ou mensal.

---

## 8. Módulo de Segurança, Autenticação & RBAC

- **Autenticação Interna Segura:** Senhas criptografadas via `bcryptjs` (salt rounds = 10) com validação por expressão regular (mínimo 8 caracteres, maiúsculas, minúsculas, números e caracteres especiais).
- **Sessões via JWT:** Tokens assinados com validade de 7 dias, transportando ID do usuário, nome, e-mail e perfil (`ADMIN` ou `GERENTE`).
- **Guarda de Rotas (Frontend & Backend):** Middleware `requireAuth` e `requireAdmin` garantem que rotas administrativas não sejam executadas por gerentes.
- **Proteção Text-to-SQL:** Blocklist nativa que impede o RAG de ler ou expor tabelas confidenciais (`usuarios`, `chat_feedbacks`, `erp_configurations`).

---

## 9. Referência Completa de Endpoints da API

Todas as rotas são prefixadas por `/api`.

### 🔑 Autenticação (`/api/auth`)
| Método | Endpoint | Acesso | Descrição |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Público | Autenticação com e-mail e senha. Retorna token JWT e perfil. |
| `GET` | `/api/auth/me` | Autenticado | Retorna os dados do usuário autenticado no token Bearer. |

### 👥 Gestão de Usuários (`/api/users`)
| Método | Endpoint | Acesso | Descrição |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/users` | Admin | Lista todos os usuários cadastrados. |
| `POST` | `/api/users` | Admin | Cadastra novo usuário com senha e confirmação de senha. |
| `PUT` | `/api/users/:id` | Admin | Atualiza dados ou redefine a senha do usuário. |
| `DELETE` | `/api/users/:id` | Admin | Exclui usuário (com bloqueio de auto-exclusão do admin). |

### 💬 Chat, Multi-Conversas & Memórias (`/api/chat`)
| Método | Endpoint | Acesso | Descrição |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/chat` | Autenticado | Processa a pergunta, executa RAG Text-to-SQL e transmite SSE. |
| `GET` | `/api/chat/conversations` | Autenticado | Lista as conversas ativas do usuário (máx. 10). |
| `POST` | `/api/chat/conversations` | Autenticado | Cria uma nova conversa (com remoção FIFO da mais antiga se necessário). |
| `GET` | `/api/chat/conversations/:id` | Autenticado | Retorna os detalhes e o histórico de mensagens da conversa. |
| `PATCH` | `/api/chat/conversations/:id` | Autenticado | Renomeia o título ou fixa/desafixa a conversa. |
| `DELETE` | `/api/chat/conversations/:id` | Autenticado | Exclui uma conversa e suas mensagens. |
| `GET` | `/api/chat/memories` | Autenticado | Lista as memórias e preferências salvas do usuário. |
| `POST` | `/api/chat/memories` | Autenticado | Cadastra uma nova memória pessoal manualmente. |
| `DELETE` | `/api/chat/memories/:id` | Autenticado | Remove uma memória do usuário. |
| `POST` | `/api/chat/feedback` | Autenticado | Registra avaliação de uma resposta (👍/👎, tags, comentário e snapshot). |

### 📊 "Seu Dashboard" (`/api/dashboard`)
| Método | Endpoint | Acesso | Descrição |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/dashboard/me` | Autenticado | Obtém ou cria o dashboard do usuário autenticado com seus widgets. |
| `POST` | `/api/dashboard/widgets` | Autenticado | Salva diretamente um widget com layout, tipo, dados e query SQL. |
| `POST` | `/api/dashboard/widgets/generate` | Autenticado | Gera e adiciona um novo widget a partir de um prompt em linguagem natural. |
| `PUT` | `/api/dashboard/layout` | Autenticado | Atualiza em lote a ordem e dimensões (`colSpan`, `rowSpan`) dos widgets. |
| `POST` | `/api/dashboard/widgets/:id/refresh` | Autenticado | Reexecuta a query SQL do widget e atualiza seu cache de dados. |
| `DELETE` | `/api/dashboard/widgets/:id` | Autenticado | Exclui um widget do dashboard. |

### 🏆 Curadoria de Feedbacks & Qualidade IA (`/api/admin/feedbacks`)
| Método | Endpoint | Acesso | Descrição |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/feedbacks` | Admin | Retorna a lista filtrada de feedbacks e o dashboard consolidado de métricas. |
| `PATCH` | `/api/admin/feedbacks/:id/status` | Admin | Altera o status da avaliação entre `PENDING` e `RESOLVED`. |

### 🗄️ Integrações ERP & Configurações da IA
| Método | Endpoint | Acesso | Descrição |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/erp/configurations` | Admin | Lista todas as integrações com o Sankhya configuradas. |
| `POST` | `/api/erp/configurations` | Admin | Cria nova integração, cria tabela física e registra no dicionário. |
| `PUT` | `/api/erp/configurations/:id` | Admin | Edita query, colunas, chave primária e parâmetros de agendamento. |
| `DELETE` | `/api/erp/configurations/:id` | Admin | Remove a integração e a tabela física correspondente. |
| `POST` | `/api/erp/configurations/:id/sync` | Admin | Dispara sincronização imediata com o Sankhya. |
| `GET` | `/api/ai/configurations` | Admin | Retorna os parâmetros globais do modelo LLM. |
| `PUT` | `/api/ai/configurations` | Admin | Atualiza system prompt, temperatura, topP e memória. |

---

## 10. Modelagem de Dados (Prisma & PostgreSQL)

O modelo relacional em [`schema.prisma`](file:///mnt/Dados/Projetos/Gideon/backend/prisma/schema.prisma) contempla:

- `Usuario`: Perfis de acesso (`ADMIN` ou `GERENTE`), credenciais e vínculos.
- `AiConfiguration`: System prompt corporativo e hiperparâmetros do modelo.
- `ErpConfiguration`: Queries de extração do Sankhya, estratégias de sync e regras de agendamento.
- `MetaTable` & `MetaColumn`: Dicionário de dados semântico para o RAG Text-to-SQL.
- `ChatConversation` & `ChatMessage`: Histórico multi-conversa, resumo compactado e mensagens.
- `UserMemory`: Memórias e preferências de longo prazo de cada usuário.
- `UserDashboard` & `DashboardWidget`: Painéis analíticos personalizados, posições de grid e cache de consultas.
- `ChatFeedback`: Registro detalhado de avaliações de respostas, tags, comentários, SQL e status de revisão manual.

---

## 11. Arquitetura Frontend (SPA) & Telas do Sistema

Desenvolvido em **React 19, TypeScript, Vite e Tailwind CSS**:

- **Chat com Assistente IA (`/`):**
  - Barra lateral retrátil estilo ChatGPT com histórico das últimas 10 conversas, botão de nova conversa e fixação.
  - Streaming em tempo real via Server-Sent Events (SSE) com indicador de progresso das etapas de raciocínio.
  - Generative UI: renderização interativa de gráficos com `Recharts` e opção imediata de salvar no dashboard.
  - Avaliação de respostas (👍 / 👎) com seleção dinâmica de tags e modal de gerenciamento de memórias do usuário.
- **Seu Dashboard (`/dashboard`):**
  - Grid responsivo de indicadores com suporte a redimensionamento e reordenação.
  - Botão de refresh individual por widget e modal de criação de indicador por prompt.
- **Integrações ERP (`/admin/erp`):**
  - Construtor visual de integrações, editor SQL para Sankhya, seleção de chave primária e agendador.
- **Configurações de IA (`/admin/ai`):**
  - Ajuste de system prompt, regras de negócio e parâmetros de inferência.
- **Feedbacks & Qualidade IA (`/admin/feedbacks`):**
  - Dashboard analítico executivo (taxa de aprovação, tendência temporal, ranking de usuários e motivos).
  - Tabela de revisão com modal de conversa completa e resolução manual.
- **Gestão de Usuários (`/admin/users`):**
  - Controle de contas, regras de senha e definição de papéis.

---

## 12. Variáveis de Ambiente e Configuração

Crie um arquivo `.env` no diretório `backend/`:

```env
# Servidor Backend
PORT=3080
CORS_ORIGIN=http://localhost:3090

# Google Gemini API
GEMINI_API_KEY=sua_chave_do_google_ai_studio
GEMINI_MODEL=gemini-3.5-flash-lite

# Gateway Sankhya ERP
SESSION_SECRET=seu_session_secret_sankhya
SANKHYA_API_URL=https://api.sankhya.com.br/authenticate
SANKHYA_SERVICE_URL=https://api.sankhya.com.br/gateway/v1/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json
SANKHYA_X_TOKEN=seu_x_token
CLIENT_ID=seu_client_id
CLIENT_SECRET=seu_client_secret
grant_type=client_credentials

# Autenticação Gideon
JWT_SECRET=sua_chave_secreta_jwt_longa_e_segura
ADMIN_EMAIL=admin@gideon.local
ADMIN_PASSWORD=Admin@123

# Banco de Dados PostgreSQL
DATABASE_URL="postgresql://usuario:senha@localhost:5432/gideon_db"
DIRECT_URL="postgresql://usuario:senha@localhost:5432/gideon_db"
```

---

## 13. Guia de Instalação e Execução Local

### Pré-requisitos
- Node.js 20+
- PostgreSQL 15+ ativo (local ou container Docker)
- Chave de API do Google Gemini

### 1. Clonar e Instalar Dependências

```bash
# Na raiz do projeto:

# Backend:
cd backend
npm install

# Frontend:
cd ../frontend
npm install
```

### 2. Configurar o Banco de Dados

```bash
cd backend
npx prisma generate
```

> **Atenção:** As tabelas operacionais do ERP (`erp_*`) e de controle interno são gerenciadas de forma idempotente e dinâmica. Não execute `prisma db push --accept-data-loss`.

### 3. Executar a Suíte de Testes Automatizados

```bash
cd backend
npx tsc --noEmit && npx tsx --test src/__tests__/*.test.ts
```

### 4. Iniciar a Aplicação

**Terminal 1 — Backend (Porta 3080):**
```bash
cd backend
npm run dev
```

**Terminal 2 — Frontend (Porta 3090):**
```bash
cd frontend
npm run dev
```

### 5. Acesso Inicial
Acesse no navegador: `http://localhost:3090`
- **Usuário Inicial:** `admin@gideon.local`
- **Senha Inicial:** `Admin@123`

---

*Gideon Enterprise AI &copy; 2026. Todos os direitos reservados.*
