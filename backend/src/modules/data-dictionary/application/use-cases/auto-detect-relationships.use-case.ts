import { IMetaTableRepository } from '../../domain/repositories/meta-table.repository.interface';
import { MetaTableEntity } from '../../domain/entities/meta-table.entity';

export interface DetectedRelationship {
	fromTable: string;
	fromColumn: string;
	toTable: string;
	toColumn: string;
	reason: string;
}

export interface AutoDetectRelationshipsOutput {
	totalTablesAnalyzed: number;
	updatedTablesCount: number;
	detectedRelationships: DetectedRelationship[];
}

/**
 * Caso de Uso: Auto-Detecção Heurística de Relacionamentos (Virtual Foreign Keys)
 *
 * Analisa as tabelas registradas no Dicionário de Dados do mesmo tenant e infere
 * vínculos virtuais de chave estrangeira entre tabelas sem afetar a integridade física do PostgreSQL.
 * Permite que o Grafo Relacional (ExpandRelationshipsUseCase) conecte automaticamente tabelas
 * em consultas de linguagem natural (Text-to-SQL).
 */
export class AutoDetectRelationshipsUseCase {
	constructor(private readonly repository: IMetaTableRepository) {}

	async execute(tenantId: string = 'default'): Promise<AutoDetectRelationshipsOutput> {
		const allTables = await this.repository.findAllByTenant(tenantId);
		if (allTables.length < 2) {
			return {
				totalTablesAnalyzed: allTables.length,
				updatedTablesCount: 0,
				detectedRelationships: [],
			};
		}

		// 1. Mapeia as Chaves Primárias de negócio conhecidas de cada tabela
		// key: normalizedPkColumnName -> { tableName, columnName }
		const knownPks = new Map<string, { tableName: string; columnName: string }>();

		for (const table of allTables) {
			const pkCol = table.getPrimaryKeyColumn();
			if (pkCol && pkCol.columnName.toLowerCase() !== '_id') {
				knownPks.set(pkCol.columnName.toLowerCase(), {
					tableName: table.tableName.toLowerCase(),
					columnName: pkCol.columnName,
				});
			}
		}

		const detectedRelationships: DetectedRelationship[] = [];
		let updatedTablesCount = 0;

		// 2. Analisa cada tabela e coluna à procura de correspondências com as PKs conhecidas
		for (const table of allTables) {
			let tableModified = false;

			for (const col of table.columns) {
				// Ignora se for a própria Chave Primária ou se já tiver FK explícita definida
				if (col.isPrimaryKey || col.hasForeignKey()) {
					continue;
				}

				const colNameNorm = col.columnName.toLowerCase();
				const target = knownPks.get(colNameNorm);

				if (target && target.tableName !== table.tableName.toLowerCase()) {
					col.setForeignKey(target.tableName, target.columnName);
					tableModified = true;
					detectedRelationships.push({
						fromTable: table.tableName,
						fromColumn: col.columnName,
						toTable: target.tableName,
						toColumn: target.columnName,
						reason: `Correspondência exata de chave primária (${col.columnName} -> ${target.tableName}.${target.columnName})`,
					});
				} else {
					// Verificação heurística por normalização de prefixos/separadores (ex: cod_parc vs codparc)
					const stripped = colNameNorm.replace(/_/g, '');
					for (const [pkName, pkTarget] of knownPks.entries()) {
						if (pkTarget.tableName !== table.tableName.toLowerCase() && stripped === pkName.replace(/_/g, '')) {
							col.setForeignKey(pkTarget.tableName, pkTarget.columnName);
							tableModified = true;
							detectedRelationships.push({
								fromTable: table.tableName,
								fromColumn: col.columnName,
								toTable: pkTarget.tableName,
								toColumn: pkTarget.columnName,
								reason: `Correspondência aproximada sem separadores (${col.columnName} -> ${pkTarget.tableName}.${pkTarget.columnName})`,
							});
							break;
						}
					}
				}
			}

			if (tableModified) {
				await this.repository.save(table);
				updatedTablesCount++;
			}
		}

		return {
			totalTablesAnalyzed: allTables.length,
			updatedTablesCount,
			detectedRelationships,
		};
	}
}
