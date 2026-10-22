import { PrismaClient, ErpConfiguration } from '@prisma/client';
import prismaClient from '../config/prisma';
import dynamicTableManager, { IDynamicTableManager } from './dynamic-table.manager';
import syncQueueManager, { ISyncQueueManager } from './sync-queue.manager';

export interface SyncResult {
	success: boolean;
	syncedRows?: number;
	message: string;
	syncedAt: Date;
	nextSyncAt?: Date | null;
}

export interface ScheduleParams {
	syncFrequency: string; // MINUTES, HOURS, DAILY, MONTHLY, MANUAL
	syncInterval?: number | null;
	syncTime?: string | null;
	syncDayOfMonth?: number | null;
	syncActive?: boolean;
}

export interface IErpSyncScheduler {
	start(intervalMs?: number): void;
	stop(): void;
	tick(): Promise<void>;
	executeJob(config: ErpConfiguration): Promise<SyncResult>;
	syncNow(id: string): Promise<SyncResult>;
	calculateNextSyncAt(config: ErpConfiguration | ScheduleParams, fromDate?: Date): Date | null;
	calculateNextSync(params: ScheduleParams, fromDate?: Date): Date | null;
}

export class ErpSyncScheduler implements IErpSyncScheduler {
	public static readonly DISTRIBUTED_LOCK_KEY = 'erp_sync_scheduler';
	public static readonly DEFAULT_LOCK_TTL_SECONDS = 180; // 3 minutos de expiração automática (TTL)

	private timer: NodeJS.Timeout | null = null;
	private isRunning = false;
	private readonly activeJobLocks = new Set<string>();
	private readonly instanceId: string;
	private readonly lockTtlSeconds: number;
	private isLockTableInitialized = false;

