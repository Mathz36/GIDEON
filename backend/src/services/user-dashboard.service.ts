import prismaClient from '../config/prisma';
import GeminiService from './gemini.service';
import chatRagService from './chat-rag.service';
import {
	selectSmartAxes,
	formatSmartAxisLabel,
	parseRowNumericValue,
} from '../utils/smart-axis-selector';

export type WidgetType = 'bar' | 'horizontal-bar' | 'line' | 'area' | 'pie' | 'table';

export interface CreateWidgetInput {
	title: string;
	type: WidgetType;
	data: unknown;
	colSpan?: number;
	rowSpan?: number;
	sqlQuery?: string | null;
	queryPrompt?: string;
}

export interface UpdateLayoutItem {
	id: string;
	colSpan?: number;
	rowSpan?: number;
	order: number;
}

export interface FormattedChartItem {
	name: string;
	value: number;
	[key: string]: unknown;
}

export interface DashboardWidgetPayload {
	type: WidgetType;
	title: string;
	data: unknown;
}

export function formatWidgetForClient(w: any) {
	if (!w) return w;
	const cached = w.cachedData;
	const data = Array.isArray(cached?.data)
		? cached.data
		: Array.isArray(cached)
			? cached
			: [];
	return {
		...w,
		data,
	};
}

const VALID_WIDGET_TYPES: ReadonlySet<WidgetType> = new Set([
	'bar',
	'horizontal-bar',
	'line',
	'area',
	'pie',
	'table',
]);

export class UserDashboardService {
	private readonly gemini: GeminiService;

	constructor(gemini: GeminiService = new GeminiService()) {
		this.gemini = gemini;
	}

	/**
	 * Busca o dashboard do usuário ou cria um vazio caso ainda não exista.
	 * Carrega os widgets ordenados por `order ASC`.
	 */
	async getOrCreateDashboard(userId: string) {
		if (!userId || typeof userId !== 'string') {
			throw new Error('userId inválido ou não informado.');
		}

		let dashboard = await prismaClient.userDashboard.findFirst({
			where: { userId },
			include: {
				widgets: {
					orderBy: { order: 'asc' },
				},
			},
		});

		if (!dashboard) {
			dashboard = await prismaClient.userDashboard.create({
				data: {
					userId,
					title: 'Meu Dashboard',
				},
				include: {
					widgets: {
						orderBy: { order: 'asc' },
					},
				},
			});
		}

		return {
			...dashboard,
			widgets: dashboard.widgets.map(formatWidgetForClient),
		};
	}

	/**
	 * Gera e adiciona um novo widget com pipeline RAG e LLM.
	 * 1. Executa ChatRagService.executeRagPipeline para buscar dados reais e SQL.
	 * 2. Aplica a Matriz Heurística (via Gemini e fallback determinístico) para inferir tipo e layout.
	 * 3. Salva o widget vinculado ao dashboard do usuário ao final do grid.
	 */
	async generateAndAddWidget(userId: string, prompt: string) {
		const cleanPrompt = prompt?.trim();
		if (!cleanPrompt) {
			throw new Error('O prompt para geração do widget é obrigatório.');
		}

		const dashboard = await this.getOrCreateDashboard(userId);

		// 1. Executa o pipeline RAG determinístico
		const ragResult = await chatRagService.executeRagPipeline(cleanPrompt);

		if (ragResult.noDataFound || !ragResult.rows || ragResult.rows.length === 0) {
			throw new Error(
				ragResult.fallbackMessage ||
					'Não foram encontrados registros correspondentes no ERP para responder à consulta e criar o widget.',
			);
		}

		// 2. Determina o tipo de gráfico, título e formatação dos dados pela Matriz Heurística
		const visualMetadata = await this.inferWidgetMetadata(cleanPrompt, ragResult.rows);

		// 3. Define dimensionamento padrão do layout
		let defaultColSpan = 1;
		if (visualMetadata.type === 'table' || visualMetadata.type === 'line' || visualMetadata.type === 'area') {
			defaultColSpan = 2;
		}

		const maxOrder = dashboard.widgets.reduce((max, w) => Math.max(max, w.order), -1);
		const nextOrder = maxOrder + 1;

		const cachedData: DashboardWidgetPayload = {
			type: visualMetadata.type,
			title: visualMetadata.title,
			data: visualMetadata.data,
		};

		const widget = await prismaClient.dashboardWidget.create({
			data: {
				dashboardId: dashboard.id,
				title: visualMetadata.title,
				type: visualMetadata.type,
				queryPrompt: cleanPrompt,
				sqlQuery: ragResult.generatedSql,
				cachedData: cachedData as unknown as object,
				colSpan: defaultColSpan,
				rowSpan: 1,
				order: nextOrder,
			},
		});

		return formatWidgetForClient(widget);
	}

