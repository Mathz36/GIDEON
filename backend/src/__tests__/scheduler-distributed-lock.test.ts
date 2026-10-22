import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Configuração prévia de variáveis de ambiente para testes isolados
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini-key';
process.env.SANKHYA_SERVICE_URL = process.env.SANKHYA_SERVICE_URL || 'https://api.sankhya.test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { ErpSyncScheduler } from '../services/erp-sync.scheduler';

describe('ErpSyncScheduler - Atomic Distributed Lock with TTL Suite', () => {
	let mockLocksTable: { [key: string]: { locked_by: string; expires_at: Date } };
	let rawExecutedQueries: string[];

	const createMockPrisma = () => {
		return {
			$executeRawUnsafe: async (sql: string) => {
				rawExecutedQueries.push(sql);
				return 0;
			},
			$queryRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
				const fullQuery = strings.reduce((acc, str, i) => acc + str + (values[i] !== undefined ? values[i] : ''), '');
				rawExecutedQueries.push(fullQuery);

				// Simula INSERT ... ON CONFLICT ... RETURNING lock_key
				if (fullQuery.includes('INSERT INTO system_distributed_locks')) {
					const lockKey = values[0];
					const instanceId = values[1];
					const ttlSeconds = Number(values[2]) || 180;
					const now = new Date();

					const existing = mockLocksTable[lockKey];
					if (!existing || existing.expires_at.getTime() < now.getTime()) {
						// Consegue adquirir ou renovar após expiração
						const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
						mockLocksTable[lockKey] = { locked_by: instanceId, expires_at: expiresAt };
						return [{ acquired_key: lockKey }];
					}

					// Bloqueado por outra instância ativa
					return [];
				}

				// Simula DELETE FROM system_distributed_locks WHERE lock_key = ... AND locked_by = ...
				if (fullQuery.includes('DELETE FROM system_distributed_locks')) {
					const lockKey = values[0];
					const instanceId = values[1];
					const existing = mockLocksTable[lockKey];
					if (existing && existing.locked_by === instanceId) {
						delete mockLocksTable[lockKey];
					}
					return [];
				}

				// pg_advisory_unlock_all (startup cleanup)
				if (fullQuery.includes('pg_advisory_unlock_all')) {
					return [];
				}

				return [];
			},
			erpConfiguration: {
				findMany: async () => [],
				update: async () => ({}),
			},
		} as any;
	};

	beforeEach(() => {
		mockLocksTable = {};
		rawExecutedQueries = [];
	});

	it('deve criar a tabela system_distributed_locks idempotentemente na primeira tentativa', async () => {
		const mockPrisma = createMockPrisma();
		const scheduler = new ErpSyncScheduler(mockPrisma, {} as any, {} as any);

		await scheduler.tick();

		const tableCreated = rawExecutedQueries.some((q) => q.includes('CREATE TABLE IF NOT EXISTS system_distributed_locks'));
		assert.equal(tableCreated, true, 'Deve verificar/criar a tabela de lock distribuído');
	});

	it('deve adquirir a trava com sucesso quando o banco não possui lock ativo e liberá-la no finally', async () => {
		const mockPrisma = createMockPrisma();
		const scheduler = new ErpSyncScheduler(mockPrisma, {} as any, {} as any);
		const instanceId = scheduler.getInstanceId();

		assert.ok(instanceId.startsWith('node_'), 'InstanceId deve ser gerado com prefixo do processo');

		// Antes do tick, sem locks
		assert.equal(mockLocksTable[ErpSyncScheduler.DISTRIBUTED_LOCK_KEY], undefined);

		await scheduler.tick();

		// Após o tick completo, o lock deve ter sido liberado no bloco finally
		assert.equal(mockLocksTable[ErpSyncScheduler.DISTRIBUTED_LOCK_KEY], undefined, 'Lock deve ser liberado no finally');
	});

	it('deve impedir que uma segunda instância adquira o lock enquanto a primeira estiver com trava ativa', async () => {
		const mockPrisma = createMockPrisma();
		const schedulerA = new ErpSyncScheduler(mockPrisma, {} as any, {} as any);
		const schedulerB = new ErpSyncScheduler(mockPrisma, {} as any, {} as any);

		// Simula Instância A segurando o lock com TTL ativo de 3 minutos no futuro
		const futureDate = new Date(Date.now() + 180_000);
		mockLocksTable[ErpSyncScheduler.DISTRIBUTED_LOCK_KEY] = {
			locked_by: schedulerA.getInstanceId(),
			expires_at: futureDate,
		};

		let executedJobs = false;
		mockPrisma.erpConfiguration.findMany = async () => {
			executedJobs = true;
			return [];
		};

		// Executa o tick da Instância B
		await schedulerB.tick();

		// Instância B deve ter ignorado o tick sem buscar ou rodar jobs
		assert.equal(executedJobs, false, 'Instância B não deve executar jobs concorrentes');
		assert.equal(
			mockLocksTable[ErpSyncScheduler.DISTRIBUTED_LOCK_KEY]?.locked_by,
			schedulerA.getInstanceId(),
			'O lock deve permanecer atribuído à Instância A',
		);
	});

	it('deve permitir que uma nova instância assuma o lock se o TTL da instância anterior tiver expirado (Dead Lock Recovery)', async () => {
		const mockPrisma = createMockPrisma();
		const schedulerOld = new ErpSyncScheduler(mockPrisma, {} as any, {} as any);
		const schedulerNew = new ErpSyncScheduler(mockPrisma, {} as any, {} as any);

		// Simula processo antigo que caiu há 10 segundos (expires_at no passado)
		const pastDate = new Date(Date.now() - 10_000);
		mockLocksTable[ErpSyncScheduler.DISTRIBUTED_LOCK_KEY] = {
			locked_by: schedulerOld.getInstanceId(),
			expires_at: pastDate,
		};

		let searchedJobs = false;
		mockPrisma.erpConfiguration.findMany = async () => {
			searchedJobs = true;
			return [];
		};

		// Instância Nova executa o tick
		await schedulerNew.tick();

		// Deve ter recuperado o lock órfão e executado a busca de jobs normalmente
		assert.equal(searchedJobs, true, 'Instância Nova deve recuperar a trava após o TTL expirar');
	});

	it('não deve permitir que a Instância A libere o lock caso ele tenha sido assumido pela Instância B após expiração', async () => {
		const mockPrisma = createMockPrisma();
		const schedulerA = new ErpSyncScheduler(mockPrisma, {} as any, {} as any);
		const schedulerB = new ErpSyncScheduler(mockPrisma, {} as any, {} as any);

		// Instância B é a dona atual legítima
		mockLocksTable[ErpSyncScheduler.DISTRIBUTED_LOCK_KEY] = {
			locked_by: schedulerB.getInstanceId(),
			expires_at: new Date(Date.now() + 60_000),
		};

		// Instância A tenta liberar (ex: tarefa muito demorada que terminou depois do TTL)
		// Chamamos o método privado de liberação via cast any
		await (schedulerA as any).releaseDistributedLock();

		// O lock da Instância B NÃO pode ter sido apagado pela Instância A
		assert.ok(mockLocksTable[ErpSyncScheduler.DISTRIBUTED_LOCK_KEY] !== undefined);
		assert.equal(mockLocksTable[ErpSyncScheduler.DISTRIBUTED_LOCK_KEY].locked_by, schedulerB.getInstanceId());
	});
});
