# 🛡️ Diretrizes de Engenharia Backend: Eficiência de Memória & Integrações

Este documento define os padrões obrigatórios de engenharia de software para o desenvolvimento e manutenção do **Backend do Gideon**. Todo agente e desenvolvedor atuando neste módulo deve seguir rigorosamente estes princípios.

---

## 1. 🧠 Gestão e Eficiência de Memória (Memory First)

### 1.1. Streaming vs. Buffering na Memória
- **Nunca carregue conjuntos massivos de dados inteiramente na RAM.**
- **SSE (Server-Sent Events) & LLM:** O streaming de respostas da IA (Google Gemini) deve ser repassado ao cliente HTTP diretamente como stream contínuo, sem acumular o texto completo em buffers desnecessários.
- **Exportação e Relatórios:** Use `Stream` e `Pipeline` do Node.js (`stream.pipeline`) para transferências de grandes volumes entre banco, arquivos e clientes.

### 1.2. Processamento em Lotes (Batching & Chunking)
- **Sincronização com ERP (Sankhya):** Ao importar registros de tabelas do ERP para o PostgreSQL dinâmico, execute inserts e updates em lotes controlados (ex: chunks de 500 a 1000 registros).
- **Controle de Concorrência:** Limite requisições simultâneas e promessas em voo (`p-limit` ou loops assíncronos controlados) para evitar picos repentinos no heap do V8.

### 1.3. Prevenção Ativa de Memory Leaks
- **Listeners:** Registros em `EventEmitter`, sockets e streams devem ser desregistrados explicitamente (`removeListener` / `off`) ou gerenciados com `AbortController`.
- **Closures & Variáveis Globais:** Não retenha referências a objetos volumosos em variáveis globais ou closures de longa duração.
- **Caches:** Qualquer cache em memória (ex: metadados de tabelas, tokens) **DEVE** possuir:
  - Política de despejo explícita (LRU / FIFO);
  - Limite máximo de entradas (`maxSize`);
  - Tempo de expiração (`TTL`).
- **Uso de Estruturas Fracas:** Utilize `WeakMap` e `WeakSet` quando associar metadados temporários a referências de objetos.

### 1.4. Conexões e Ciclo de Vida de Recursos
- Garanta o fechamento e descarte de file descriptors, sockets e cursores de banco em blocos `finally`.
- Monitore e preserve o pool de conexões do **Prisma Client** / PostgreSQL para evitar esgotamento de conexões e vazamento de conexões pendentes.

---

## 2. 🔗 Arquitetura de Integrações Robustas (Integration First)

### 2.1. Resiliência e Tolerância a Falhas
- **Timeouts Obrigatórios:** Toda chamada de integração (Axios, Fetch, SDKs de IA, gateways ERP) **deve ter timeout explícito configurado**.
- **Retry com Exponential Backoff & Jitter:** Chamadas idempotentes com falhas transitórias de rede (502, 503, 504, timeout) devem ter retentativas com intervalo exponencial aleatorizado.
- **Circuit Breaker:** Em integrações críticas externas (Sankhya ERP Gateway), implementar proteção contra falhas em cascata para evitar consumir recursos do backend enquanto o sistema externo estiver degradado.

### 2.2. Autenticação de Gateways & Renovação de Sessões
- **Single-Flight Token Refresh:** Ao renovar tokens OAuth2 / sessões JSESSIONID do Sankhya, evite tempestade de requisições concorrentes (*thundering herd*) utilizando promessas compartilhadas ou locks durante o refresh.
- **Cache Seguro de Sessão:** Armazene a sessão ativa em memória com renovação proativa antes da expiração.

### 2.3. Validação de Contratos & Isolamento
- **Fronteira Rígida (Gateways / Adapters):** O core da aplicação (Domain e UseCases) nunca deve depender diretamente dos formatos de payload legados de APIs parceiras. Mapeie e valide entradas e saídas na camada de integração (via DTOs / Zod).
- **Sanitização de Logs:** Jamais registre senhas, chaves de API, tokens JWT/OAuth ou dados confidenciais nos logs do sistema.

---

## 3. 📐 Padrões Arquiteturais e Qualidade de Código
- **Clean Architecture & SOLID:**
  - `src/modules/`: Regras de negócio divididas por domínio (ex: `data-dictionary`, `auth`, `users`).
  - `src/services/`: Orquestradores e serviços de integração (ex: `chat-rag.service.ts`, `sankhya.service.ts`).
  - `src/controllers/`: Manipulação e validação de requisições HTTP/SSE.
- **Tipagem Estrita (TypeScript):** Evite o uso de `any`; defina interfaces e tipos explícitos para todas as entradas e saídas de dados.