	/**
	 * Cria e adiciona um widget pronto diretamente (ex: fixado a partir do chat).
	 */
	async createWidget(userId: string, input: CreateWidgetInput) {
		const dashboard = await this.getOrCreateDashboard(userId);

		const title = input.title?.trim() || 'Novo Widget';
		const rawType = input.type?.trim().toLowerCase() as WidgetType;
		const type: WidgetType = VALID_WIDGET_TYPES.has(rawType) ? rawType : 'table';

		const colSpan = Math.min(3, Math.max(1, typeof input.colSpan === 'number' ? input.colSpan : (type === 'table' ? 2 : 1)));
		const rowSpan = Math.min(2, Math.max(1, typeof input.rowSpan === 'number' ? input.rowSpan : 1));

		const maxOrder = dashboard.widgets.reduce((max, w) => Math.max(max, w.order), -1);
		const nextOrder = maxOrder + 1;

		let cachedData: DashboardWidgetPayload;
		if (input.data && typeof input.data === 'object' && 'data' in (input.data as Record<string, unknown>)) {
			cachedData = {
				type,
				title,
				data: (input.data as Record<string, unknown>).data,
			};
		} else {
			cachedData = {
				type,
				title,
				data: input.data ?? [],
			};
		}

		const widget = await prismaClient.dashboardWidget.create({
			data: {
				dashboardId: dashboard.id,
				title,
				type,
				queryPrompt: input.queryPrompt?.trim() || title,
				sqlQuery: input.sqlQuery || null,
				cachedData: cachedData as unknown as object,
				colSpan,
				rowSpan,
				order: nextOrder,
			},
		});

		return formatWidgetForClient(widget);
	}

	/**
	 * Atualiza o layout (colSpan, rowSpan, order) dos widgets do usuário em lote.
	 * Garante isolamento estrito RBAC: nenhum widget de outro usuário pode ser modificado.
	 */
	async updateLayout(userId: string, items: UpdateLayoutItem[]) {
		if (!Array.isArray(items)) {
			throw new Error('Lista de itens para atualização de layout inválida.');
		}

		const dashboard = await this.getOrCreateDashboard(userId);
		const allowedWidgetIds = new Set(dashboard.widgets.map((w) => w.id));

		for (const item of items) {
			if (!item || !item.id || typeof item.id !== 'string') {
				throw new Error('Identificador de widget inválido na lista de layout.');
			}
			if (!allowedWidgetIds.has(item.id)) {
				throw new Error(`Acesso negado: o widget "${item.id}" não pertence ao seu dashboard.`);
			}
		}

		await prismaClient.$transaction(
			items.map((item) =>
				prismaClient.dashboardWidget.update({
					where: { id: item.id },
					data: {
						...(typeof item.colSpan === 'number' ? { colSpan: Math.min(3, Math.max(1, item.colSpan)) } : {}),
						...(typeof item.rowSpan === 'number' ? { rowSpan: Math.min(2, Math.max(1, item.rowSpan)) } : {}),
						...(typeof item.order === 'number' ? { order: item.order } : {}),
					},
				}),
			),
		);

		const updatedWidgets = await prismaClient.dashboardWidget.findMany({
			where: { dashboardId: dashboard.id },
			orderBy: { order: 'asc' },
		});
		return updatedWidgets.map(formatWidgetForClient);
	}

	/**
	 * Re-executa a sqlQuery do widget no PostgreSQL via transação Read-Only com timeout de 3s
	 * e atualiza o cachedData.
	 */
	async refreshWidget(userId: string, widgetId: string) {
		if (!widgetId || typeof widgetId !== 'string') {
			throw new Error('ID do widget não informado.');
		}

		const widget = await prismaClient.dashboardWidget.findUnique({
			where: { id: widgetId },
			include: { dashboard: true },
		});

		if (!widget || widget.dashboard.userId !== userId) {
			throw new Error('Widget não encontrado ou você não possui permissão para atualizá-lo.');
		}

		if (!widget.sqlQuery || !widget.sqlQuery.trim()) {
			return formatWidgetForClient(widget);
		}

		// Valida segurança da query antes de re-executar
		if (!chatRagService.isReadOnlyQuery(widget.sqlQuery)) {
			throw new Error('A consulta SQL deste widget não atende às regras de segurança estrita Read-Only.');
		}

		// Executa em transação Read-Only com timeout de 3000ms
		const rawRows = await prismaClient.$transaction(async (tx) => {
			await tx.$executeRawUnsafe('SET LOCAL TRANSACTION READ ONLY');
			await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'");
			return tx.$queryRawUnsafe<Record<string, unknown>[]>(widget.sqlQuery!);
		});

		const rows = Array.isArray(rawRows) ? rawRows : [];
		const sanitizedRows = chatRagService.sanitizeRowsForLgpd(rows);

		// Formata dados preservando a consistência com o tipo de visualização
		const widgetType = widget.type as WidgetType;
		const formattedData = this.formatDataForWidgetType(widgetType, sanitizedRows, widget.title);

		const updatedCachedData: DashboardWidgetPayload = {
			type: widgetType,
			title: widget.title,
			data: formattedData,
		};

		const updated = await prismaClient.dashboardWidget.update({
			where: { id: widgetId },
			data: {
				cachedData: updatedCachedData as unknown as object,
				updatedAt: new Date(),
			},
		});

		return formatWidgetForClient(updated);
	}

