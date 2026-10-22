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
