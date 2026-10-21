import { PrismaClient, ErpConfiguration } from '@prisma/client';
import prismaClient from '../config/prisma';
import dynamicTableManager, { IDynamicTableManager, SyncExecutionResult } from './dynamic-table.manager';

export interface QueueJob {
	id: string;
	config: ErpConfiguration;
	enqueuedAt: Date;
	resolve: (result: SyncExecutionResult) => void;
	reject: (error: Error) => void;
}

export interface SyncJobHistoryEntry {
	id: string;
	context: string;
	tableName: string;
	strategy: string;
	status: 'SUCCESS' | 'ERROR';
	enqueuedAt: Date;
	startedAt: Date;
	finishedAt: Date;
	durationMs: number;
	totalProcessed?: number;
	totalUpserted?: number;
	totalDeleted?: number;
	totalSkipped?: number;
	errorMessage?: string;
}

export interface QueueStatus {
	pending: number;
	active: number;
	concurrency: number;
	historySize?: number;
	maxHistorySize?: number;
	maxQueueSize?: number;
}

export interface ISyncQueueManager {
	concurrency: number;
	addJob(config: ErpConfiguration): Promise<SyncExecutionResult>;
	processQueue(): Promise<void>;
	getStatus(): QueueStatus;
	getHistory?(): ReadonlyArray<SyncJobHistoryEntry>;
	clearHistory?(): void;
}

/**
 * Gerenciador de Fila de Sincronização (SyncQueueManager):
 * Limita a concorrência de sincronizações simultâneas para proteger recursos de rede,
 * conexões do banco de dados e o V8 Heap de Node.js.
 * Conta com controle de backpressure (limite máximo de fila) e retenção máxima (FIFO eviction)
 * do histórico de execuções em memória para impedir memory leaks.
 */
export class SyncQueueManager implements ISyncQueueManager {
	private static readonly DEFAULT_MAX_QUEUE_SIZE = 100;
	private static readonly DEFAULT_MAX_HISTORY_SIZE = 50;

	private readonly queue: QueueJob[] = [];
	private readonly jobHistory: SyncJobHistoryEntry[] = [];
	private activeJobsCount = 0;
	private readonly activeConfigIds = new Set<string>();
	public concurrency: number = 2; // Limite de tabelas sincronizadas concorrentemente
	public readonly maxQueueSize: number = SyncQueueManager.DEFAULT_MAX_QUEUE_SIZE;
	public readonly maxHistorySize: number = SyncQueueManager.DEFAULT_MAX_HISTORY_SIZE;

	constructor(
		private readonly prisma: PrismaClient = prismaClient,
		private readonly tableManager: IDynamicTableManager = dynamicTableManager,
	) {}

	/**
	 * Registra um job finalizado no histórico em memória respeitando o limite máximo (FIFO cap/eviction).
	 */
	private recordHistory(entry: SyncJobHistoryEntry): void {
		this.jobHistory.push(entry);
		while (this.jobHistory.length > this.maxHistorySize) {
			this.jobHistory.shift();
		}
	}

	/**
	 * Retorna cópia somente-leitura do histórico recente de sincronizações (limitado por maxHistorySize).
	 */
	getHistory(): ReadonlyArray<SyncJobHistoryEntry> {
		return [...this.jobHistory];
	}

	/**
	 * Limpa manualmente o histórico em memória.
	 */
	clearHistory(): void {
		this.jobHistory.length = 0;
	}

	/**
	 * Adiciona uma integração na fila de processamento.
	 * Retorna uma Promise que será resolvida quando o trabalho for executado e finalizado.
	 */
	async addJob(config: ErpConfiguration): Promise<SyncExecutionResult> {
		if (this.activeConfigIds.has(config.id)) {
			throw new Error(`A sincronização para a integração "${config.context}" (${config.id}) já está na fila ou em andamento.`);
		}

		if (this.queue.length >= this.maxQueueSize) {
			throw new Error(
				`Fila de sincronização atingiu a capacidade máxima (${this.maxQueueSize} jobs pendentes). Tente novamente mais tarde.`,
			);
		}

		this.activeConfigIds.add(config.id);

		return new Promise<SyncExecutionResult>((resolve, reject) => {
			this.queue.push({
				id: config.id,
				config,
				enqueuedAt: new Date(),
				resolve,
				reject,
			});

			console.info(
				`[SyncQueueManager] Job "${config.context}" (${config.id}) enfileirado. Posição na fila: ${this.queue.length}. Ativos: ${this.activeJobsCount}/${this.concurrency}`,
			);

			// Dispara o processamento imediato da fila
			void this.processQueue();
		});
	}

