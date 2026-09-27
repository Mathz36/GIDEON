import { PrismaClient } from '@prisma/client';
import prismaClient from '../../../../config/prisma';
import { MetaTableEntity } from '../../domain/entities/meta-table.entity';
import { MetaColumnEntity } from '../../domain/entities/meta-column.entity';
import { IMetaTableRepository } from '../../domain/repositories/meta-table.repository.interface';

export class PrismaMetaTableRepository implements IMetaTableRepository {
	constructor(private readonly prisma: PrismaClient = prismaClient) {}

	async save(metaTable: MetaTableEntity): Promise<MetaTableEntity> {
		const result = await this.prisma.$transaction(async (tx) => {
			// 1. Upsert da tabela de metadados
			const tableRecord = await tx.metaTable.upsert({
				where: {
					tenantId_tableName: {
						tenantId: metaTable.tenantId,
						tableName: metaTable.tableName,
					},
				},
				update: {
					description: metaTable.description,
				},
				create: {
					...(metaTable.id ? { id: metaTable.id } : {}),
					tenantId: metaTable.tenantId,
					tableName: metaTable.tableName,
					description: metaTable.description,
				},
			});

			// 2. Colunas existentes para sincronização
			const currentColumns = await tx.metaColumn.findMany({
				where: { metaTableId: tableRecord.id },
			});

			const desiredColumnNames = new Set(metaTable.columns.map((c) => c.columnName.toUpperCase()));

			// Remove colunas que não estão mais presentes na entidade
			const toDelete = currentColumns.filter(
				(c) => !desiredColumnNames.has(c.columnName.toUpperCase()),
			);

			if (toDelete.length > 0) {
				await tx.metaColumn.deleteMany({
					where: {
						id: { in: toDelete.map((c) => c.id) },
					},
				});
			}

			// Upsert de cada coluna com flag isPrimaryKey
			for (const col of metaTable.columns) {
				await tx.metaColumn.upsert({
					where: {
						metaTableId_columnName: {
							metaTableId: tableRecord.id,
							columnName: col.columnName.toUpperCase(),
						},
					},
					update: {
						dataType: col.dataType,
						description: col.description,
						isPrimaryKey: col.isPrimaryKey,
						foreignKeyToTable: col.foreignKeyToTable,
						foreignKeyToColumn: col.foreignKeyToColumn,
					},
					create: {
						metaTableId: tableRecord.id,
						columnName: col.columnName.toUpperCase(),
						dataType: col.dataType,
						description: col.description,
						isPrimaryKey: col.isPrimaryKey,
						foreignKeyToTable: col.foreignKeyToTable,
						foreignKeyToColumn: col.foreignKeyToColumn,
					},
				});
			}

			// 3. Busca o registro completo atualizado
			const updated = await tx.metaTable.findUniqueOrThrow({
				where: { id: tableRecord.id },
				include: { columns: true },
			});

			return updated;
		});

		return this.mapToEntity(result);
	}

	async findByTenantAndTableName(tenantId: string, tableName: string): Promise<MetaTableEntity | null> {
		const record = await this.prisma.metaTable.findUnique({
			where: {
				tenantId_tableName: {
					tenantId: tenantId.trim(),
					tableName: tableName.trim().toLowerCase(),
				},
			},
			include: {
				columns: true,
			},
		});

		if (!record) {
			return null;
		}

		return this.mapToEntity(record);
	}

	async findByTableNames(tenantId: string, tableNames: string[]): Promise<MetaTableEntity[]> {
		if (tableNames.length === 0) return [];
		const normalized = tableNames.map((t) => t.trim().toLowerCase());

		const records = await this.prisma.metaTable.findMany({
			where: {
				tenantId: tenantId.trim(),
				tableName: { in: normalized },
			},
			include: {
				columns: true,
			},
		});

		return records.map((r) => this.mapToEntity(r));
	}

	async findAllByTenant(tenantId: string): Promise<MetaTableEntity[]> {
		const records = await this.prisma.metaTable.findMany({
			where: {
				tenantId: tenantId.trim(),
			},
			include: {
				columns: true,
			},
			orderBy: {
				tableName: 'asc',
			},
		});

		return records.map((r) => this.mapToEntity(r));
	}

	async searchByKeywords(tenantId: string, keywords: string[]): Promise<MetaTableEntity[]> {
		const cleanKeywords = keywords.map((k) => k.trim()).filter(Boolean);
		if (cleanKeywords.length === 0) {
			return this.findAllByTenant(tenantId);
		}

		const records = await this.prisma.metaTable.findMany({
			where: {
				tenantId: tenantId.trim(),
				OR: [
					...cleanKeywords.map((kw) => ({
						tableName: { contains: kw, mode: 'insensitive' as const },
					})),
					...cleanKeywords.map((kw) => ({
						description: { contains: kw, mode: 'insensitive' as const },
					})),
					...cleanKeywords.map((kw) => ({
						columns: {
							some: {
								OR: [
									{ columnName: { contains: kw, mode: 'insensitive' as const } },
									{ description: { contains: kw, mode: 'insensitive' as const } },
								],
							},
						},
					})),
				],
			},
			include: {
				columns: true,
			},
		});

		return records.map((r) => this.mapToEntity(r));
	}

	async findReferencingTables(tenantId: string, targetTableNames: string[]): Promise<MetaTableEntity[]> {
		if (targetTableNames.length === 0) return [];
		const normalized = targetTableNames.map((t) => t.trim().toLowerCase());

		const records = await this.prisma.metaTable.findMany({
			where: {
				tenantId: tenantId.trim(),
				columns: {
					some: {
						foreignKeyToTable: { in: normalized, mode: 'insensitive' as const },
					},
				},
			},
			include: {
				columns: true,
			},
		});

		return records.map((r) => this.mapToEntity(r));
	}

	async delete(tenantId: string, tableName: string): Promise<boolean> {
		try {
			await this.prisma.metaTable.delete({
				where: {
					tenantId_tableName: {
						tenantId: tenantId.trim(),
						tableName: tableName.trim().toLowerCase(),
					},
				},
			});
			return true;
		} catch {
			return false;
		}
	}

	private mapToEntity(record: {
		id: string;
		tenantId: string;
		tableName: string;
		description: string;
		createdAt: Date;
		updatedAt: Date;
		columns: Array<{
			id: string;
			metaTableId: string;
			columnName: string;
			dataType: string;
			description: string;
			isPrimaryKey: boolean;
			foreignKeyToTable: string | null;
			foreignKeyToColumn: string | null;
			createdAt: Date;
			updatedAt: Date;
		}>;
	}): MetaTableEntity {
		const columns = record.columns.map(
			(col) =>
				new MetaColumnEntity({
					id: col.id,
					metaTableId: col.metaTableId,
					columnName: col.columnName,
					dataType: col.dataType,
					description: col.description,
					isPrimaryKey: col.isPrimaryKey,
					foreignKeyToTable: col.foreignKeyToTable,
					foreignKeyToColumn: col.foreignKeyToColumn,
					createdAt: col.createdAt,
					updatedAt: col.updatedAt,
				}),
		);

		return new MetaTableEntity({
			id: record.id,
			tenantId: record.tenantId,
			tableName: record.tableName,
			description: record.description,
			columns,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
		});
	}
}
