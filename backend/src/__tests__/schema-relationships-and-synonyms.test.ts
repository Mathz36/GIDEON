import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
process.env.SANKHYA_SERVICE_URL = process.env.SANKHYA_SERVICE_URL || 'https://api.sankhya.test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { MetaTableEntity } from '../modules/data-dictionary/domain/entities/meta-table.entity';
import { MetaColumnEntity } from '../modules/data-dictionary/domain/entities/meta-column.entity';
import { AutoDetectRelationshipsUseCase } from '../modules/data-dictionary/application/use-cases/auto-detect-relationships.use-case';
import { SearchMetadataUseCase } from '../modules/data-dictionary/application/use-cases/search-metadata.use-case';
import { IMetaTableRepository } from '../modules/data-dictionary/domain/repositories/meta-table.repository.interface';

describe('Data Dictionary - Virtual FK Auto-Detection & Business Synonyms Suite', () => {
	let inMemoryTables: Map<string, MetaTableEntity>;
	let mockRepo: IMetaTableRepository;

	beforeEach(() => {
		inMemoryTables = new Map();

		mockRepo = {
			save: async (table: MetaTableEntity) => {
				inMemoryTables.set(table.tableName.toLowerCase(), table);
				return table;
			},
			findByTenantAndTableName: async (tenantId: string, tableName: string) => {
				return inMemoryTables.get(tableName.toLowerCase()) || null;
			},
			findByTableNames: async (tenantId: string, tableNames: string[]) => {
				return tableNames.map((n) => inMemoryTables.get(n.toLowerCase())).filter(Boolean) as MetaTableEntity[];
			},
			findAllByTenant: async (tenantId: string) => {
				return Array.from(inMemoryTables.values());
			},
			searchByKeywords: async (tenantId: string, keywords: string[]) => {
				const lowerKeywords = keywords.map((k) => k.toLowerCase());
				const results: MetaTableEntity[] = [];

				for (const table of inMemoryTables.values()) {
					const tName = table.tableName.toLowerCase();
					const tDesc = table.description.toLowerCase();
					const match = lowerKeywords.some((kw) => {
						if (tName.includes(kw) || tDesc.includes(kw)) return true;
						return table.columns.some((c) => c.columnName.toLowerCase().includes(kw) || c.description.toLowerCase().includes(kw));
					});

					if (match) {
						results.push(table);
					}
				}

				return results;
			},
			findReferencingTables: async (tenantId: string, targetTableNames: string[]) => {
				const targets = new Set(targetTableNames.map((t) => t.toLowerCase()));
				const refs: MetaTableEntity[] = [];

				for (const table of inMemoryTables.values()) {
					const hasRef = table.columns.some((c) => c.foreignKeyToTable && targets.has(c.foreignKeyToTable.toLowerCase()));
					if (hasRef) refs.push(table);
				}
				return refs;
			},
			delete: async () => true,
		};
	});

	describe('1. Auto-Detecção Heurística de Chaves Estrangeiras (Virtual FKs)', () => {
		it('deve vincular automaticamente colunas correspondentes à Chave Primária de outra tabela (CODPARC e CODPROD)', async () => {
			// Tabela 1: Clientes (PK = CODPARC)
			const clientesTable = new MetaTableEntity({
				tenantId: 'default',
				tableName: 'erp_clientes',
				description: 'Cadastro geral de clientes',
				columns: [
					new MetaColumnEntity({ columnName: 'CODPARC', description: 'Código do Cliente', isPrimaryKey: true }),
					new MetaColumnEntity({ columnName: 'NOMEPARC', description: 'Razão Social' }),
				],
			});
			inMemoryTables.set('erp_clientes', clientesTable);

			// Tabela 2: Produtos (PK = CODPROD)
			const produtosTable = new MetaTableEntity({
				tenantId: 'default',
				tableName: 'erp_produtos',
				description: 'Catálogo de produtos',
				columns: [
					new MetaColumnEntity({ columnName: 'CODPROD', description: 'Código do Produto', isPrimaryKey: true }),
					new MetaColumnEntity({ columnName: 'DESCRPROD', description: 'Descrição da mercadoria' }),
				],
			});
			inMemoryTables.set('erp_produtos', produtosTable);

			// Tabela 3: Vendas (PK = NUNOTA, possui CODPARC e CODPROD sem FKs ainda)
			const vendasTable = new MetaTableEntity({
				tenantId: 'default',
				tableName: 'erp_vendas',
				description: 'Notas fiscais de vendas',
				columns: [
					new MetaColumnEntity({ columnName: 'NUNOTA', description: 'Número Único da Nota', isPrimaryKey: true }),
					new MetaColumnEntity({ columnName: 'CODPARC', description: 'Código do Cliente' }),
					new MetaColumnEntity({ columnName: 'CODPROD', description: 'Código do Produto' }),
					new MetaColumnEntity({ columnName: 'VLRNOTA', description: 'Valor total' }),
				],
			});
			inMemoryTables.set('erp_vendas', vendasTable);

			const useCase = new AutoDetectRelationshipsUseCase(mockRepo);
			const result = await useCase.execute('default');

			assert.equal(result.detectedRelationships.length, 2, 'Deve detectar exatamente 2 relacionamentos');

			// Verifica se erp_vendas foi atualizada com as FKs virtuais
			const updatedVendas = inMemoryTables.get('erp_vendas')!;
			const colCodParc = updatedVendas.findColumn('CODPARC')!;
			const colCodProd = updatedVendas.findColumn('CODPROD')!;

			assert.equal(colCodParc.foreignKeyToTable, 'erp_clientes');
			assert.equal(colCodParc.foreignKeyToColumn, 'CODPARC');

			assert.equal(colCodProd.foreignKeyToTable, 'erp_produtos');
			assert.equal(colCodProd.foreignKeyToColumn, 'CODPROD');
		});

		it('deve detectar vínculos mesmo com pequenas variações de prefixos (ex: cod_parc -> codparc)', async () => {
			const clientesTable = new MetaTableEntity({
				tenantId: 'default',
				tableName: 'erp_clientes',
				description: 'Clientes',
				columns: [
					new MetaColumnEntity({ columnName: 'CODPARC', description: 'PK Cliente', isPrimaryKey: true }),
				],
			});
			inMemoryTables.set('erp_clientes', clientesTable);

			const pedidosTable = new MetaTableEntity({
				tenantId: 'default',
				tableName: 'erp_pedidos',
				description: 'Pedidos',
				columns: [
					new MetaColumnEntity({ columnName: 'ID', description: 'PK Pedido', isPrimaryKey: true }),
					new MetaColumnEntity({ columnName: 'COD_PARC', description: 'Cliente com separador underscore' }),
				],
			});
			inMemoryTables.set('erp_pedidos', pedidosTable);

			const useCase = new AutoDetectRelationshipsUseCase(mockRepo);
			const result = await useCase.execute('default');

			assert.equal(result.detectedRelationships.length, 1);
			const col = inMemoryTables.get('erp_pedidos')!.findColumn('COD_PARC')!;
			assert.equal(col.foreignKeyToTable, 'erp_clientes');
			assert.equal(col.foreignKeyToColumn, 'CODPARC');
		});

		it('não deve sobrescrever uma chave estrangeira já preenchida manualmente', async () => {
			const fornecedores = new MetaTableEntity({
				tenantId: 'default',
				tableName: 'erp_fornecedores',
				description: 'Fornecedores',
				columns: [
					new MetaColumnEntity({ columnName: 'CODPARC', description: 'PK Fornecedor', isPrimaryKey: true }),
				],
			});
			inMemoryTables.set('erp_fornecedores', fornecedores);

			const compras = new MetaTableEntity({
				tenantId: 'default',
				tableName: 'erp_compras',
				description: 'Compras',
				columns: [
					new MetaColumnEntity({ columnName: 'ID', description: 'PK Compra', isPrimaryKey: true }),
					new MetaColumnEntity({
						columnName: 'CODPARC',
						description: 'Fornecedor específico',
						foreignKeyToTable: 'erp_fornecedores',
						foreignKeyToColumn: 'CODPARC',
					}),
				],
			});
			inMemoryTables.set('erp_compras', compras);

			const useCase = new AutoDetectRelationshipsUseCase(mockRepo);
			const result = await useCase.execute('default');

			assert.equal(result.detectedRelationships.length, 0, 'Não deve sobrescrever FK existente');
			assert.equal(inMemoryTables.get('erp_compras')!.findColumn('CODPARC')!.foreignKeyToTable, 'erp_fornecedores');
		});
	});

	describe('2. Busca Semântica por Sinônimos e Termos de Negócio', () => {
		it('deve localizar a tabela erp_tgfcab ao buscar por "faturamento" e "vendas" graças aos sinônimos injetados', async () => {
			// Simula tabela com nome técnico do Sankhya mas com sinônimos de negócio injetados na descrição
			const tgfcabTable = new MetaTableEntity({
				tenantId: 'default',
				tableName: 'erp_tgfcab',
				description: 'Tabela dinâmica para o contexto de Notas Fiscais. [Sinônimos e termos de negócio para busca: faturamento, vendas, receita, pedidos, notas fiscais, volume faturado, emissao]',
				columns: [
					new MetaColumnEntity({ columnName: 'NUNOTA', description: 'Número Único', isPrimaryKey: true }),
					new MetaColumnEntity({ columnName: 'VLRNOTA', description: 'Valor monetário de faturamento/venda' }),
					new MetaColumnEntity({ columnName: 'DTNEG', description: 'Data da negociação' }),
				],
			});
			inMemoryTables.set('erp_tgfcab', tgfcabTable);

			const searchUseCase = new SearchMetadataUseCase(mockRepo);

			// Busca utilizando termos que o usuário final normalmente digita
			const output = await searchUseCase.execute({
				tenantId: 'default',
				keywords: ['faturamento', 'vendas', 'recentes'],
			});

			assert.equal(output.totalFound, 1, 'Deve encontrar a tabela erp_tgfcab através dos sinônimos');
			assert.equal(output.tables[0].tableName, 'erp_tgfcab');
			assert.ok(output.scoredTables[0].relevanceScore > 10, 'A pontuação de relevância deve ser alta devido ao match com sinônimos');
		});
	});
});
