import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// Configuração prévia de variáveis de ambiente para testes sem dependência de serviços externos
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini-key-matrix';
process.env.SANKHYA_SERVICE_URL = process.env.SANKHYA_SERVICE_URL || 'https://api.sankhya.test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

// Mock do prisma global para execução desacoplada
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

/**
 * Interface canônica de Dashboard JSON gerado pelo LLM
 */
export type SupportedChartType = 'bar' | 'horizontal-bar' | 'line' | 'area' | 'pie' | 'table';

export interface DashboardPayload {
	type: SupportedChartType;
	title?: string;
	data: Array<Record<string, unknown>>;
}

export interface DashboardValidationResult {
	valid: boolean;
	sanitizedType: SupportedChartType;
	errors: string[];
	isUnknownTypeSanitized: boolean;
	violatesPieMaxCategories?: boolean;
}

/**
 * Validador e Sanitizador de Estruturas JSON de Dashboards (espelhando a especificação técnica do Gideon)
 */
export function validateAndSanitizeDashboardJson(
	raw: unknown,
	options: { maxPieCategories?: number; strictTypeOnly?: boolean } = {},
): DashboardValidationResult {
	const errors: string[] = [];
	const maxPie = options.maxPieCategories ?? 6;

	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return {
			valid: false,
			sanitizedType: 'table',
			errors: ['O payload do dashboard deve ser um objeto JSON não-nulo'],
			isUnknownTypeSanitized: false,
		};
	}

	const record = raw as Record<string, unknown>;
	const rawType = typeof record.type === 'string' ? record.type.trim().toLowerCase() : '';
	const validTypes: SupportedChartType[] = ['bar', 'horizontal-bar', 'line', 'area', 'pie', 'table'];

	let sanitizedType: SupportedChartType = 'table';
	let isUnknownTypeSanitized = false;

	if (validTypes.includes(rawType as SupportedChartType)) {
		sanitizedType = rawType as SupportedChartType;
	} else {
		isUnknownTypeSanitized = true;
		if (options.strictTypeOnly) {
			errors.push(`Tipo de gráfico desconhecido ou não suportado: "${record.type}"`);
		}
		sanitizedType = 'table';
	}

	if (!Array.isArray(record.data)) {
		errors.push('A propriedade "data" deve ser um array de registros');
	} else if (record.data.length === 0) {
		errors.push('O array "data" não pode ser vazio para um dashboard válido');
	}

	let violatesPieMaxCategories = false;
	if (sanitizedType === 'pie' && Array.isArray(record.data)) {
		if (record.data.length > maxPie) {
			violatesPieMaxCategories = true;
			errors.push(`Gráfico do tipo "pie" excede o limite máximo recomendado de ${maxPie} categorias (recebido: ${record.data.length})`);
		}
	}

	// Para gráficos (não-tabela), valida presença de campos chave name e value numérico
	if (sanitizedType !== 'table' && Array.isArray(record.data)) {
		for (let i = 0; i < record.data.length; i++) {
			const item = record.data[i];
			if (!item || typeof item !== 'object') {
				errors.push(`Item de índice ${i} no array "data" deve ser um objeto`);
				continue;
			}
			const hasName = 'name' in item || 'label' in item;
			const hasValue = 'value' in item || 'total' in item;

			if (!hasName) {
				errors.push(`Item de índice ${i} deve conter o campo de rótulo ("name")`);
			}
			if (!hasValue) {
				errors.push(`Item de índice ${i} deve conter o campo numérico ("value" ou "total")`);
			} else {
				const val = (item as any).value ?? (item as any).total;
				if (typeof val !== 'number' && isNaN(Number(val))) {
					errors.push(`Item de índice ${i} possui valor não numérico: ${val}`);
				}
			}
		}
	}

	return {
		valid: errors.length === 0,
		sanitizedType,
		errors,
		isUnknownTypeSanitized,
		violatesPieMaxCategories,
	};
}

