# 🏛️ MEMORY PALACE — Gideon Knowledge & Decision Vault

Este documento é a fonte canônica e imutável de todas as decisões arquiteturais, alterações estruturais e regras de negócio implementadas no **Gideon**.

> [!IMPORTANT]
> **REGRA OBRIGATÓRIA PARA TODOS OS AGENTES:**
> Toda alteração, refatoração significativa, adição de funcionalidade ou mudança de regra de negócio **DEVE** ser registrada neste documento no final da tarefa pelo agente que realizou a alteração, informando a data, o agente responsável, o contexto da mudança e os arquivos impactados.

---

## 📐 Padrão Obrigatório de Mensagens de Commit (Git Standards)

Todas as mensagens de commit no projeto devem seguir a especificação em **inglês**, baseada no Conventional Commits com prefixos estritos:

| Prefixo | Significado / Quando Usar | Exemplo |
| :--- | :--- | :--- |
| `feat:` | Adição de nova funcionalidade | `feat(rag): add hybrid search combining BM25 and vector embeddings` |
| `fix:` | Correção de bug ou regressão | `fix(sync): resolve memory leak on Sankhya bulk insert stream` |
| `perf:` | Otimizações de performance (memória, CPU, render) | `perf(frontend): prevent unnecessary re-renders in chat message stream` |
| `refactor:` | Mudança estrutural de código sem alterar comportamento externo | `refactor(auth): split RBAC guards into modular middleware functions` |
| `test:` | Adição ou refatoração de testes unitários/integração/E2E | `test(api): add integration tests for Text-to-SQL dynamic execution` |
| `ci:` | Alterações em pipelines de CI/CD, scripts de build e workflows | `ci(actions): configure typecheck and automated test suite on PR` |
| `docs:` | Atualizações exclusivas em documentações, README ou Memory Palace | `docs(palace): record architecture shift to cursor-based pagination` |
| `chore:` | Atualização de dependências ou tarefas operacionais rotineiras | `chore(deps): bump @prisma/client to 6.19.3` |
| `duel:` | Comparação técnica de benchmark/POC entre duas soluções alternativas | `duel(cache): evaluate Redis vs In-Memory LRU eviction for metadata` |

---

## 📜 Registro Cronológico de Alterações (Changelog do Palácio)

### [2026-10-20] — Formação do Time de Agentes Especialistas & Memory Palace
- **Agente Responsável:** `antigravity` (Orquestrador)
- **Tipo:** `feat` / `docs`
- **Contexto & Motivação:** 
  Criação da equipe especializada de agentes autônomos para o ecossistema Gideon, garantindo separação rígida de responsabilidades, otimização de recursos e blindagem de código.
- **Implementações Realizadas:**
  1. Criação do agente `backend`: especialista em engenharia de software com foco prioritário em gestão de memória (streams, batching, prevenção de memory leaks) e integrações resilientes (APIs, ERP Sankhya, Gemini).
  2. Criação do agente `frontend`: especialista em UI com foco em performance de renderização (React 19), responsividade fluida e consumo em tempo real de streaming SSE.
  3. Criação do agente `tester`: especialista em QA e automação CI/CD para prevenção ativa de regressões em cada entrega.
  4. Criação do agente `ai-specialist`: especialista em RAG, Text-to-SQL corporativo, prompt engineering e metodologias de fine-tuning/treinamento de LLMs.
  5. Criação do agente `planner`: segundo Tech Lead com ferramentas de escrita bloqueadas, atuando como sparring partner reflexivo, questionando complexidade e desenhando estratégias conceituais.
  6. Estabelecimento das diretrizes do **Memory Palace** e do padrão de commits em inglês.
- **Arquivos Criados/Impactados:**
  - `MEMORY_PALACE.md`
  - `.agents/rules/backend.md`
  - `backend/AGENTS.md`
  - `.agents/rules/git-standards.md`

---



### [2026-10-20] — Diagnóstico Geral de Arquitetura & Diretrizes de Zero-Alucinação e LGPD
- **Agente Responsável:** `planner` (Tech Lead)
- **Tipo:** `docs` / `refactor`
- **Contexto & Motivação:** 
  Diagnóstico cirúrgico em 4 pilares:
  1. RAG sem alucinação: Grounding determinístico e fallback imediato quando dados não existirem.
  2. UI didática e responsiva: `100dvh`, feedback de etapas no SSE, visualização de tabelas adaptativa (mobile card vs desktop).
  3. Processamento ERP: Postgres Advisory Lock (`pg_try_advisory_lock`) em vez de lock em memória para suportar múltiplos pods; hashing invariante.
  4. Segurança e LGPD: Camada de mascaramento automático de CPF/e-mails/telefones antes de enviar ao Gemini e `statement_timeout` com transação read-only estrita no Postgres.
- **Arquivos Impactados:**
  - `backend/src/services/chat-rag.service.ts`
  - `backend/src/services/gemini.service.ts`
  - `backend/src/services/dynamic-table.manager.ts`
  - `backend/src/services/erp-sync.scheduler.ts`
  - `frontend/src/pages/Chat.tsx`
  - `frontend/src/components/chat/DynamicDashboard.tsx`


### [2026-10-20] — Blindagem RAG Zero-Alucinação, Grounding Estrito & Sanitização LGPD
- **Agente Responsável:** `ai-specialist`
- **Tipo:** `feat` / `fix`
- **Contexto & Motivação:**
  Eliminar qualquer possibilidade de alucinação do modelo quando o banco não possui dados ou quando uma pergunta foge do escopo sincronizado, além de assegurar conformidade com a LGPD mascarando PII e segredos antes de enviar dados ao LLM externo (Google Gemini) e blindar o banco PostgreSQL contra queries maliciosas.
- **Implementações Realizadas:**
  1. **Sanitizador LGPD (`lgpd-sanitizer.ts`):** Funções puras `sanitizeRowsForLgpd`, `maskCpf` (`***.XXX.XXX-**`), `maskRg` (`**.XXX-*`), `maskEmail` (`ma***@dominio.com.br`), `maskPhone` (`(11) *****-1234`) e redação total (`[REDACTED_LGPD]`) de senhas/tokens tanto por nome de coluna quanto por varredura regex em campos de texto livre.
  2. **Validação SQL Read-Only Avançada (`chat-rag.service.ts`):** Remoção prévia de comentários/literais, permissão exclusiva para `SELECT` / `WITH ... SELECT`, bloqueio de stacked queries (`;`), DDL/DML e funções perigosas (`pg_sleep`, `pg_read_file`, `dblink`), e bloqueio de tabelas internas/sistema (`pg_catalog`, `information_schema`, `usuarios`, `ai_configurations`, `erp_configurations`).
  3. **Transação Read-Only & Timeout:** Execução via `prisma.$transaction` com `SET LOCAL TRANSACTION READ ONLY` e `SET LOCAL statement_timeout = '5000ms'`.
  4. **Grounding Determinístico (`chat-rag.service.ts` & `gemini.service.ts`):** `temperature: 0.0` para geração SQL, injeção de `STRICT_GROUNDING_SYSTEM_INSTRUCTION` em todas as chamadas de chat e retorno estruturado `RagPipelineResult` com `noDataFound: true` e prompt determinístico de recusa quando 0 linhas são retornadas.
- **Arquivos Impactados:**
  - `backend/src/utils/lgpd-sanitizer.ts`
  - `backend/src/services/chat-rag.service.ts`
  - `backend/src/services/gemini.service.ts`
  - `backend/src/modules/data-dictionary/application/use-cases/build-sql-generation-prompt.use-case.ts`

