# 🛡️ Gideon — Inteligência Artificial Corporativa & RAG Text-to-SQL para Sankhya ERP

O **Gideon** é uma plataforma corporativa completa de **Inteligência Artificial Generativa e RAG (Retrieval-Augmented Generation)** integrada diretamente ao **Sankhya ERP**. 

A solução permite que gestores, diretores e gerentes comerciais consultem dados de clientes, vendas, estoque, crédito e faturamento em **linguagem natural** através de uma interface de chat conversacional fluida (com respostas em tempo real via streaming SSE), transformando automaticamente perguntas em consultas SQL seguras no PostgreSQL e respondendo com dados reais, análises e insights estratégicos.

---

## 📑 Sumário

1. [Visão Geral e Proposta de Valor](#1-visão-geral-e-proposta-de-valor)
2. [Arquitetura Geral do Sistema](#2-arquitetura-geral-do-sistema)
3. [Pipeline RAG com Expansão de Contexto & Text-to-SQL](#3-pipeline-rag-com-expansão-de-contexto--text-to-sql)
4. [Dicionário de Dados Dinâmico & Multi-tenant](#4-dicionário-de-dados-dinâmico--multi-tenant)
5. [Mecanismo Dinâmico de Tabelas & Agendador ERP](#5-mecanismo-dinâmico-de-tabelas--agendador-erp)
6. [Módulo de Segurança, Autenticação & RBAC](#6-módulo-de-segurança-autenticação--rbac)
7. [Referência Completa de Endpoints da API](#7-referência-completa-de-endpoints-da-api)
8. [Modelagem de Dados (Prisma & PostgreSQL)](#8-modelagem-de-dados-prisma--postgresql)
9. [Arquitetura Frontend (SPA)](#9-arquitetura-frontend-spa)
10. [Variáveis de Ambiente e Configuração](#10-variáveis-de-ambiente-e-configuração)
11. [Guia de Instalação e Execução Local](#11-guia-de-instalação-e-execução-local)

---

## 1. Visão Geral e Proposta de Valor

### O Desafio
Consultar bancos legados de ERPs robustos como o Sankhya normalmente exige conhecimento técnico avançado em SQL, navegação por menus burocráticos e entendimento das nomenclaturas das tabelas e campos internos (ex: `TGFPAR`, `TGFVEN`, `CODPARC`, `AD_RAMOATIV`).

### A Solução Gideon
O Gideon atua como um agente intermediário autônomo entre o usuário de negócios e o banco de dados corporativo:
- **Linguagem Natural:** O gerente simplesmente digita: *"Quais são os dados e o histórico do cliente 11096?"* ou *"Quais clientes da rede AGROPEC têm maior limite de crédito?"*.
- **Sem Alucinações ou Placeholders:** O motor RAG localiza as tabelas pertinentes no banco PostgreSQL interno, gera a query SQL otimizada, executa-a no banco e fornece os dados reais para o LLM responder com números, nomes e recomendações consultivas concretas.
- **Sincronização Programada:** As tabelas internas são alimentadas por integrações periódicas customizáveis com o gateway `DbExplorerSP` da API Sankhya.
- **Diferenciação Estrita de Perfis (RBAC):**
  - **Gerente:** Experiência 100% focada no Chat. Nenhum menu ou rota de configuração é exposto ao gerente.
  - **Administrador:** Controle total da plataforma (Chat, Integrações do ERP, Parâmetros da IA e Gestão de Usuários).

---

## 2. Arquitetura Geral do Sistema

O Gideon foi desenhado seguindo princípios de **Clean Architecture** (Arquitetura Limpa), separação estrita de responsabilidades, injeção de dependências e programação orientada a objetos (POO).

```
                        ┌───────────────────────────────────────────────────┐
                        │             Frontend SPA (React 19)               │
                        │  Vite + Tailwind CSS + Context API + Lucide Icons │
                        └─────────┬───────────────────────────────┬─────────┘
                                  │ HTTP / JSON                   │ SSE Stream
                                  ▼                               ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                           Backend API (Node.js & Express)                         │
│                                                                                   │
│  ┌───────────────────────────────┐     ┌───────────────────────────────────────┐  │
│  │     Módulo de Autenticação    │     │       Módulo de Gestão de Usuários    │  │
│  │   JWT + bcrypt + RBAC Guards  │     │       CRUD Completo (Admin-only)      │  │
│  └───────────────────────────────┘     └───────────────────────────────────────┘  │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐  │
│  │            Pipeline RAG Text-to-SQL (Clean Architecture)                    │  │
│  │  1. ExtractKeywordsUseCase -> 2. SearchMetadataUseCase                       │  │
│  │  3. ExpandRelationshipsUseCase -> 4. BuildSqlGenerationPromptUseCase        │  │
│  │  5. ChatRagService (Geração, Validação Read-Only e Execução Postgres)       │  │
│  └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                   │
│  ┌───────────────────────────────┐     ┌───────────────────────────────────────┐  │
│  │    DynamicTableManager        │     │         ErpSyncScheduler              │  │
│  │  Criação DDL, Sanitização     │     │  Agendamento Inteligente (Cron-like)  │  │
│  │  Bulk Inserts Parametrizados  │     │  Loop assíncrono a cada 30 segundos   │  │
│  └──────────────┬────────────────┘     └───────────────────┬───────────────────┘  │
└─────────────────┼──────────────────────────────────────────┼──────────────────────┘
                  │                                          │
                  │ PostgreSQL (Prisma ORM)                  │ Gateway REST / JSON
                  ▼                                          ▼
   ┌──────────────────────────────┐          ┌──────────────────────────────┐
   │    Banco de Dados Interno    │          │      Sankhya ERP Gateway     │
   │  - usuarios                  │          │  - Autenticação OAuth2       │
   │  - ai_configurations         │          │  - DbExplorerSP.executeQuery │
   │  - erp_configurations        │          └──────────────────────────────┘
   │  - meta_tables/meta_columns  │
   │  - Tabelas dinâmicas (erp_*) │
   └──────────────────────────────┘
```

---

## 3. Pipeline RAG com Expansão de Contexto & Text-to-SQL

O coração da assertividade do Gideon está localizado em `backend/src/modules/data-dictionary` e `backend/src/services/chat-rag.service.ts`.

Quando o usuário envia uma mensagem no chat, o pipeline executa o seguinte fluxo determinístico:

```
 Pergunta do Usuário
        │
        ▼
 1. [ExtractKeywordsUseCase] ──────────► Extrai palavras-chave, entidades e filtros
        │
        ▼
 2. [SearchMetadataUseCase] ───────────► Busca tabelas e colunas candidatas no Dicionário
        │
        ▼
 3. [ExpandRelationshipsUseCase] ─────► Identifica Chaves Estrangeiras (FKs) e traz tabelas
        │                                relacionadas automaticamente para viabilizar JOINs
        ▼
 4. [BuildSqlGenerationPromptUseCase] ─► Constrói um pseudo-DDL simplificado com as PKs e tipos
        │
        ▼
 5. [Gemini LLM] ─────────────────────► Gera query SQL estrita para PostgreSQL
        │
        ▼
 6. [Validação de Segurança] ──────────► Garante que a query inicia com SELECT/WITH,
        │                                bloqueia qualquer comando DDL/DML e anexa LIMIT 50
        ▼
 7. [Execução no PostgreSQL] ──────────► Executa via prismaClient.$queryRawUnsafe() e
        │                                trata bigint do Postgres para JSON limpo
        ▼
 8. [Injeção no Contexto do Chat] ─────► Injeta os dados reais com diretiva contra placeholders
        │
        ▼
 Gemini gera resposta contextualizada final e entrega via SSE Stream ao Frontend
```

### Arquivos Principais do Pipeline:
- [`ExtractKeywordsUseCase`](file:///d:/Projetos/Gideon/backend/src/modules/data-dictionary/application/use-cases/extract-keywords.use-case.ts): Utiliza o Gemini para quebrar perguntas complexas em tokens e termos de negócio (ex: `"cliente"`, `"11096"`, `"limite"`, `"saldo"`).
- [`SearchMetadataUseCase`](file:///d:/Projetos/Gideon/backend/src/modules/data-dictionary/application/use-cases/search-metadata.use-case.ts): Realiza correspondência insensível a maiúsculas/minúsculas e pontuação nas tabelas e colunas cadastradas, calculando pontuação de relevância.
- [`ExpandRelationshipsUseCase`](file:///d:/Projetos/Gideon/backend/src/modules/data-dictionary/application/use-cases/expand-relationships.use-case.ts): Percorre o grafo de dependências. Se a tabela de vendas `erp_vendas` foi selecionada e possui FK para `erp_clientes`, esta última é automaticamente anexada ao contexto para permitir o JOIN correto.
- [`BuildSqlGenerationPromptUseCase`](file:///d:/Projetos/Gideon/backend/src/modules/data-dictionary/application/use-cases/build-sql-generation-prompt.use-case.ts): Monta o esquema DDL simplificado informando expressamente quais colunas são PKs e FKs.
- [`ChatRagService`](file:///d:/Projetos/Gideon/backend/src/services/chat-rag.service.ts): Orquestrador do Text-to-SQL que solicita a query ao Gemini, inspeciona e valida segurança contra SQL Injection / mutações destrutivas e executa no banco de dados.

---

## 4. Dicionário de Dados Dinâmico & Multi-tenant

O banco de dados armazena metadados de qualquer tabela dinâmica criada pelos usuários através dos modelos `MetaTable` e `MetaColumn`.

### Características:
- **Isolamento Multitenant:** Suporte nativo a múltiplos clientes através do campo `tenantId` com índices dedicados.
- **Normalização de Identificadores (PostgreSQL Case-Folding):** O PostgreSQL converte identificadores sem aspas para minúsculas. O `MetaColumnEntity` normaliza as colunas em minúsculas para garantir compatibilidade 100% com identificadores cotados (`"codcli"`, `"razaosocial"`).
- **Identificação Obrigatória de Chave Primária (PK):** Impede a criação ou sincronização de tabelas sem a demarcação estrita da PK.

---

## 5. Motor de Sincronização ERP, Filas & Tabelas Dinâmicas

### DynamicTableManager (`backend/src/services/dynamic-table.manager.ts`)
Responsável pelo ciclo de vida físico das tabelas dinâmicas no PostgreSQL, controle estrito de memória do V8 Heap e execução das estratégias de sincronização com o Sankhya ERP:

- **Estratégias Estritas de Sincronização:**
  1. `FULL` **(Sincronização Completa Paginada):**
     - Trunca a tabela no PostgreSQL (`TRUNCATE TABLE`).
     - Executa paginação universal por `OFFSET` (via `ROWNUM` no Oracle) ou por macro `{{LAST_CURSOR}}`.
     - Insere os dados em massa em sub-lotes controlados de 500 registros, gerando e persistindo o `_row_hash` para cada linha.
     - Libera explicitamente arrays e referências a cada lote para estabilidade do Garbage Collector (V8 Heap).
  2. `HASH_COMPARATOR` **(Sincronização Incremental Inteligente por Hash):**
     - Varre os dados do ERP em lotes configuráveis (`batchSize`).
     - Calcula em memória o Hash MD5 determinístico (`_row_hash`) de cada linha recebida.
     - Consulta no PostgreSQL apenas os hashes atuais das PKs daquele lote (`SELECT pk, _row_hash WHERE pk IN (...)`).
     - Compara linha a linha: linhas com hash idêntico são **descartadas imediatamente da memória** (economia massiva de CPU, rede e I/O).
     - Linhas novas ou modificadas sofrem `UPSERT` nativo via `INSERT ... ON CONFLICT ("primary_key") DO UPDATE SET ...`.
     - Reconciliação inteligente: em varreduras totais, identifica e executa Hard Delete (`DELETE FROM ... WHERE pk IN (...)`) para registros ausentes no ERP.
- **Hash MD5 Determinístico (`generateRowHash`):**
  - Concatena chave e valor ordenados alfabeticamente (`campo1:valor1|campo2:valor2`).
  - Isola metadados técnicos (`_id`, `_row_hash`, `_synced_at`, `created_at`), garantindo que alterações na ordem das colunas da query não gerem falsos positivos.
- **Prevenção de Loops Infinitos & Paginação Híbrida:**
  - Se a query SQL do usuário não possuir a macro `{{LAST_CURSOR}}`, o sistema pagina automaticamente via `OFFSET` e `ROWNUM` do Oracle.
  - Guarda anti-estagnação (*stall detection*): se a macro `{{LAST_CURSOR}}` for utilizada e o cursor não avançar entre lotes consecutivos, o loop é interrompido com alerta.
- **Arquitetura de Chaves e Isolamento DDL:**
  - A chave surrogate técnica interna do PostgreSQL é nomeada como `"_id" BIGSERIAL PRIMARY KEY`.
  - Caso a query do ERP utilize uma chave de negócio chamada `"id"` ou `"ID"` (ex: concatenações de strings como `CODPARC || '-' || CODVEND`), esta é criada como coluna de negócio do tipo `TEXT`, permitindo índices únicos e `ON CONFLICT` textuais.
- **Colunas Técnicas Padronizadas:**
  - `_row_hash TEXT`: Hash MD5 do conteúdo completo da linha.
  - `_synced_at TIMESTAMPTZ DEFAULT NOW()`: Registro de data/hora da sincronização.
  - `created_at TIMESTAMPTZ DEFAULT NOW()`: Data de inserção do registro local.

### SyncQueueManager (`backend/src/services/sync-queue.manager.ts`)
Sistema de fila em memória com padrão Singleton que gerencia a execução de sincronizações:
- **Controle Estrito de Concorrência:** Limita a execução concorrente de tabelas (`concurrency = 1` por padrão) para proteger a CPU, memória RAM e limites de conexões do PostgreSQL e gateway do Sankhya.
- **Enfileiramento Inteligente:** Previne duplicação de jobs pendentes para a mesma tabela.
- **Tratamento de Falhas:** Notifica eventos de início, sucesso e erro, atualizando o status da configuração com detalhes da execução.

### ErpSyncScheduler (`backend/src/services/erp-sync.scheduler.ts`)
Serviço de agendamento autônomo baseado em intervalos que roda em segundo plano:
- **Ciclo de Verificação:** Executa a cada 30 segundos, verificando se há integrações ativas elegíveis para execução e as envia para o `SyncQueueManager`.
- **Frequências Suportadas:**
  1. `MINUTES`: Intervalo em minutos (ex: a cada 15 min).
  2. `HOURS`: Intervalo em horas (ex: a cada 1 hora).
  3. `DAILY`: Execução diária em horário fixo (ex: às 08:00).
  4. `MONTHLY`: Execução mensal em dia e horário específicos (ex: todo dia 01 às 08:00).
  5. `MANUAL`: Apenas sincronização manual disparada pelo painel administrativo.
- **Rastreabilidade:** Grava `lastSyncAt`, `nextSyncAt`, `lastSyncStatus` (`SUCCESS` ou `ERROR`) e `lastSyncMessage`.

---

## 6. Módulo de Segurança, Autenticação & RBAC

O sistema de autenticação legado (validação em tempo de login na tabela `TGFVEN` via Sankhya com envio de OTP) foi descontinuado. A autenticação agora é **100% interna e baseada na tabela de usuários do PostgreSQL**.

### Regras de Negócio e Segurança:
- **Criptografia:** Senhas armazenadas com hash seguro via `bcryptjs` (salt rounds = 10). A `senha_hash` **nunca** é devolvida pela API.
- **Política de Senha Obrigatória (Regex):**
  ```regex
  ^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$
  ```
  - Mínimo de 8 caracteres.
  - Pelo menos 1 letra maiúscula (`A-Z`).
  - Pelo menos 1 letra minúscula (`a-z`).
  - Pelo menos 1 número (`0-9`).
  - Pelo menos 1 caractere especial (`!@#$%^&*()_+-=...`).
- **Validação de Confirmação:** No cadastro ou alteração, os campos `senha` e `confirmacao_senha` devem ser idênticos.
- **Tokens JWT:** Assinados com secret configurável, com validade de 7 dias, transportando perfil (`ADMIN` ou `GERENTE`), dados do usuário e identificadores do ERP.
- **Auto-proteção:** Administradores não podem excluir a própria conta logada.

---

## 7. Referência Completa de Endpoints da API

Todas as rotas da API estão prefixadas por `/api`.

### 🔑 Autenticação (`/api/auth`)

| Método | Endpoint | Acesso | Descrição |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Público | Autenticação com `email` e `password`. Retorna token JWT e perfil do usuário. |
| `POST` | `/api/auth/login/admin` | Público | Alias do endpoint de login. |
| `GET` | `/api/auth/me` | Autenticado | Retorna os dados do usuário autenticado no token Bearer. |

---

### 👥 Gestão de Usuários (`/api/users`)
*Todas as rotas abaixo exigem privilégio de `ADMIN` (Middleware `requireAdmin`).*

| Método | Endpoint | Descrição |
| :--- | :--- | :--- |
| `GET` | `/api/users` | Lista todos os usuários cadastrados (sem expor `senha_hash`), ordenados por data de criação. |
| `GET` | `/api/users/:id` | Retorna os detalhes de um usuário específico. |
| `POST` | `/api/users` | Cria um novo usuário (`nome`, `email`, `usuario_erp`, `cod_gerente_erp`, `tipo_acesso`, `senha`, `confirmacao_senha`). |
| `PUT` | `/api/users/:id` | Atualiza dados cadastrais e/ou redefine a senha (senha opcional na edição). |
| `DELETE` | `/api/users/:id` | Remove um usuário (bloqueia auto-exclusão do próprio administrador). |

---

### 🗄️ Integrações do ERP Sankhya (`/api/erp`)

| Método | Endpoint | Acesso | Descrição |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/erp/query` | Autenticado | Executa consulta somente-leitura de teste no gateway `DbExplorerSP` do Sankhya. |
| `GET` | `/api/erp/configurations` | Admin | Lista todas as integrações configuradas com status de agendamento. |
| `POST` | `/api/erp/configurations` | Admin | Cria nova integração, gera a tabela dinâmica física e registra no Dicionário de Dados. |
| `GET` | `/api/erp/configurations/:id` | Admin | Retorna dados de uma configuração específica. |
| `PUT` | `/api/erp/configurations/:id` | Admin | Atualiza a query, colunas esperadas, PK, agendamento e sincroniza o DDL. |
| `DELETE` | `/api/erp/configurations/:id` | Admin | Exclui a integração e sua tabela física no banco. |
| `POST` | `/api/erp/configurations/:id/sync` | Admin | Dispara manualmente a sincronização imediata com o Sankhya. |

---

### 🤖 Configurações da IA (`/api/ai`)

| Método | Endpoint | Acesso | Descrição |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/ai/configurations` | Admin | Retorna o `systemPrompt`, `temperature`, `topP` e `memorySize`. |
| `PUT` | `/api/ai/configurations` | Admin | Atualiza os parâmetros globais da IA persistidos no PostgreSQL. |

---

### 💬 Chat com RAG e Streaming SSE (`/api/chat`)

| Método | Endpoint | Acesso | Descrição |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/chat` | Autenticado | Recebe o histórico da conversa, executa o RAG Text-to-SQL, consulta dados reais no Postgres e transmite a resposta via Server-Sent Events (`text/event-stream`). |

---

## 8. Modelagem de Dados (Prisma & PostgreSQL)

O arquivo [`schema.prisma`](file:///d:/Projetos/Gideon/backend/prisma/schema.prisma) define as entidades estruturais do Gideon:

```prisma
// Usuários internos do Gideon
model Usuario {
  id              String   @id @default(uuid())
  nome            String
  email           String   @unique
  senha_hash      String   @map("senha_hash")
  usuario_erp     String   @map("usuario_erp")
  cod_gerente_erp String   @map("cod_gerente_erp")
  tipo_acesso     String   @default("GERENTE") @map("tipo_acesso")
  criado_em       DateTime @default(now()) @map("criado_em")
  atualizado_em   DateTime @updatedAt @map("atualizado_em")

  @@map("usuarios")
}

// Configurações globais de comportamento do modelo LLM
model AiConfiguration {
  id           String   @id @default("ai-config")
  systemPrompt String   @db.Text
  temperature  Float    @default(0.7)
  topP         Float    @default(0.9)
  memorySize   Int      @default(10)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@map("ai_configurations")
}

// Configurações de integração SQL com o Sankhya, Estratégia de Sync e Agendamento
model ErpConfiguration {
  id              String    @id @default(uuid())
  context         String
  description     String    @db.Text
  query           String    @db.Text
  expectedFields  String[]
  tableName       String
  primaryKey      String?

  // Estratégia de sincronização e paginação (FULL ou HASH_COMPARATOR)
  syncStrategy    String    @default("FULL") // FULL ou HASH_COMPARATOR
  lastSyncCursor  String?
  batchSize       Int       @default(1000)
  activeColumn    String?
  activeValue     String?

  // Agendamento da atualização automática
  syncFrequency   String    @default("HOURS") // MINUTES, HOURS, DAILY, MONTHLY, MANUAL
  syncInterval    Int?      @default(1)
  syncTime        String?   @default("08:00")
  syncDayOfMonth  Int?      @default(1)
  syncActive      Boolean   @default(true)
  lastSyncAt      DateTime?
  nextSyncAt      DateTime?
  lastSyncStatus  String?   // SUCCESS, ERROR, RUNNING
  lastSyncMessage String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@map("erp_configurations")
}

// Dicionário de Dados: Tabelas cadastradas para RAG
model MetaTable {
  id          String       @id @default(uuid())
  tenantId    String
  tableName   String
  description String       @db.Text
  columns     MetaColumn[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  @@unique([tenantId, tableName])
  @@index([tenantId])
  @@map("meta_tables")
}

// Dicionário de Dados: Colunas e Relacionamentos
model MetaColumn {
  id                 String    @id @default(uuid())
  metaTableId        String
  columnName         String
  dataType           String    @default("TEXT")
  description        String    @db.Text
  isPrimaryKey       Boolean   @default(false)
  foreignKeyToTable  String?
  foreignKeyToColumn String?
  metaTable          MetaTable @relation(fields: [metaTableId], references: [id], onDelete: Cascade)
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  @@unique([metaTableId, columnName])
  @@index([metaTableId])
  @@map("meta_columns")
}
```

---

## 9. Arquitetura Frontend (SPA)

Construído com **React 19, TypeScript e Vite**, priorizando performance, responsividade e separação clara de papéis:

- [`AuthContext.tsx`](file:///d:/Projetos/Gideon/frontend/src/context/AuthContext.tsx): Gerenciador global de sessão, persistência via `localStorage`, renovação e cabeçalhos de autorização Bearer.
- [`ProtectedRoute.tsx`](file:///d:/Projetos/Gideon/frontend/src/components/ProtectedRoute.tsx): Guarda de rotas que valida se o usuário está logado e se possui o papel exigido (`requiredRole="ADMIN"`). Se um Gerente tentar acessar `/admin/*`, é redirecionado instantaneamente para `/`.
- [`Login.tsx`](file:///d:/Projetos/Gideon/frontend/src/pages/Login.tsx): Tela de autenticação moderna e direta com validação de credenciais.
- [`Chat.tsx`](file:///d:/Projetos/Gideon/frontend/src/pages/Chat.tsx): Interface conversacional otimizada com streaming de texto em tempo real (Server-Sent Events) e renderização rica em Markdown.
- [`AdminERP.tsx`](file:///d:/Projetos/Gideon/frontend/src/pages/AdminERP.tsx): Painel completo de integração com Sankhya, editor SQL com atalhos de teclado, seleção de Chave Primária (PK), configuração de agendamento e sincronização manual instantânea.
- [`AdminAI.tsx`](file:///d:/Projetos/Gideon/frontend/src/pages/AdminAI.tsx): Ajuste em tempo real do Prompt do Sistema, Temperatura, TopP e limite de histórico.
- [`AdminUsers.tsx`](file:///d:/Projetos/Gideon/frontend/src/pages/AdminUsers.tsx): Módulo de Gestão de Usuários com Tabela / Data Grid, barra de busca instantânea, checklist visual de validação de senha e modais de criação, edição, visualização e exclusão.

---

## 10. Variáveis de Ambiente e Configuração

Crie um arquivo `.env` na pasta `backend/` com as seguintes chaves:

```env
# Servidor
PORT=3001
CORS_ORIGIN=http://localhost:3000

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

# Banco de Dados PostgreSQL (Supabase)
DATABASE_URL="postgresql://usuario:senha@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://usuario:senha@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"
```

---

## 11. Guia de Instalação e Execução Local

### Pré-requisitos
- Node.js versão 20+ instalada
- PostgreSQL ativo (ou projeto no Supabase)
- Chave de API do Google Gemini ativa

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

### 3. Iniciar os Servidores em Modo de Desenvolvimento

**Terminal 1 — Backend (porta 3001):**
```bash
cd backend
npm run dev
```

**Terminal 2 — Frontend (porta 5173):**
```bash
cd frontend
npm run dev
```

### 4. Acesso Inicial
Abra o navegador em `http://localhost:5173/login`:
- **Usuário Padrão:** `admin@gideon.local`
- **Senha Padrão:** `Admin@123`

---

*Gideon Enterprise AI &copy; 2026. Todos os direitos reservados.*
