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

export interface QueueStatus {
	pending: number;
	active: number;
	concurrency: number;
}

export interface ISyncQueueManager {
	concurrency: number;
	addJob(config: ErpConfiguration): Promise<SyncExecutionResult>;
	processQueue(): Promise<void>;
	getStatus(): QueueStatus;
}

/**
 * Gerenciador de Fila de Sincronização (SyncQueueManager):
 * Limita a concorrência de sincronizações simultâneas para proteger recursos de rede,
 * conexões do banco de dados e o V8 Heap de Node.js.
 */
export class SyncQueueManager implements ISyncQueueManager {
	private readonly queue: QueueJob[] = [];
	private activeJobsCount = 0;
	private readonly activeConfigIds = new Set<string>();
	public concurrency: number = 2; // Limite de tabelas sincronizadas concorrentemente

	constructor(
		private readonly prisma: PrismaClient = prismaClient,
		private readonly tableManager: IDynamicTableManager = dynamicTableManager,
	) {}

	/**
	 * Adiciona uma integração na fila de processamento.
	 * Retorna uma Promise que será resolvida quando o trabalho for executado e finalizado.
	 */
	async addJob(config: ErpConfiguration): Promise<SyncExecutionResult> {
		if (this.activeConfigIds.has(config.id)) {
			throw new Error(`A sincronização para a integração "${config.context}" (${config.id}) já está na fila ou em andamento.`);
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
				const { config, resolve, reject } = job;

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

					console.info(`[SyncQueueManager] [Concluído] Job "${config.context}": ${successMessage}`);
					resolve(syncResult);
				} catch (error) {
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

					reject(error instanceof Error ? error : new Error(errorMessage));
				} finally {
					this.activeConfigIds.delete(config.id);
					this.activeJobsCount -= 1;

					// Continua consumindo a fila automaticamente
					void this.processQueue();
				}
			})();
		}
	}

	/**
	 * Retorna o status atual da fila e workers ativos.
	 */
	getStatus(): QueueStatus {
		return {
			pending: this.queue.length,
			active: this.activeJobsCount,
			concurrency: this.concurrency,
		};
	}
}

export const syncQueueManager = new SyncQueueManager();
export default syncQueueManager;