### [2026-10-20] — Hash Comparator Invariante, Advisory Lock Distribuído & Resiliência Sankhya ERP
- **Agente Responsável:** `backend`
- **Tipo:** `perf` / `feat` / `fix`
- **Contexto & Motivação:**
  Garantir integridade absoluta na comparação de hashes MD5 entre Sankhya (Oracle/SQL) e PostgreSQL, impedir execuções concorrentes de sincronização em múltiplos containers, otimizar uso do V8 Heap e evitar *thundering herd* na autenticação OAuth2 do ERP.
- **Implementações Realizadas:**
  1. **Hash Determinístico Invariante (`dynamic-table.manager.ts`):** Ordenação lexicográfica estrita de chaves (`trim().toLowerCase()`), exclusão de colunas técnicas (`_id`, `_row_hash`, `_synced_at`, `created_at`, `updated_at`), convergência canônica de `null`/`undefined`/strings vazias, normalização de datas ISO-8601 e decimais (`10` vs `"10.00"`) preservando zeros à esquerda em códigos fiscais.
  2. **Otimização de V8 Heap (`dynamic-table.manager.ts`):** Remoção da lista intermediária `activeBatchRows`, busca de hashes em sub-lotes de 500 PKs e limpeza imediata de `dbHashMap` e arrays brutos antes do I/O de escrita.
  3. **Distributed Lock PostgreSQL (`erp-sync.scheduler.ts`):** Implementação de `pg_try_advisory_lock(849201746)` e `pg_advisory_unlock(849201746)` garantindo exclusão mútua entre múltiplas réplicas do backend.
  4. **Single-Flight Token Refresh & Retry (`sankhya.service.ts`):** Promise lock compartilhada em `getAccessToken`, retry automático com *Exponential Backoff + Jitter*, reconexão transparente em HTTP 401 e sanitização de credenciais em logs de erro.
  5. **Controle de Memória na Fila (`sync-queue.manager.ts`):** Limite de backpressure (`maxQueueSize = 100`), buffer circular FIFO (`maxHistorySize = 50`) e limpeza de referências pesadas no bloco `finally`.
- **Arquivos Impactados:**
  - `backend/src/services/dynamic-table.manager.ts`
  - `backend/src/services/erp-sync.scheduler.ts`
  - `backend/src/services/sankhya.service.ts`
  - `backend/src/services/sync-queue.manager.ts`

### [2026-10-20] — UI Mobile-First (`100dvh`), Prompts Didáticos,Tabelas Adaptativas & Streaming Otimizado
- **Agente Responsável:** `frontend`
- **Tipo:** `feat` / `perf`
- **Contexto & Motivação:**
  Tornar a experiência de chat extremamente fluida, didática e ergonômica tanto no celular (foco em gerentes comerciais) quanto no desktop (foco em administradores), eliminando re-renderizações desnecessárias durante o streaming SSE.
- **Implementações Realizadas:**
  1. **Viewport Mobile-First & Ergonomia (`Chat.tsx`, `index.css`):** Uso de `100dvh`, área de toque mínima de `44px`, botão `Parar` geração em andamento e limpeza rápida de conversa.
  2. **Interface Didática & Progresso em Etapas (`Chat.tsx`):** Cartões e drawer de sugestões rápidas divididos por categorias (*Faturamento & Vendas*, *Clientes & Limite de Crédito*, *Estoque & Produtos*) e componente `DidacticProgressIndicator` exibindo as etapas do pipeline RAG em tempo real.
  3. **Isolamento de Renderização (`Chat.tsx`):** `ChatMessageItem` encapsulado em `React.memo` para evitar re-renderizar mensagens e gráficos anteriores a cada chunk SSE.
  4. **Visualização Híbrida Adaptativa (`DynamicDashboard.tsx`):** Exibição automática em **Cards Compactos** no mobile (`< sm`) e **Tabela com Coluna Sticky** no desktop (`>= sm`) com seletor manual Cards/Tabela, parser JSON resiliente e formatação PT-BR compacta nos eixos (`12,5 mil`, `1,4 mi`) e completa nos tooltips/células (`R$ 1.234,56`).
  5. **Ciclo de Vida SSE (`useChat.ts`):** Cancelamento limpo de streams via `AbortController` e tradução didática de erros de rede/sessão.
- **Arquivos Impactados:**
  - `frontend/src/pages/Chat.tsx`
  - `frontend/src/components/chat/DynamicDashboard.tsx`
  - `frontend/src/hooks/useChat.ts`
  - `frontend/src/index.css`

### [2026-10-20] — Suíte de Testes Automatizados (RAG, LGPD, Hash Sync) & Pipeline CI/CD
- **Agente Responsável:** `tester`
- **Tipo:** `test` / `ci`
- **Contexto & Motivação:**
  Blindar os 4 pilares do Gideon contra regressões futuras através de testes automatizados rápidos e pipeline de validação contínua no GitHub Actions.
- **Implementações Realizadas:**
  1. **Testes de Segurança RAG, LGPD e Anti-Alucinação (`rag-security-lgpd.test.ts`):** Validação de bloqueio DDL/DML, stacked queries (`;`), proteção de tabelas internas/sistema, mascaramento de CPF/e-mail/telefone/segredos e garantia de fallback determinístico (`noDataFound: true`) quando a consulta retorna `[]`.
  2. **Testes de Invariância de Hash e Sync Incremental (`hash-and-sync.test.ts`):** Validação de independência da ordem de chaves no MD5, normalização de `null`/`undefined`/metadados internos e teste integrado de `hashComparatorSync` (ignorando linhas inalteradas e fazendo upsert apenas de linhas modificadas/novas).
  3. **Pipeline CI/CD (`.github/workflows/ci.yml`):** Workflow GitHub Actions com jobs paralelos para Backend (Prisma generate, `tsc --noEmit` e `npx tsx --test`) e Frontend (`npm run lint` e `npm run build`).
- **Arquivos Impactados:**
  - `.github/workflows/ci.yml`
  - `backend/src/__tests__/rag-security-lgpd.test.ts`
  - `backend/src/__tests__/hash-and-sync.test.ts`


### [2026-10-21] — Correção Multiplataforma (Linux & Windows) para Binários Nativos e Prisma Engine
- **Agente Responsável:** `antigravity` (Orquestrador)
- **Tipo:** `fix` / `chore`
- **Contexto & Motivação:**
  O projeto reside em uma partição compartilhada (`/mnt/Dados/Projetos/Gideon`) onde `node_modules` havia sido instalado originalmente no Windows (`win32-x64`), causando ausência de `@rollup/rollup-linux-x64-gnu`, `@esbuild/linux-x64` e da engine Prisma `debian-openssl-3.0.x` ao rodar `npm run dev` no Linux.
- **Implementações Realizadas:**
  1. Adicionado `binaryTargets = ["native", "debian-openssl-3.0.x", "windows"]` em `backend/prisma/schema.prisma` e regerado o Prisma Client para suportar ambos os ambientes.
  2. Instalados os binários nativos de Linux para Rollup e Esbuild em `frontend` e `backend`.
  3. Adicionado tratamento explícito do evento `EADDRINUSE` em `backend/src/server.ts`.
- **Arquivos Impactados:**
  - `backend/prisma/schema.prisma`
  - `backend/src/server.ts`

### [2026-10-21] — Migração de Session Advisory Lock para Trava Distribuída Atômica com TTL
- **Agente Responsável:** `backend`
- **Tipo:** `fix` / `perf` / `refactor`
- **Contexto & Motivação:**
  O uso de `pg_try_advisory_lock` e `pg_advisory_unlock` causava starvation perpétuo (`Outra instância do backend detém o PostgreSQL Advisory Lock`) devido ao Connection Pool do Prisma, onde a aquisição da trava e a sua liberação ocorriam em conexões TCP físicas diferentes da sessão do PostgreSQL.
