import crypto from 'node:crypto';
import { PrismaClient, ErpConfiguration } from '@prisma/client';
import prismaClient from '../config/prisma';
import SankhyaService, { SankhyaRow } from './sankhya.service';

export interface ISankhyaGateway {
	executeQuery(query: string, expectedFields: string[]): Promise<Array<Record<string, any>>>;
}

export interface SyncBatchResult {
	upserted: number;
	deleted: number;
	skipped?: number;
}

export interface SyncExecutionResult {
	strategy: 'FULL' | 'HASH_COMPARATOR' | 'INCREMENTAL';
	totalProcessed: number;
	totalUpserted: number;
	totalDeleted: number;
	totalSkipped?: number;
	batchesCount: number;
	finalCursor?: string | null;
	durationMs: number;
}

export interface IDynamicTableManager {
	generateTableName(context: string): string;
	sanitizeColumnName(fieldName: string): string;
	createTable(tableName: string, expectedFields: string[], primaryKey?: string | null): Promise<void>;
	syncColumns(tableName: string, expectedFields: string[], primaryKey?: string | null): Promise<void>;
	dropTable(tableName: string): Promise<void>;
	insertRows(tableName: string, rows: Record<string, unknown>[]): Promise<number>;
	replaceRows(tableName: string, rows: Record<string, unknown>[]): Promise<number>;
	syncTable(config: ErpConfiguration): Promise<SyncExecutionResult>;
	hashComparatorSync(config: ErpConfiguration): Promise<SyncExecutionResult>;
	incrementalSync(config: ErpConfiguration): Promise<SyncExecutionResult>;
	fullSync(config: ErpConfiguration): Promise<SyncExecutionResult>;
	processBatch(config: ErpConfiguration, rows: Record<string, unknown>[]): Promise<SyncBatchResult>;
	upsertBatch(tableName: string, primaryKey: string, rows: Record<string, unknown>[]): Promise<number>;
	deleteBatch(tableName: string, primaryKey: string, ids: (string | number)[]): Promise<number>;
	generateRowHash(row: Record<string, any>): string;
}

export class DynamicTableManager implements IDynamicTableManager {
	private readonly prisma: PrismaClient;
	private readonly sankhyaGateway: ISankhyaGateway;

	constructor(
		prisma: PrismaClient = prismaClient,
		sankhyaGateway: ISankhyaGateway = new SankhyaService(),
	) {
		this.prisma = prisma;
		this.sankhyaGateway = sankhyaGateway;
	}

	/**
	 * Normaliza valores de forma canônica para o cálculo de Hash determinístico,
	 * prevenindo falsos positivos de sincronização entre os tipos do Sankhya (Oracle/SQL) e PostgreSQL:
	 * - `null` e `undefined` -> representação canônica idêntica (`null`)
	 * - `Date` -> ISO-8601 string
	 * - `number` -> representação numérica sem zeros decimais supérfluos (ex: 10.0 -> "10")
	 * - `string` -> quebras de linha normalizadas (\r\n -> \n), .trim() aplicado e números decimais equivalentes normalizados sem afetar códigos com zero à esquerda.
	 */
	private normalizeValueForHash(val: unknown): string | null {
		if (val === null || val === undefined) {
			return null;
		}

		if (val instanceof Date) {
			return Number.isNaN(val.getTime()) ? null : val.toISOString();
		}

		if (typeof val === 'number') {
			if (!Number.isFinite(val)) return null;
			return Object.is(val, -0) ? '0' : String(val);
		}

		if (typeof val === 'boolean') {
			return val ? 'true' : 'false';
		}

		if (typeof val === 'string') {
			const normalizedStr = val.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
			if (normalizedStr === '') {
				return null;
			}

			// Normaliza strings numéricas decimais equivalentes (ex: "10.0" -> "10", "10.50" -> "10.5")
			// preservando códigos com zeros à esquerda (ex: "00123") e números longos (ex: CNPJ/chaves > 15 dígitos)
			if (
				normalizedStr.length <= 15 &&
				/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalizedStr)
			) {
				const parsed = Number(normalizedStr);
				if (Number.isFinite(parsed)) {
					return Object.is(parsed, -0) ? '0' : String(parsed);
				}
			}

			return normalizedStr;
		}

