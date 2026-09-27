import { MetaTableEntity } from '../../domain/entities/meta-table.entity';
import { IMetaTableRepository } from '../../domain/repositories/meta-table.repository.interface';

export interface SearchMetadataInput {
	tenantId: string;
	keywords: string[];
	limit?: number;
}

export interface ScoredMetadataTable {
	table: MetaTableEntity;
	relevanceScore: number;
	matchedFields: string[];
}

export interface SearchMetadataOutput {
	tables: MetaTableEntity[];
	scoredTables: ScoredMetadataTable[];
	totalFound: number;
}

export class SearchMetadataUseCase {
	constructor(private readonly repository: IMetaTableRepository) {}

	async execute(input: SearchMetadataInput): Promise<SearchMetadataOutput> {
		if (!input.tenantId || !input.tenantId.trim()) {
			throw new Error('tenantId é obrigatório para busca semântica de metadados.');
		}

		const cleanKeywords = (input.keywords || [])
			.map((k) => k.trim().toLowerCase())
			.filter(Boolean);

		if (cleanKeywords.length === 0) {
			const all = await this.repository.findAllByTenant(input.tenantId);
			return {
				tables: all,
				scoredTables: all.map((t) => ({ table: t, relevanceScore: 1, matchedFields: [] })),
				totalFound: all.length,
			};
		}

		// 1. Busca via PostgreSQL/Prisma com ILIKE/contains nas tabelas e colunas
		const rawTables = await this.repository.searchByKeywords(input.tenantId, cleanKeywords);

		// 2. Pontua e ranqueia a relevância de cada tabela encontrada
		const scoredTables: ScoredMetadataTable[] = rawTables.map((table) => {
			let score = 0;
			const matchedFields: string[] = [];

			const tableNameNorm = table.tableName.toLowerCase();
			const tableDescNorm = table.description.toLowerCase();

			for (const kw of cleanKeywords) {
				if (tableNameNorm.includes(kw)) {
					score += 5;
					matchedFields.push(`tableName: "${table.tableName}"`);
				}
				if (tableDescNorm.includes(kw)) {
					score += 8;
					matchedFields.push(`tableDesc: "${kw}"`);
				}
			}

			for (const col of table.columns) {
				const colNameNorm = col.columnName.toLowerCase();
				const colDescNorm = col.description.toLowerCase();

				for (const kw of cleanKeywords) {
					if (colNameNorm.includes(kw)) {
						score += 4;
						matchedFields.push(`colName: "${col.columnName}"`);
					}
					if (colDescNorm.includes(kw)) {
						score += 7;
						matchedFields.push(`colDesc "${col.columnName}": "${kw}"`);
					}
				}
			}

			return {
				table,
				relevanceScore: score,
				matchedFields,
			};
		});

		// 3. Ordena pela pontuação de relevância decrescente
		scoredTables.sort((a, b) => b.relevanceScore - a.relevanceScore);

		const limit = input.limit && input.limit > 0 ? input.limit : 10;
		const sliced = scoredTables.slice(0, limit);

		return {
			tables: sliced.map((s) => s.table),
			scoredTables: sliced,
			totalFound: scoredTables.length,
		};
	}
}