- **Implementações Realizadas:**
  1. **Tabela Atômica de Travas Distribuídas:** Criação automática e idempotente da tabela `system_distributed_locks` (`lock_key`, `locked_by`, `acquired_at`, `expires_at`).
  2. **Aquisição Atômica via Upsert Condicional com TTL:** Substituição de `pg_try_advisory_lock` por `INSERT ... ON CONFLICT (lock_key) DO UPDATE ... WHERE system_distributed_locks.expires_at < NOW() RETURNING lock_key` com TTL padrão de 180 segundos.
  3. **Liberação Determinística e Segura:** Remoção no bloco `finally` condicionada a `WHERE lock_key = ... AND locked_by = instanceId`, impedindo que uma instância que tenha excedido seu TTL delete indevidamente a trava adquirida por outra instância.
  4. **Limpeza Preventiva Legada:** Chamada resiliente a `SELECT pg_advisory_unlock_all();` na inicialização do scheduler para purgar quaisquer travas de sessão órfãs deixadas por versões anteriores.
  5. **Suíte de Testes de Concorrência & TTL:** Criação de `scheduler-distributed-lock.test.ts` cobrindo criação da tabela, ciclo normal de vida, bloqueio de concorrência entre múltiplas instâncias, auto-expiração (deadlock recovery) e proteção contra remoções indevidas.
- **Arquivos Impactados:**
  - `backend/src/services/erp-sync.scheduler.ts`
  - `backend/src/__tests__/scheduler-distributed-lock.test.ts`
  - `MEMORY_PALACE.md`

### [2026-10-21] — Auto-Detecção de FKs Virtuais, Enriquecimento Semântico e Sinônimos de Negócio
- **Agente Responsável:** `backend`
- **Tipo:** `feat` / `refactor`
- **Contexto & Motivação:**
  Eliminar o falso-positivo `SEM_DADOS_DISPONIVEIS` (`NO_RELEVANT_TABLES`) provocado pela ausência de vocabulário de negócio e viabilizar consultas cruzadas (multi-tabela com JOINs) conectando as tabelas dinâmicas em um grafo relacional sem criar FKs físicas no PostgreSQL.
- **Implementações Realizadas:**
  1. **Auto-Detecção de FKs Virtuais (`AutoDetectRelationshipsUseCase`):** Algoritmo heurístico que mapeia as PKs conhecidas do tenant e vincula automaticamente colunas correspondentes (ex: `CODPARC`, `CODPROD`, `NUNOTA`) inclusive com normalização de separadores (ex: `COD_PARC` -> `CODPARC`), preservando FKs manuais pré-existentes.
  2. **Geração e Injeção de Sinônimos de Negócio (`ErpConfigurationService`):** Métodos `inferBusinessSynonyms` e `generateTableDescription` que agregam termos canônicos (faturamento, vendas, receita, pedidos, clientes, financeiro) nas descrições persistidas em `meta_tables`.
  3. **Enriquecimento de Colunas do Sankhya ERP:** Mapeamento semântico rico para siglas críticas (`VLRNOTA`, `TIPMOV`, `STATUSNOTA`, `CODPARC`, `CODPROD`), informando tipos e valores válidos para o LLM.
  4. **Indexação Universal no Dicionário:** Suporte a integrações sem PK de negócio explícita através da inclusão da chave surrogate `_id`, garantindo que nenhuma tabela fique invisível para o motor de busca RAG.
  5. **Bônus de Relevância por Sinônimos (`SearchMetadataUseCase`):** Ponderação com pontuação elevada (+12) quando o termo de busca coincide com a seção de sinônimos de negócio da tabela.
  6. **Suíte de Testes Automatizados (`schema-relationships-and-synonyms.test.ts`):** Validação de auto-detecção de relacionamentos, expansão de grafo relacional e busca semântica por sinônimos.
- **Arquivos Impactados:**
  - `backend/src/modules/data-dictionary/application/use-cases/auto-detect-relationships.use-case.ts`
  - `backend/src/modules/data-dictionary/application/use-cases/search-metadata.use-case.ts`
  - `backend/src/modules/data-dictionary/index.ts`
  - `backend/src/services/erp-configuration.service.ts`
  - `backend/src/__tests__/schema-relationships-and-synonyms.test.ts`
  - `MEMORY_PALACE.md`

### [2026-10-21] — Expansão Conceitual de NLP, Regras Categóricas e Guardrails Text-to-SQL
- **Agente Responsável:** `ai-specialist`
- **Tipo:** `feat` / `perf`
- **Contexto & Motivação:**
  Aprimorar a compreensão conceitual de perguntas corporativas (faturamento, clientes, produtos) mesmo quando o usuário utiliza termos informais ou quando o LLM opera sob fallback, além de blindar a geração de SQL com regras estritas para filtros de status e somas de valores do ERP.
- **Implementações Realizadas:**
  1. **Expansão Conceitual no NLP (`GeminiKeywordExtractorGateway`):** Ajuste do prompt do extrator para solicitar explicitamente sinônimos correlatos de negócio (faturamento -> vendas, receita, pedidos) e ampliação do `tokenizeFallback` com expansão de raízes léxicas.
  2. **Fallback Heurístico de Keywords (`ExtractKeywordsUseCase`):** Inclusão de stopword filtering executivo e expansão semântica em caso de indisponibilidade momentânea da API do Gemini.
  3. **Guardrails Estritos de Status e Valores no SQL (`BuildSqlGenerationPromptUseCase`):**
     - Injeção obrigatória de regra para filtros de status (atentar para `STATUSNOTA = 'L'` ou `TIPMOV = 'V'`).
     - Instrução para conversão e agregações financeiras com `SUM(CAST(coluna AS NUMERIC))`.
     - Documentação explícita de caminhos de junção (`JOIN`) derivados do grafo de FKs virtuais.
  4. **Suíte de Testes Automatizados (`ai-rag-prompt-and-keywords.test.ts`):** Validação de expansão léxica/conceitual e conformidade do prompt com regras de agregação e filtros de status.
- **Arquivos Impactados:**
  - `backend/src/modules/data-dictionary/infrastructure/gateways/gemini-keyword-extractor.gateway.ts`
  - `backend/src/modules/data-dictionary/application/use-cases/extract-keywords.use-case.ts`
  - `backend/src/modules/data-dictionary/application/use-cases/build-sql-generation-prompt.use-case.ts`
  - `backend/src/__tests__/ai-rag-prompt-and-keywords.test.ts`
  - `MEMORY_PALACE.md`


### [2026-10-21] — Expansão Visual de Gráficos e Matriz Heurística de Decisão de BI
- **Agentes Responsáveis:** `ai-specialist`, `frontend`, `tester`
- **Tipo:** `feat` / `test`
- **Contexto & Motivação:**
  Anteriormente a Gideon só gerava gráficos de colunas verticais (`bar`) devido a um exemplo few-shot único no System Prompt. Expandiu-se o repertório visual no frontend e treinou-se a IA com uma Matriz Heurística rigorosa para seleção automática do tipo de gráfico ideal de acordo com o contexto analítico.
