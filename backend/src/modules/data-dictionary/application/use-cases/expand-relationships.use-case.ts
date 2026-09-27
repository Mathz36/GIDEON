import { MetaTableEntity } from '../../domain/entities/meta-table.entity';
import { IMetaTableRepository } from '../../domain/repositories/meta-table.repository.interface';

export interface ExpandRelationshipsInput {
	tenantId: string;
	initialTables: MetaTableEntity[];
	includeInverseRelations?: boolean; // Se true, traz tabelas que apontam para as tabelas iniciais
}

export interface JoinPath {
	fromTable: string;
	fromColumn: string;
	toTable: string;
	toColumn: string;
	relationshipType: 'DIRECT_FK' | 'INVERSE_FK';
}

export interface ExpandedRelationshipsOutput {
	primaryTables: MetaTableEntity[];
	expandedTables: MetaTableEntity[];
	allTables: MetaTableEntity[];
	joinPaths: JoinPath[];
}

export class ExpandRelationshipsUseCase {
	constructor(private readonly repository: IMetaTableRepository) {}

	async execute(input: ExpandRelationshipsInput): Promise<ExpandedRelationshipsOutput> {
		const { tenantId, initialTables, includeInverseRelations = true } = input;

		if (!initialTables || initialTables.length === 0) {
			return {
				primaryTables: [],
				expandedTables: [],
				allTables: [],
				joinPaths: [],
			};
		}

		const tableMap = new Map<string, MetaTableEntity>();
		initialTables.forEach((t) => tableMap.set(t.tableName.toLowerCase(), t));

		const joinPaths: JoinPath[] = [];
		const neededTableNames = new Set<string>();

		// 1. Expansão Direta: Tabela A possui FK para Tabela B
		for (const table of initialTables) {
			for (const col of table.columns) {
				if (col.hasForeignKey() && col.foreignKeyToTable && col.foreignKeyToColumn) {
					const targetTable = col.foreignKeyToTable.toLowerCase();
					const targetColumn = col.foreignKeyToColumn.toUpperCase();

					joinPaths.push({
						fromTable: table.tableName,
						fromColumn: col.columnName,
						toTable: targetTable,
						toColumn: targetColumn,
						relationshipType: 'DIRECT_FK',
					});

					if (!tableMap.has(targetTable)) {
						neededTableNames.add(targetTable);
					}
				}
			}
		}

		// 2. Expansão Inversa (Opcional): Outras tabelas do banco que apontam para as tabelas iniciais
		if (includeInverseRelations) {
			const currentTableNames = Array.from(tableMap.keys());
			const referencingTables = await this.repository.findReferencingTables(tenantId, currentTableNames);

			for (const refTable of referencingTables) {
				const refTableName = refTable.tableName.toLowerCase();

				for (const col of refTable.columns) {
					if (col.hasForeignKey() && col.foreignKeyToTable && col.foreignKeyToColumn) {
						const targetTable = col.foreignKeyToTable.toLowerCase();

						if (tableMap.has(targetTable)) {
							joinPaths.push({
								fromTable: refTable.tableName,
								fromColumn: col.columnName,
								toTable: targetTable,
								toColumn: col.foreignKeyToColumn,
								relationshipType: 'INVERSE_FK',
							});

							if (!tableMap.has(refTableName)) {
								neededTableNames.add(refTableName);
							}
						}
					}
				}
			}
		}

		// 3. Busca no banco as tabelas relacionadas que ainda não estão no mapa
		const tablesToFetch = Array.from(neededTableNames).filter((name) => !tableMap.has(name));
		let fetchedTables: MetaTableEntity[] = [];

		if (tablesToFetch.length > 0) {
			fetchedTables = await this.repository.findByTableNames(tenantId, tablesToFetch);
			fetchedTables.forEach((t) => tableMap.set(t.tableName.toLowerCase(), t));
		}

		// 4. Remove duplicações de join paths
		const uniqueJoinPaths = this.deduplicateJoinPaths(joinPaths);

		return {
			primaryTables: initialTables,
			expandedTables: fetchedTables,
			allTables: Array.from(tableMap.values()),
			joinPaths: uniqueJoinPaths,
		};
	}

	private deduplicateJoinPaths(paths: JoinPath[]): JoinPath[] {
		const seen = new Set<string>();
		return paths.filter((p) => {
			const key = `${p.fromTable}.${p.fromColumn}->${p.toTable}.${p.toColumn}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}
}
