import { PrismaClient, ErpConfiguration as PrismaErpConfig } from '@prisma/client';
import prismaClient from '../config/prisma';
import dynamicTableManager, { IDynamicTableManager } from './dynamic-table.manager';
import SankhyaService from './sankhya.service';

export interface ScheduleParams {
	syncFrequency: string; // MINUTES, HOURS, DAILY, MONTHLY, MANUAL
	syncInterval?: number | null;
	syncTime?: string | null;
	syncDayOfMonth?: number | null;
	syncActive?: boolean;
}

export interface SyncResult {
	success: boolean;
	syncedRows?: number;
	message: string;
	syncedAt: Date;
	nextSyncAt?: Date | null;
}

export interface ISyncCalculator {
	calculateNextSync(params: ScheduleParams, fromDate?: Date): Date | null;
}

/**
 * Calculador de datas e horários de agendamento seguindo os requisitos de negócio:
 * - A cada X minutos ou X horas
 * - Diário: horário específico do dia
 * - Mensal: dia do mês específico e horário do dia
 */
export class SyncScheduleCalculator implements ISyncCalculator {
	calculateNextSync(params: ScheduleParams, fromDate: Date = new Date()): Date | null {
		if (params.syncActive === false || params.syncFrequency === 'MANUAL') {
			return null;
		}

		const from = new Date(fromDate);

		switch (params.syncFrequency) {
			case 'MINUTES': {
				const interval = Math.max(1, params.syncInterval ?? 15);
				return new Date(from.getTime() + interval * 60 * 1000);
			}

			case 'HOURS': {
				const interval = Math.max(1, params.syncInterval ?? 1);
				return new Date(from.getTime() + interval * 60 * 60 * 1000);
			}

			case 'DAILY': {
				const [hours, minutes] = this.parseTime(params.syncTime ?? '08:00');
				const candidate = new Date(from);
				candidate.setHours(hours, minutes, 0, 0);

				if (candidate.getTime() <= from.getTime()) {
					candidate.setDate(candidate.getDate() + 1);
				}
				return candidate;
			}

			case 'MONTHLY': {
				const [hours, minutes] = this.parseTime(params.syncTime ?? '08:00');
				const targetDay = Math.min(Math.max(1, params.syncDayOfMonth ?? 1), 31);

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

	private parseTime(timeStr: string): [number, number] {
		const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
		if (!match) {
			return [8, 0];
		}

		const hours = Math.min(Math.max(0, parseInt(match[1], 10)), 23);
		const minutes = Math.min(Math.max(0, parseInt(match[2], 10)), 59);
		return [hours, minutes];
	}
}

export interface IErpSyncScheduler {
	start(checkIntervalMs?: number): void;
	stop(): void;
	syncNow(id: string): Promise<SyncResult>;
	runScheduledSyncs(): Promise<void>;
	calculateNextSync(params: ScheduleParams, fromDate?: Date): Date | null;
}

/**
 * Orquestrador de agendamentos e execuções de sincronização de dados do ERP Sankhya.
 * Utiliza Orientação a Objetos e injeção de dependências.
 */
export class ErpSyncScheduler implements IErpSyncScheduler {
	private timer: NodeJS.Timeout | null = null;
	private isChecking = false;
	private readonly runningSyncs = new Set<string>();

	constructor(
		private readonly prisma: PrismaClient = prismaClient,
		private readonly tableManager: IDynamicTableManager = dynamicTableManager,
		private readonly calculator: ISyncCalculator = new SyncScheduleCalculator(),
		private readonly sankhyaFactory: () => SankhyaService = () => new SankhyaService(),
	) {}

	start(checkIntervalMs: number = 30_000): void {
		if (this.timer) {
			return;
		}

		console.info(`[ErpSyncScheduler] Serviço de agendamento iniciado (ciclo de ${checkIntervalMs / 1000}s).`);

		// Executa primeira checagem após 5 segundos
		setTimeout(() => {
			void this.runScheduledSyncs();
		}, 5_000);

		this.timer = setInterval(() => {
			void this.runScheduledSyncs();
		}, checkIntervalMs);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
			console.info('[ErpSyncScheduler] Serviço de agendamento parado.');
		}
	}

	calculateNextSync(params: ScheduleParams, fromDate?: Date): Date | null {
		return this.calculator.calculateNextSync(params, fromDate);
	}

	async runScheduledSyncs(): Promise<void> {
		if (this.isChecking) {
			return;
		}

		this.isChecking = true;

		try {
			const now = new Date();
			const dueConfigs = await this.prisma.erpConfiguration.findMany({
				where: {
					syncActive: true,
					nextSyncAt: {
						lte: now,
					},
				},
			});

			for (const config of dueConfigs) {
				await this.executeSync(config);
			}
		} catch (error) {
			console.error('[ErpSyncScheduler] Erro ao buscar sincronizações pendentes:', error);
		} finally {
			this.isChecking = false;
		}
	}

	async syncNow(id: string): Promise<SyncResult> {
		const config = await this.prisma.erpConfiguration.findUnique({
			where: { id },
		});

		if (!config) {
			throw new Error(`Configuração de ERP com ID "${id}" não encontrada.`);
		}

		return this.executeSync(config);
	}

	private async executeSync(config: PrismaErpConfig): Promise<SyncResult> {
		if (this.runningSyncs.has(config.id)) {
			return {
				success: false,
				message: 'Sincronização já está em andamento para esta integração.',
				syncedAt: new Date(),
			};
		}

		this.runningSyncs.add(config.id);
		const startTime = new Date();

		try {
			// 1. Marca status como RUNNING
			await this.prisma.erpConfiguration.update({
				where: { id: config.id },
				data: {
					lastSyncStatus: 'RUNNING',
					lastSyncMessage: 'Sincronização em andamento...',
				},
			});

			console.info(`[ErpSyncScheduler] Executando sincronização para "${config.context}" (${config.tableName})...`);

			// 2. Consulta o Sankhya ERP
			const sankhya = this.sankhyaFactory();
			const rows = await sankhya.executeQuery(config.query, config.expectedFields);

			// 3. Atualiza a tabela dinâmica correspondente
			const insertedCount = await this.tableManager.replaceRows(config.tableName, rows);

			// 4. Calcula próxima sincronização
			const nextSyncAt = this.calculator.calculateNextSync(
				{
					syncFrequency: config.syncFrequency,
					syncInterval: config.syncInterval,
					syncTime: config.syncTime,
					syncDayOfMonth: config.syncDayOfMonth,
					syncActive: config.syncActive,
				},
				startTime,
			);

			const successMessage = `${insertedCount} registros sincronizados com sucesso na tabela "${config.tableName}".`;

			await this.prisma.erpConfiguration.update({
				where: { id: config.id },
				data: {
					lastSyncAt: startTime,
					lastSyncStatus: 'SUCCESS',
					lastSyncMessage: successMessage,
					nextSyncAt,
				},
			});

			console.info(`[ErpSyncScheduler] Sincronização de "${config.context}" concluída com sucesso (${insertedCount} registros).`);

			return {
				success: true,
				syncedRows: insertedCount,
				message: successMessage,
				syncedAt: startTime,
				nextSyncAt,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Falha desconhecida durante a sincronização.';
			console.error(`[ErpSyncScheduler] Falha na sincronização de "${config.context}":`, errorMessage);

			// Recalcula o próximo agendamento mesmo em caso de erro para não travar a fila
			const nextSyncAt = this.calculator.calculateNextSync(
				{
					syncFrequency: config.syncFrequency,
					syncInterval: config.syncInterval,
					syncTime: config.syncTime,
					syncDayOfMonth: config.syncDayOfMonth,
					syncActive: config.syncActive,
				},
				startTime,
			);

			await this.prisma.erpConfiguration.update({
				where: { id: config.id },
				data: {
					lastSyncAt: startTime,
					lastSyncStatus: 'ERROR',
					lastSyncMessage: errorMessage,
					nextSyncAt,
				},
			});

			return {
				success: false,
				message: errorMessage,
				syncedAt: startTime,
				nextSyncAt,
			};
		} finally {
			this.runningSyncs.delete(config.id);
		}
	}
}

export const erpSyncScheduler = new ErpSyncScheduler();
export default erpSyncScheduler;