- **Implementações Realizadas:**
  1. **Frontend (`DynamicDashboard.tsx`):**
     * Suporte expandido para `type: 'bar' | 'horizontal-bar' | 'line' | 'area' | 'pie' | 'table'`.
     * Implementação de `area` (AreaChart com gradiente índigo suave e IDs de defs seguros via `React.useId`).
     * Implementação de `horizontal-bar` (BarChart vertical com altura dinâmica `data.length * 38px`, eixos numéricos compactos PT-BR e truncamento de nomes de clientes/produtos, ideal para mobile).
     * Refinamento de `pie` para formato Donut (`innerRadius={46}`) com legenda contextual e tratamento seguro para fatias zeradas.
  2. **Prompt Engineering & Matriz Heurística (`ai-configuration.service.ts` & `chat-rag.service.ts`):**
     * `line` / `area`: Obrigatório para séries temporais e evolução cronológica.
     * `horizontal-bar`: Obrigatório para rankings e Top N (evitando truncamento de nomes no celular).
     * `bar`: Indicado para comparações discretas de poucas categorias (< 7 itens).
     * `pie`: Exclusivo para composição percentual de poucas fatias (3 a 5 categorias, máximo 6, proibido para séries temporais).
     * `table`: Obrigatório para relatórios analíticos com 3 ou mais atributos de detalhe.
     * Few-shot examples ricos injetados para cada um dos 6 formatos.
  3. **Suíte de Testes Automatizados (`chart-decision-matrix.test.ts`):**
     * 15 novos testes validando a matriz de decisão, extração de blocos dashboard, regras de formatação e sanitização resiliente para fallback de tabela. Totalizando 40 testes passando no projeto.
- **Arquivos Impactados:**
  - `frontend/src/components/chat/DynamicDashboard.tsx`
  - `backend/src/services/ai-configuration.service.ts`
  - `backend/src/services/chat-rag.service.ts`
  - `backend/src/__tests__/chart-decision-matrix.test.ts`
  - `MEMORY_PALACE.md`


### [2026-10-22] — Blindagem Anti-Crash e Error Boundary nos Gráficos Dinâmicos
- **Agente Responsável:** `frontend`
- **Tipo:** `fix` / `perf`
- **Contexto & Motivação:**
  Identificado que a tela ficava branca ao abrir gráficos no chat devido a ausência de React ErrorBoundary (erros de renderização de SVG/Recharts ou parsing de chunks SSE derrubavam toda a árvore do React) e manipulações de strings não protegidas contra `null`/`undefined` em formatadores.
- **Implementações Realizadas:**
  1. **Criação do `ErrorBoundary` (`frontend/src/components/common/ErrorBoundary.tsx`):**
     * Componente resiliente com modo compacto (para itens isolados de chat) e modo página inteira.
     * Captura qualquer exceção não tratada durante o render e impede que o React desmonte o aplicativo.
  2. **Isolamento de Erros no Chat e Rotas (`Chat.tsx` e `App.tsx`):**
     * `<DynamicDashboard />` envolvido em `<ErrorBoundary compact>` dentro de `markdownComponents.code`.
     * Rotas principais do `<App />` blindadas com `<ErrorBoundary>`.
     * `rawContent` extraído com `.join('')` para evitar inserção indevida de vírgulas de arrays gerados pelo ReactMarkdown.
  3. **Blindagem e Null-Safety em `DynamicDashboard.tsx`:**
     * `isCurrencyField`, `formatFullValuePtBr`, `formatColumnLabel` e `truncateLabel` 100% protegidos contra valores nulos/indefinidos.
     * Parser JSON com extração resiliente delimitada por `{` e `}`.
     * Adicionados `minWidth={100}` e `minHeight={220}` em todos os `ResponsiveContainer` para impedir colapso de dimensão em Recharts.
- **Arquivos Impactados:**
  - `frontend/src/components/common/ErrorBoundary.tsx`
  - `frontend/src/components/chat/DynamicDashboard.tsx`
  - `frontend/src/pages/Chat.tsx`
  - `frontend/src/App.tsx`
  - `MEMORY_PALACE.md`


### [2026-11-12] — Transição do Banco de Dados para PostgreSQL Local
- **Agente Responsável:** `planner` (Tech Lead)
- **Tipo:** `chore` / `perf`
- **Contexto & Motivação:**
  O backend estava conectado a uma instância remota do Supabase com latência de rede e dependência externa. Foi ativado o banco PostgreSQL local (`gideon_db`) na porta `5432` com autenticação local.
- **Implementações Realizadas:**
  1. Configuração de `DATABASE_URL` e `DIRECT_URL` apontando para `postgresql://postgres:postgrespassword@localhost:5432/gideon_db?schema=public` no `backend/.env`.
  2. Execução da migration inicial Prisma (`20261010184523_init`), criando as tabelas estruturais (`usuarios`, `ai_configurations`, `erp_configurations`, `meta_tables`, `meta_columns`).
  3. Validação completa da suíte automatizada (40 testes unitários e de integração passando em 351ms).
- **Arquivos Impactados:**
  - `backend/.env`
  - `MEMORY_PALACE.md`


### [2026-11-13] — Módulo "Seu Dashboard" (Personalizado, Drag-and-Drop, Auto-Save e Assistência Gideon)
- **Agentes Responsáveis:** `backend`, `frontend`, `tester`, `planner`
- **Tipo:** `feat` / `test`
- **Contexto & Motivação:**
  Usuários de perfis ADMIN e GERENTE demandavam a capacidade de criar dashboards analíticos personalizados estilo Notion/WordPress/Excel, gerando gráficos sob demanda com apoio da IA Gideon via linguagem natural, organizando cards livremente através de drag-and-drop e persistindo layouts individualizados no PostgreSQL local.
- **Implementações Realizadas:**
  1. **Modelagem Prisma (`schema.prisma`):**
     * Criação das entidades `UserDashboard` (`user_dashboards`) e `DashboardWidget` (`dashboard_widgets`) com chave estrangeira em cascata para `Usuario`.
     * Atributos de layout responsivo persistidos: `col_span` (1, 2, 3 correspondendo a tamanhos P/M/G), `row_span` (1, 2 para altura expandida), `order`, `query_prompt`, `sql_query`, `cached_data` e `type` (`bar`, `horizontal-bar`, `line`, `area`, `pie`, `table`).
     * Sincronização executada via `prisma db push` e `prisma generate`.
  2. **Serviço e API Backend (`user-dashboard.service.ts` e `api.ts`):**
     * `getOrCreateDashboard(userId)`: Recupera ou inicializa o dashboard único do usuário logado.
     * `generateAndAddWidget(userId, prompt)`: Conecta ao pipeline RAG determinístico, infere tipo visual ideal pela Matriz Heurística e persiste o novo widget no grid.
     * `updateLayout(userId, items)`: Auto-save atômico em lote com isolamento estrito multi-tenant (RBAC).
     * `refreshWidget(userId, widgetId)`: Reexecuta queries em transação PostgreSQL read-only com `statement_timeout = '3000ms'` e sanitização LGPD.
     * `removeWidget(userId, widgetId)`: Exclusão com proteção RBAC.
  3. **Interface Frontend (`UserDashboard.tsx` & `App.tsx`):**
     * Adicionada a aba "Seu Dashboard" com ícone `LayoutDashboard` acessível para ambos os papéis `ADMIN` e `GERENTE`.
     * Grid fluido `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` com suporte nativo a drag-and-drop HTML5, botões táteis de reordenação e redimensionamento dinâmico P/M/G.
     * Barra de comando compacta com atalhos de 1 toque, geração assíncrona com IA Gideon e onboarding inicial didático com 3 indicadores pré-configurados.
     * Auto-save debounced em 600ms com persistência híbrida PostgreSQL e fallback local (`localStorage`) para zero latência e resiliência offline.
     * Refatoração retrocompatível em `DynamicDashboard.tsx` para suporte a cards embutidos sem cabeçalhos duplicados e exportação do utilitário `parseDashboardConfig`.
  4. **Garantia de Qualidade & Testes Automatizados (`user-dashboard.service.test.ts` e `user-dashboard.test.ts`):**
     * 30 novos testes automatizados cobrindo isolamento multi-tenant RBAC (403), auto-save de layout e sanitização estrita anti-SQLi (bloqueio DDL/DML, stacked queries, proteção de tabelas internas).
     * Suíte completa com **70 testes passando com 100% de sucesso** em ~333ms e zero erros no TypeScript.