	constructor(
		private readonly prisma: PrismaClient = prismaClient,
		private readonly tableManager: IDynamicTableManager = dynamicTableManager,
		private readonly queueManager: ISyncQueueManager = syncQueueManager,
		lockTtlSeconds: number = ErpSyncScheduler.DEFAULT_LOCK_TTL_SECONDS,
	) {
		this.lockTtlSeconds = lockTtlSeconds;
		this.instanceId = `node_${process.pid}_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
	}

	/**
	 * Retorna o identificador único desta instância do agendador.
	 */
	getInstanceId(): string {
		return this.instanceId;
	}

	/**
	 * Inicia o loop em segundo plano com setInterval (padrão: 30 segundos).
	 */
	start(intervalMs: number = 30_000): void {
		if (this.timer) {
			console.info('[ErpSyncScheduler] Serviço de agendamento já está em execução.');
			return;
		}

		console.info(`[ErpSyncScheduler] Serviço de agendamento iniciado (ciclo de ${intervalMs / 1000}s, TTL do lock: ${this.lockTtlSeconds}s).`);

		// Limpeza preventiva de advisory locks legados de sessões anteriores
		if (typeof this.prisma.$queryRaw === 'function') {
			void this.prisma.$queryRaw`SELECT pg_advisory_unlock_all();`.catch(() => {});
		}

		// Executa uma primeira checagem 5 segundos após a subida do servidor
		setTimeout(() => {
			void this.tick();
		}, 5_000);

		// Loop periódico não-bloqueante
		this.timer = setInterval(() => {
			void this.tick();
		}, intervalMs);
	}

	/**
	 * Para o loop em segundo plano.
	 */
	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
			console.info('[ErpSyncScheduler] Serviço de agendamento parado com sucesso.');
		}
	}

	/**
	 * Garante idempotentemente a existência da tabela de travas distribuídas.
	 * Independe de migrations manuais e suporta conexões poolers do PostgreSQL.
	 */
	private async ensureDistributedLockTable(): Promise<void> {
		if (this.isLockTableInitialized) {
			return;
		}

		if (typeof this.prisma.$executeRawUnsafe !== 'function') {
			this.isLockTableInitialized = true;
			return;
		}

		try {
			await this.prisma.$executeRawUnsafe(`
				CREATE TABLE IF NOT EXISTS system_distributed_locks (
					lock_key VARCHAR(128) PRIMARY KEY,
					locked_by VARCHAR(255) NOT NULL,
					acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
					expires_at TIMESTAMPTZ NOT NULL
				);
			`);
			this.isLockTableInitialized = true;
		} catch (error) {
			console.error('[ErpSyncScheduler] Falha ao verificar/criar tabela system_distributed_locks:', error);
		}
	}

	/**
	 * Tenta adquirir o Distributed Lock atômico com TTL no PostgreSQL.
	 * Garante exclusão mútua entre múltiplas instâncias/containers mesmo sob Connection Pooling (Prisma/PgBouncer)
	 * e com expiração automática (TTL) para evitar bloqueios órfãos caso um container morra.
	 */
	private async tryAcquireDistributedLock(): Promise<boolean> {
		if (typeof this.prisma.$queryRaw !== 'function') {
			return true;
		}

		await this.ensureDistributedLockTable();

		try {
			// Upsert atômico condicional:
			// Adquire se o registro não existir ou se a trava atual já estiver expirada (expires_at < NOW())
			const result = await this.prisma.$queryRaw<Array<{ acquired_key: string }>>`
				INSERT INTO system_distributed_locks (lock_key, locked_by, acquired_at, expires_at)
				VALUES (
					${ErpSyncScheduler.DISTRIBUTED_LOCK_KEY},
					${this.instanceId},
					NOW(),
					NOW() + (${this.lockTtlSeconds} * INTERVAL '1 second')
				)
				ON CONFLICT (lock_key) DO UPDATE
				SET locked_by = EXCLUDED.locked_by,
				    acquired_at = NOW(),
				    expires_at = EXCLUDED.expires_at
				WHERE system_distributed_locks.expires_at < NOW()
				RETURNING lock_key AS "acquired_key";
			`;

			return Array.isArray(result) && result.length > 0;
		} catch (lockError) {
			console.error('[ErpSyncScheduler] Erro ao tentar adquirir Distributed Lock com TTL:', lockError);
			return false;
		}
	}

	/**
	 * Libera o Distributed Lock atômico pertencente a esta instância.
	 * Verifica estritamente locked_by para não remover travas adquiridas por outra instância caso o TTL tenha expirado.
	 */
	private async releaseDistributedLock(): Promise<void> {
		if (typeof this.prisma.$queryRaw !== 'function') {
			return;
		}

		try {
			await this.prisma.$queryRaw`
				DELETE FROM system_distributed_locks
				WHERE lock_key = ${ErpSyncScheduler.DISTRIBUTED_LOCK_KEY}
				  AND locked_by = ${this.instanceId};
			`;
		} catch (unlockError) {
			console.error('[ErpSyncScheduler] Falha ao liberar Distributed Lock:', unlockError);
		}
	}

	/**
	 * Loop de Fundo (Tick): Busca sincronizações pendentes e executa sequencialmente.
	 * Utiliza a flag `isRunning` em memória combinada com Distributed Lock atômico (`system_distributed_locks`)
	 * para impedir ticks concorrentes tanto localmente quanto entre múltiplos containers/instâncias.
	 */
	async tick(): Promise<void> {
		if (this.isRunning) {
			console.info('[ErpSyncScheduler] Ciclo anterior ainda em processamento. Ignorando este tick (Lock local ativo).');
			return;
		}

		this.isRunning = true;
		let dbLockAcquired = false;

		try {
			dbLockAcquired = await this.tryAcquireDistributedLock();
			if (!dbLockAcquired) {
				console.info(
					'[ErpSyncScheduler] Outra instância do backend detém o Distributed Lock ativo. Ignorando este tick.',
				);
				return;
			}

			const now = new Date();

			// Busca jobs pendentes: ativos, não manuais, não em execução e com data de execução vencida ou nula
			const pendingConfigs = await this.prisma.erpConfiguration.findMany({
				where: {
					syncActive: true,
					syncFrequency: { not: 'MANUAL' },
					lastSyncStatus: { not: 'RUNNING' },
					OR: [
						{ nextSyncAt: null },
						{ nextSyncAt: { lte: now } },
					],
				},
				orderBy: {
					nextSyncAt: 'asc',
				},
			});

			if (pendingConfigs.length > 0) {
				console.info(`[ErpSyncScheduler] [Tick] ${pendingConfigs.length} job(s) pendente(s) localizado(s). Iniciando execução sequencial...`);
			}

			// Execução sequencial para não sobrecarregar o gateway do Sankhya ERP
			for (const config of pendingConfigs) {
				await this.executeJob(config);
			}
		} catch (error) {
			console.error('[ErpSyncScheduler] Erro durante o tick de sincronização:', error);
		} finally {
			if (dbLockAcquired) {
				await this.releaseDistributedLock();
			}
			this.isRunning = false;
		}
	}

	/**
	 * Executa um job específico de sincronização através da Fila de Processamento (SyncQueueManager).
	 * Utilizado tanto pelo loop automático (tick) quanto pela rota de sincronização manual.
	 */
	async executeJob(config: ErpConfiguration): Promise<SyncResult> {
		const startTime = new Date();

		console.info(`[ErpSyncScheduler] Despachando integração "${config.context}" (${config.tableName}) para a fila de sincronização...`);

		try {
			// 1. Enfileira o job na fila com controle de concorrência
			const syncResult = await this.queueManager.addJob(config);

			// 2. Calcula a próxima data de sincronização
			const nextSyncAt = this.calculateNextSyncAt(config, startTime);

			// 3. Atualiza nextSyncAt no banco
			await this.prisma.erpConfiguration.update({
				where: { id: config.id },
				data: {
					nextSyncAt,
				},
			});

			const successMessage = syncResult.strategy === 'HASH_COMPARATOR'
				? `Incremental Hash: ${syncResult.totalProcessed} registros analisados em ${syncResult.batchesCount} lote(s) (${syncResult.totalUpserted} upserts, ${syncResult.totalSkipped ?? 0} inalterados, ${syncResult.totalDeleted} deletados).`
				: `Carga Completa Paginada: ${syncResult.totalUpserted} registros sincronizados em ${syncResult.batchesCount} lote(s).`;

			return {
				success: true,
				syncedRows: syncResult.totalUpserted,
				message: successMessage,
				syncedAt: startTime,
				nextSyncAt,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Falha desconhecida durante a sincronização.';
			console.error(`[ErpSyncScheduler] Falha na sincronização de "${config.context}":`, errorMessage);

			// Recalcula o próximo agendamento mesmo em caso de erro para não travar a esteira futura
			const nextSyncAt = this.calculateNextSyncAt(config, startTime);

			try {
				await this.prisma.erpConfiguration.update({
					where: { id: config.id },
					data: {
						nextSyncAt,
					},
				});
			} catch (_) {}

			return {
				success: false,
				message: errorMessage,
				syncedAt: startTime,
				nextSyncAt,
			};
		}
	}

	/**
	 * Dispara sincronização manual sob demanda pelo ID.
	 */
	async syncNow(id: string): Promise<SyncResult> {
		const config = await this.prisma.erpConfiguration.findUnique({
			where: { id },
		});

		if (!config) {
			throw new Error(`Configuração de integração com ID "${id}" não encontrada.`);
		}

		return this.executeJob(config);
	}

	/**
	 * Calcula o próximo agendamento baseado no tipo de frequência e horários configurados.
	 */
	calculateNextSyncAt(config: ErpConfiguration | ScheduleParams, fromDate: Date = new Date()): Date | null {
		if (config.syncActive === false || config.syncFrequency === 'MANUAL') {
			return null;
		}

		const from = new Date(fromDate);

		switch (config.syncFrequency) {
			case 'MINUTES': {
				const interval = Math.max(1, config.syncInterval ?? 15);
				return new Date(from.getTime() + interval * 60 * 1000);
			}

			case 'HOURS': {
				const interval = Math.max(1, config.syncInterval ?? 1);
				return new Date(from.getTime() + interval * 60 * 60 * 1000);
			}

			case 'DAILY': {
				const [hours, minutes] = this.parseTime(config.syncTime ?? '08:00');
				const candidate = new Date(from);
				candidate.setHours(hours, minutes, 0, 0);

				if (candidate.getTime() <= from.getTime()) {
					candidate.setDate(candidate.getDate() + 1);
				}
				return candidate;
			}

			case 'MONTHLY': {
				const [hours, minutes] = this.parseTime(config.syncTime ?? '08:00');
				const targetDay = Math.min(Math.max(1, config.syncDayOfMonth ?? 1), 31);

				// Tenta o mês corrente
				const daysInCurrentMonth = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
				const actualDayCurrent = Math.min(targetDay, daysInCurrentMonth);
				const candidate = new Date(from.getFullYear(), from.getMonth(), actualDayCurrent, hours, minutes, 0, 0);

				if (candidate.getTime() <= from.getTime()) {
					// Avança para o próximo mês
					const daysInNextMonth = new Date(from.getFullYear(), from.getMonth() + 2, 0).getDate();
					const actualDayNext = Math.min(targetDay, daysInNextMonth);
					return new Date(from.getFullYear(), from.getMonth() + 1, actualDayNext, hours, minutes, 0, 0);
				}

				return candidate;
			}

			default:
				return null;
		}
	}

	/**
	 * Alias de compatibilidade com interfaces anteriores.
	 */
	calculateNextSync(params: ScheduleParams, fromDate?: Date): Date | null {
		return this.calculateNextSyncAt(params, fromDate);
	}

	private parseTime(timeStr?: string | null): [number, number] {
		if (!timeStr) return [8, 0];
		const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
		if (!match) return [8, 0];

		const hours = Math.min(Math.max(0, parseInt(match[1], 10)), 23);
		const minutes = Math.min(Math.max(0, parseInt(match[2], 10)), 59);
		return [hours, minutes];
	}
}

export const erpSyncScheduler = new ErpSyncScheduler();
export default erpSyncScheduler;