	/**
	 * Remove um widget garantindo que pertença ao usuário autenticado.
	 */
	async removeWidget(userId: string, widgetId: string) {
		if (!widgetId || typeof widgetId !== 'string') {
			throw new Error('ID do widget não informado.');
		}

		const widget = await prismaClient.dashboardWidget.findUnique({
			where: { id: widgetId },
			include: { dashboard: true },
		});

		if (!widget || widget.dashboard.userId !== userId) {
			throw new Error('Widget não encontrado ou você não possui permissão para removê-lo.');
		}

		await prismaClient.dashboardWidget.delete({
			where: { id: widgetId },
		});

		return { success: true };
	}

	/**
	 * Inferência do Tipo de Visualização e Título do Widget segundo a Matriz Heurística:
	 * 1. Tenta utilizar o LLM (Gemini) com temperatura baixa e diretiva rigorosa.
	 * 2. Em caso de indisponibilidade de rede ou falha de parsing, executa a heurística analítica determinística.
	 */
	private async inferWidgetMetadata(
		prompt: string,
		rows: Record<string, unknown>[],
	): Promise<{ type: WidgetType; title: string; data: unknown }> {
		const sampleRows = rows.slice(0, 40);

		try {
			const systemInstruction = `Você é um Arquiteto de Business Intelligence e visualização de dados executivos.
Analise a pergunta do gestor e a amostra de dados reais do banco do ERP para definir o tipo ideal de gráfico e um título executivo claro.

MATRIZ HEURÍSTICA DE ESCOLHA DE VISUALIZAÇÃO:
1. "line" ou "area" — SÉRIES TEMPORAIS E TENDÊNCIAS:
   - Obrigatório para evolução cronológica, tendências, faturamento mês a mês, histórico temporal.
   - "line" para tendências e "area" para acumulados.
2. "horizontal-bar" — RANKINGS E TOP N:
   - Obrigatório para rankings e Top N (maiores clientes, produtos mais vendidos, maiores devedores, vendedores).
3. "bar" — COMPARAÇÕES DISCRETAS (< 7 CATEGORIAS):
   - Comparações entre poucas categorias discretas (ex: 3 filiais, 4 trimestres).
4. "pie" — COMPOSIÇÃO / PARTICIPAÇÃO PERCENTUAL (% DO TODO, 3 A 5 CATEGORIAS):
   - Proporções percentuais com poucas categorias (ex: por canal, por forma de pagamento). NUNCA usar para séries temporais nem mais de 6 categorias.
5. "table" — RELATÓRIOS ANALÍTICOS MULTIDIMENSIONAIS:
   - Obrigatório para 3 ou mais atributos de detalhe (código, nome, valor, limite, saldo, status) ou listagens analíticas.

RETORNE APENAS UM JSON VÁLIDO no seguinte formato (sem blocos de código adicionais):
{
  "title": "Título Executivo do Widget",
  "type": "bar" | "horizontal-bar" | "line" | "area" | "pie" | "table",
  "data": [ ... ]
}

REGRAS DOS DADOS:
- Para "bar", "horizontal-bar", "line", "area", "pie": data DEVE ser um array de {"name": string, "value": number}.
- Para "table": data DEVE ser o array com os objetos originais formatados.`;

			const userMessage = `Pergunta do Usuário: "${prompt}"
Amostra de dados retornados do banco (${sampleRows.length} registros):
${JSON.stringify(sampleRows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}`;

			const rawAiResponse = await this.gemini.generateText(
				[{ role: 'user', parts: [{ text: userMessage }] }],
				systemInstruction,
				{ temperature: 0.1, topP: 0.8 },
			);

			const jsonMatch = rawAiResponse.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]) as { title?: unknown; type?: unknown; data?: unknown };
				const rawType = typeof parsed.type === 'string' ? parsed.type.trim().toLowerCase() : '';
				const validTypes: WidgetType[] = ['bar', 'horizontal-bar', 'line', 'area', 'pie', 'table'];