		return String(val).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
	}

	/**
	 * Gera Hash MD5 100% determinístico e invariante à ordem das propriedades do objeto.
	 * As chaves são normalizadas e ordenadas alfabeticamente (comparação lexicográfica determinística).
	 * Campos de metadados técnicos internos (_id, _row_hash, row_hash, _synced_at, synced_at, created_at, _updated_at, updated_at) são excluídos.
	 */
	generateRowHash(row: Record<string, any>): string {
		if (!row || typeof row !== 'object') return '';

		const technicalFields = new Set([
			'_id',
			'_row_hash',
			'row_hash',
			'_synced_at',
			'synced_at',
			'created_at',
			'_updated_at',
			'updated_at',
		]);

		const normalizedEntries = new Map<string, string | null>();

		for (const rawKey of Object.keys(row)) {
			const cleanKey = rawKey.trim().toLowerCase();
			if (!cleanKey || technicalFields.has(cleanKey)) {
				continue;
			}
			normalizedEntries.set(cleanKey, this.normalizeValueForHash(row[rawKey]));
		}

		const sortedKeys = Array.from(normalizedEntries.keys()).sort((a, b) =>
			a < b ? -1 : a > b ? 1 : 0,
		);

		const canonicalPayload = sortedKeys.map((k) => [k, normalizedEntries.get(k) ?? null]);
		normalizedEntries.clear();

		return crypto
			.createHash('md5')
			.update(JSON.stringify(canonicalPayload), 'utf8')
			.digest('hex');
	}

	/**
	 * Ponto de entrada principal de sincronização da tabela dinâmica.
	 * Roteia para HASH_COMPARATOR (Incremental Inteligente) ou FULL (Carga Completa Paginada).
	 */
	async syncTable(config: ErpConfiguration): Promise<SyncExecutionResult> {
		const strategy = (config.syncStrategy ?? 'FULL').toUpperCase();

		if (strategy === 'HASH_COMPARATOR' || strategy === 'INCREMENTAL') {
			return this.hashComparatorSync(config);
		}

		return this.fullSync(config);
	}

	/**
	 * Alias de compatibilidade com implementações anteriores que chamavam incrementalSync.
	 */
	async incrementalSync(config: ErpConfiguration): Promise<SyncExecutionResult> {
		return this.hashComparatorSync(config);
	}

	/**
	 * Sincronização Incremental Inteligente por Hash Comparator:
	 * 1. Busca lotes do Sankhya com paginação (limitando por batchSize).
	 * 2. Calcula o Hash MD5 determinístico de cada linha recebida.
	 * 3. Trata inativações (Soft Delete tornando-se Hard Delete no Postgres).
	 * 4. Consulta os Hashes atuais no PostgreSQL via SELECT ... WHERE pk IN (...).
	 * 5. Se o Hash for idêntico ao do banco, a linha é descartada da memória (economiza I/O).
	 * 6. Se for novo ou alterado, é inserido/atualizado em sub-lotes de 500 linhas.
	 * 7. Libera arrays e mapas explicitamente para o Garbage Collector do V8 Heap.
	 */
	async hashComparatorSync(config: ErpConfiguration): Promise<SyncExecutionResult> {
		const startTime = Date.now();

		if (!config.primaryKey || !config.primaryKey.trim()) {
			throw new Error(
				`A sincronização HASH_COMPARATOR para a tabela "${config.tableName}" requer a definição obrigatória de uma Chave Primária (PK).`,
			);
		}

		const batchSize = Math.max(1, config.batchSize ?? 1000);
		let currentCursor = config.lastSyncCursor?.trim() || '0';
		let offset = 0;
		let hasMoreData = true;
		let batchIndex = 0;
		let totalProcessed = 0;
		let totalUpserted = 0;
		let totalDeleted = 0;
		let totalSkipped = 0;

		const safeTableName = this.generateTableName(config.tableName);
		const sanitizedPk = this.sanitizeColumnName(config.primaryKey);

		// 1. Assegura a existência da tabela, coluna _row_hash e índice único da PK no PostgreSQL
		await this.syncColumns(safeTableName, config.expectedFields, config.primaryKey);

		// Detecta se a query do usuário utiliza as macros {{LAST_CURSOR}} ou {{LAST_SYNC_DATE}}
		const hasCursorMacro = /\{\{\s*LAST_CURSOR\s*\}\}/i.test(config.query);
		const hasDateMacro = /\{\{\s*LAST_SYNC_DATE\s*\}\}/i.test(config.query);

		console.info(`[DynamicTableManager] Iniciando sincronização HASH_COMPARATOR para "${config.tableName}"`);
		console.info(
			`[DynamicTableManager] [Config] BatchSize: ${batchSize} | Modo: ${hasCursorMacro ? `Cursor Incremental (Inicial: "${currentCursor}")` : 'Offset ROWNUM Paginado'} | PK: "${config.primaryKey}"`,
		);

		// Conjunto para rastrear todas as PKs retornadas pela query do ERP nesta execução (para reconciliação de deleção)
		const seenPksInSync = new Set<string>();

		while (hasMoreData) {
			batchIndex += 1;

			// 2. Monta a query paginada conforme a estratégia
			const lastSyncDateStr = this.formatLastSyncDate(config.lastSyncAt);
			let pagedQuery: string;

			if (hasCursorMacro) {
				const queryWithMacros = config.query
					.replace(/\{\{\s*LAST_CURSOR\s*\}\}/gi, currentCursor)
					.replace(/\{\{\s*LAST_SYNC_DATE\s*\}\}/gi, lastSyncDateStr);
				pagedQuery = this.wrapQueryWithPagination(queryWithMacros, batchSize);

				console.info(
					`[DynamicTableManager] [Lote #${batchIndex}] Solicitando até ${batchSize} registros ao ERP (Cursor atual: ${currentCursor})...`,
				);
			} else {
				const queryWithMacros = config.query
					.replace(/\{\{\s*LAST_SYNC_DATE\s*\}\}/gi, lastSyncDateStr);
				pagedQuery = this.wrapQueryWithOffsetPagination(queryWithMacros, offset, batchSize);

				console.info(
					`[DynamicTableManager] [Lote #${batchIndex}] Solicitando até ${batchSize} registros ao ERP (Offset: ${offset})...`,
				);
			}

			// 3. Executa consulta no Sankhya
			const rows = await this.sankhyaGateway.executeQuery(pagedQuery, config.expectedFields);
			const rowCount = rows?.length ?? 0;

			if (rowCount === 0) {
				console.info(
					`[DynamicTableManager] [Lote #${batchIndex}] Nenhum registro retornado pelo ERP. Fim da extração.`,
				);
				hasMoreData = false;
				break;
			}

			totalProcessed += rowCount;
			const sampleRow = rows[0];
			const pkKey = this.findMatchingFieldKey(sampleRow, config.primaryKey);
			if (!pkKey) {
				throw new Error(`Coluna PK "${config.primaryKey}" não encontrada no retorno da integração.`);
			}

			// 4. Extrai apenas as PKs válidas do lote atual sem criar objetos wrapper intermediários pesados
			const batchPks: string[] = [];
			for (const row of rows) {
				const pkVal = row[pkKey];
				if (pkVal === undefined || pkVal === null || pkVal === '') continue;

				const pkStr = String(pkVal).trim();
				seenPksInSync.add(pkStr);
				batchPks.push(pkStr);
			}

			// 5. Consulta os Hashes persistidos no PostgreSQL para as PKs deste lote (armazena apenas strings leves pk -> hash)
			const dbHashMap = new Map<string, string>();
			if (batchPks.length > 0) {
				const PK_CHUNK = 500;
				for (let i = 0; i < batchPks.length; i += PK_CHUNK) {
					const pkChunk = batchPks.slice(i, i + PK_CHUNK);
					const escapedPks = pkChunk.map((pk) => this.escapeSqlLiteral(pk)).join(', ');
					pkChunk.length = 0;

					const existingRecords = await this.prisma.$queryRawUnsafe<Array<{ pk: string; _row_hash: string | null }>>(`
						SELECT "${sanitizedPk}"::text AS "pk", "_row_hash"
						FROM "${safeTableName}"
						WHERE "${sanitizedPk}"::text IN (${escapedPks});
					`);

					for (const rec of existingRecords) {
						if (rec.pk && rec._row_hash) {
							dbHashMap.set(String(rec.pk).trim(), rec._row_hash.trim());
						}
					}
					existingRecords.length = 0;
				}
			}
			batchPks.length = 0;

			// 6. Calcula Hashes e compara linha a linha em passagem única, retendo apenas linhas alteradas/novas
			const rowsToUpsert: Record<string, unknown>[] = [];
			let skippedInBatch = 0;

			for (const row of rows) {
				const pkVal = row[pkKey];
				if (pkVal === undefined || pkVal === null || pkVal === '') continue;

				const pkStr = String(pkVal).trim();
				const computedHash = this.generateRowHash(row);
				const existingHash = dbHashMap.get(pkStr);

				if (!existingHash || existingHash !== computedHash) {
					row._row_hash = computedHash;
					rowsToUpsert.push(row);
				} else {
					totalSkipped += 1;
					skippedInBatch += 1;
				}
			}

			// Libera imediatamente o Map de hashes do lote antes do I/O de escrita
			dbHashMap.clear();

			// 7. Captura a última PK para avanço de cursor antes de esvaziar referências do lote
			let cursorAdvanced = false;
			if (hasCursorMacro) {
				const lastRow = rows[rowCount - 1];
				const lastPkValue = lastRow?.[pkKey];
				if (lastPkValue !== undefined && lastPkValue !== null) {
					const nextCursor = String(lastPkValue).trim();
					if (nextCursor !== currentCursor) {
						currentCursor = nextCursor;
						cursorAdvanced = true;
					}
				}
			} else {
				offset += rowCount;
			}

			// Libera referências das linhas inalteradas do lote bruto antes do upsert
			const upsertsInBatchCount = rowsToUpsert.length;
			rows.length = 0;

			// 8. Grava alterações em sub-lotes de 500 registros
			if (upsertsInBatchCount > 0) {
				const upsertedCount = await this.upsertBatch(safeTableName, config.primaryKey, rowsToUpsert);
				totalUpserted += upsertedCount;
			}

			// 9. Desaloca memória explicitamente para manter V8 Heap estável
			rowsToUpsert.length = 0;

			console.info(
				`[DynamicTableManager] [Lote #${batchIndex}] Processado: ${rowCount} rows (${upsertsInBatchCount} upserts, ${skippedInBatch} inalteradas descartadas). ${hasCursorMacro ? `Cursor: "${currentCursor}"` : `Offset: ${offset}`}`,
			);

			// 10. Proteção contra Loop Infinito: se estiver usando macro de cursor e o cursor não avançar
			if (hasCursorMacro && !cursorAdvanced && rowCount >= batchSize) {
				console.warn(
					`[DynamicTableManager] [AVISO] Cursor "${currentCursor}" não avançou no Lote #${batchIndex}. Encerrando extração para prevenir loop infinito.`,
				);
				hasMoreData = false;
				break;
			}

			// 11. Se o lote veio incompleto, finaliza o loop
			if (rowCount < batchSize) {
				console.info(`[DynamicTableManager] [Lote #${batchIndex}] Lote parcial recebido (${rowCount} < ${batchSize}). Fim dos dados.`);
				hasMoreData = false;
				break;
			}
		}

		// 12. Reconciliação de Exclusão:
		// Só executa se a query representou uma varredura do conjunto (sem filtro delta de data)
		if (!hasDateMacro && (totalProcessed > 0 || seenPksInSync.size > 0)) {
			const localPksRaw = await this.prisma.$queryRawUnsafe<Array<{ pk: string }>>(`
				SELECT "${sanitizedPk}"::text AS "pk" FROM "${safeTableName}";
			`);

			const pksToDelete: string[] = [];
			for (const rec of localPksRaw) {
				if (rec.pk !== null && rec.pk !== undefined) {
					const pk = String(rec.pk).trim();
					if (pk && !seenPksInSync.has(pk)) {
						pksToDelete.push(pk);
					}
				}
			}
			localPksRaw.length = 0;
			seenPksInSync.clear();

			if (pksToDelete.length > 0) {
				console.info(
					`[DynamicTableManager] [Reconciliação] ${pksToDelete.length} registro(s) ausentes no ERP serão removidos do PostgreSQL local...`,
				);
				const deletedCount = await this.deleteBatch(safeTableName, config.primaryKey, pksToDelete);
				totalDeleted += deletedCount;
			}

			pksToDelete.length = 0;
		} else {
			seenPksInSync.clear();
		}

		const durationMs = Date.now() - startTime;
		const summaryMessage = `Sincronização HASH_COMPARATOR concluída: ${totalProcessed} registros analisados em ${batchIndex} lote(s) (${totalUpserted} modificados/inseridos, ${totalSkipped} inalterados, ${totalDeleted} deletados) em ${durationMs}ms. ${hasCursorMacro ? `Cursor final: "${currentCursor}"` : `Offset final: ${offset}`}.`;

		// 13. Atualiza estado da integração no banco
		await this.prisma.erpConfiguration.update({
			where: { id: config.id },
			data: {
				lastSyncCursor: hasCursorMacro ? currentCursor : undefined,
				lastSyncAt: new Date(),
				lastSyncStatus: 'SUCCESS',
				lastSyncMessage: summaryMessage,
			},
		});

		console.info(`[DynamicTableManager] ${summaryMessage}`);

		return {
			strategy: 'HASH_COMPARATOR',
			totalProcessed,
			totalUpserted,
			totalDeleted,
			totalSkipped,
			batchesCount: batchIndex,
			finalCursor: currentCursor,
			durationMs,
		};
	}

	/**
	 * Sincronização Completa Paginada (FULL):
	 * 1. Trunca a tabela no Postgres (TRUNCATE TABLE).
	 * 2. Inicia loop de paginação buscando lotes do Sankhya.
	 * 3. Para cada lote, calcula o _row_hash de cada linha.
	 * 4. Faz inserção em massa em chunks de 500 linhas para não estourar memória.
	 * 5. Libera memória explicitamente em cada iteração.
	 */
	async fullSync(config: ErpConfiguration): Promise<SyncExecutionResult> {
		const startTime = Date.now();
		const safeTableName = this.generateTableName(config.tableName);
		const batchSize = Math.max(1, config.batchSize ?? 1000);

		console.info(`[DynamicTableManager] Iniciando sincronização COMPLETA PAGINADA (Full Load) para "${config.tableName}" (batchSize: ${batchSize})...`);

		// 1. Assegura a estrutura da tabela
		await this.syncColumns(safeTableName, config.expectedFields, config.primaryKey);

		// 2. Executa TRUNCATE TABLE no Postgres
		await this.prisma.$executeRawUnsafe(`TRUNCATE TABLE "${safeTableName}";`);
		console.info(`[DynamicTableManager] Tabela "${safeTableName}" truncada para recarga completa.`);

		let hasMoreData = true;
		let batchIndex = 0;
		let totalProcessed = 0;
		let totalUpserted = 0;
		let totalDeleted = 0;
		let currentCursor = '0';
		let offset = 0;

		const hasCursorMacro = /\{\{\s*LAST_CURSOR\s*\}\}/i.test(config.query);

		// 3. Loop de paginação
		while (hasMoreData) {
			batchIndex += 1;

			let pagedQuery: string;

			if (hasCursorMacro) {
				const queryWithMacros = config.query
					.replace(/\{\{\s*LAST_CURSOR\s*\}\}/gi, currentCursor)
					.replace(/\{\{\s*LAST_SYNC_DATE\s*\}\}/gi, '1970-01-01 00:00:00');
				pagedQuery = this.wrapQueryWithPagination(queryWithMacros, batchSize);
			} else {
				pagedQuery = this.wrapQueryWithOffsetPagination(config.query, offset, batchSize);
			}

			console.info(`[DynamicTableManager] [FullSync Lote #${batchIndex}] Buscando até ${batchSize} registros (Offset: ${offset}, Cursor: ${currentCursor})...`);

			const rows = await this.sankhyaGateway.executeQuery(pagedQuery, config.expectedFields);
			const rowCount = rows?.length ?? 0;

			if (rowCount === 0) {
				console.info(`[DynamicTableManager] [FullSync Lote #${batchIndex}] Nenhum registro retornado. Fim da carga completa.`);
				hasMoreData = false;
				break;
			}

			totalProcessed += rowCount;
			const sampleRow = rows[0];

			// Mantém todos os registros retornados (mesmo inativos)
			for (const row of rows) {
				row._row_hash = this.generateRowHash(row);
			}

			// Insere em massa em chunks de 500 linhas para não estourar memória
			if (rows.length > 0) {
				const inserted = await this.insertRows(safeTableName, rows);
				totalUpserted += inserted;
			}

			// Atualiza cursor / offset
			if (hasCursorMacro && config.primaryKey) {
				const matchingPkKey = this.findMatchingFieldKey(sampleRow, config.primaryKey);
				if (matchingPkKey) {
					const lastRow = rows[rowCount - 1];
					const lastPk = lastRow[matchingPkKey];
					if (lastPk !== undefined && lastPk !== null) {
						currentCursor = String(lastPk).trim();
					}
				}
			}
			offset += rowCount;

			console.info(`[DynamicTableManager] [FullSync Lote #${batchIndex}] Inseridos ${rowCount} registros no PostgreSQL.`);

			// Libera memória explicitamente
			rows.length = 0;

			if (rowCount < batchSize) {
				console.info(`[DynamicTableManager] [FullSync Lote #${batchIndex}] Lote parcial recebido (${rowCount} < ${batchSize}). Fim da carga.`);
				hasMoreData = false;
			}
		}

		const durationMs = Date.now() - startTime;
		const summaryMessage = `Carga completa paginada finalizada: ${totalUpserted} de ${totalProcessed} registros sincronizados em ${batchIndex} lote(s) (${durationMs}ms).`;

		await this.prisma.erpConfiguration.update({
			where: { id: config.id },
			data: {
				lastSyncCursor: hasCursorMacro ? currentCursor : undefined,
				lastSyncAt: new Date(),
				lastSyncStatus: 'SUCCESS',
				lastSyncMessage: summaryMessage,
			},
		});

		console.info(`[DynamicTableManager] ${summaryMessage}`);

		return {
			strategy: 'FULL',
			totalProcessed,
			totalUpserted,
			totalDeleted,
			batchesCount: batchIndex,
			finalCursor: hasCursorMacro ? currentCursor : null,
			durationMs,
		};
	}

	/**
	 * Lógica de processamento de lote padrão:
	 * - Linhas com activeValue válido vão para Upsert.
	 * - Linhas inativadas no ERP vão para deleção imediata no Postgres.
	 */
	async processBatch(config: ErpConfiguration, rows: Record<string, unknown>[]): Promise<SyncBatchResult> {
		if (!rows || rows.length === 0) {
			return { upserted: 0, deleted: 0 };
		}

		const pk = config.primaryKey;
		if (!pk) {
			throw new Error(`Primary Key não configurada para a tabela "${config.tableName}".`);
		}

		const sampleRow = rows[0];
		const pkKey = this.findMatchingFieldKey(sampleRow, pk);
		if (!pkKey) {
			throw new Error(`Campo de Chave Primária "${pk}" não encontrado nos dados retornados da integração.`);
		}

		const rowsToUpsert: Record<string, unknown>[] = [];
		const idsToDelete: (string | number)[] = [];

		if (config.activeColumn && config.activeValue) {
			const activeKey = this.findMatchingFieldKey(sampleRow, config.activeColumn);
			const targetActive = String(config.activeValue).trim().toUpperCase();

			for (const row of rows) {
				const rowActiveValue = activeKey ? String(row[activeKey] ?? '').trim().toUpperCase() : targetActive;
				const pkValue = row[pkKey];

				if (rowActiveValue === targetActive) {
					row._row_hash = this.generateRowHash(row);
					rowsToUpsert.push(row);
				} else {
					if (pkValue !== undefined && pkValue !== null && pkValue !== '') {
						idsToDelete.push(pkValue as string | number);
					}
				}
			}
		} else {
			for (const row of rows) {
				row._row_hash = this.generateRowHash(row);
				rowsToUpsert.push(row);
			}
		}

		let upsertedCount = 0;
		if (rowsToUpsert.length > 0) {
			upsertedCount = await this.upsertBatch(config.tableName, pk, rowsToUpsert);
		}

		let deletedCount = 0;
		if (idsToDelete.length > 0) {
			deletedCount = await this.deleteBatch(config.tableName, pk, idsToDelete);
		}

		// Libera memória
		rowsToUpsert.length = 0;
		idsToDelete.length = 0;

		return {
			upserted: upsertedCount,
			deleted: deletedCount,
		};
	}

	/**
	 * Executa Upsert em massa nativo no PostgreSQL usando:
	 * INSERT INTO "tabela" (...) VALUES (...) ON CONFLICT ("primary_key") DO UPDATE SET ..., "_row_hash" = EXCLUDED."_row_hash", "_synced_at" = NOW()
	 * Processa em chunks de 500 registros para evitar estouro de memória e limite de parâmetros.
	 */
	/**
	 * Executa Upsert em massa nativo no PostgreSQL usando:
	 * INSERT INTO "tabela" (...) VALUES (...) ON CONFLICT ("primary_key") DO UPDATE SET ..., "_row_hash" = EXCLUDED."_row_hash", "_synced_at" = NOW()
	 * Processa em chunks de 500 registros para evitar estouro de memória e limite de parâmetros.
	 */
	async upsertBatch(tableName: string, primaryKey: string, rows: Record<string, unknown>[]): Promise<number> {
		if (!rows || rows.length === 0) return 0;

		const safeTableName = this.generateTableName(tableName);
		const sanitizedPk = this.sanitizeColumnName(primaryKey);
		const sampleRow = rows[0];
		const pkKey = this.findMatchingFieldKey(sampleRow, primaryKey) ?? primaryKey;

		// Separa colunas de negócio das colunas técnicas para evitar duplicação ou descompasso
		const technicalCols = new Set(['_id', '_row_hash', 'row_hash', '_synced_at', 'synced_at', 'created_at']);
		const businessFields = Object.keys(rows[0]).filter((f) => !technicalCols.has(f.toLowerCase()));
		const sanitizedBusinessFields = businessFields.map((f) => this.sanitizeColumnName(f));

		// Lista determinística de colunas no INSERT: [campos de negócio, _row_hash, _synced_at]
		const insertColumnsList = [
			...sanitizedBusinessFields.map((col) => `"${col}"`),
			'"_row_hash"',
			'"_synced_at"',
		].join(', ');

		// Cláusula DO UPDATE SET para todas as colunas de negócio exceto a chave primária
		const updateAssignments = sanitizedBusinessFields
			.filter((col) => col !== sanitizedPk && col !== '_id' && col !== 'created_at')
			.map((col) => `"${col}" = EXCLUDED."${col}"`);

		updateAssignments.push(`"_row_hash" = EXCLUDED."_row_hash"`);
		updateAssignments.push(`"_synced_at" = NOW()`);

		const updateClause = updateAssignments.join(',\n\t\t\t\t');

		const CHUNK_SIZE = 500;
		let totalUpserted = 0;

		for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
			const rawChunk = rows.slice(i, i + CHUNK_SIZE);

			// Deduplica linhas pelo valor da chave primária dentro do chunk para evitar o erro PostgreSQL 21000:
			// "ON CONFLICT DO UPDATE command cannot affect row a second time"
			const deduplicatedMap = new Map<string, Record<string, unknown>>();
			for (const r of rawChunk) {
				const pkVal = String(r[pkKey] ?? '').trim();
				if (pkVal) {
					deduplicatedMap.set(pkVal, r);
				}
			}
			const chunk = Array.from(deduplicatedMap.values());
			deduplicatedMap.clear();

			if (chunk.length === 0) continue;

			const valuesLines = chunk.map((row) => {
				const values = businessFields.map((f) => this.escapeSqlLiteral(row[f]));
				const rowHash = this.escapeSqlLiteral(row._row_hash ?? this.generateRowHash(row));
				values.push(rowHash);
				values.push('NOW()');
				return `(${values.join(', ')})`;
			});

			const sql = `
				INSERT INTO "${safeTableName}" (${insertColumnsList})
				VALUES
				${valuesLines.join(',\n\t\t\t\t')}
				ON CONFLICT ("${sanitizedPk}") DO UPDATE SET
				${updateClause};
			`;

			await this.prisma.$executeRawUnsafe(sql);
			totalUpserted += chunk.length;
			chunk.length = 0;
			rawChunk.length = 0;
		}

		return totalUpserted;
	}

	/**
	 * Executa remoção em massa (Hard Delete) para IDs de registros inativados no ERP.
	 */
	async deleteBatch(tableName: string, primaryKey: string, ids: (string | number)[]): Promise<number> {
		if (!ids || ids.length === 0) return 0;

		const safeTableName = this.generateTableName(tableName);
		const sanitizedPk = this.sanitizeColumnName(primaryKey);

		const CHUNK_SIZE = 500;
		let totalDeleted = 0;

		for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
			const chunk = ids.slice(i, i + CHUNK_SIZE);
			const escapedIds = chunk.map((id) => this.escapeSqlLiteral(id)).join(', ');

			const sql = `
				DELETE FROM "${safeTableName}"
				WHERE "${sanitizedPk}"::text IN (${escapedIds});
			`;

			await this.prisma.$executeRawUnsafe(sql);
			totalDeleted += chunk.length;
			chunk.length = 0;
		}

		return totalDeleted;
	}

	/**
	 * Gera nome de tabela seguro e normalizado (ex: "Pedidos" -> "erp_pedidos").
	 */
	generateTableName(context: string): string {
		const normalized = context
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '');

		const base = normalized || 'integracao';
		const safeName = base.startsWith('erp_') ? base : `erp_${base}`;
		return safeName.slice(0, 63);
	}

	/**
	 * Sanitiza nomes de colunas para identificadores seguros no PostgreSQL.
	 */
	sanitizeColumnName(fieldName: string): string {
		const trimmed = (fieldName || '').trim();
		if (trimmed.toLowerCase() === '_row_hash') return '_row_hash';
		if (trimmed.toLowerCase() === '_synced_at') return '_synced_at';

		const sanitized = trimmed
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9_]+/g, '_')
			.replace(/^_+|_+$/g, '');

		return sanitized || 'col';
	}

	/**
	 * Cria dinamicamente a tabela no banco PostgreSQL.
	 * Adiciona as colunas técnicas padronizadas: "_row_hash" TEXT e "_synced_at" TIMESTAMPTZ.
	 */
	async createTable(tableName: string, expectedFields: string[], primaryKey?: string | null): Promise<void> {
		const safeTableName = this.generateTableName(tableName);
		const sanitizedColumns = this.getUniqueSanitizedColumns(expectedFields);

		const columnsDdl = sanitizedColumns
			.map((col) => `"${col}" TEXT`)
			.join(',\n\t\t\t\t');

		const ddl = `
			CREATE TABLE IF NOT EXISTS "${safeTableName}" (
				"_id" BIGSERIAL PRIMARY KEY,
				${columnsDdl ? `${columnsDdl},` : ''}
				"_row_hash" TEXT,
				"_synced_at" TIMESTAMPTZ DEFAULT NOW(),
				"created_at" TIMESTAMPTZ DEFAULT NOW()
			);
		`;

		await this.prisma.$executeRawUnsafe(ddl);

		// Índice único na Primary Key para ON CONFLICT
		if (primaryKey && primaryKey.trim()) {
			const sanitizedPk = this.sanitizeColumnName(primaryKey);
			const idxName = `${safeTableName}_${sanitizedPk}_uidx`.slice(0, 63);

			await this.prisma.$executeRawUnsafe(`
				CREATE UNIQUE INDEX IF NOT EXISTS "${idxName}" 
				ON "${safeTableName}" ("${sanitizedPk}");
			`);
		}
	}

	/**
	 * Sincroniza colunas da tabela dinâmica adicionando colunas faltantes e garantindo "_row_hash" e "_synced_at".
	 */
	async syncColumns(tableName: string, expectedFields: string[], primaryKey?: string | null): Promise<void> {
		const safeTableName = this.generateTableName(tableName);

		// 1. Assegura que a tabela exista
		await this.createTable(safeTableName, expectedFields, primaryKey);

		// 2. Obtém colunas já existentes na tabela
		const existingColumnsRaw = await this.prisma.$queryRawUnsafe<Array<{ column_name: string; data_type: string }>>(`
			SELECT column_name, data_type 
			FROM information_schema.columns 
			WHERE table_name = '${safeTableName}' AND table_schema = 'public';
		`);

		const existingColumns = new Set(existingColumnsRaw.map((row) => row.column_name.toLowerCase()));
		const sanitizedColumns = this.getUniqueSanitizedColumns(expectedFields);

		// Se a tabela legada possuía "id" como BIGSERIAL e agora "id" é uma coluna de negócio do ERP
		if (existingColumns.has('id') && sanitizedColumns.includes('id')) {
			const idCol = existingColumnsRaw.find((r) => r.column_name.toLowerCase() === 'id');
			if (idCol && idCol.data_type !== 'text') {
				await this.prisma.$executeRawUnsafe(`ALTER TABLE "${safeTableName}" ALTER COLUMN "id" TYPE TEXT USING "id"::text;`);
				await this.prisma.$executeRawUnsafe(`ALTER TABLE "${safeTableName}" ALTER COLUMN "id" DROP DEFAULT;`);
			}
		}

		// Assegura chave surrogate _id se ausente
		if (!existingColumns.has('_id')) {
			await this.prisma.$executeRawUnsafe(`ALTER TABLE "${safeTableName}" ADD COLUMN IF NOT EXISTS "_id" BIGSERIAL;`);
		}

		// 3. Adiciona cada coluna de negócio faltante
		for (const col of sanitizedColumns) {
			if (!existingColumns.has(col.toLowerCase())) {
				await this.prisma.$executeRawUnsafe(`
					ALTER TABLE "${safeTableName}" ADD COLUMN IF NOT EXISTS "${col}" TEXT;
				`);
			}
		}

		// 4. Assegura existência da coluna técnica _row_hash
		if (!existingColumns.has('_row_hash')) {
			await this.prisma.$executeRawUnsafe(`
				ALTER TABLE "${safeTableName}" ADD COLUMN IF NOT EXISTS "_row_hash" TEXT;
			`);
		}

		// 5. Assegura existência da coluna técnica _synced_at
		if (!existingColumns.has('_synced_at')) {
			await this.prisma.$executeRawUnsafe(`
				ALTER TABLE "${safeTableName}" ADD COLUMN IF NOT EXISTS "_synced_at" TIMESTAMPTZ DEFAULT NOW();
			`);
		}

		// 6. Assegura índice único na Primary Key para ON CONFLICT
		if (primaryKey && primaryKey.trim()) {
			const sanitizedPk = this.sanitizeColumnName(primaryKey);
			const idxName = `${safeTableName}_${sanitizedPk}_uidx`.slice(0, 63);

			await this.prisma.$executeRawUnsafe(`
				CREATE UNIQUE INDEX IF NOT EXISTS "${idxName}" 
				ON "${safeTableName}" ("${sanitizedPk}");
			`);
		}
	}

	/**
	 * Remove a tabela dinâmica correspondente à integração excluída.
	 */
	async dropTable(tableName: string): Promise<void> {
		const safeTableName = this.generateTableName(tableName);
		await this.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${safeTableName}";`);
	}

	/**
	 * Insere linhas na tabela dinâmica em chunks de 500 linhas.
	 */
	async insertRows(tableName: string, rows: Record<string, unknown>[]): Promise<number> {
		if (!rows || rows.length === 0) return 0;

		const safeTableName = this.generateTableName(tableName);

		const technicalCols = new Set(['_id', '_row_hash', 'row_hash', '_synced_at', 'synced_at', 'created_at']);
		const businessFields = Object.keys(rows[0]).filter((f) => !technicalCols.has(f.toLowerCase()));
		const sanitizedBusinessFields = businessFields.map((f) => this.sanitizeColumnName(f));

		const insertColumnsList = [
			...sanitizedBusinessFields.map((col) => `"${col}"`),
			'"_row_hash"',
			'"_synced_at"',
		].join(', ');

		const CHUNK_SIZE = 500;
		let insertedCount = 0;

		for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
			const chunk = rows.slice(i, i + CHUNK_SIZE);
			const valuesLines = chunk.map((row) => {
				const values = businessFields.map((f) => this.escapeSqlLiteral(row[f]));
				const rowHash = this.escapeSqlLiteral(row._row_hash ?? this.generateRowHash(row));
				values.push(rowHash);
				values.push('NOW()');
				return `(${values.join(', ')})`;
			});

			const sql = `
				INSERT INTO "${safeTableName}" (${insertColumnsList})
				VALUES
				${valuesLines.join(',\n\t\t\t\t')};
			`;

			await this.prisma.$executeRawUnsafe(sql);
			insertedCount += chunk.length;
			chunk.length = 0;
		}

		return insertedCount;
	}

	/**
	 * Substitui os dados da tabela dinâmica pelo novo lote de registros sincronizados (TRUNCATE + INSERT).
	 */
	async replaceRows(tableName: string, rows: Record<string, unknown>[]): Promise<number> {
		const safeTableName = this.generateTableName(tableName);
		if (rows.length > 0) {
			await this.syncColumns(safeTableName, Object.keys(rows[0]));
		}
		await this.prisma.$executeRawUnsafe(`TRUNCATE TABLE "${safeTableName}";`);
		return this.insertRows(safeTableName, rows);
	}

	/**
	 * Envolve a query SQL com paginação limitando pelo batchSize (Oracle / SQL Server / Sankhya).
	 */
	private wrapQueryWithPagination(query: string, batchSize: number): string {
		const trimmed = query.trim().replace(/;$/, '');

		if (/\bROWNUM\s*<=/i.test(trimmed) || /\bFETCH\s+FIRST\b/i.test(trimmed)) {
			return trimmed;
		}

		return `
SELECT * FROM (
${trimmed}
) WHERE ROWNUM <= ${batchSize}`.trim();
	}

	/**
	 * Paginação universal via ROWNUM e OFFSET no Oracle / Sankhya DbExplorer.
	 */
	private wrapQueryWithOffsetPagination(query: string, offset: number, batchSize: number): string {
		const trimmed = query.trim().replace(/;$/, '');

		if (/\bROWNUM\s*<=/i.test(trimmed) || /\bFETCH\s+FIRST\b/i.test(trimmed)) {
			return trimmed;
		}

		return `
SELECT * FROM (
    SELECT a.*, ROWNUM rnum FROM (
        ${trimmed}
    ) a WHERE ROWNUM <= ${offset + batchSize}
) WHERE rnum > ${offset}`.trim();
	}

	/**
	 * Formata Date para string compatível com bancos relacionais (YYYY-MM-DD HH:mm:ss).
	 */
	private formatLastSyncDate(date?: Date | null): string {
		if (!date) {
			return '1970-01-01 00:00:00';
		}

		const d = new Date(date);
		const pad = (n: number) => String(n).padStart(2, '0');

		const year = d.getFullYear();
		const month = pad(d.getMonth() + 1);
		const day = pad(d.getDate());
		const hours = pad(d.getHours());
		const minutes = pad(d.getMinutes());
		const seconds = pad(d.getSeconds());

		return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
	}

	/**
	 * Localiza case-insensitively a chave de um campo nos dados retornados do ERP.
	 */
	private findMatchingFieldKey(row: Record<string, unknown>, targetField: string): string | undefined {
		if (!row || !targetField) return undefined;
		const targetNormalized = targetField.trim().toUpperCase();
		return Object.keys(row).find((k) => k.trim().toUpperCase() === targetNormalized);
	}

	/**
	 * Escapa valores primitivos para uso seguro em queries SQL raw.
	 */
	private escapeSqlLiteral(value: unknown): string {
		if (value === null || value === undefined) {
			return 'NULL';
		}
		if (typeof value === 'number') {
			return Number.isFinite(value) ? String(value) : 'NULL';
		}
		if (typeof value === 'boolean') {
			return value ? 'TRUE' : 'FALSE';
		}
		if (value instanceof Date) {
			return `'${value.toISOString()}'`;
		}

		const escaped = String(value).replace(/\0/g, '').replace(/'/g, "''");
		return `'${escaped}'`;
	}

	private getUniqueSanitizedColumns(fields: string[]): string[] {
		const unique = new Set<string>();

		fields.forEach((field) => {
			const clean = this.sanitizeColumnName(field);
			if (
				clean &&
				clean !== '_id' &&
				clean !== 'created_at' &&
				clean !== 'synced_at' &&
				clean !== '_synced_at' &&
				clean !== '_row_hash' &&
				clean !== 'row_hash'
			) {
				unique.add(clean);
			}
		});

		return Array.from(unique);
	}
}

export const dynamicTableManager = new DynamicTableManager();
export default dynamicTableManager;
