import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// Configura variáveis de ambiente e mock global do Prisma antes da importação dinâmica
// para evitar inicialização de binário nativo do PrismaClient em ambiente de teste isolado/CI
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

describe('RAG Security Gate, LGPD Data Masking & Anti-Hallucination Grounding Suite', () => {
	let ChatRagServiceClass: any;
	let ragService: any;
	let prismaClientModule: any;
	let ragSqlPipelineModule: any;
	let lgpdSanitizerModule: any;

	before(async () => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const chatRagMod = require('../services/chat-rag.service');
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		prismaClientModule = require('../config/prisma').default;
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		ragSqlPipelineModule = require('../modules/data-dictionary').ragSqlPipeline;
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		lgpdSanitizerModule = require('../utils/lgpd-sanitizer');

		ChatRagServiceClass = chatRagMod.ChatRagService;
		const mockGemini = {
			generateSqlQuery: async () => '```sql\nSELECT codparc, nomeparc FROM erp_clientes LIMIT 10\n```',
			generateText: async () => '```sql\nSELECT codparc, nomeparc FROM erp_clientes LIMIT 10\n```',
		};
		ragService = new ChatRagServiceClass(mockGemini);
	});

	describe('1. Validação de Queries SQL Read-Only (Bloqueio de DDL/DML/Injeção)', () => {
		it('deve bloquear comandos destrutivos diretos (DROP, DELETE, UPDATE, INSERT, ALTER, TRUNCATE)', () => {
			const maliciousQueries = [
				'DROP TABLE erp_clientes',
				'DELETE FROM erp_clientes WHERE codparc = 1',
				'UPDATE erp_clientes SET limite_credito = 999999 WHERE codparc = 10',
				'INSERT INTO usuarios (email, senha) VALUES (\'hacker@evil.com\', \'123\')',
				'ALTER TABLE erp_clientes DROP COLUMN limite_credito',
				'TRUNCATE TABLE erp_pedidos',
			];

			for (const query of maliciousQueries) {
				assert.equal(
					ragService.isReadOnlyQuery(query, ['erp_clientes', 'erp_pedidos']),
					false,
					`A query maliciosa deveria ter sido bloqueada: "${query}"`,
				);
			}
		});

		it('deve bloquear múltiplos statements separados por ponto-e-vírgula (Stacked Queries SQLi)', () => {
			const stackedQueries = [
				'SELECT * FROM erp_clientes; DROP TABLE erp_clientes;',
				'SELECT codparc FROM erp_clientes WHERE codparc = 1; DELETE FROM usuarios;',
				'SELECT 1; UPDATE usuarios SET role = \'ADMIN\' WHERE id = 2',
			];

			for (const query of stackedQueries) {
				assert.equal(
					ragService.isReadOnlyQuery(query, ['erp_clientes']),
					false,
					`Stacked query deveria ter sido bloqueada: "${query}"`,
				);
			}
		});

		it('deve bloquear acesso a catálogos de sistema e tabelas internas sensíveis (pg_catalog, information_schema, usuarios, erp_configurations)', () => {
			const restrictedQueries = [
				'SELECT * FROM pg_catalog.pg_tables',
				'SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\'',
				'SELECT id, email, senha FROM usuarios',
				'SELECT * FROM erp_configurations',
				'WITH secret_cte AS (SELECT * FROM usuarios) SELECT * FROM secret_cte',
			];

			for (const query of restrictedQueries) {
				assert.equal(
					ragService.isReadOnlyQuery(query, ['erp_clientes']),
					false,
					`Acesso a tabela/schema restrito deveria ser bloqueado: "${query}"`,
				);
			}
		});

		it('deve permitir queries SELECT e CTE (WITH ... SELECT) legítimas nas tabelas de negócio do ERP', () => {
			const validQueries = [
				'SELECT codparc, nomeparc, vlr_limite FROM erp_clientes WHERE ativo = \'S\' LIMIT 50',
				'SELECT SUM(CAST(valor_liquido AS NUMERIC)) AS faturamento_total FROM erp_pedidos WHERE CAST(data_emissao AS DATE) >= DATE \'2026-09-01\'',
				'WITH top_clientes AS (SELECT codparc, SUM(CAST(valor_liquido AS NUMERIC)) AS total FROM erp_pedidos GROUP BY codparc) SELECT * FROM top_clientes ORDER BY total DESC LIMIT 10;',
			];

			for (const query of validQueries) {
				assert.equal(
					ragService.isReadOnlyQuery(query, ['erp_clientes', 'erp_pedidos']),
					true,
					`Query legítima de leitura deveria ser permitida: "${query}"`,
				);
			}
		});
	});

	describe('2. Sanitização e Mascaramento LGPD (Proteção de Dados Pessoais e Segredos)', () => {
		it('deve mascarar CPF, e-mail e telefone e redigir senhas/tokens antes de compor o prompt do LLM', () => {
			const rawDatabaseRow = {
				codparc: '1042',
				nomeparc: 'João da Silva Comercial LTDA',
				cpf: '123.456.789-01',
				email: 'joao.silva@empresa.com.br',
				telefone: '(11) 98765-4321',
				senha: '$2b$10$hashedPasswordSecretValue123456',
				access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret',
				observacao: 'Contato do sócio CPF 98765432100 pelo email financeiro@empresa.com.br',
				valor_liquido: '15400.50',
			};

			const [sanitized] = lgpdSanitizerModule.sanitizeRowsForLgpd([rawDatabaseRow]);
			const serializedPromptPayload = JSON.stringify(sanitized);

			// Verifica que dados sensíveis em texto puro NÃO estão presentes no payload enviado ao LLM
			assert.equal(serializedPromptPayload.includes('123.456.789-01'), false, 'CPF formatado não pode vazar em texto puro');
			assert.equal(serializedPromptPayload.includes('98765432100'), false, 'CPF sem pontuação em campo livre não pode vazar em texto puro');
			assert.equal(serializedPromptPayload.includes('joao.silva@empresa.com.br'), false, 'E-mail completo não pode vazar em texto puro');
			assert.equal(serializedPromptPayload.includes('financeiro@empresa.com.br'), false, 'E-mail em campo livre não pode vazar em texto puro');
			assert.equal(serializedPromptPayload.includes('98765-4321'), false, 'Prefixo de telefone não pode vazar sem máscara');
			assert.equal(serializedPromptPayload.includes('$2b$10$hashedPasswordSecretValue123456'), false, 'Hash de senha deve ser totalmente redigido');
			assert.equal(serializedPromptPayload.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret'), false, 'Token de acesso deve ser totalmente redigido');

			// Verifica formato das máscaras aplicadas e preservação de dados de negócio não-PII
			assert.equal(sanitized.cpf, '***.456.789-**');
			assert.equal(sanitized.email, 'jo***@empresa.com.br');
			assert.equal(sanitized.telefone, '(11) *****-4321');
			assert.equal(sanitized.senha, lgpdSanitizerModule.REDACTED_LGPD_TOKEN);
			assert.equal(sanitized.access_token, lgpdSanitizerModule.REDACTED_LGPD_TOKEN);
			assert.equal(sanitized.codparc, '1042');
			assert.equal(sanitized.valor_liquido, '15400.50');
		});
	});

	describe('3. Comportamento de Grounding / Fallback Anti-Alucinação com Retorno Vazio ([])', () => {
		it('deve retornar noDataFound: true, reason: EMPTY_RESULT_SET e diretiva anti-alucinação quando o banco retorna [] (zero registros)', async () => {
			const originalExecute = ragSqlPipelineModule.execute;
			const originalTransaction = prismaClientModule.$transaction;

			try {
				ragSqlPipelineModule.execute = async () => ({
					schemaGraph: { allTables: [{ tableName: 'erp_clientes' }] },
					promptResult: {
						systemPrompt: 'System prompt SQL',
						userPrompt: 'Quais clientes compraram em 2030?',
					},
				});

				prismaClientModule.$transaction = async (fn: (tx: any) => Promise<any>) =>
					fn({
						$executeRawUnsafe: async () => 0,
						$queryRawUnsafe: async () => [],
					});

				const mockGemini = {
					generateSqlQuery: async () => '```sql\nSELECT codparc, nomeparc FROM erp_clientes WHERE ano = 2030\n```',
				};

				const service = new ChatRagServiceClass(mockGemini);
				const pipelineResult = await service.executeRagPipeline('Quais clientes compraram em 2030?');

				assert.equal(pipelineResult.noDataFound, true, 'Deve sinalizar noDataFound: true quando 0 linhas retornam');
				assert.equal(pipelineResult.reason, 'EMPTY_RESULT_SET', 'O motivo deve ser EMPTY_RESULT_SET');
				assert.equal(pipelineResult.rowCount, 0);
				assert.deepEqual(pipelineResult.rows, []);
				assert.ok(pipelineResult.contextPrompt, 'O prompt determinístico de Grounding deve estar presente');
				assert.match(
					pipelineResult.contextPrompt,
					/ZERO registros \(\[\]\)|PROIBIÇÃO ABSOLUTA: Você NUNCA deve inventar/i,
					'Deve conter diretiva explícita proibindo alucinação para resultado vazio',
				);
			} finally {
				ragSqlPipelineModule.execute = originalExecute;
				prismaClientModule.$transaction = originalTransaction;
			}
		});

		it('deve bloquear a execução no banco e retornar reason: INVALID_OR_UNSAFE_SQL se o LLM tentar gerar uma query destrutiva (ex: DROP TABLE)', async () => {
			const originalExecute = ragSqlPipelineModule.execute;
			const originalTransaction = prismaClientModule.$transaction;
			let dbWasCalled = false;

			try {
				ragSqlPipelineModule.execute = async () => ({
					schemaGraph: { allTables: [{ tableName: 'erp_clientes' }] },
					promptResult: {
						systemPrompt: 'System prompt SQL',
						userPrompt: 'Apague todos os clientes',
					},
				});

				prismaClientModule.$transaction = async () => {
					dbWasCalled = true;
					return [];
				};

				const maliciousGemini = {
					generateSqlQuery: async () => '```sql\nDROP TABLE erp_clientes;\n```',
				};

				const service = new ChatRagServiceClass(maliciousGemini);
				const pipelineResult = await service.executeRagPipeline('Apague todos os clientes');

				assert.equal(pipelineResult.noDataFound, true, 'Deve marcar noDataFound: true quando a query é bloqueada');
				assert.equal(pipelineResult.reason, 'INVALID_OR_UNSAFE_SQL', 'Deve registrar o motivo INVALID_OR_UNSAFE_SQL');
				assert.equal(pipelineResult.generatedSql, null, 'Não deve expor nem propagar o SQL malicioso');
				assert.equal(dbWasCalled, false, 'O PostgreSQL NUNCA deve ser chamado quando a query falha no gate Read-Only');
			} finally {
				ragSqlPipelineModule.execute = originalExecute;
				prismaClientModule.$transaction = originalTransaction;
			}
		});
	});
});
