import { PrismaClient, ErpConfiguration as PrismaErpConfig } from '@prisma/client';
import prismaClient from '../config/prisma';
import dynamicTableManager, { IDynamicTableManager } from './dynamic-table.manager';
import erpSyncScheduler, { IErpSyncScheduler, SyncResult } from './erp-sync.scheduler';
import { saveTableMetadataUseCase, metaTableRepository } from '../modules/data-dictionary';

export type SyncFrequency = 'MINUTES' | 'HOURS' | 'DAILY' | 'MONTHLY' | 'MANUAL';

export interface ErpConfigurationInput {
	context: string;
	description: string;
	query: string;
	expectedFields: string[];
	primaryKey?: string;
	syncStrategy?: 'FULL' | 'HASH_COMPARATOR' | 'INCREMENTAL';
	lastSyncCursor?: string;
	batchSize?: number;
	activeColumn?: string;
	activeValue?: string;
	syncFrequency?: SyncFrequency;
	syncInterval?: number;
	syncTime?: string;
	syncDayOfMonth?: number;
	syncActive?: boolean;
}

export interface IErpConfigurationService {
	list(): Promise<PrismaErpConfig[]>;
	getById(id: string): Promise<PrismaErpConfig | null>;
	create(input: ErpConfigurationInput): Promise<PrismaErpConfig>;
	update(id: string, input: ErpConfigurationInput): Promise<PrismaErpConfig | null>;
	delete(id: string): Promise<boolean>;
	syncNow(id: string): Promise<SyncResult>;
}

export class ErpConfigurationService implements IErpConfigurationService {
	private readonly prisma: PrismaClient;
	private readonly tableManager: IDynamicTableManager;
	private readonly scheduler: IErpSyncScheduler;

	constructor(
		prisma: PrismaClient = prismaClient,
		tableManager: IDynamicTableManager = dynamicTableManager,
		scheduler: IErpSyncScheduler = erpSyncScheduler,
	) {
		this.prisma = prisma;
		this.tableManager = tableManager;
		this.scheduler = scheduler;
	}

	async list(): Promise<PrismaErpConfig[]> {
		return this.prisma.erpConfiguration.findMany({
			orderBy: { createdAt: 'desc' },
		});
	}

	async getById(id: string): Promise<PrismaErpConfig | null> {
		return this.prisma.erpConfiguration.findUnique({
			where: { id },
		});
	}

	async create(input: ErpConfigurationInput): Promise<PrismaErpConfig> {
		const tableName = this.tableManager.generateTableName(input.context);

		const primaryKey = input.primaryKey?.trim() || null;

		// 1. Cria a tabela dinâmica no banco com as colunas definidas em expectedFields e índice na PK
		await this.tableManager.createTable(tableName, input.expectedFields, primaryKey);

		const syncStrategy = input.syncStrategy ?? 'FULL';
		const lastSyncCursor = input.lastSyncCursor?.trim() || null;
		const batchSize = input.batchSize ? Math.max(1, input.batchSize) : 1000;
		const activeColumn = input.activeColumn?.trim() || null;
		const activeValue = input.activeValue?.trim() || null;

		const syncFrequency = input.syncFrequency ?? 'HOURS';
		const syncInterval = input.syncInterval ?? 1;
		const syncTime = input.syncTime ?? '08:00';
		const syncDayOfMonth = input.syncDayOfMonth ?? 1;
		const syncActive = input.syncActive ?? true;

		// Calcula a próxima execução do agendamento
		const nextSyncAt = this.scheduler.calculateNextSync({
			syncFrequency,
			syncInterval,
			syncTime,
			syncDayOfMonth,
			syncActive,
		});

		// 2. Registra a configuração de integração no banco
		const created = await this.prisma.erpConfiguration.create({
			data: {
				context: input.context.trim(),
				description: input.description.trim(),
				query: input.query.trim(),
				expectedFields: input.expectedFields.map((f) => f.trim()).filter(Boolean),
				tableName,
				primaryKey,
				syncStrategy,
				lastSyncCursor,
				batchSize,
				activeColumn,
				activeValue,
				syncFrequency,
				syncInterval,
				syncTime,
				syncDayOfMonth,
				syncActive,
				nextSyncAt,
			},
		});

		// 3. Sincroniza automaticamente com o Dicionário de Dados Dinâmico (RAG)
		if (primaryKey) {
			try {
				await saveTableMetadataUseCase.execute({
					tenantId: 'default',
					tableName,
					description: input.description.trim() || `Tabela dinâmica para o contexto ${input.context}`,
					columns: created.expectedFields.map((field) => ({
						columnName: field,
						dataType: 'TEXT',
						description: field.toUpperCase() === primaryKey.toUpperCase()
							? `Chave Primária identificadora (${field})`
							: `Coluna de dados ${field} da integração ${input.context}`,
						isPrimaryKey: field.toUpperCase() === primaryKey.toUpperCase(),
					})),
				});
			} catch (err) {
				console.warn('[ErpConfigurationService] Aviso ao registrar no dicionário de dados:', err);
			}
		}

		return created;
	}