- **Arquivos Impactados:**
  - `backend/prisma/schema.prisma`
  - `backend/src/services/user-dashboard.service.ts`
  - `backend/src/routes/api.ts`
  - `backend/src/__tests__/user-dashboard.service.test.ts`
  - `backend/src/__tests__/user-dashboard.test.ts`
  - `frontend/src/pages/UserDashboard.tsx`
  - `frontend/src/components/chat/DynamicDashboard.tsx`
  - `frontend/src/App.tsx`
  - `MEMORY_PALACE.md`


### [2026-11-14] — Eliminação de Dados Mockados, Sanitização de Decimais e Blindagem de Gráficos no Dashboard
- **Agentes Responsáveis:** `backend`, `frontend`, `tester`, `planner`
- **Tipo:** `fix` / `perf` / `test`
- **Contexto & Motivação:**
  1. No painel "Seu Dashboard", dados fictícios/mockados estavam sendo exibidos quando não haviam registros ou durante a criação de novos indicadores/sugestões.
  2. Gráficos no Chat e no Dashboard apresentavam o erro "Não foi possível renderizar este gráfico interativo." devido à serialização de instâncias `Decimal.js` do Prisma (`{ s, e, d }`) no lugar de números primitivos, e ausência de chaves estrangeiras cadastradas em `meta_columns` que quebrava os joins gerados pelo Text-to-SQL.
- **Implementações Realizadas:**
  1. **Eliminação Total de Fallbacks Mockados (`UserDashboard.tsx`):**
     - Removida integralmente a função `generateSmartFallbackChart` e arrays com dados estáticos fictícios ("Atacadão Central", "Distribuidora Progresso", "PIX Instantâneo").
     - As sugestões iniciais (`SUGGESTION_TEMPLATES`) agora invocam diretamente `handleGenerateCard(template.prompt)`, gerando gráficos com dados reais de `gideon_db` via pipeline RAG determinístico da Gideon.
     - `handleGenerateCard` e `handleRefreshSingleCard` agora exibem feedback de erro real retornado pelo backend quando não existem registros, garantindo o princípio estrito de Zero-Alucinação.
     - Sincronização correta do carregamento com `response.ok`, evitando ressuscitar cards antigos do `localStorage`.
  2. **Sanitização de Tipos Numéricos (Decimal e BigInt) no Backend (`lgpd-sanitizer.ts`, `chat-rag.service.ts`, `user-dashboard.service.ts`):**
     - Conversão automática de objetos `Decimal` (Prisma/Decimal.js) e `BigInt` para `number` nativo de JavaScript antes da serialização JSON.
     - `formatWidgetForClient` unifica as propriedades `.data` e `.cachedData` garantindo compatibilidade no consumo da API pelo frontend.
  3. **Blindagem do Recharts e Fallback Tabular no Frontend (`DynamicDashboard.tsx`, `ErrorBoundary.tsx`):**
     - Reconstrução matemática exata de estruturas `{ s, e, d }` em `parseNumericValue` baseada no expoente decimal.
     - Componente de barreira resiliente `SafeChartContainer` envolvendo todos os gráficos Recharts; em caso de falha de renderização SVG, um fallback tabular interativo e responsivo é exibido automaticamente sem quebrar o componente pai.
     - `ErrorBoundary.tsx` atualizado com `componentDidUpdate` para resetar `hasError: false` quando novos `children` chegam, evitando que erros temporários durante o streaming SSE travem os cards permanentemente.
  4. **Correção de Chaves Estrangeiras no Dicionário de Dados (`meta_columns`):**
     - Cadastradas as FKs reais entre `erp_nota_fiscal`, `erp_nota_fiscal_prod`, `erp_clientes` e `erp_vendedores`, permitindo que o Text-to-SQL gere JOINs válidos e traga dados reais de faturamento e clientes.
  5. **Configuração do Serviço PostgreSQL no Docker:**
     - Container `gideon-postgres` configurado com `--restart no` para não iniciar automaticamente com o PC, rodando apenas sob demanda manual do usuário (`docker start gideon-postgres`).
  6. **Garantia de Qualidade & Testes:**
     - 70/70 testes unitários e de integração passando com 100% de sucesso.
     - Build Vite do frontend (`npm run build`) concluído com zero erros de compilação.
- **Arquivos Impactados:**
  - `backend/src/services/chat-rag.service.ts`
  - `backend/src/services/user-dashboard.service.ts`
  - `backend/src/utils/lgpd-sanitizer.ts`
  - `frontend/src/components/chat/DynamicDashboard.tsx`
  - `frontend/src/components/common/ErrorBoundary.tsx`
  - `frontend/src/pages/UserDashboard.tsx`
  - `MEMORY_PALACE.md`


### [2026-11-14] — Pacote Completo Anti-Alucinação: Fechamento do RAG, Query Rewriter, Self-Healing SQL e Agente Revisor (Reflection Loop)
- **Agentes Responsáveis:** `planner`, `ai-specialist`, `backend`, `frontend`, `tester`
- **Tipo:** `feat` / `fix` / `test`
- **Contexto & Motivação:**
  A Gideon apresentava alucinações no Chat quando ocorriam erros de sintaxe/segurança no Text-to-SQL (`retrieveDatabaseContext` retornava `null`, deixando o LLM sem contexto e sem restrição), em perguntas conversacionais dependentes de histórico ("E quais notas ele tem?"), por contaminação de exemplos few-shot no System Prompt e pela ausência de uma camada de auditoria/revisão antes da exibição ao usuário.
