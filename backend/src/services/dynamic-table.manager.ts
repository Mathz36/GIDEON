import { PrismaClient } from '@prisma/client';
import prismaClient from '../config/prisma';

export interface IDynamicTableManager {
	generateTableName(context: string): string;
	createTable(tableName: string, expectedFields: string[]): Promise<void>;
	syncColumns(tableName: string, expectedFields: string[]): Promise<void>;
	dropTable(tableName: string): Promise<void>;
	insertRows(tableName: string, rows: Record<string, unknown>[]): Promise<number>;
	replaceRows(tableName: string, rows: Record<string, unknown>[]): Promise<number>;
}

export class DynamicTableManager implements IDynamicTableManager {
	private readonly prisma: PrismaClient;

	constructor(prisma: PrismaClient = prismaClient) {
		this.prisma = prisma;
	}

	/**
	 * Gera um nome de tabela seguro e normalizado baseado no contexto informado.
	 * Ex: "Vendas e Faturamento" -> "erp_vendas_e_faturamento"
	 */
	generateTableName(context: string): string {
		const normalized = context
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '') // Remove acentos
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '');

		const base = normalized || 'integracao';
		const safeName = base.startsWith('erp_') ? base : `erp_${base}`;

		// Limita o tamanho do identificador no Postgres a 63 caracteres
		return safeName.slice(0, 63);
	}

	/**
	 * Sanitiza nomes de colunas para identificadores seguros no PostgreSQL.
	 */
	sanitizeColumnName(fieldName: string): string {
		const sanitized = fieldName
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9_]+/g, '_')
			.replace(/^_+|_+$/g, '');

		return sanitized || 'col';
	}

	/**
	 * Cria dinamicamente a tabela no banco do Supabase com base nos campos informados.
	 */
	async createTable(tableName: string, expectedFields: string[]): Promise<void> {
		const safeTableName = this.generateTableName(tableName);
		const sanitizedColumns = this.getUniqueSanitizedColumns(expectedFields);

		const columnsDdl = sanitizedColumns
			.map((col) => `"${col}" TEXT`)
			.join(',\n\t\t\t\t');

		const ddl = `
			CREATE TABLE IF NOT EXISTS "${safeTableName}" (
				"id" BIGSERIAL PRIMARY KEY,
				${columnsDdl ? `${columnsDdl},` : ''}
				"synced_at" TIMESTAMPTZ DEFAULT NOW(),
				"created_at" TIMESTAMPTZ DEFAULT NOW()
			);
		`;

		await this.prisma.$executeRawUnsafe(ddl);
	}

	/**
	 * Sincroniza colunas caso novos campos tenham sido adicionados na edição da integração.
	 */
	async syncColumns(tableName: string, expectedFields: string[]): Promise<void> {
		const safeTableName = this.generateTableName(tableName);

		// Primeiro assegura que a tabela exista
		await this.createTable(safeTableName, expectedFields);

		// Obtém colunas já existentes na tabela
		const existingColumnsRaw = await this.prisma.$queryRawUnsafe<Array<{ column_name: string }>>(`
			SELECT column_name 
			FROM information_schema.columns 
			WHERE table_name = '${safeTableName}' AND table_schema = 'public';
		`);

		const existingColumns = new Set(existingColumnsRaw.map((row) => row.column_name.toLowerCase()));
		const sanitizedColumns = this.getUniqueSanitizedColumns(expectedFields);

		// Adiciona cada coluna faltante
		for (const col of sanitizedColumns) {
			if (!existingColumns.has(col.toLowerCase())) {
				await this.prisma.$executeRawUnsafe(`
					ALTER TABLE "${safeTableName}" ADD COLUMN IF NOT EXISTS "${col}" TEXT;
				`);
			}
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
	 * Opcional: insere linhas obtidas do ERP na tabela dinâmica correspondente.
	 */
	async insertRows(tableName: string, rows: Record<string, unknown>[]): Promise<number> {
		if (!rows || rows.length === 0) return 0;

		const safeTableName = this.generateTableName(tableName);
		const fields = Object.keys(rows[0]);
		const sanitizedFields = fields.map((f) => this.sanitizeColumnName(f));

		let insertedCount = 0;

		for (const row of rows) {
			const cols = sanitizedFields.map((f) => `"${f}"`).join(', ');
			const values = fields.map((f) => {
				const val = row[f];
				if (val === null || val === undefined) return 'NULL';
				const escaped = String(val).replace(/'/g, "''");
				return `'${escaped}'`;
			}).join(', ');

			await this.prisma.$executeRawUnsafe(`
				INSERT INTO "${safeTableName}" (${cols}) VALUES (${values});
			`);
			insertedCount += 1;
		}

		return insertedCount;
	}

	/**
	 * Substitui os dados da tabela dinâmica pelo novo lote de registros sincronizados.
	 */
	async replaceRows(tableName: string, rows: Record<string, unknown>[]): Promise<number> {
		const safeTableName = this.generateTableName(tableName);
		if (rows.length > 0) {
			await this.syncColumns(safeTableName, Object.keys(rows[0]));
		}
		await this.prisma.$executeRawUnsafe(`TRUNCATE TABLE "${safeTableName}";`);
		return this.insertRows(safeTableName, rows);
	}

	private getUniqueSanitizedColumns(fields: string[]): string[] {
		const unique = new Set<string>();

		fields.forEach((field) => {
			const clean = this.sanitizeColumnName(field);
			if (clean && clean !== 'id' && clean !== 'created_at' && clean !== 'synced_at') {
				unique.add(clean);
			}
		});

		return Array.from(unique);
	}
}

export const dynamicTableManager = new DynamicTableManager();
export default dynamicTableManager;

