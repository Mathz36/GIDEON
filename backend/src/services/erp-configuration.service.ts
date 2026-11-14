import { PrismaClient, ErpConfiguration as PrismaErpConfig } from '@prisma/client';
import prismaClient from '../config/prisma';
import dynamicTableManager, { IDynamicTableManager } from './dynamic-table.manager';
import erpSyncScheduler, { IErpSyncScheduler, SyncResult } from './erp-sync.scheduler';
import {
	saveTableMetadataUseCase,
	metaTableRepository,
	autoDetectRelationshipsUseCase,
} from '../modules/data-dictionary';
import {
	extractSqlSelectAliases,
	mergeExpectedFieldsWithQueryAliases,
} from '../utils/sql-alias-extractor';

export type SyncFrequency = 'MINUTES' | 'HOURS' | 'DAILY' | 'MONTHLY' | 'MANUAL';

export interface ErpConfigurationInput {
	context: string;
	description: string;
	query: string;
	expectedFields: string[];
	columnDescriptions?: Record<string, string>;
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

export interface ErpConfigurationWithDictionary extends PrismaErpConfig {
	columnDescriptions?: Record<string, string>;
}

export interface SchemaColumnOverview {
	columnName: string;
	dataType: string;
	description: string;
	isPrimaryKey: boolean;
	foreignKeyToTable: string | null;
	foreignKeyToColumn: string | null;
	isGenericDescription: boolean;
	sampleValues: string[];
}

export interface SchemaTableOverview {
	id: string;
	erpConfigId: string | null;
	tableName: string;
	context: string;
	description: string;
	primaryKey: string | null;
	rowCount: number;
	lastSyncAt: Date | null;
	lastSyncStatus: string | null;
	columns: SchemaColumnOverview[];
}

export interface SchemaRelationshipLink {
	fromTable: string;
	fromColumn: string;
	toTable: string;
	toColumn: string;
}

export interface SchemaOverviewResponse {
	tables: SchemaTableOverview[];
	relationships: SchemaRelationshipLink[];
}

export interface UpdateTableSchemaInput {
	description: string;
	columns: Array<{
		columnName: string;
		description: string;
		isPrimaryKey?: boolean;
		foreignKeyToTable?: string | null;
		foreignKeyToColumn?: string | null;
	}>;
}

export interface IErpConfigurationService {
	list(): Promise<ErpConfigurationWithDictionary[]>;
	getById(id: string): Promise<ErpConfigurationWithDictionary | null>;
	create(input: ErpConfigurationInput): Promise<ErpConfigurationWithDictionary>;
	update(id: string, input: ErpConfigurationInput): Promise<ErpConfigurationWithDictionary | null>;
	delete(id: string): Promise<boolean>;
	syncNow(id: string): Promise<SyncResult>;
	getSchemaOverview(): Promise<SchemaOverviewResponse>;
	updateTableSchema(tableName: string, input: UpdateTableSchemaInput): Promise<SchemaTableOverview>;
	extractColumnsFromQuery(
		query: string,
		context?: string,
		primaryKey?: string,
	): Array<{ columnName: string; description: string }>;
}

const CATEGORICAL_CANDIDATE_REGEX =
	/^(operacao|tipo_movimento|status|tipo_pessoa|ramo_de_atividade|classificacao|rede|uf|grupo_de_produtos|descricao_grupo|descricao_subgrupo|empresa)$/i;

export function isGenericColumnDescription(desc?: string | null): boolean {
	if (!desc || !desc.trim()) return true;
	return /^Coluna de dados\s+\S+\s+da integra[çc][ãa]o/i.test(desc.trim());
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

	async list(): Promise<ErpConfigurationWithDictionary[]> {
		const configs = await this.prisma.erpConfiguration.findMany({
			orderBy: { createdAt: 'desc' },
		});

		try {
			const metaTables = await metaTableRepository.findAllByTenant('default');
			const metaByTable = new Map(metaTables.map((t) => [t.tableName.toLowerCase(), t]));

			return configs.map((cfg) => {
				const meta = metaByTable.get(cfg.tableName.toLowerCase());
				const columnDescriptions: Record<string, string> = {};
				for (const field of cfg.expectedFields) {
					const colMeta = meta?.findColumn(field);
					columnDescriptions[field.toUpperCase()] =
						colMeta && !isGenericColumnDescription(colMeta.description)
							? colMeta.description
							: this.generateColumnDescription(field, cfg.primaryKey, cfg.context);
				}
				return {
					...cfg,
					columnDescriptions,
				};
			});
		} catch {
			return configs;
		}
	}

	async getById(id: string): Promise<ErpConfigurationWithDictionary | null> {
		const cfg = await this.prisma.erpConfiguration.findUnique({
			where: { id },
		});
		if (!cfg) return null;

		try {
			const meta = await metaTableRepository.findByTenantAndTableName('default', cfg.tableName);
			const columnDescriptions: Record<string, string> = {};
			for (const field of cfg.expectedFields) {
				const colMeta = meta?.findColumn(field);
				columnDescriptions[field.toUpperCase()] =
					colMeta && !isGenericColumnDescription(colMeta.description)
						? colMeta.description
						: this.generateColumnDescription(field, cfg.primaryKey, cfg.context);
			}
			return {
				...cfg,
				columnDescriptions,
			};
		} catch {
			return cfg;
		}
	}

	private resolveColumnDescription(
		field: string,
		customDescriptions: Record<string, string> | undefined,
		existingDescription: string | undefined,
		primaryKey: string | null,
		context: string,
	): string {
		if (customDescriptions) {
			const direct =
				customDescriptions[field] ??
				customDescriptions[field.toUpperCase()] ??
				customDescriptions[field.toLowerCase()];
			if (typeof direct === 'string' && direct.trim()) {
				return direct.trim();
			}
		}
		if (existingDescription && !isGenericColumnDescription(existingDescription)) {
			return existingDescription.trim();
		}
		return this.generateColumnDescription(field, primaryKey, context);
	}

	async create(input: ErpConfigurationInput): Promise<ErpConfigurationWithDictionary> {
		const tableName = this.tableManager.generateTableName(input.context);

		const primaryKey = input.primaryKey?.trim() || null;
		const effectiveExpectedFields = mergeExpectedFieldsWithQueryAliases(input.query, input.expectedFields);

		// 1. Cria a tabela dinâmica no banco com as colunas definidas em expectedFields e índice na PK
		await this.tableManager.createTable(tableName, effectiveExpectedFields, primaryKey);

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
				expectedFields: effectiveExpectedFields,
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

		const columnDescriptions: Record<string, string> = {};
		for (const field of created.expectedFields) {
			columnDescriptions[field.toUpperCase()] = this.resolveColumnDescription(
				field,
				input.columnDescriptions,
				undefined,
				primaryKey,
				input.context,
			);
		}

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
						description: columnDescriptions[field.toUpperCase()],
						isPrimaryKey: field.toUpperCase() === primaryKey.toUpperCase(),
					})),
				});
				await autoDetectRelationshipsUseCase.execute('default');
			} catch (err) {
				console.warn('[ErpConfigurationService] Aviso ao registrar no dicionário de dados:', err);
			}
		}

		return {
			...created,
			columnDescriptions,
		};
	}

	async update(id: string, input: ErpConfigurationInput): Promise<ErpConfigurationWithDictionary | null> {
		const existing = await this.getById(id);
		if (!existing) {
			return null;
		}

		const primaryKey = input.primaryKey !== undefined ? (input.primaryKey?.trim() || null) : existing.primaryKey;
		const effectiveExpectedFields = mergeExpectedFieldsWithQueryAliases(input.query, input.expectedFields);

		// Garante a existência da tabela e adiciona novas colunas caso haja novos campos
		await this.tableManager.syncColumns(existing.tableName, effectiveExpectedFields, primaryKey);

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
				expectedFields: effectiveExpectedFields,
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

		const existingMeta = await metaTableRepository
			.findByTenantAndTableName('default', existing.tableName)
			.catch(() => null);

		const columnDescriptions: Record<string, string> = {};
		for (const field of updated.expectedFields) {
			const oldDesc = existingMeta?.findColumn(field)?.description;
			columnDescriptions[field.toUpperCase()] = this.resolveColumnDescription(
				field,
				input.columnDescriptions,
				oldDesc,
				primaryKey,
				input.context,
			);
		}

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
						description: columnDescriptions[field.toUpperCase()],
						isPrimaryKey: field.toUpperCase() === primaryKey.toUpperCase(),
					})),
				});
				await autoDetectRelationshipsUseCase.execute('default');
			} catch (err) {
				console.warn('[ErpConfigurationService] Aviso ao atualizar no dicionário de dados:', err);
			}
		}

		return {
			...updated,
			columnDescriptions,
		};
	}

	public generateColumnDescription(field: string, primaryKey: string | null, context: string): string {
		const upper = field.trim().toUpperCase();
		const isPk = Boolean(primaryKey && upper === primaryKey.trim().toUpperCase());
		const pkPrefix = isPk ? '[Chave Primária] ' : '';

		switch (upper) {
			case 'OPERACAO':
				return `${pkPrefix}Natureza/tipo da operação comercial da nota fiscal. Valores exatos existentes no banco: ['VENDAS', 'BONIFICAÇÃO', 'DEVOLUÇÃO DE VENDAS', 'DEVOLUÇÃO DE BONIFICAÇÃO']. REGRA CRÍTICA: Quando o usuário pedir faturamento ou vendas, filtre OBRIGATORIAMENTE WHERE operacao = 'VENDAS' (não misture bonificações nem devoluções no faturamento de vendas).`;
			case 'TIPO_MOVIMENTO':
				return `${pkPrefix}Sentido fiscal da movimentação da nota. Valores exatos no banco: ['SAIDA', 'ENTRADA'] ('SAIDA' para vendas/bonificações e 'ENTRADA' para devoluções).`;
			case 'NOTA_FISCAL':
			case 'NUMERO_NOTA':
				return `${pkPrefix}Número identificador da Nota Fiscal emitida no ERP (conecta cabeçalho erp_nota_fiscal e itens erp_nota_fiscal_prod).`;
			case 'PEDIDO_ORIGEM':
			case 'NUM_PEDIDO':
				return `${pkPrefix}Número do pedido de venda original que deu origem à nota fiscal.`;
			case 'VALOR_LIQUIDO':
				return `${pkPrefix}Valor financeiro líquido da nota fiscal em R$ (armazenado como texto numérico). Para somar faturamento líquido, use SUM(CAST(valor_liquido AS NUMERIC)).`;
			case 'VALOR_BRUTO':
				return `${pkPrefix}Valor financeiro bruto da nota fiscal em R$ antes de descontos. Para somar faturamento bruto, use SUM(CAST(valor_bruto AS NUMERIC)).`;
			case 'DATA_EMISSAO':
				return `${pkPrefix}Data e hora de emissão da nota fiscal gravada no formato ISO 'YYYY-MM-DD HH24:MI:SS' (ex: '2026-10-05 00:00:00'). Para filtrar períodos, ordenar ou agrupar por dia/mês, use OBRIGATORIAMENTE CAST(data_emissao AS TIMESTAMP) ou CAST(data_emissao AS DATE).`;
			case 'COD_CLIENTE':
			case 'CLIENTE_ID':
				return `${pkPrefix}Código identificador único do cliente/parceiro no ERP (conecta com erp_clientes.cliente_id).`;
			case 'RAZAOSOCIAL':
			case 'RAZAO_SOCIAL':
				return `${pkPrefix}Nome empresarial / Razão Social completa do cliente no ERP.`;
			case 'COD_VENDEDOR':
			case 'REPRESENTANTE_ID':
				return `${pkPrefix}Código identificador do vendedor/representante comercial (conecta com erp_vendedores.representante_id).`;
			case 'REPRESENTANTE_NOME':
				return `${pkPrefix}Nome/apelido comercial do vendedor ou representante de vendas.`;
			case 'GERENTE_ID':
				return `${pkPrefix}Código identificador do gerente comercial responsável pela equipe do vendedor.`;
			case 'GERENTE_NOME':
				return `${pkPrefix}Nome/apelido do gerente comercial responsável pelo vendedor.`;
			case 'COD_PRODUTO':
				return `${pkPrefix}Código identificador único do produto/mercadoria no ERP (conecta com erp_produtos.cod_produto).`;
			case 'DESCRICAO_PRODUTO':
				return `${pkPrefix}Nome comercial / descrição completa do produto ou mercadoria.`;
			case 'GRUPO_DE_PRODUTOS':
			case 'DESCRICAO_GRUPO':
				return `${pkPrefix}Nome do grupo principal / família mercadológica do produto.`;
			case 'COD_GRUPO':
				return `${pkPrefix}Código numérico do grupo principal de produtos.`;
			case 'DESCRICAO_SUBGRUPO':
				return `${pkPrefix}Nome do subgrupo / categoria específica do produto.`;
			case 'COD_SUBGRUPO':
				return `${pkPrefix}Código numérico do subgrupo de produtos.`;
			case 'QUANTIDADE':
			case 'QTD':
				return `${pkPrefix}Quantidade física de unidades/itens comercializados na nota fiscal. Para somar volume de itens, use SUM(CAST(quantidade AS NUMERIC)).`;
			case 'PESO':
				return `${pkPrefix}Peso total (em kg) dos produtos comercializados no item da nota fiscal. Para somar peso, use SUM(CAST(peso AS NUMERIC)).`;
			case 'STATUS':
				return `${pkPrefix}Indicador de cadastro ativo no ERP ('1' = Ativo, '0' = Inativo).`;
			case 'TIPO_PESSOA':
				return `${pkPrefix}Personalidade jurídica do cliente ('J' = Pessoa Jurídica / CNPJ, 'F' = Pessoa Física / CPF).`;
			case 'RAMO_DE_ATIVIDADE':
				return `${pkPrefix}Segmento / ramo de atuação comercial do cliente (ex: Supermercado, Atacado, Padaria, Distribuidor).`;
			case 'CLASSIFICACAO':
				return `${pkPrefix}Classificação comercial / perfil do cliente no ERP.`;
			case 'REDE':
				return `${pkPrefix}Nome da rede associativa ou grupo econômico ao qual o cliente pertence (ou 'SEM-REDE').`;
			case 'BAIRRO':
				return `${pkPrefix}Bairro do endereço de entrega do cliente.`;
			case 'CIDADE':
				return `${pkPrefix}Município/Cidade do endereço de entrega do cliente.`;
			case 'UF':
				return `${pkPrefix}Sigla do Estado (Unidade Federativa, ex: 'MG', 'SP', 'RJ') do cliente.`;
			case 'EMPRESA':
				return `${pkPrefix}Código da filial/empresa emitente no ERP.`;
			case 'ID':
				return `Chave Primária composta identificadora única do registro na integração ${context}.`;
			default:
				break;
		}

		if (isPk) {
			return `Chave Primária identificadora (${field}) da tabela ${context}.`;
		}
		if (upper.includes('DATA') || upper.startsWith('DT_')) {
			return `Data e hora gravada como texto no formato ISO 'YYYY-MM-DD HH24:MI:SS'. Use OBRIGATORIAMENTE CAST(${field} AS TIMESTAMP) ou CAST(${field} AS DATE).`;
		}
		if (upper.startsWith('VALOR_') || upper.startsWith('VLR_')) {
			return `Valor monetário em R$ da integração ${context}. Para somas e cálculos matemáticos, use CAST(${field} AS NUMERIC).`;
		}
		if (upper.includes('QTD') || upper.includes('QUANTIDADE') || upper.includes('PESO')) {
			return `Medida numérica de quantidade/volume da integração ${context}. Para somas, use CAST(${field} AS NUMERIC).`;
		}
		return `Atributo de negócio ${field} da integração ${context}.`;
	}

	public extractColumnsFromQuery(
		query: string,
		context: string = 'ERP',
		primaryKey?: string,
	): Array<{ columnName: string; description: string }> {
		const aliases = extractSqlSelectAliases(query);
		const pk = primaryKey?.trim() || aliases[0] || null;
		return aliases.map((col) => ({
			columnName: col,
			description: this.generateColumnDescription(col, pk, context),
		}));
	}

	/**
	 * Faz profiling leve no PostgreSQL para obter até 10 valores distintos reais de uma coluna categórica
	 */
	private async getSampleDistinctValues(tableName: string, columnName: string): Promise<string[]> {
		const safeTable = this.tableManager.generateTableName(tableName);
		const safeCol = this.tableManager.sanitizeColumnName(columnName);

		if (!CATEGORICAL_CANDIDATE_REGEX.test(safeCol)) {
			return [];
		}

		try {
			const rows = await this.prisma.$queryRawUnsafe<Array<{ val: string | null }>>(`
				SELECT DISTINCT "${safeCol}"::text AS val
				FROM "${safeTable}"
				WHERE "${safeCol}" IS NOT NULL AND TRIM("${safeCol}"::text) <> ''
				ORDER BY val ASC
				LIMIT 10;
			`);
			return rows.map((r) => String(r.val ?? '').trim()).filter(Boolean);
		} catch {
			return [];
		}
	}

	private async getTableRowCount(tableName: string): Promise<number> {
		const safeTable = this.tableManager.generateTableName(tableName);
		try {
			const rows = await this.prisma.$queryRawUnsafe<Array<{ cnt: number | bigint | string }>>(`
				SELECT COUNT(*)::int AS cnt FROM "${safeTable}";
			`);
			return Number(rows?.[0]?.cnt ?? 0);
		} catch {
			return 0;
		}
	}

	/**
	 * Retorna a visão completa do Esquema do Banco PostgreSQL + Dicionário de Dados + Relacionamentos (PKs e FKs)
	 */
	async getSchemaOverview(): Promise<SchemaOverviewResponse> {
		const erpConfigs = await this.prisma.erpConfiguration.findMany({
			orderBy: { createdAt: 'asc' },
		});

		// Garante que todas as tabelas de erp_configurations estejam registradas no dicionário de dados com descrições semânticas ricas
		let allMetaTables = await metaTableRepository.findAllByTenant('default');
		const metaMap = new Map(allMetaTables.map((t) => [t.tableName.toLowerCase(), t]));

		let needsAutoDetect = false;
		for (const cfg of erpConfigs) {
			const tName = cfg.tableName.toLowerCase();
			const existingMeta = metaMap.get(tName);
			const effectiveFields = mergeExpectedFieldsWithQueryAliases(cfg.query, cfg.expectedFields);
			const pk = cfg.primaryKey?.trim() || effectiveFields[0] || 'ID';

			const hasMissingCols = !existingMeta || existingMeta.columns.length < effectiveFields.length;
			const hasGenericCols =
				existingMeta?.columns.some((c) => isGenericColumnDescription(c.description)) ?? false;

			if (hasMissingCols || hasGenericCols) {
				const columnsPayload = [];
				for (const field of effectiveFields) {
					const existingCol = existingMeta?.findColumn(field);
					let desc =
						existingCol && !isGenericColumnDescription(existingCol.description)
							? existingCol.description
							: this.generateColumnDescription(field, pk, cfg.context);

					// Auto-Profiler: anexa valores reais do banco para colunas categóricas se ainda não constarem
					const samples = await this.getSampleDistinctValues(cfg.tableName, field);
					if (samples.length > 0 && samples.length <= 10 && !desc.includes('Valores')) {
						desc = `${desc} (Valores reais no banco: ${samples.map((s) => `'${s}'`).join(', ')})`;
					}

					columnsPayload.push({
						columnName: field.toUpperCase(),
						dataType: existingCol?.dataType ?? 'TEXT',
						description: desc,
						isPrimaryKey: field.toUpperCase() === pk.toUpperCase(),
						foreignKeyToTable: existingCol?.foreignKeyToTable,
						foreignKeyToColumn: existingCol?.foreignKeyToColumn,
					});
				}

				const saved = await saveTableMetadataUseCase.execute({
					tenantId: 'default',
					tableName: cfg.tableName,
					description:
						cfg.description?.trim() ||
						existingMeta?.description ||
						`Tabela sincronizada do ERP para o contexto ${cfg.context}`,
					columns: columnsPayload,
				});
				metaMap.set(tName, saved);
				needsAutoDetect = true;
			}
		}

		if (needsAutoDetect) {
			await autoDetectRelationshipsUseCase.execute('default');
			allMetaTables = await metaTableRepository.findAllByTenant('default');
		}

		const configByTable = new Map(erpConfigs.map((c) => [c.tableName.toLowerCase(), c]));
		const tablesOverview: SchemaTableOverview[] = [];
		const relationships: SchemaRelationshipLink[] = [];

		for (const meta of allMetaTables) {
			const cfg = configByTable.get(meta.tableName.toLowerCase());
			const rowCount = await this.getTableRowCount(meta.tableName);
			const pkCol = meta.getPrimaryKeyColumn();

			const columnsOverview: SchemaColumnOverview[] = [];
			for (const col of meta.columns) {
				const sampleValues = await this.getSampleDistinctValues(meta.tableName, col.columnName);
				columnsOverview.push({
					columnName: col.columnName.toUpperCase(),
					dataType: col.dataType,
					description: col.description,
					isPrimaryKey: col.isPrimaryKey,
					foreignKeyToTable: col.foreignKeyToTable ?? null,
					foreignKeyToColumn: col.foreignKeyToColumn ? col.foreignKeyToColumn.toUpperCase() : null,
					isGenericDescription: isGenericColumnDescription(col.description),
					sampleValues,
				});

				if (col.foreignKeyToTable && col.foreignKeyToColumn) {
					relationships.push({
						fromTable: meta.tableName.toLowerCase(),
						fromColumn: col.columnName.toUpperCase(),
						toTable: col.foreignKeyToTable.toLowerCase(),
						toColumn: col.foreignKeyToColumn.toUpperCase(),
					});
				}
			}

			tablesOverview.push({
				id: meta.id ?? meta.tableName,
				erpConfigId: cfg?.id ?? null,
				tableName: meta.tableName.toLowerCase(),
				context: cfg?.context ?? meta.tableName.replace(/^erp_/i, '').toUpperCase(),
				description: meta.description,
				primaryKey: pkCol ? pkCol.columnName.toUpperCase() : (cfg?.primaryKey ?? null),
				rowCount,
				lastSyncAt: cfg?.lastSyncAt ?? null,
				lastSyncStatus: cfg?.lastSyncStatus ?? null,
				columns: columnsOverview,
			});
		}

		return {
			tables: tablesOverview,
			relationships,
		};
	}

	/**
	 * Salva alterações de descrição da tabela, descrições das colunas, PK e FKs feitas no Visualizador de Esquema
	 */
	async updateTableSchema(tableName: string, input: UpdateTableSchemaInput): Promise<SchemaTableOverview> {
		const cleanTableName = tableName.trim().toLowerCase();
		const cleanDesc = input.description?.trim();
		if (!cleanDesc) {
			throw new Error(`A descrição da tabela "${cleanTableName}" é obrigatória.`);
		}

		if (!Array.isArray(input.columns) || input.columns.length === 0) {
			throw new Error(`A tabela "${cleanTableName}" deve possuir ao menos uma coluna.`);
		}

		for (const col of input.columns) {
			if (!col.columnName || !col.columnName.trim()) {
				throw new Error('Todas as colunas devem possuir um nome válido.');
			}
			if (!col.description || !col.description.trim()) {
				throw new Error(`A descrição da coluna "${col.columnName}" é obrigatória para o Dicionário de Dados da IA.`);
			}
		}

		const savedMeta = await saveTableMetadataUseCase.execute({
			tenantId: 'default',
			tableName: cleanTableName,
			description: cleanDesc,
			columns: input.columns.map((c) => ({
				columnName: c.columnName.trim().toUpperCase(),
				dataType: 'TEXT',
				description: c.description.trim(),
				isPrimaryKey: Boolean(c.isPrimaryKey),
				foreignKeyToTable: c.foreignKeyToTable ? c.foreignKeyToTable.trim().toLowerCase() : null,
				foreignKeyToColumn: c.foreignKeyToColumn ? c.foreignKeyToColumn.trim().toUpperCase() : null,
			})),
		});

		const pkCol = savedMeta.getPrimaryKeyColumn();
		const erpConfig = await this.prisma.erpConfiguration.findFirst({
			where: { tableName: cleanTableName },
		});

		if (erpConfig) {
			await this.prisma.erpConfiguration.update({
				where: { id: erpConfig.id },
				data: {
					description: cleanDesc,
					...(pkCol ? { primaryKey: pkCol.columnName.toUpperCase() } : {}),
				},
			});
		}

		const rowCount = await this.getTableRowCount(cleanTableName);
		const columnsOverview: SchemaColumnOverview[] = [];
		for (const col of savedMeta.columns) {
			const sampleValues = await this.getSampleDistinctValues(cleanTableName, col.columnName);
			columnsOverview.push({
				columnName: col.columnName.toUpperCase(),
				dataType: col.dataType,
				description: col.description,
				isPrimaryKey: col.isPrimaryKey,
				foreignKeyToTable: col.foreignKeyToTable ?? null,
				foreignKeyToColumn: col.foreignKeyToColumn ? col.foreignKeyToColumn.toUpperCase() : null,
				isGenericDescription: isGenericColumnDescription(col.description),
				sampleValues,
			});
		}

		return {
			id: savedMeta.id ?? cleanTableName,
			erpConfigId: erpConfig?.id ?? null,
			tableName: cleanTableName,
			context: erpConfig?.context ?? cleanTableName.replace(/^erp_/i, '').toUpperCase(),
			description: savedMeta.description,
			primaryKey: pkCol ? pkCol.columnName.toUpperCase() : null,
			rowCount,
			lastSyncAt: erpConfig?.lastSyncAt ?? null,
			lastSyncStatus: erpConfig?.lastSyncStatus ?? null,
			columns: columnsOverview,
		};
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
		const existing = await this.getById(id);
		if (existing) {
			const effectiveFields = mergeExpectedFieldsWithQueryAliases(existing.query, existing.expectedFields);
			if (effectiveFields.length > existing.expectedFields.length) {
				await this.prisma.erpConfiguration.update({
					where: { id },
					data: { expectedFields: effectiveFields },
				});
			}
			if (existing.primaryKey) {
				try {
					const existingMeta = await metaTableRepository.findByTenantAndTableName('default', existing.tableName);
					await saveTableMetadataUseCase.execute({
						tenantId: 'default',
						tableName: existing.tableName,
						description: existing.description || `Tabela dinâmica para o contexto ${existing.context}`,
						columns: effectiveFields.map((field) => {
							const prevCol = existingMeta?.findColumn(field);
							const desc =
								prevCol && !isGenericColumnDescription(prevCol.description)
									? prevCol.description
									: this.generateColumnDescription(field, existing.primaryKey, existing.context);
							return {
								columnName: field,
								dataType: 'TEXT',
								description: desc,
								isPrimaryKey: field.toUpperCase() === existing.primaryKey!.toUpperCase(),
							};
						}),
					});
					await autoDetectRelationshipsUseCase.execute('default');
				} catch (err) {
					console.warn('[ErpConfigurationService] Aviso ao sincronizar dicionário de dados em syncNow:', err);
				}
			}
		}
		return this.scheduler.syncNow(id);
	}
}

export const erpConfigurationService = new ErpConfigurationService();
export default erpConfigurationService;