- **Implementações Realizadas:**
  1. **Pilar 1 — Fechamento do "Buraco Negro" do RAG & Self-Healing SQL Retry (`chat-rag.service.ts`, `ai-configuration.service.ts`):**
     - `retrieveDatabaseContext` jamais retorna `null` em falhas (`INVALID_OR_UNSAFE_SQL`, `EXECUTION_ERROR`), injetando obrigatoriamente `buildDeterministicNoDataPrompt` com proibição absoluta de invenção de dados.
     - Adicionado **Self-Healing SQL Retry**: se a primeira query SQL falhar na execução do PostgreSQL (ex: coluna inexistente ou falta de CAST), o serviço envia o erro exato do banco de volta ao gerador SQL (`temperature: 0.0`) para auto-correção imediata antes de desistir.
     - Substituídos todos os exemplos com nomes de empresas fictícias nos prompts (`ai-configuration.service.ts` e `chat-rag.service.ts`) por placeholders estruturais neutros (`<NOME_REAL_DO_REGISTRO_1>`) e reduzida a `temperature` padrão de `0.7` para `0.1`.
  2. **Pilar 2 — Query Rewriter Contextual Multi-Turn (`chat-rag.service.ts`):**
     - Implementado `rewriteQueryWithHistory(userQuestion, history)` que analisa as últimas mensagens da conversa e reescreve perguntas dependentes de contexto (ex: *"E quanto ele comprou?"* -> *"Quanto o cliente X comprou?"*) tornando-as 100% autocontidas para o Text-to-SQL.
  3. **Pilar 3 — Agente Revisor de Grounding, Loop de Auto-Correção e Fallback Determinístico (`response-reviewer.service.ts`, `number-sanitizer.ts`, `api.ts`):**
     - Pré-cálculo determinístico em TypeScript (`computeDeterministicAggregates`) de somas, médias, mínimos e máximos das colunas numéricas retornadas pelo PostgreSQL, injetado no prompt para eliminar erros de cálculo mental do LLM.
     - **Camada 1 do Revisor (Guardrail Determinístico - 0ms):** Bloqueia instantaneamente nomes fictícios banidos, vazamento de código SQL técnico, JSON de gráfico malformado e qualquer invenção de valores monetários (`R$`) ou gráficos quando `noDataFound: true`.
     - **Camada 2 do Revisor (Agente Crítico LLM - Constitutional Reviewer):** Audita semanticamente se a resposta gerada responde à pergunta do usuário utilizando exclusivamente os registros reais do PostgreSQL.
     - **Loop de Auto-Correção (Reflection Loop):** Caso reprovada, a resposta retorna ao modelo com o apontamento exato do Auditor para regeneração (até 2 retentativas com `temperature: 0.0`).
     - **Fallback Determinístico Final (`buildDeterministicFallbackResponse`):** Se todas as tentativas falharem, constrói programaticamente a resposta executiva e a tabela `dashboard` diretamente a partir das linhas reais do PostgreSQL, tornando matematicamente impossível vazar alucinações.
  4. **Feedback Visual de Auditoria em Tempo Real no Frontend (`useChat.ts`, `Chat.tsx`):**
     - Suporte a eventos SSE `event: status` transmitindo em tempo real as 4 etapas ao componente `DidacticProgressIndicator` (incluindo a etapa *"Auditando resposta (Agente Revisor)..."* e eventuais auto-correções).
  5. **Garantia de Qualidade & Testes Automatizados (`rag-reviewer-and-rewriter.test.ts`):**
     - Adicionados 7 novos testes cobrindo fechamento do buraco negro do RAG, Self-Healing SQL Retry, Query Rewriter multi-turn, Guardrail Determinístico, Loop de Auto-Correção do Agente Crítico e Fallback Determinístico.
     - Suíte total com **77/77 testes passando (100% de sucesso)** e build Vite do frontend sem erros.
- **Arquivos Impactados:**
  - `backend/src/services/response-reviewer.service.ts`
  - `backend/src/utils/number-sanitizer.ts`
  - `backend/src/services/chat-rag.service.ts`
  - `backend/src/services/ai-configuration.service.ts`
  - `backend/src/routes/api.ts`
  - `backend/src/__tests__/rag-reviewer-and-rewriter.test.ts`
  - `frontend/src/hooks/useChat.ts`
  - `frontend/src/pages/Chat.tsx`
  - `MEMORY_PALACE.md`


### [2026-11-14] — Engenharia Semântica de Eixos para Gráficos, Granularidade Temporal no Text-to-SQL e Auto-Extração de Aliases SQL no ERP
- **Agentes Responsáveis:** `planner`, `ai-specialist`, `backend`, `frontend`, `tester`
- **Tipo:** `feat` / `fix` / `test`
- **Contexto & Motivação:**
  Em gráficos de evolução temporal (como *"Evolução do faturamento no mês de outubro por dia"*), o gráfico estava exibindo o número da Nota Fiscal (`124323`, `129196`...) no Eixo X em vez dos dias do mês (`01/10`, `02/10`...). O diagnóstico revelou duas causas-raiz:
  1. A integração `NOTA_FISCAL` em `erp_configurations` possuía `DATA_EMISSAO`, `VALOR_LIQUIDO` e `VALOR_BRUTO` na query SQL do Sankhya, mas esses campos estavam ausentes no array `expectedFields`, fazendo com que a tabela `erp_nota_fiscal` no PostgreSQL fosse criada sem `data_emissao` e sem `valor_liquido`.
  2. Ausência de guardrails de engenharia semântica de eixos no Text-to-SQL e no formatador de gráficos (`UserDashboardService` e `DynamicDashboard.tsx`).
- **Implementações Realizadas:**
  1. **Frente 1 — Auto-Extração de Aliases SQL e Sincronização Completa (`sql-alias-extractor.ts`, `dynamic-table.manager.ts`, `erp-configuration.service.ts`, `auto-detect-relationships.use-case.ts`):**
     - Criado `extractSqlSelectAliases` e `mergeExpectedFieldsWithQueryAliases` para extrair automaticamente todos os aliases (`AS <COLUNA>`) da cláusula `SELECT` principal das integrações ERP, garantindo que nenhuma coluna da query seja omitida de `expectedFields`, da criação/alteração de tabela no PostgreSQL ou do Dicionário de Dados (`meta_columns`).
     - Sincronizada a tabela `erp_nota_fiscal` com as 11 colunas (`id`, `operacao`, `nota_fiscal`, `pedido_origem`, `cod_vendedor`, `cod_cliente`, `empresa`, `tipo_movimento`, `valor_bruto`, `valor_liquido`, `data_emissao`) em 11.242 registros e detectadas automaticamente as FKs semânticas (`cod_cliente -> erp_clientes.cliente_id` e `cod_vendedor -> erp_vendedores.representante_id`).
  2. **Frente 2 — Regras de Granularidade Temporal e Engenharia de Eixos no Text-to-SQL (`build-sql-generation-prompt.use-case.ts`, `chat-rag.service.ts`):**
     - Injetadas diretrizes estritas obrigando que séries temporais diárias agrupem por `TO_CHAR(CAST(data_emissao AS TIMESTAMP), 'DD/MM') AS dia` com ordenação cronológica `ORDER BY MIN(CAST(data_emissao AS TIMESTAMP)) ASC`, proibindo o uso de `nota_fiscal`, `id` ou `cod_*` no Eixo X de evolução temporal e exigindo `SUM(CAST(valor_liquido AS NUMERIC))` para faturamento financeiro.
  3. **Frente 3 — Seletor Semântico de Eixos no Backend e Frontend (`smart-axis-selector.ts`, `user-dashboard.service.ts`, `DynamicDashboard.tsx`):**
     - Criado `selectSmartAxes` e `formatSmartAxisLabel` para priorizar colunas temporais (`dia`, `data_emissao`, `mes`) em gráficos de linha/área, colunas descritivas (`razaosocial`, `descricao`, `nome`) em rankings/barras (acima de códigos `cod_*`) e formatar datas ISO (`2026-10-05 00:00:00` -> `05/10`) automaticamente.
     - Atualizados os widgets existentes de evolução de outubro no banco com os dados diários reais (`01/10`, `02/10`, `05/10`...).
  4. **Testes Automatizados (`smart-axis-and-sql-aliases.test.ts`):**
     - Adicionados 5 novos testes unitários validando a extração de aliases SQL, seleção semântica de eixos X/Y, formatação de datas e regras de prompt. Suíte total com **82/82 testes passando (0 falhas)**.
- **Arquivos Impactados:**
  - `backend/src/utils/sql-alias-extractor.ts`
  - `backend/src/utils/smart-axis-selector.ts`
  - `backend/src/services/dynamic-table.manager.ts`
  - `backend/src/services/erp-configuration.service.ts`
  - `backend/src/services/user-dashboard.service.ts`
  - `backend/src/services/chat-rag.service.ts`
  - `backend/src/modules/data-dictionary/application/use-cases/build-sql-generation-prompt.use-case.ts`
  - `backend/src/modules/data-dictionary/application/use-cases/auto-detect-relationships.use-case.ts`
  - `backend/src/__tests__/smart-axis-and-sql-aliases.test.ts`
  - `frontend/src/components/chat/DynamicDashboard.tsx`
  - `MEMORY_PALACE.md`