	async update(id: string, input: ErpConfigurationInput): Promise<PrismaErpConfig | null> {
		const existing = await this.getById(id);
		if (!existing) {
			return null;
		}

		const primaryKey = input.primaryKey !== undefined ? (input.primaryKey?.trim() || null) : existing.primaryKey;

		// Garante a existência da tabela e adiciona novas colunas caso haja novos campos
		await this.tableManager.syncColumns(existing.tableName, input.expectedFields, primaryKey);

		const syncStrategy = input.syncStrategy ?? existing.syncStrategy ?? 'FULL';
		const lastSyncCursor = input.lastSyncCursor !== undefined ? (input.lastSyncCursor?.trim() || null) : existing.lastSyncCursor;
		const batchSize = input.batchSize !== undefined ? Math.max(1, input.batchSize) : (existing.batchSize ?? 1000);
		const activeColumn = input.activeColumn !== undefined ? (input.activeColumn?.trim() || null) : existing.activeColumn;
		const activeValue = input.activeValue !== undefined ? (input.activeValue?.trim() || null) : existing.activeValue;

		const syncFrequency = input.syncFrequency ?? existing.syncFrequency;
		const syncInterval = input.syncInterval !== undefined ? input.syncInterval : existing.syncInterval;
		const syncTime = input.syncTime ?? existing.syncTime;
		const syncDayOfMonth = input.syncDayOfMonth !== undefined ? input.syncDayOfMonth : existing.syncDayOfMonth;
		const syncActive = input.syncActive !== undefined ? input.syncActive : existing.syncActive;

		const nextSyncAt = this.scheduler.calculateNextSync({
			syncFrequency,
			syncInterval,
			syncTime,
			syncDayOfMonth,
			syncActive,
		});

		const updated = await this.prisma.erpConfiguration.update({
			where: { id },
			data: {
				context: input.context.trim(),
				description: input.description.trim(),
				query: input.query.trim(),
				expectedFields: input.expectedFields.map((f) => f.trim()).filter(Boolean),
				primaryKey,
				syncStrategy,
				lastSyncCursor,
				batchSize,
				activeColumn,
				activeValue,
				syncFrequency,
				syncInterval,
				syncTime,
				syncDayOfMonth,
				syncActive,
				nextSyncAt,
			},
		});

		// Sincroniza metadados com o Dicionário de Dados Dinâmico
		if (primaryKey) {
			try {
				await saveTableMetadataUseCase.execute({
					tenantId: 'default',
					tableName: existing.tableName,
					description: input.description.trim() || `Tabela dinâmica para o contexto ${input.context}`,
					columns: updated.expectedFields.map((field) => ({
						columnName: field,
						dataType: 'TEXT',
						description: field.toUpperCase() === primaryKey.toUpperCase()
							? `Chave Primária identificadora (${field})`
							: `Coluna de dados ${field} da integração ${input.context}`,
						isPrimaryKey: field.toUpperCase() === primaryKey.toUpperCase(),
					})),
				});
			} catch (err) {
				console.warn('[ErpConfigurationService] Aviso ao atualizar no dicionário de dados:', err);
			}
		}

		return updated;
	}

	async delete(id: string): Promise<boolean> {
		const existing = await this.getById(id);
		if (!existing) {
			return false;
		}

		// Remove a tabela dinâmica correspondente no banco
		await this.tableManager.dropTable(existing.tableName);

		// Remove os metadados do dicionário de dados
		await metaTableRepository.delete('default', existing.tableName);

		// Remove a configuração do Prisma
		await this.prisma.erpConfiguration.delete({
			where: { id },
		});

		return true;
	}

	async syncNow(id: string): Promise<SyncResult> {
		return this.scheduler.syncNow(id);
	}
}

export const erpConfigurationService = new ErpConfigurationService();
export default erpConfigurationService;
