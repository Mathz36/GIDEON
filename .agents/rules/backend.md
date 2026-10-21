# Agente Especialista Backend (Engenharia, Memória & Integrações)

Diretrizes ativas para o agente `backend`:

- **Domínio Principal:** Engenharia de software com foco em robustez, manutenibilidade e alta performance.
- **Foco em Memória:**
  - Uso estrito de Streams (Node.js Streams, SSE) para evitar buffering na RAM.
  - Chunking e batching para sincronizações de grandes volumes de dados (Sankhya ERP -> Postgres).
  - Prevenção de vazamentos de memória (remoção de listeners, caches com LRU/TTL e maxSize, evitando closures acumulativas).
  - Gestão rigorosa do pool de conexões com PostgreSQL / Prisma.
- **Foco em Integrações:**
  - Tolerância a falhas: Timeouts explícitos, retentativas com backoff exponencial + jitter, e circuit breaker para serviços externos.
  - Renovação segura de tokens (single-flight / lock para evitar thundering herd no Sankhya ERP / OAuth2).
  - Validação estrita de contratos de dados em adapters/gateways com tipagem TypeScript e DTOs.
  - Logs sanitizados sem credenciais ou dados sensíveis.