### [2026-11-14] — Dicionário de Dados Obrigatório por Coluna, Auto-Profiler de Valores Categóricos (`OPERACAO = 'VENDAS'`) e Visualizador de Esquema Interativo (Diagrama ER)
- **Agentes Responsáveis:** `planner`, `ai-specialist`, `backend`, `frontend`, `tester`
- **Tipo:** `feat` / `fix` / `test`
- **Contexto & Motivação:**
  1. Ao consultar faturamento na tabela `erp_nota_fiscal`, a Gideon somava todas as notas fiscais indiscriminadamente porque a coluna `operacao` estava documentada de forma genérica (`"Coluna de dados OPERACAO da integração NOTA_FISCAL"`), sem especificar os 4 valores reais existentes no banco (`'VENDAS'`, `'BONIFICAÇÃO'`, `'DEVOLUÇÃO DE VENDAS'`, `'DEVOLUÇÃO DE BONIFICAÇÃO'`).
  2. O usuário solicitou tornar **obrigatória** a descrição semântica da tabela e de todas as colunas na criação/edição de integrações ERP, além de criar uma aba de **Visualizador de Esquema & Diagrama ER** na tela de configuração do ERP (`AdminERP.tsx`) exibindo tabelas, PKs, FKs e permitindo inspecionar e editar descrições de tabelas/colunas clicando sobre cada tabela.
- **Implementações Realizadas:**
  1. **Dicionário Semântico Rico, Auto-Profiler Categórico e Regra `WHERE operacao = 'VENDAS'` (`erp-configuration.service.ts`, `build-sql-generation-prompt.use-case.ts`, `chat-rag.service.ts`):**
     - Atualizado `generateColumnDescription` com semântica de negócio completa para todas as colunas ERP, documentando explicitamente `OPERACAO` (`['VENDAS', 'BONIFICAÇÃO', 'DEVOLUÇÃO DE VENDAS', 'DEVOLUÇÃO DE BONIFICAÇÃO']`) e a regra obrigatória `WHERE operacao = 'VENDAS'` para consultas de faturamento/vendas.
     - Implementado `getSampleDistinctValues(tableName, columnName)` (Auto-Profiler no PostgreSQL) que amostra até 10 valores distintos reais para colunas categóricas (`operacao`, `tipo_movimento`, `status`, `tipo_pessoa`, `uf`, `ramo_de_atividade`, `classificacao`, `rede`) e os disponibiliza tanto no Dicionário da IA quanto no Inspetor do Diagrama ER.
     - Enriquecidas todas as 6 tabelas sincronizadas (`erp_clientes`, `erp_clientes_vendedores`, `erp_nota_fiscal`, `erp_nota_fiscal_prod`, `erp_produtos`, `erp_vendedores`) em `meta_tables` / `meta_columns` e atualizados os widgets de faturamento no `dashboard_widgets` para filtrar `operacao = 'VENDAS'`.
  2. **Auto-Detecção de Chaves Naturais e Preservação de FKs (`auto-detect-relationships.use-case.ts`, `save-table-metadata.use-case.ts`):**
     - Registrada a chave natural `erp_nota_fiscal.nota_fiscal` no `AutoDetectRelationshipsUseCase`, conectando automaticamente `erp_nota_fiscal_prod.NOTA_FISCAL -> erp_nota_fiscal.NOTA_FISCAL` (totalizando 6 ligações FKs ativas entre as 6 tabelas).
     - Atualizado `SaveTableMetadataUseCase` para preservar FKs existentes quando uma coluna tiver sua descrição atualizada sem reenvio explícito de FK.
  3. **Novos Endpoints de Esquema e Extração SQL (`api.ts`):**
     - `GET /api/erp/schema`: Retorna todas as tabelas do PostgreSQL, contagem de linhas real, PKs, FKs, descrições e amostras de valores categóricos.
     - `PUT /api/erp/schema/:tableName`: Atualiza descrição da tabela, descrições obrigatórias das colunas, PK e FKs diretamente pelo Diagrama ER.
     - `POST /api/erp/schema/auto-detect-fks`: Reexecuta a detecção automática de relacionamentos entre todas as tabelas do tenant.
     - `POST /api/erp/extract-sql-columns`: Extrai automaticamente os aliases da cláusula `SELECT` e sugere descrições de negócio ricas para preenchimento rápido no modal.
  4. **Visualizador de Esquema Interativo (Diagrama ER) e Descrições Obrigatórias no Modal (`SchemaDiagramExplorer.tsx`, `AdminERP.tsx`):**
     - Criado `SchemaDiagramExplorer.tsx` com painel de métricas do esquema, barra interativa de relacionamentos FKs (`fromTable.fromColumn ➔ toTable.toColumn`), cards ER de cada tabela com badges `PK`/`FK` e valores reais do PostgreSQL, e Drawer lateral de inspeção/edição ao clicar em qualquer tabela (com botão de 1 clique para injetar valores reais do banco na descrição da coluna).
     - Atualizado `AdminERP.tsx` com seletor de abas (*"Consultas & Sincronização ERP"* vs *"Visualizar Esquema & Dicionário IA (Diagrama ER / PKs / FKs)"*), botão *"Auto-extrair Colunas & Sugerir Descrições do SQL"* e validação obrigatória de descrição para a tabela e para cada coluna.
  5. **Testes Automatizados (`smart-axis-and-sql-aliases.test.ts`):**
     - Adicionados testes unitários validando a descrição semântica de `OPERACAO`, `isGenericColumnDescription` e `extractColumnsFromQuery`. Suíte total com **84/84 testes passando (0 falhas)** e build de produção do frontend concluído sem erros.
- **Arquivos Impactados:**
  - `backend/src/services/erp-configuration.service.ts`
  - `backend/src/routes/api.ts`
  - `backend/src/modules/data-dictionary/application/dtos/save-table-metadata.dto.ts`
  - `backend/src/modules/data-dictionary/application/use-cases/save-table-metadata.use-case.ts`
  - `backend/src/modules/data-dictionary/application/use-cases/auto-detect-relationships.use-case.ts`
  - `backend/src/modules/data-dictionary/application/use-cases/build-sql-generation-prompt.use-case.ts`
  - `backend/src/services/chat-rag.service.ts`
  - `backend/src/__tests__/smart-axis-and-sql-aliases.test.ts`
  - `frontend/src/components/erp/SchemaDiagramExplorer.tsx`
  - `frontend/src/pages/AdminERP.tsx`
  - `MEMORY_PALACE.md`


### [2026-11-14] — Canvas Interativo Supabase Studio para o Diagrama ER, Radar Minimap e Modal Flutuante de Edição
- **Agentes Responsáveis:** `frontend`, `planner`, `backend`
- **Tipo:** `feat` / `refactor`
- **Contexto & Motivação:**
  O usuário solicitou uma experiência de visualização de esquema idêntica à do **Supabase Studio**, com canvas infinito dot grid escuro, nós de tabelas arrastáveis (drag & drop), linhas de conexão SVG curvas com marcadores para chaves estrangeiras (`FK ➔ PK`), radar minimap no canto inferior direito e um **Popup / Modal flutuante centralizado** que se abre ao clicar na tabela para inspecionar e editar descrições da tabela, das colunas, PK e FKs.
