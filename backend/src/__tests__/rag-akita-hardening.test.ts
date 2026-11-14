import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
process.env.SANKHYA_SERVICE_URL = process.env.SANKHYA_SERVICE_URL || 'https://api.sankhya.test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import {
	detectOutOfScopeBusinessMetric,
	sanitizeAndValidateGeneratedSql,
} from '../utils/sql-ast-validator';
import { ExtractKeywordsUseCase } from '../modules/data-dictionary/application/use-cases/extract-keywords.use-case';
import { ChatRagService } from '../services/chat-rag.service';
import { ResponseReviewerService } from '../services/response-reviewer.service';

const STANDARD_ERP_COLUMNS = [
	'id',
	'operacao',
	'nota_fiscal',
	'cod_vendedor',
	'cod_cliente',
	'empresa',
	'pedido_origem',
	'tipo_movimento',
	'valor_bruto',
	'valor_liquido',
	'data_emissao',
	'razaosocial',
	'nome_fantasia',
	'cidade',
	'uf',
	'representante_nome',
	'gerente_nome',
	'descricao_produto',
	'grupo_de_produtos',
	'quantidade',
	'peso',
];

describe('Blindagem Determinística RAG (4 Camadas - Metodologia Fábio Akita)', () => {
	describe('Camada 1: Guardrail Determinístico de Escopo Fechado (Fail-Fast Out-of-Scope Detector)', () => {
		it('deve bloquear perguntas sobre Lucro Líquido, Margem de Lucro ou CMV quando não há colunas de custo no ERP', () => {
			const profitCheck = detectOutOfScopeBusinessMetric(
				'Qual foi a margem de lucro líquido da empresa em outubro?',
				STANDARD_ERP_COLUMNS,
			);
			assert.equal(profitCheck.outOfScope, true);
			assert.equal(profitCheck.reasonCode, 'UNSUPPORTED_PROFIT_OR_COST_METRIC');
			assert.ok(profitCheck.explanation?.includes('Valor Líquido da Nota Fiscal'));

			const cmvCheck = detectOutOfScopeBusinessMetric(
				'Qual o CMV e custo das mercadorias vendidas por produto?',
				STANDARD_ERP_COLUMNS,
			);
			assert.equal(cmvCheck.outOfScope, true);
			assert.equal(cmvCheck.reasonCode, 'UNSUPPORTED_PROFIT_OR_COST_METRIC');
		});

		it('NÃO deve bloquear perguntas sobre Faturamento Líquido, Valor Líquido das Notas ou Receita Líquida', () => {
			const netBillingCheck = detectOutOfScopeBusinessMetric(
				'Qual foi o faturamento líquido e o valor líquido das notas fiscais em outubro?',
				STANDARD_ERP_COLUMNS,
			);
			assert.equal(netBillingCheck.outOfScope, false);

			const netSalesCheck = detectOutOfScopeBusinessMetric(
				'Mostre a receita líquida por vendedor no mês',
				STANDARD_ERP_COLUMNS,
			);
			assert.equal(netSalesCheck.outOfScope, false);
		});

		it('deve bloquear perguntas sobre Contas a Pagar, Inadimplência/Boletos e Impostos (ICMS/PIS/COFINS) sem colunas correspondentes', () => {
			const payableCheck = detectOutOfScopeBusinessMetric(
				'Quais são as contas a pagar para fornecedores nesta semana?',
				STANDARD_ERP_COLUMNS,
			);
			assert.equal(payableCheck.outOfScope, true);
			assert.equal(payableCheck.reasonCode, 'UNSUPPORTED_ACCOUNTS_PAYABLE_OR_EXPENSES');

			const delinquencyCheck = detectOutOfScopeBusinessMetric(
				'Quais clientes estão inadimplentes com boletos vencidos?',
				STANDARD_ERP_COLUMNS,
			);
			assert.equal(delinquencyCheck.outOfScope, true);
			assert.equal(delinquencyCheck.reasonCode, 'UNSUPPORTED_DELINQUENCY_OR_RECEIVABLES_STATUS');

			const taxCheck = detectOutOfScopeBusinessMetric(
				'Quanto pagamos de ICMS e PIS/COFINS sobre as vendas?',
				STANDARD_ERP_COLUMNS,
			);
			assert.equal(taxCheck.outOfScope, true);
			assert.equal(taxCheck.reasonCode, 'UNSUPPORTED_TAX_ACCOUNTING_METRIC');
		});

		it('deve permitir a métrica caso o tenant tenha sincronizado colunas reais daquele domínio', () => {
			const customCols = [...STANDARD_ERP_COLUMNS, 'vlr_custo_cmv', 'margem_lucro'];
			const check = detectOutOfScopeBusinessMetric(
				'Qual foi a margem de lucro em outubro?',
				customCols,
			);
			assert.equal(check.outOfScope, false);
		});
	});

	describe('Camada 2: Dicionário Determinístico de Sinônimos Corporativos (100% Recall Semântico)', () => {
		it('deve mesclar sinônimos corporativos determinísticos mesmo quando o LLM retorna poucas keywords', async () => {
			const useCase = new ExtractKeywordsUseCase({
				extract: async () => ['praça'], // Simula LLM retornando apenas o jargão regional
			});

			const keywords = await useCase.execute({
				question: 'Qual o faturamento por praça e representante comercial?',
			});

			// Deve ter expandido "praça" -> cidade, uf, bairro, erp_clientes
			assert.ok(keywords.includes('cidade'), 'Deve mapear praça -> cidade');
			assert.ok(keywords.includes('uf'), 'Deve mapear praça -> uf');
			assert.ok(keywords.includes('erp_clientes'), 'Deve mapear praça -> erp_clientes');

			// Deve ter expandido "representante" -> erp_vendedores, representante_nome
			assert.ok(keywords.includes('erp_vendedores'), 'Deve mapear representante -> erp_vendedores');
			assert.ok(keywords.includes('representante_nome'), 'Deve mapear representante -> representante_nome');

			// Deve ter expandido "faturamento" -> erp_nota_fiscal, valor_liquido, operacao
			assert.ok(keywords.includes('erp_nota_fiscal'), 'Deve mapear faturamento -> erp_nota_fiscal');
			assert.ok(keywords.includes('valor_liquido'), 'Deve mapear faturamento -> valor_liquido');
			assert.ok(keywords.includes('operacao'), 'Deve mapear faturamento -> operacao');
		});

		it('deve mapear termos de devolução, bonificação e família de mercadorias para as colunas físicas', async () => {
			const useCase = new ExtractKeywordsUseCase({
				extract: async () => [],
			});

			const keywords = await useCase.execute({
				question: 'Quanto tivemos de bonificação e devolução por família de mercadorias?',
			});

			assert.ok(keywords.includes('operacao'));
			assert.ok(keywords.includes('tipo_movimento'));
			assert.ok(keywords.includes('grupo_de_produtos'));
			assert.ok(keywords.includes('descricao_produto'));
		});
	});

	describe('Camada 3: Validador e Auto-Sanitizador Determinístico de AST/SQL Pré-Execução', () => {
		it('deve envolver colunas numéricas TEXT em CAST(... AS NUMERIC) dentro de SUM, AVG, MIN e MAX automaticamente', () => {
			const rawSql = `SELECT cod_cliente, SUM(valor_liquido) AS total_liq, AVG(nf.valor_bruto) AS media_bruta, MAX(quantidade) AS max_qtd FROM erp_nota_fiscal nf WHERE nf.operacao = 'VENDAS' GROUP BY cod_cliente`;

			const result = sanitizeAndValidateGeneratedSql(
				rawSql,
				'Qual o faturamento e média por cliente?',
			);

			assert.equal(result.wasModified, true);
			assert.ok(result.sql.includes('SUM(CAST(valor_liquido AS NUMERIC))'));
			assert.ok(result.sql.includes('AVG(CAST(nf.valor_bruto AS NUMERIC))'));
			assert.ok(result.sql.includes('MAX(CAST(quantidade AS NUMERIC))'));
		});

		it('deve corrigir ORDER BY alfabético em colunas numéricas TEXT não agrupadas para usar CAST(... AS NUMERIC)', () => {
			const rawSql = `SELECT nota_fiscal, valor_liquido FROM erp_nota_fiscal WHERE operacao = 'VENDAS' ORDER BY valor_liquido DESC LIMIT 10`;

			const result = sanitizeAndValidateGeneratedSql(
				rawSql,
				'Quais as 10 maiores notas fiscais emitidas?',
			);

			assert.equal(result.wasModified, true);
			assert.ok(
				result.sql.includes('ORDER BY CAST(valor_liquido AS NUMERIC) DESC'),
				`SQL esperado com CAST no ORDER BY, recebido: ${result.sql}`,
			);
		});

		it('deve injetar deterministicamente operacao = \'VENDAS\' em consultas de faturamento sobre erp_nota_fiscal quando omitido pelo LLM', () => {
			const rawSqlWithoutFilter = `SELECT TO_CHAR(CAST(nf.data_emissao AS TIMESTAMP), 'DD/MM') AS dia, SUM(CAST(nf.valor_liquido AS NUMERIC)) AS faturamento_total FROM erp_nota_fiscal nf GROUP BY dia ORDER BY MIN(CAST(nf.data_emissao AS TIMESTAMP)) ASC`;

			const result = sanitizeAndValidateGeneratedSql(
				rawSqlWithoutFilter,
				'Qual a evolução diária do faturamento em outubro?',
			);

			assert.equal(result.wasModified, true);
			assert.ok(
				result.sql.includes("WHERE nf.operacao = 'VENDAS' GROUP BY"),
				`Esperava injeção de nf.operacao = 'VENDAS', recebido: ${result.sql}`,
			);
		});

		it('NÃO deve injetar operacao = \'VENDAS\' quando o usuário perguntar sobre devoluções, bonificações ou todas as operações', () => {
			const rawSql = `SELECT operacao, SUM(CAST(valor_liquido AS NUMERIC)) AS total FROM erp_nota_fiscal GROUP BY operacao`;
			const result1 = sanitizeAndValidateGeneratedSql(
				rawSql,
				'Qual o valor de devoluções e bonificações no mês?',
			);
			assert.equal(result1.wasModified, false);

			const rawSql2 = `SELECT nota_fiscal, valor_liquido FROM erp_nota_fiscal WHERE CAST(valor_liquido AS NUMERIC) > 1000`;
			const result2 = sanitizeAndValidateGeneratedSql(
				rawSql2,
				'Mostre as notas de devolução acima de 1000 reais',
			);
			assert.ok(!result2.sql.includes("operacao = 'VENDAS'"));
		});
	});

	describe('Camada 4: Matemática Determinística na CPU e Reconciliação de Dashboards', () => {
		it('deve pré-calcular somas, médias, mínimos e máximos na CPU via ChatRagService.buildDeterministicMathSummary', () => {
			const ragService = new ChatRagService();
			const rows = [
				{ cliente: 'Empresa A', faturamento_total: '1500.50' },
				{ cliente: 'Empresa B', faturamento_total: '2499.50' },
				{ cliente: 'Empresa C', faturamento_total: '1000.00' },
			];

			const mathBlock = ragService.buildDeterministicMathSummary(rows);
			assert.ok(mathBlock.includes('"soma_total": 5000'));
			assert.ok(mathBlock.includes('"media_aritmetica": 1666.67'));
			assert.ok(mathBlock.includes('"minimo": 1000'));
			assert.ok(mathBlock.includes('"maximo": 2499.5'));
		});

		it('deve sanitizar valores monetários formatados como string dentro de blocos ```dashboard e converter pie > 6 fatias para horizontal-bar', () => {
			const reviewer = new ResponseReviewerService();
			const draftWithFlawedDashboard = `Aqui está a distribuição por cliente:

\`\`\`dashboard
{
  "type": "pie",
  "title": "Participação de Clientes",
  "data": [
    {"name": "Cliente 1", "value": "R$ 12.500,50"},
    {"name": "Cliente 2", "value": "R$ 8.300,25"},
    {"name": "Cliente 3", "value": "5.100,00"},
    {"name": "Cliente 4", "value": 4200},
    {"name": "Cliente 5", "value": "R$ 3.100,00"},
    {"name": "Cliente 6", "value": "R$ 2.050,75"},
    {"name": "Cliente 7", "value": "R$ 950,00"}
  ]
}
\`\`\``;

			const reconciled = reviewer.reconcileAndSanitizeDashboardBlocks(draftWithFlawedDashboard);
			const match = reconciled.match(/```dashboard\s*([\s\S]*?)\s*```/i);
			assert.ok(match, 'Deve preservar o bloco dashboard');

			const parsed = JSON.parse(match![1]);
			assert.equal(parsed.type, 'horizontal-bar', 'Deve converter pie com 7 itens para horizontal-bar');
			assert.equal(parsed.data[0].value, 12500.5, 'Deve converter "R$ 12.500,50" para 12500.5');
			assert.equal(parsed.data[1].value, 8300.25, 'Deve converter "R$ 8.300,25" para 8300.25');
			assert.equal(parsed.data[2].value, 5100, 'Deve converter "5.100,00" para 5100');
			assert.equal(typeof parsed.data[6].value, 'number');
		});

		it('deve acionar Fail-Fast determinístico no ResponseReviewerService quando reason === OUT_OF_SCOPE_METRIC sem chamar o LLM', async () => {
			let llmCalled = false;
			const fakeGemini: any = {
				generateChatResponse: async () => {
					llmCalled = true;
					return 'Nosso lucro líquido foi R$ 999.999,00';
				},
			};

			const reviewer = new ResponseReviewerService(fakeGemini);
			const reviewResult = await reviewer.generateAndReviewResponse({
				userQuestion: 'Qual foi o nosso lucro líquido em outubro?',
				history: [{ role: 'user', parts: [{ text: 'Qual foi o nosso lucro líquido em outubro?' }] }],
				systemPrompt: 'System prompt',
				ragResult: {
					noDataFound: true,
					reason: 'OUT_OF_SCOPE_METRIC',
					fallbackMessage: 'O esquema sincronizado não possui dados de CMV ou Lucro Líquido.',
					contextPrompt: null,
					generatedSql: null,
					rowCount: 0,
					rows: [],
				},
				parameters: { temperature: 0.2, topP: 0.9 },
			});

			assert.equal(llmCalled, false, 'Não deve invocar o LLM quando a métrica está fora de escopo');
			assert.equal(reviewResult.usedDeterministicFallback, true);
			assert.ok(reviewResult.finalResponse.includes('CMV ou Lucro Líquido'));
		});
	});
});
