import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
process.env.SANKHYA_SERVICE_URL = process.env.SANKHYA_SERVICE_URL || 'https://api.sankhya.test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { ExtractKeywordsUseCase } from '../modules/data-dictionary/application/use-cases/extract-keywords.use-case';
import { GeminiKeywordExtractorGateway } from '../modules/data-dictionary/infrastructure/gateways/gemini-keyword-extractor.gateway';
import { BuildSqlGenerationPromptUseCase } from '../modules/data-dictionary/application/use-cases/build-sql-generation-prompt.use-case';
import { MetaTableEntity } from '../modules/data-dictionary/domain/entities/meta-table.entity';
import { MetaColumnEntity } from '../modules/data-dictionary/domain/entities/meta-column.entity';

describe('AI Specialist - Semantic Keyword Expansion & Prompt Engineering Suite', () => {
	describe('1. Expansão Conceitual de Palavras-Chave no NLP', () => {
		it('deve expandir termos de faturamento para incluir sinônimos de vendas, receita e pedidos no fallback heurístico', async () => {
			// Mock do gateway que simula fallback heurístico
			const gateway = new GeminiKeywordExtractorGateway();
			// Força o gateway a cair no fallback usando método privado tokenizeFallback
			const keywords = (gateway as any).tokenizeFallback('resumo executivo do faturamento e da evolucao das vendas recentes');

			assert.ok(keywords.includes('faturamento'), 'Deve conter faturamento');
			assert.ok(keywords.includes('vendas'), 'Deve conter vendas');
			assert.ok(keywords.includes('receita'), 'Deve incluir sinônimo correlato receita');
			assert.ok(keywords.includes('pedidos'), 'Deve incluir sinônimo correlato pedidos');
			assert.ok(keywords.includes('notas_fiscais'), 'Deve incluir sinônimo correlato notas_fiscais');
		});

		it('deve expandir termos de clientes para incluir parceiros e compradores', async () => {
			const useCase = new ExtractKeywordsUseCase({
				extract: async () => {
					throw new Error('Simula fallback offline do LLM');
				},
			});

			const keywords = await useCase.execute({
				question: 'Quais os maiores clientes que compraram no mês passado?',
			});

			assert.ok(keywords.includes('clientes'), 'Deve conter clientes');
			assert.ok(keywords.includes('parceiros'), 'Deve expandir para parceiros');
			assert.ok(keywords.includes('compradores'), 'Deve expandir para compradores');
		});
	});

	describe('2. Engenharia de Prompt e Injeção de Regras de Negócio no SQL', () => {
		it('deve gerar System Prompt com guardrails explícitos de filtros de status do ERP e agregações monetárias (CAST NUMERIC)', () => {
			const buildPromptUseCase = new BuildSqlGenerationPromptUseCase();

			const tableVendas = new MetaTableEntity({
				tenantId: 'default',
				tableName: 'erp_vendas',
				description: 'Vendas e Notas Fiscais [Sinônimos: faturamento, vendas, receita]',
				columns: [
					new MetaColumnEntity({ columnName: 'NUNOTA', description: 'Número único', isPrimaryKey: true }),
					new MetaColumnEntity({
						columnName: 'CODPARC',
						description: 'Código do Cliente',
						foreignKeyToTable: 'erp_clientes',
						foreignKeyToColumn: 'CODPARC',
					}),
					new MetaColumnEntity({ columnName: 'VLRNOTA', description: 'Valor monetário da venda' }),
					new MetaColumnEntity({ columnName: 'STATUSNOTA', description: 'Status: L=Liberada, P=Pendente' }),
				],
			});

			const tableClientes = new MetaTableEntity({
				tenantId: 'default',
				tableName: 'erp_clientes',
				description: 'Cadastro de clientes',
				columns: [
					new MetaColumnEntity({ columnName: 'CODPARC', description: 'Código do cliente', isPrimaryKey: true }),
					new MetaColumnEntity({ columnName: 'NOMEPARC', description: 'Razão social' }),
				],
			});

			const promptResult = buildPromptUseCase.execute({
				question: 'Qual o faturamento total por cliente no último mês?',
				schemaGraph: {
					primaryTables: [tableVendas],
					expandedTables: [tableClientes],
					allTables: [tableVendas, tableClientes],
					joinPaths: [
						{
							fromTable: 'erp_vendas',
							fromColumn: 'CODPARC',
							toTable: 'erp_clientes',
							toColumn: 'CODPARC',
							relationshipType: 'DIRECT_FK',
						},
					],
				},
			});

			// Valida diretrizes de agregação e filtros de status no System Prompt
			assert.ok(promptResult.systemPrompt.includes('CAST(coluna AS NUMERIC)'), 'Deve instruir conversão com CAST NUMERIC');
			assert.ok(promptResult.systemPrompt.includes('STATUS E FILTROS DE NEGÓCIO'), 'Deve conter seção de status e filtros');
			assert.ok(promptResult.systemPrompt.includes('Liberada'), 'Deve instruir sobre status de notas liberadas');

			// Valida formatação do caminho de JOIN
			assert.ok(promptResult.joinRulesText.includes('-- ON "erp_vendas"."CODPARC" = "erp_clientes"."CODPARC"'));

			// Valida DDL Simplificado com FKs documentadas
			assert.ok(promptResult.formattedSchemaDDL.includes('FK -> "erp_clientes"'));
			assert.ok(promptResult.formattedSchemaDDL.toLowerCase().includes('fk -> "erp_clientes"("codparc")'));
		});
	});
});