- **Implementações Realizadas:**
  1. **Canvas Interativo Infinito estilo Supabase Studio (`SchemaDiagramExplorer.tsx`):**
     - Dot grid escuro (`radial-gradient(#262a36 1px, transparent 1px)`) com aceleração por GPU.
     - Pan suave com mouse/touch e Zoom suave centrado no scroll (0.3x a 2.0x).
     - Drag & drop livre das caixas de tabelas pelo cabeçalho, com persistência automática de coordenadas no `localStorage` (`gideon_supabase_schema_positions_v1`).
     - Botão **"Auto-Organizar" (Auto-Layout)** com organização em colunas/camadas lógicas (dimensões à esquerda, associações/cabeçalhos ao centro, fatos detalhados à direita) e botão **"Ajustar à Tela" (Fit to View)**.
     - Botão de alternância de **Tela Cheia (Fullscreen)** para visualização imersiva do banco de dados.
  2. **Nós de Tabelas e Arestas SVG de Relacionamentos (`SchemaDiagramExplorer.tsx`):**
     - Cards retangulares no estilo Supabase Studio com cabeçalho mono escuro, indicador de total de colunas, contagem de linhas reais no PostgreSQL e ícones de chave dourada (`PK`) e chave/elo azul (`FK`).
     - Linhas SVG em curvas cúbicas de Bézier conectando com precisão a porta da coluna FK na tabela de origem até a porta da coluna PK na tabela de destino, com realce brilhante ao passar o mouse.
  3. **Radar Minimap no Canto Inferior Direito (`SchemaDiagramExplorer.tsx`):**
     - Miniatura proporcional do mundo e de todas as tabelas com viewport retangular semitransparente em tempo real indicando a posição da câmera.
  4. **Popup / Modal Flutuante de Edição (`SchemaDiagramExplorer.tsx`):**
     - Ao clicar ou selecionar qualquer tabela no canvas, um modal flutuante centralizado com backdrop blur escuro é aberto para edição da descrição da tabela, seleção de PK, mapeamento de FKs e edição das descrições obrigatórias de cada coluna (com injeção em 1 clique de valores reais do PostgreSQL).
- **Arquivos Impactados:**
  - `frontend/src/components/erp/SchemaDiagramExplorer.tsx`
  - `MEMORY_PALACE.md`


### [2026-11-14] — Refinamento do Esquema ER: Harmonização com Tema do App, SVG Overflow Infinito, 2 Cliques p/ Edição e Auto-Save no Servidor
- **Agentes Responsáveis:** `frontend`, `backend`, `planner`
- **Tipo:** `refactor` / `fix` / `feat`
- **Contexto & Motivação:**
  O usuário solicitou 4 refinamentos pontuais na visualização do esquema do banco:
  1. Manter a paleta visual no mesmo tema claro/clean do restante do Gideon (`slate-50`, cards brancos, bordas `slate-200`, detalhes `indigo-600`).
  2. Corrigir o corte/desaparecimento das linhas SVG ao mover as tabelas para baixo no canvas.
  3. Diferenciar arrastar de editar: 1 clique e segure arrasta livremente a tabela; 2 cliques rápidos abrem o popup/modal de edição (eliminando a abertura acidental do modal ao arrastar).
  4. Salvar automaticamente no servidor (`POST /api/erp/schema/positions`) sempre que a organização do esquema for alterada (ao arrastar ou clicar em Auto-Organizar).
- **Implementações Realizadas:**
  1. **Harmonização Visual com o Tema do App (`SchemaDiagramExplorer.tsx`):**
     - Canvas em `bg-slate-50/70` com dot grid sutil cinza (`radial-gradient(#cbd5e1 1.5px, transparent 1.5px)`).
     - Caixas de tabelas em `bg-white border-slate-200 text-slate-900 shadow-sm` com header em `bg-slate-50/90`, colunas em `hover:bg-indigo-50/60`, badges `PK` em âmbar e `FK` em índigo.
     - Barra de ferramentas e Radar Minimap em `bg-white/95 border-slate-200 shadow-md` com indicador animado *"Layout salvo no banco"*.
     - Modal flutuante de edição em `bg-white border-slate-200 shadow-2xl text-slate-900` com backdrop `bg-slate-900/50 backdrop-blur-xs`.
  2. **Correção de Clipping SVG Infinito (`SchemaDiagramExplorer.tsx`):**
     - Aplicado `overflow: visible` e `width: 100%; height: 100%` no elemento `<svg>` e na camada de nós, eliminando qualquer recorte de linhas e conexões quando tabelas são posicionadas em coordenadas `y > 750` ou em áreas distantes do canvas.
  3. **Lógica de Interação: 1 Clique Arrasta vs 2 Cliques Edita (`SchemaDiagramExplorer.tsx`):**
     - `onMouseDown` + `onMouseMove` com medição de distância: 1 clique e segure permite arrastar a tabela com fluidez.
     - `onDoubleClick`: 2 cliques rápidos abrem o modal de edição (além do botão explícito de lápis no cabeçalho).
     - Removido `onClick` acidental de abertura de modal durante o arraste.
  4. **Persistência de Layout no Servidor (`erp-configuration.service.ts`, `api.ts`, `SchemaDiagramExplorer.tsx`):**
     - Criado `POST /api/erp/schema/positions` e adicionado suporte em `GET /api/erp/schema` para retornar `positions: Record<string, { x: number, y: number }>`.
     - Salva posições em `backend/data/erp-schema-positions.json` e no `localStorage`, garantindo sincronização instantânea e persistente entre sessões e navegadores.
- **Arquivos Impactados:**
  - `backend/src/services/erp-configuration.service.ts`
  - `backend/src/routes/api.ts`
  - `frontend/src/components/erp/SchemaDiagramExplorer.tsx`
  - `MEMORY_PALACE.md`


### [2026-11-14] — Sincronismo Físico Frame a Frame de Tabelas e Arestas FK (Eliminação do Delay CSS)
- **Agentes Responsáveis:** `frontend`, `planner`
- **Tipo:** `fix` / `perf`
- **Contexto & Motivação:**
  O usuário reportou que ao mover uma tabela de um local para outro no diagrama, as setas de ligação FK se moviam primeiro que a tabela física (as setas chegavam antes e a tabela ficava atrasada atrás das setas).
- **Causa Raiz & Solução:**
  - **Causa:** A `div` do nó da tabela possuía `transition-all duration-150` no Tailwind, fazendo com que qualquer alteração em `transform: translate3d(...)` sofresse uma interpolação/atraso de 150ms no CSS. O SVG, por outro lado, atualizava suas coordenadas matemáticas `(x, y)` instantaneamente no React a cada evento de mouse (0ms). Isso criava uma discrepância visual de 150ms onde a seta se movia no frame atual e a tabela "corria atrás".
  - **Correção:**
    1. Removido `transition-all duration-150` de `transform` nas tabelas e no grupo SVG, mantendo transições suaves apenas em cores e sombras (`transition-[border-color,box-shadow]`).
    2. Adicionada classe `transition-none` e elevação de `z-index: 30` no nó que está sendo arrastado no momento (`isDraggingThis`).
    3. Fixada a altura exata do cabeçalho da tabela em `HEADER_HEIGHT = 44px` para correspondência milimétrica com o centro das linhas de cada coluna.
    4. Implementados listeners globais no `window` (`mousemove` e `mouseup`) com limpeza no unmount, garantindo arraste 60fps sem engasgos ou descompasso mesmo em movimentos rápidos do cursor.
- **Arquivos Impactados:**
  - `frontend/src/components/erp/SchemaDiagramExplorer.tsx`
  - `MEMORY_PALACE.md`