/**
 * Utilitário para extrair bloco ```dashboard do texto de resposta da IA
 */
export function extractDashboardFromMarkdown(markdownText: string): DashboardPayload | null {
	const regex = /```dashboard\s*([\s\S]*?)\s*```/i;
	const match = markdownText.match(regex);
	if (!match || !match[1]) {
		return null;
	}
	try {
		return JSON.parse(match[1].trim()) as DashboardPayload;
	} catch {
		return null;
	}
}

describe('Chart Decision Matrix & Visual Prompt Rules Suite', () => {
	let systemPrompt: string;
	let chatRagService: any;
	let ragSqlPipelineModule: any;
	let prismaClientModule: any;

	before(async () => {
		// Importação dinâmica para garantir que process.env.GEMINI_API_KEY esteja populado antes
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const aiConfigMod = require('../services/ai-configuration.service');
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const chatRagMod = require('../services/chat-rag.service');
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		ragSqlPipelineModule = require('../modules/data-dictionary').ragSqlPipeline;
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		prismaClientModule = require('../config/prisma').default;

		const AiConfigurationServiceClass = aiConfigMod.AiConfigurationService;
		const ChatRagServiceClass = chatRagMod.ChatRagService;

		// Instancia AiConfigurationService com mock do Prisma para obter o DEFAULT_AI_CONFIG
		const mockPrisma = {
			aiConfiguration: {
				findUnique: async () => null,
				create: async ({ data }: any) => ({
					...data,
					createdAt: new Date(),
					updatedAt: new Date(),
				}),
			},
		} as any;

		const aiConfigService = new AiConfigurationServiceClass(mockPrisma);
		const aiConfig = await aiConfigService.get();
		systemPrompt = aiConfig.systemPrompt;

		const mockGemini = {
			generateSqlQuery: async () => '```sql\nSELECT nome, total FROM erp_vendas LIMIT 5\n```',
			generateText: async () => '```sql\nSELECT nome, total FROM erp_vendas LIMIT 5\n```',
		};
		chatRagService = new ChatRagServiceClass(mockGemini as any);
	});

	describe('1. Validação de Regras da Matriz de Decisão Visual em AiConfigurationService', () => {
		it('deve conter a regra explícita de Séries Temporais -> "line" ou "area"', () => {
			assert.ok(systemPrompt.includes('"line"'), 'O prompt deve incluir a opção "line"');
			assert.ok(systemPrompt.includes('"area"'), 'O prompt deve incluir a opção "area"');
			assert.match(
				systemPrompt,
				/s[ée]ries\s+temporais/i,
				'O prompt deve associar explicitamente séries temporais a line/area',
			);
			assert.match(
				systemPrompt,
				/evolu[çc][ãa]o\s+cronol[óo]gica|tend[êe]ncias/i,
				'O prompt deve descrever evolução cronológica e tendências',
			);
		});

		it('deve conter a regra explícita de Rankings e Top N -> "horizontal-bar"', () => {
			assert.ok(
				systemPrompt.includes('"horizontal-bar"'),
				'O prompt deve incluir a recomendação obrigatória de "horizontal-bar"',
			);
			assert.match(
				systemPrompt,
				/rankings?\s+(e|\/)\s+top\s+n/i,
				'O prompt deve direcionar explicitamente rankings e Top N para horizontal-bar',
			);
			assert.match(
				systemPrompt,
				/mobile|r[óo]tulos|cortados/i,
				'O prompt deve justificar a escolha de horizontal-bar pela legibilidade de nomes longos no mobile',
			);
		});

		it('deve conter a regra explícita de Comparações Discretas -> "bar"', () => {
			assert.ok(systemPrompt.includes('"bar"'), 'O prompt deve incluir a opção "bar"');
			assert.match(
				systemPrompt,
				/compara[çc][õo]es\s+discretas/i,
				'O prompt deve descrever comparações discretas para o uso de bar',
			);
			assert.match(
				systemPrompt,
				/<\s*7\s+categorias|poucas\s+categorias/i,
				'O prompt deve limitar bar para poucas categorias (< 7 categorias)',
			);
		});

		it('deve conter a regra explícita de Participação Percentual / Composição -> "pie" (máximo 6 categorias e proibição para séries temporais)', () => {
			assert.ok(systemPrompt.includes('"pie"'), 'O prompt deve incluir a opção "pie"');
			assert.match(
				systemPrompt,
				/composi[çc][ãa]o|participa[çc][ãa]o\s+percentual/i,
				'O prompt deve associar pie a composição e participação percentual (% do todo)',
			);
			assert.match(
				systemPrompt,
				/nunc?a\s+usar\s+["']?pie["']?\s+para\s+s[ée]ries\s+temporais/i,
				'O prompt deve proibir categoricamente o uso de pie para séries temporais',
			);
			assert.match(
				systemPrompt,
				/6\s+categorias|3\s+a\s+5\s+categorias/i,
				'O prompt deve restringir pie a poucas fatias (no máximo 6 categorias)',
			);
		});

		it('deve conter a regra explícita de Relatórios Multidimensionais -> "table"', () => {
			assert.ok(systemPrompt.includes('"table"'), 'O prompt deve incluir a opção "table"');
			assert.match(
				systemPrompt,
				/relat[óo]rios\s+anal[íi]ticos|multidimensionais/i,
				'O prompt deve associar table a relatórios analíticos multidimensionais',
			);
			assert.match(
				systemPrompt,
				/3\+\s+atributos|3\s+ou\s+mais\s+atributos/i,
				'O prompt deve especificar table para 3 ou mais atributos de detalhe',
			);
		});

		it('deve conter as regras estritas de formato JSON para evitar números formatados com R$ no payload', () => {
			assert.match(
				systemPrompt,
				/n[úu]mero\s+puro|nunca\s+formate\s+com\s+["']?r\$/i,
				'O prompt deve proibir inclusão de símbolos monetários (R$) dentro dos valores numéricos do JSON',
			);
			assert.ok(
				systemPrompt.includes('```dashboard'),
				'O prompt deve orientar a saída dentro do bloco de código ```dashboard',
			);
		});
	});

	describe('2. Validação de Diretrizes Visuais em ChatRagService', () => {
		it('deve injetar a diretiva de visualização de dados e bloco dashboard no contextPrompt quando dados reais são encontrados', async () => {
			const originalExecute = ragSqlPipelineModule.execute;
			const originalTransaction = prismaClientModule.$transaction;
			const originalQueryRawUnsafe = prismaClientModule.$queryRawUnsafe;

			try {
				ragSqlPipelineModule.execute = async () => ({
					schemaGraph: { allTables: [{ tableName: 'erp_vendas' }] },
					promptResult: { systemPrompt: 'Sys', userPrompt: 'Faturamento' },
				});

				const mockRows = [
					{ filial: 'Matriz SP', total: 450000.0 },
					{ filial: 'Filial RJ', total: 280000.0 },
				];

				prismaClientModule.$queryRawUnsafe = async () => mockRows;
				prismaClientModule.$transaction = async (fn: (tx: any) => Promise<any>) =>
					fn({
						$executeRawUnsafe: async () => 0,
						$queryRawUnsafe: async () => mockRows,
					});

				const result = await chatRagService.executeRagPipeline('Qual o faturamento por filial?');

				assert.equal(result.noDataFound, false, 'Deve identificar dados encontrados');
				assert.ok(result.contextPrompt, 'Deve gerar contextPrompt preenchido');
				assert.ok(
					result.contextPrompt.includes('[DIRETIVA DE VISUALIZAÇÃO DE DADOS]'),
					'contextPrompt deve conter o bloco [DIRETIVA DE VISUALIZAÇÃO DE DADOS]',
				);
				assert.ok(
					result.contextPrompt.includes('MATRIZ HEURÍSTICA DE ESCOLHA DE VISUALIZAÇÃO DE DADOS'),
					'contextPrompt deve conter a Matriz Heurística',
				);

				// Validação das 5 regras explícitas no contextPrompt do ChatRagService
				assert.ok(
					result.contextPrompt.includes('"line"') && result.contextPrompt.includes('"area"'),
					'ChatRagService deve incluir line e area para séries temporais',
				);
				assert.match(
					result.contextPrompt,
					/s[ée]ries\s+temporais/i,
					'ChatRagService deve referenciar séries temporais',
				);

				assert.ok(
					result.contextPrompt.includes('"horizontal-bar"'),
					'ChatRagService deve incluir horizontal-bar para rankings e Top N',
				);
				assert.match(
					result.contextPrompt,
					/rankings?\s+(e|\/)\s+top\s+n/i,
					'ChatRagService deve referenciar rankings e Top N',
				);

				assert.ok(
					result.contextPrompt.includes('"bar"'),
					'ChatRagService deve incluir bar para comparações discretas',
				);
				assert.match(
					result.contextPrompt,
					/compara[çc][õo]es\s+discretas/i,
					'ChatRagService deve referenciar comparações discretas',
				);

				assert.ok(
					result.contextPrompt.includes('"pie"'),
					'ChatRagService deve incluir pie para composição/percentual',
				);
				assert.match(
					result.contextPrompt,
					/nunc?a\s+usar\s+["']?pie["']?\s+para\s+s[ée]ries\s+temporais/i,
					'ChatRagService deve proibir pie para séries temporais',
				);
				assert.match(
					result.contextPrompt,
					/6\s+categorias/i,
					'ChatRagService deve restringir pie a no máximo 6 categorias',
				);

				assert.ok(
					result.contextPrompt.includes('"table"'),
					'ChatRagService deve incluir table para relatórios multidimensionais',
				);
				assert.match(
					result.contextPrompt,
					/relat[óo]rios\s+anal[íi]ticos|multidimensionais/i,
					'ChatRagService deve referenciar relatórios multidimensionais',
				);
			} finally {
				ragSqlPipelineModule.execute = originalExecute;
				prismaClientModule.$transaction = originalTransaction;
				prismaClientModule.$queryRawUnsafe = originalQueryRawUnsafe;
			}
		});

		it('deve bloquear estritamente a geração de dashboards visuais quando o banco retornar vazio (noDataFound: true)', async () => {
			const originalExecute = ragSqlPipelineModule.execute;
			const originalTransaction = prismaClientModule.$transaction;
			const originalQueryRawUnsafe = prismaClientModule.$queryRawUnsafe;

			try {
				ragSqlPipelineModule.execute = async () => ({
					schemaGraph: { allTables: [{ tableName: 'erp_vendas' }] },
					promptResult: { systemPrompt: 'Sys', userPrompt: 'Faturamento de 2099' },
				});

				prismaClientModule.$queryRawUnsafe = async () => [];
				prismaClientModule.$transaction = async (fn: (tx: any) => Promise<any>) =>
					fn({
						$executeRawUnsafe: async () => 0,
						$queryRawUnsafe: async () => [],
					});

				const result = await chatRagService.executeRagPipeline('Qual o faturamento de 2099?');

				assert.equal(result.noDataFound, true, 'Deve marcar noDataFound: true');
				assert.ok(result.contextPrompt, 'Deve conter prompt determinístico de fallback');
				assert.match(
					result.contextPrompt,
					/NUNCA gere blocos\s+```dashboard```\s+quando n[ãa]o houver registros reais/i,
					'Deve proibir expressamente geração de bloco dashboard sem dados reais',
				);
			} finally {
				ragSqlPipelineModule.execute = originalExecute;
				prismaClientModule.$transaction = originalTransaction;
				prismaClientModule.$queryRawUnsafe = originalQueryRawUnsafe;
			}
		});

		it('deve garantir que a composição integrada do System Prompt preserva todas as regras da Matriz Heurística', async () => {
			const fullConsolidatedPrompt = `${systemPrompt}\n\n[DIRETIVA DE VISUALIZAÇÃO DE DADOS]\n\`\`\`dashboard\n...\n\`\`\``;

			const requiredTypes: SupportedChartType[] = ['bar', 'horizontal-bar', 'line', 'area', 'pie', 'table'];
			for (const chartType of requiredTypes) {
				assert.ok(
					fullConsolidatedPrompt.includes(`"${chartType}"`),
					`O prompt consolidado de produção deve referenciar o tipo "${chartType}"`,
				);
			}
		});
	});

	describe('3. Validação e Sanitização de Estruturas JSON de Dashboards Simuladas', () => {
		it('deve aceitar com sucesso todos os 6 tipos visuais válidos com payloads estruturados corretos', () => {
			const validSamples: DashboardPayload[] = [
				{
					type: 'line',
					title: 'Evolução Semestral',
					data: [
						{ name: 'Jan/24', value: 100 },
						{ name: 'Fev/24', value: 150 },
					],
				},
				{
					type: 'area',
					title: 'Volume Acumulado',
					data: [
						{ name: 'Semana 1', value: 50 },
						{ name: 'Semana 2', value: 120 },
					],
				},
				{
					type: 'horizontal-bar',
					title: 'Top 5 Clientes',
					data: [
						{ name: 'Cliente A', value: 5000 },
						{ name: 'Cliente B', value: 3500 },
					],
				},
				{
					type: 'bar',
					title: 'Vendas por Filial',
					data: [
						{ name: 'SP', value: 300 },
						{ name: 'RJ', value: 200 },
					],
				},
				{
					type: 'pie',
					title: 'Canais de Distribuição',
					data: [
						{ name: 'Direto', value: 60 },
						{ name: 'Parceiros', value: 40 },
					],
				},
				{
					type: 'table',
					title: 'Extrato Detalhado',
					data: [
						{ cod: 1, descricao: 'Produto Alpha', valor: 250, status: 'Ativo' },
						{ cod: 2, descricao: 'Produto Beta', valor: 450, status: 'Inativo' },
					],
				},
			];

			for (const sample of validSamples) {
				const result = validateAndSanitizeDashboardJson(sample);
				assert.equal(result.valid, true, `Payload para tipo "${sample.type}" deveria ser válido: ${result.errors.join(', ')}`);
				assert.equal(result.sanitizedType, sample.type, `O tipo sanitizado deve coincidir com "${sample.type}"`);
				assert.equal(result.isUnknownTypeSanitized, false, 'Não deve marcar tipo conhecido como sanitizado');
			}
		});

		it('deve sanitizar tipos desconhecidos ou inválidos (ex: "scatter", "radar", "bubble") convertendo para fallback seguro "table"', () => {
			const unknownSamples = [
				{ type: 'scatter', title: 'Dispersão', data: [{ name: 'Ponto 1', value: 10 }] },
				{ type: 'radar', title: 'Radar de Habilidades', data: [{ name: 'Eixo 1', value: 80 }] },
				{ type: 'bubble', title: 'Bolhas', data: [{ name: 'Bolha 1', value: 20 }] },
				{ type: 'desconhecido', title: 'Custom', data: [{ name: 'X', value: 1 }] },
			];

			for (const sample of unknownSamples) {
				const result = validateAndSanitizeDashboardJson(sample);
				assert.equal(result.sanitizedType, 'table', `Tipo desconhecido "${sample.type}" deve ser sanitizado para "table"`);
				assert.equal(result.isUnknownTypeSanitized, true, 'Deve sinalizar que o tipo foi convertido');
			}
		});

		it('deve rejeitar tipo desconhecido quando o modo estrito strictTypeOnly estiver habilitado', () => {
			const sample = { type: 'sunburst', title: 'Hierarquia', data: [{ name: 'Root', value: 100 }] };
			const result = validateAndSanitizeDashboardJson(sample, { strictTypeOnly: true });

			assert.equal(result.valid, false, 'Deve invalidar no modo estrito');
			assert.ok(
				result.errors.some((e) => e.includes('sunburst')),
				'Deve reportar mensagem de erro contendo o tipo não suportado',
			);
		});

		it('deve detectar violação de regra quando gráfico "pie" excede o limite máximo recomendado de 6 categorias', () => {
			const overcrowdedPie: DashboardPayload = {
				type: 'pie',
				title: 'Participação com muitas fatias',
				data: [
					{ name: 'Cat 1', value: 10 },
					{ name: 'Cat 2', value: 10 },
					{ name: 'Cat 3', value: 10 },
					{ name: 'Cat 4', value: 10 },
					{ name: 'Cat 5', value: 10 },
					{ name: 'Cat 6', value: 10 },
					{ name: 'Cat 7', value: 10 }, // 7 categorias > 6 permitido
				],
			};

			const result = validateAndSanitizeDashboardJson(overcrowdedPie, { maxPieCategories: 6 });
			assert.equal(result.valid, false, 'Pie com mais de 6 fatias deve falhar na validação estrita');
			assert.equal(result.violatesPieMaxCategories, true, 'Deve acusar flag violatesPieMaxCategories');
			assert.ok(
				result.errors.some((e) => e.includes('excede o limite máximo recomendado de 6 categorias')),
				'Deve gerar erro de negócio específico para excesso de fatias',
			);
		});

		it('deve rejeitar payloads corrompidos (sem campo data, data vazio ou valores não numéricos em gráficos)', () => {
			const corruptedCases = [
				{
					payload: { type: 'bar', title: 'Sem Data' },
					errorMatch: 'array de registros',
				},
				{
					payload: { type: 'line', title: 'Data Vazio', data: [] },
					errorMatch: 'não pode ser vazio',
				},
				{
					payload: { type: 'bar', title: 'Valor Não Numérico', data: [{ name: 'A', value: 'cem reais' }] },
					errorMatch: 'valor não numérico',
				},
				{
					payload: { type: 'horizontal-bar', title: 'Sem Rótulo Name', data: [{ valor: 100 }] },
					errorMatch: 'rótulo ("name")',
				},
			];

			for (const tc of corruptedCases) {
				const result = validateAndSanitizeDashboardJson(tc.payload);
				assert.equal(result.valid, false, `Caso corrompido "${tc.payload.title}" deveria falhar`);
				assert.ok(
					result.errors.some((e) => e.includes(tc.errorMatch)),
					`Deveria conter erro compatível com "${tc.errorMatch}". Encontrado: ${result.errors.join('; ')}`,
				);
			}
		});

		it('deve extrair e validar com precisão blocos ```dashboard a partir de respostas completas do LLM', () => {
			const assistantResponse = `
Com base nos dados sincronizados do ERP, o ranking dos maiores clientes é apresentado abaixo:

\`\`\`dashboard
{
  "type": "horizontal-bar",
  "title": "Top 3 Clientes por Receita",
  "data": [
    {"name": "Indústria Alfa S/A", "value": 150000.00},
    {"name": "Comércio Beta Ltda", "value": 98000.50},
    {"name": "Distribuidora Gama", "value": 64000.00}
  ]
}
\`\`\`

Os clientes acima respondem por 72% do faturamento registrado no período.
`;

			const parsed = extractDashboardFromMarkdown(assistantResponse);
			assert.ok(parsed, 'Deve conseguir extrair o bloco ```dashboard');
			assert.equal(parsed?.type, 'horizontal-bar');
			assert.equal(parsed?.title, 'Top 3 Clientes por Receita');
			assert.equal(parsed?.data.length, 3);

			const validation = validateAndSanitizeDashboardJson(parsed);
			assert.equal(validation.valid, true, 'O bloco extraído deve ser válido');
			assert.equal(validation.sanitizedType, 'horizontal-bar');
		});
	});
});