				if (validTypes.includes(rawType as WidgetType)) {
					const resolvedType = rawType as WidgetType;
					const sanitizedTitle =
						typeof parsed.title === 'string' && parsed.title.trim()
							? parsed.title.trim()
							: this.generateDefaultTitle(prompt);

					const formattedData = this.formatDataForWidgetType(
						resolvedType,
						rows,
						`${prompt} ${sanitizedTitle}`,
					);

					return {
						type: resolvedType,
						title: sanitizedTitle,
						data: formattedData,
					};
				}
			}
		} catch (err) {
			console.warn('[UserDashboardService] Aviso ao inferir visualização via LLM, aplicando heurística determinística:', err);
		}

		// Fallback determinístico robusto
		return this.deterministicWidgetInference(prompt, rows);
	}

	/**
	 * Heurística determinística pura baseada no schema das rows e no léxico da pergunta
	 */
	private deterministicWidgetInference(
		prompt: string,
		rows: Record<string, unknown>[],
	): { type: WidgetType; title: string; data: unknown } {
		const lowerPrompt = prompt.toLowerCase();
		const title = this.generateDefaultTitle(prompt);

		if (rows.length === 0) {
			return { type: 'table', title, data: [] };
		}

		const sampleRow = rows[0];
		const keys = Object.keys(sampleRow);

		// Identifica colunas de data/tempo
		const hasTimeKey = keys.some((k) =>
			/(data|mes|ano|periodo|dt|dia|semana|trimestre|date|month|year)/i.test(k),
		);
		const isTimePrompt = /(evolucao|mes a mes|historico|tendencia|ao longo do tempo|diario|mensal)/i.test(
			lowerPrompt,
		);

		if (hasTimeKey || isTimePrompt) {
			const chartData = this.formatDataForWidgetType('line', rows, prompt);
			return { type: 'line', title, data: chartData };
		}

		// Identifica se é Ranking / Top N
		const isRankingPrompt = /(top\s*\d+|ranking|maiores|melhores|mais vendidos|mais lucrativos)/i.test(
			lowerPrompt,
		);
		if (isRankingPrompt) {
			const chartData = this.formatDataForWidgetType('horizontal-bar', rows, prompt);
			return { type: 'horizontal-bar', title, data: chartData };
		}

		// Se tiver 3 ou mais atributos descritivos/analíticos -> Tabela
		if (keys.length >= 3) {
			return { type: 'table', title, data: rows };
		}

		// Composição percentual com poucas categorias (< 6)
		const isCompositionPrompt = /(composicao|distribuicao|participacao|porcentagem|percentual)/i.test(
			lowerPrompt,
		);
		if (isCompositionPrompt && rows.length <= 5) {
			const chartData = this.formatDataForWidgetType('pie', rows, prompt);
			return { type: 'pie', title, data: chartData };
		}

		// Comparações diretas (< 7 categorias) -> bar ou horizontal-bar
		if (rows.length <= 6) {
			const chartData = this.formatDataForWidgetType('bar', rows, prompt);
			return { type: 'bar', title, data: chartData };
		}

		// Caso geral para listagens
		return { type: 'table', title, data: rows };
	}

	/**
	 * Formata linhas retornadas do banco para a estrutura exigida pelo tipo de widget,
	 * utilizando o SmartAxisSelector para escolher semanticamente o Eixo X (data ou nome descritivo)
	 * e o Eixo Y (métrica financeira ou de quantidade), nunca usando códigos de nota/ID como métrica.
	 */
	public formatDataForWidgetType(
		type: WidgetType,
		rows: Record<string, unknown>[],
		promptOrTitle?: string,
	): unknown {
		if (type === 'table') {
			return rows;
		}

		if (rows.length === 0) {
			return [];
		}

		// Verifica se já possui o formato { name, value }
		const first = rows[0];
		if ('name' in first && 'value' in first && Object.keys(first).length === 2) {
			return rows.map((r) => {
				const num = parseRowNumericValue(r.value) ?? 0;
				return {
					name: formatSmartAxisLabel(r.name, 'name'),
					value: Number.isNaN(num) ? 0 : num,
				};
			});
		}

		const { labelKey, numericKey } = selectSmartAxes(rows, type, promptOrTitle);

		return rows.map((row) => {
			const numVal = parseRowNumericValue(row[numericKey]) ?? 0;
			return {
				name: formatSmartAxisLabel(row[labelKey], labelKey),
				value: Number.isNaN(numVal) ? 0 : numVal,
			};
		});
	}

	private generateDefaultTitle(prompt: string): string {
		const cleaned = prompt.replace(/[?.,!]+$/, '').trim();
		if (!cleaned) {
			return 'Métricas do Dashboard';
		}
		return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	}
}

export const userDashboardService = new UserDashboardService();
export default userDashboardService;
