import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini-api-key-ci';
process.env.SANKHYA_SERVICE_URL = process.env.SANKHYA_SERVICE_URL || 'https://api.sankhya.test/dbexplorer';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/gideon_test';

const globalForPrisma = globalThis as unknown as { prisma?: any };
if (!globalForPrisma.prisma) {
	globalForPrisma.prisma = {
		$queryRawUnsafe: async () => [],
		$executeRawUnsafe: async () => 0,
		$transaction: async (fn: (tx: any) => Promise<any>) =>
			fn({
				$executeRawUnsafe: async () => 0,
				$queryRawUnsafe: async () => [],
			}),
	};
}

describe('RAG Complete Anti-Hallucination Package: Closed Black-Hole, Query Rewriter & Response Reviewer Suite', () => {
	let ChatRagServiceClass: any;
	let ResponseReviewerServiceClass: any;
	let prismaClientModule: any;
	let ragSqlPipelineModule: any;

	before(async () => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		ChatRagServiceClass = require('../services/chat-rag.service').ChatRagService;
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		ResponseReviewerServiceClass = require('../services/response-reviewer.service').ResponseReviewerService;
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		prismaClientModule = require('../config/prisma').default;
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		ragSqlPipelineModule = require('../modules/data-dictionary').ragSqlPipeline;
	});

	describe('1. Pilar 1: Fechamento do "Buraco Negro" do RAG e Self-Healing SQL Retry', () => {
		it('NUNCA deve retornar null em retrieveDatabaseContext quando ocorrer INVALID_OR_UNSAFE_SQL ou EXECUTION_ERROR', async () => {
			const originalExecute = ragSqlPipelineModule.execute;

			try {
				ragSqlPipelineModule.execute = async () => ({
					schemaGraph: { allTables: [{ tableName: 'erp_clientes' }] },
					promptResult: { systemPrompt: 'Sys', userPrompt: 'Usr' },
				});

				const unsafeGemini = {
					generateSqlQuery: async () => '```sql\nDROP TABLE erp_clientes\n```',
				};

				const service = new ChatRagServiceClass(unsafeGemini);
				const context = await service.retrieveDatabaseContext('Qual o faturamento?');

				assert.notEqual(context, null, 'retrieveDatabaseContext jamais pode retornar null em erro SQL');
				assert.match(
					context!,
					/SEM_DADOS_DISPONIVEIS|PROIBIÇÃO ABSOLUTA/i,
					'Deve retornar o prompt determinístico de bloqueio anti-alucinação',
				);
			} finally {
				ragSqlPipelineModule.execute = originalExecute;
			}
		});

		it('deve executar Self-Healing SQL Retry e recuperar dados reais quando a primeira query SQL falhar no PostgreSQL', async () => {
			const originalExecute = ragSqlPipelineModule.execute;
			const originalTransaction = prismaClientModule.$transaction;
			const originalQueryRaw = prismaClientModule.$queryRawUnsafe;

			try {
				ragSqlPipelineModule.execute = async () => ({
					schemaGraph: { allTables: [{ tableName: 'erp_nota_fiscal' }] },
					promptResult: { systemPrompt: 'Sys', userPrompt: 'Total de notas' },
				});

				let sqlCallCount = 0;
				const selfHealingGemini = {
					generateSqlQuery: async () => {
						sqlCallCount++;
						if (sqlCallCount === 1) {
							return '```sql\nSELECT coluna_inexistente FROM erp_nota_fiscal LIMIT 5\n```';
						}
						return '```sql\nSELECT nota_fiscal, valor_nota FROM erp_nota_fiscal LIMIT 5\n```';
					},
				};

				let dbAttempt = 0;
				const mockQueryFn = async () => {
					dbAttempt++;
					if (dbAttempt === 1) {
						throw new Error('column "coluna_inexistente" does not exist');
					}
					return [{ nota_fiscal: '1050', valor_nota: 18500.5 }];
				};

				prismaClientModule.$queryRawUnsafe = mockQueryFn;
				prismaClientModule.$transaction = async (fn: (tx: any) => Promise<any>) =>
					fn({
						$executeRawUnsafe: async () => 0,
						$queryRawUnsafe: mockQueryFn,
					});

				const service = new ChatRagServiceClass(selfHealingGemini);
				const result = await service.executeRagPipeline('Qual o valor da nota 1050?');

				assert.equal(sqlCallCount, 2, 'Deve chamar o gerador SQL 2 vezes (inicial + self-healing)');
				assert.equal(result.noDataFound, false, 'Deve recuperar com sucesso na segunda tentativa');
				assert.equal(result.rowCount, 1);
				assert.equal(result.rows[0].nota_fiscal, '1050');
			} finally {
				ragSqlPipelineModule.execute = originalExecute;
				prismaClientModule.$transaction = originalTransaction;
				prismaClientModule.$queryRawUnsafe = originalQueryRaw;
			}
		});
	});

	describe('2. Pilar 2: Query Rewriter Contextual (Histórico Multi-Turn)', () => {
		it('deve reescrever pergunta dependente de contexto ("E quais notas ele tem?") incorporando a entidade do turno anterior', async () => {
			let capturedPrompt = '';
			const mockGemini = {
				generateText: async (messages: any[]) => {
					capturedPrompt = messages[0].parts[0].text;
					return 'Quais notas fiscais pertencem ao cliente DISTRIBUIDORA ALFA (código 402)?';
				},
			};

			const service = new ChatRagServiceClass(mockGemini);
			const history = [
				{ role: 'user', parts: [{ text: 'Quem é o maior cliente?' }] },
				{ role: 'model', parts: [{ text: 'O maior cliente é DISTRIBUIDORA ALFA (código 402) com R$ 90.000,00.' }] },
				{ role: 'user', parts: [{ text: 'E quais notas ele tem?' }] },
			];

			const rewritten = await service.rewriteQueryWithHistory('E quais notas ele tem?', history);

			assert.ok(capturedPrompt.includes('DISTRIBUIDORA ALFA'), 'O histórico deve ser enviado ao Query Rewriter');
			assert.equal(
				rewritten,
				'Quais notas fiscais pertencem ao cliente DISTRIBUIDORA ALFA (código 402)?',
				'A pergunta deve ser reescrita de forma autocontida',
			);
		});
	});

	describe('3. Pilar 3: Agente Revisor (Guardrail Determinístico + Critic Agent + Loop de Auto-Correção + Fallback)', () => {
		it('deve reprovar imediatamente no Guardrail Determinístico respostas que citem empresas fictícias de exemplo ou vazem código SQL', () => {
			const reviewer = new ResponseReviewerServiceClass({});
			const ragWithData = {
				noDataFound: false,
				fallbackMessage: null,
				contextPrompt: '...',
				generatedSql: 'SELECT nome FROM erp_clientes',
				rowCount: 1,
				rows: [{ nome: 'COMERCIAL REAL LTDA', valor: 12000 }],
			};

			const fakeCompanyVerdict = reviewer.evaluateDeterministicGrounding(
				'Quais os maiores clientes?',
				'O maior cliente é a Indústria Metalúrgica Silva & Santos Ltda com R$ 850.400,00.',
				ragWithData,
			);
			assert.equal(fakeCompanyVerdict.approved, false, 'Deve bloquear empresa fictícia banida');

			const sqlLeakVerdict = reviewer.evaluateDeterministicGrounding(
				'Quais os maiores clientes?',
				'Aqui está a consulta:\n```sql\nSELECT * FROM erp_clientes\n```\nCliente: COMERCIAL REAL LTDA.',
				ragWithData,
			);
			assert.equal(sqlLeakVerdict.approved, false, 'Deve bloquear vazamento de bloco SQL ao usuário');
		});

		it('deve bloquear invenção de valores monetários e gráficos quando noDataFound === true, acionando Fallback Determinístico imediato', async () => {
			const mockHallucinatingGemini = {
				generateChatResponse: async () =>
					'O faturamento de 2099 foi de R$ 450.000,00!\n```dashboard\n{"type":"bar","data":[{"name":"2099","value":450000}]}\n```',
			};

			const reviewer = new ResponseReviewerServiceClass(mockHallucinatingGemini, 2);
			const emptyRagResult = {
				noDataFound: true,
				reason: 'EMPTY_RESULT_SET',
				fallbackMessage: 'Não foram encontrados registros correspondentes no banco de dados sincronizado do ERP.',
				contextPrompt: '...',
				generatedSql: 'SELECT * FROM erp_nota_fiscal WHERE ano = 2099',
				rowCount: 0,
				rows: [],
			};

			const outcome = await reviewer.generateAndReviewResponse({
				userQuestion: 'Qual foi o faturamento de 2099?',
				history: [{ role: 'user', parts: [{ text: 'Qual foi o faturamento de 2099?' }] }],
				systemPrompt: 'Sys',
				ragResult: emptyRagResult,
				parameters: { temperature: 0.1, topP: 0.9 },
			});

			assert.equal(outcome.usedDeterministicFallback, true, 'Deve acionar o fallback determinístico quando noDataFound=true e o modelo alucina');
			assert.equal(outcome.finalResponse.includes('R$ 450.000,00'), false, 'O valor inventado jamais pode aparecer na resposta final');
			assert.ok(
				outcome.finalResponse.includes('Não foram encontrados registros correspondentes'),
				'Deve exibir a mensagem transparente de ausência de registros',
			);
		});

		it('deve executar o Loop de Auto-Correção quando a 1ª resposta é reprovada pelo Agente Crítico e aprovar a 2ª resposta corrigida', async () => {
			let generationCall = 0;
			let criticCall = 0;

			const mockSelfCorrectingGemini = {
				generateChatResponse: async () => {
					generationCall++;
					if (generationCall === 1) {
						// 1ª tentativa: cita o nome real mas erra o valor dizendo R$ 999.999,00
						return 'O cliente MERCADO ESTRELA DO SUL faturou R$ 999.999,00 no período.';
					}
					// 2ª tentativa (após crítica): corrige para o valor exato do banco R$ 25.400,00
					return 'O cliente MERCADO ESTRELA DO SUL registrou faturamento exato de R$ 25.400,00 conforme os dados do ERP.';
				},
				generateText: async () => {
					criticCall++;
					if (criticCall === 1) {
						return JSON.stringify({
							approved: false,
							issues: 'O valor R$ 999.999,00 está incorreto; o JSON do banco informa valor_total = 25400.',
							correctionInstruction: 'Informe o valor exato de R$ 25.400,00 para o cliente MERCADO ESTRELA DO SUL.',
						});
					}
					return JSON.stringify({
						approved: true,
						issues: '',
						correctionInstruction: '',
					});
				},
			};

			const reviewer = new ResponseReviewerServiceClass(mockSelfCorrectingGemini, 2);
			const ragResult = {
				noDataFound: false,
				fallbackMessage: null,
				contextPrompt: '...',
				generatedSql: 'SELECT cliente, valor_total FROM erp_nota_fiscal',
				rowCount: 1,
				rows: [{ cliente: 'MERCADO ESTRELA DO SUL', valor_total: 25400 }],
			};

			const outcome = await reviewer.generateAndReviewResponse({
				userQuestion: 'Quanto o Mercado Estrela do Sul faturou?',
				history: [{ role: 'user', parts: [{ text: 'Quanto o Mercado Estrela do Sul faturou?' }] }],
				systemPrompt: 'Sys',
				ragResult,
				parameters: { temperature: 0.1, topP: 0.9 },
			});

			assert.equal(outcome.attempts, 2, 'Deve realizar 2 tentativas (1 reprovada + 1 corrigida)');
			assert.equal(outcome.wasCorrected, true, 'Deve sinalizar que a resposta passou por auto-correção');
			assert.equal(outcome.usedDeterministicFallback, false, 'A 2ª tentativa foi aprovada pelo crítico');
			assert.ok(outcome.finalResponse.includes('R$ 25.400,00'), 'A resposta final deve conter o valor corrigido');
		});

		it('deve acionar o Fallback Determinístico com tabela real do banco caso o LLM falhe em todas as tentativas de revisão', async () => {
			const mockStubbornHallucinatingGemini = {
				generateChatResponse: async () => 'Inventando empresa fantasma Silva & Santos Ltda em todas as tentativas!',
			};

			const reviewer = new ResponseReviewerServiceClass(mockStubbornHallucinatingGemini, 2);
			const ragResult = {
				noDataFound: false,
				fallbackMessage: null,
				contextPrompt: '...',
				generatedSql: 'SELECT cod_cliente, razao_social, valor_liquido FROM erp_clientes',
				rowCount: 2,
				rows: [
					{ cod_cliente: '10', razao_social: 'PADARIA PAO DOURADO', valor_liquido: 8500 },
					{ cod_cliente: '20', razao_social: 'SUPERMERCADO CENTRAL', valor_liquido: 14200 },
				],
			};

			const outcome = await reviewer.generateAndReviewResponse({
				userQuestion: 'Liste os clientes e valores',
				history: [{ role: 'user', parts: [{ text: 'Liste os clientes e valores' }] }],
				systemPrompt: 'Sys',
				ragResult,
				parameters: { temperature: 0.1, topP: 0.9 },
			});

			assert.equal(outcome.usedDeterministicFallback, true, 'Deve acionar o fallback determinístico após esgotar as tentativas');
			assert.equal(outcome.finalResponse.includes('Silva & Santos'), false, 'A alucinação jamais pode vazar');
			assert.ok(outcome.finalResponse.includes('PADARIA PAO DOURADO'), 'Deve conter os dados reais do PostgreSQL');
			assert.ok(outcome.finalResponse.includes('```dashboard'), 'Deve incluir a tabela estruturada com os dados reais');
		});
	});
});