	/**
	 * Processa itens da fila respeitando o limite de concorrência definido.
	 * Quando um trabalho termina, retira e executa o próximo automaticamente.
	 */
	async processQueue(): Promise<void> {
		while (this.activeJobsCount < this.concurrency && this.queue.length > 0) {
			const job = this.queue.shift();
			if (!job) break;

			this.activeJobsCount += 1;

			// Execução do job desacoplada do loop de dispatch
			void (async () => {
				const startTime = new Date();
				const { config, enqueuedAt, resolve, reject } = job;

				console.info(
					`[SyncQueueManager] [Iniciando] Job "${config.context}" (${config.tableName}) via estratégia "${config.syncStrategy ?? 'FULL'}". Ativos: ${this.activeJobsCount}/${this.concurrency}`,
				);

				try {
					// 1. Marca status como RUNNING no banco de dados
					await this.prisma.erpConfiguration.update({
						where: { id: config.id },
						data: {
							lastSyncStatus: 'RUNNING',
							lastSyncMessage: 'Sincronização em processamento na fila...',
						},
					});

					// 2. Executa a sincronização paginada no DynamicTableManager
					const syncResult = await this.tableManager.syncTable(config);

					const successMessage = syncResult.strategy === 'HASH_COMPARATOR'
						? `Incremental Hash: ${syncResult.totalProcessed} linhas analisadas em ${syncResult.batchesCount} lote(s) (${syncResult.totalUpserted} modificadas/inseridas, ${syncResult.totalSkipped ?? 0} inalteradas descartadas, ${syncResult.totalDeleted} excluídas) em ${syncResult.durationMs}ms.`
						: `Carga Completa Paginada: ${syncResult.totalUpserted} linhas sincronizadas em ${syncResult.batchesCount} lote(s) em ${syncResult.durationMs}ms.`;

					// 3. Atualiza status no banco
					await this.prisma.erpConfiguration.update({
						where: { id: config.id },
						data: {
							lastSyncAt: startTime,
							lastSyncStatus: 'SUCCESS',
							lastSyncMessage: successMessage,
						},
					});

					this.recordHistory({
						id: config.id,
						context: config.context,
						tableName: config.tableName,
						strategy: syncResult.strategy,
						status: 'SUCCESS',
						enqueuedAt,
						startedAt: startTime,
						finishedAt: new Date(),
						durationMs: syncResult.durationMs,
						totalProcessed: syncResult.totalProcessed,
						totalUpserted: syncResult.totalUpserted,
						totalDeleted: syncResult.totalDeleted,
						totalSkipped: syncResult.totalSkipped,
					});

					console.info(`[SyncQueueManager] [Concluído] Job "${config.context}": ${successMessage}`);
					resolve(syncResult);
				} catch (error) {
					const finishedAt = new Date();
					const errorMessage = error instanceof Error ? error.message : 'Falha desconhecida durante a sincronização.';
					console.error(`[SyncQueueManager] [Erro] Falha no job "${config.context}":`, errorMessage);

					await this.prisma.erpConfiguration.update({
						where: { id: config.id },
						data: {
							lastSyncAt: startTime,
							lastSyncStatus: 'ERROR',
							lastSyncMessage: errorMessage,
						},
					});

					this.recordHistory({
						id: config.id,
						context: config.context,
						tableName: config.tableName,
						strategy: (config.syncStrategy ?? 'FULL').toUpperCase(),
						status: 'ERROR',
						enqueuedAt,
						startedAt: startTime,
						finishedAt,
						durationMs: finishedAt.getTime() - startTime.getTime(),
						errorMessage: errorMessage.slice(0, 500),
					});

					reject(error instanceof Error ? error : new Error(errorMessage));
				} finally {
					this.activeConfigIds.delete(config.id);
					this.activeJobsCount -= 1;

					// Libera referências de objetos potencialmente grandes (ex: SQL query na config) para o GC
					(job as Partial<QueueJob>).config = undefined;

					// Continua consumindo a fila automaticamente
					void this.processQueue();
				}
			})();
		}
	}

	/**
	 * Retorna o status atual da fila, workers ativos e uso do histórico limitado.
	 */
	getStatus(): QueueStatus {
		return {
			pending: this.queue.length,
			active: this.activeJobsCount,
			concurrency: this.concurrency,
			historySize: this.jobHistory.length,
			maxHistorySize: this.maxHistorySize,
			maxQueueSize: this.maxQueueSize,
		};
	}
}

export const syncQueueManager = new SyncQueueManager();
export default syncQueueManager;
