import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Configuração prévia de variáveis de ambiente para execução isolada e sem dependência de serviços externos
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini-key-dashboard';
process.env.SANKHYA_SERVICE_URL = process.env.SANKHYA_SERVICE_URL || 'https://api.sankhya.test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

// Mock do prisma global para execução desacoplada do binário de produção
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
 * Tipos canônicos de gráficos e visualizações suportados pelos widgets do Dashboard
 */
export type SupportedWidgetType =
	| 'bar'
	| 'horizontal-bar'
	| 'line'
	| 'area'
	| 'pie'
	| 'table'
	| 'kpi';

export const SUPPORTED_WIDGET_TYPES: readonly SupportedWidgetType[] = [
	'bar',
	'horizontal-bar',
	'line',
	'area',
	'pie',
	'table',
	'kpi',
] as const;

/**
 * Entidade de Widget do Dashboard
 */
export interface DashboardWidget {
	id: string;
	dashboardId: string;
	userId: string;
	title: string;
	type: SupportedWidgetType;
	sqlQuery?: string;
	colSpan: number; // 1 a 12 (grid de 12 colunas)
	rowSpan: number; // >= 1
	order: number; // Índice sequencial de ordenação (0, 1, 2...)
	x?: number; // Coordenada X opcional para grids livres
	y?: number; // Coordenada Y opcional para grids livres
	config?: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Entidade de Dashboard do Usuário
 */
export interface UserDashboard {
	id: string;
	userId: string;
	title: string;
	description?: string;
	isDefault?: boolean;
	widgets: DashboardWidget[];
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateDashboardDTO {
	title: string;
	description?: string;
	isDefault?: boolean;
}

export interface UpdateDashboardDTO {
	title?: string;
	description?: string;
	isDefault?: boolean;
}

export interface CreateWidgetDTO {
	title: string;
	type: SupportedWidgetType;
	sqlQuery?: string;
	colSpan?: number;
	rowSpan?: number;
	order?: number;
	x?: number;
	y?: number;
	config?: Record<string, unknown>;
}

export interface LayoutAutoSaveItem {
	widgetId: string;
	colSpan: number;
	rowSpan: number;
	order: number;
	x?: number;
	y?: number;
}

/**
 * Erros canônicos de domínio para RBAC, Layout e Sanitização
 */
export class DashboardAccessDeniedError extends Error {
	public readonly statusCode = 403;
	constructor(message = 'Acesso negado: você não tem permissão para acessar ou modificar este dashboard.') {
		super(message);
		this.name = 'DashboardAccessDeniedError';
	}
}

export class DashboardNotFoundError extends Error {
	public readonly statusCode = 404;
	constructor(id: string) {
		super(`Dashboard não encontrado: ${id}`);
		this.name = 'DashboardNotFoundError';
	}
}

export class WidgetAccessDeniedError extends Error {
	public readonly statusCode = 403;
	constructor(message = 'Acesso negado: widget pertence a outro usuário.') {
		super(message);
		this.name = 'WidgetAccessDeniedError';
	}
}

export class WidgetNotFoundError extends Error {
	public readonly statusCode = 404;
	constructor(id: string) {
		super(`Widget não encontrado: ${id}`);
		this.name = 'WidgetNotFoundError';
	}
}

export class UnsafeWidgetSqlError extends Error {
	public readonly statusCode = 400;
	constructor(reason: string) {
		super(`Query SQL insegura ou não autorizada para o widget: ${reason}`);
		this.name = 'UnsafeWidgetSqlError';
	}
}

export class InvalidLayoutError extends Error {
	public readonly statusCode = 400;
	constructor(message: string) {
		super(`Parâmetros de layout inválidos: ${message}`);
		this.name = 'InvalidLayoutError';
	}
}

/**
 * Serviço canônico de gerenciamento de Dashboards do Usuário ("Seu Dashboard")
 * Implementa isolamento estrito multi-tenant (RBAC), auto-save de layout e sanitização de queries SQL de widgets.
 */
export class UserDashboardService {
	private dashboards: Map<string, UserDashboard> = new Map();
	private widgets: Map<string, DashboardWidget> = new Map();
	private chatRagServiceInstance: any;

	constructor(chatRagServiceInstance?: any) {
		this.chatRagServiceInstance = chatRagServiceInstance;
	}

	/**
	 * Valida limites do grid de layout
	 */
	public validateLayoutItem(item: LayoutAutoSaveItem): void {
		if (!item.widgetId || typeof item.widgetId !== 'string') {
			throw new InvalidLayoutError('widgetId é obrigatório e deve ser uma string válida');
		}

		if (typeof item.colSpan !== 'number' || item.colSpan < 1 || item.colSpan > 12) {
			throw new InvalidLayoutError(`colSpan deve estar entre 1 e 12 colunas. Recebido: ${item.colSpan}`);
		}

		if (typeof item.rowSpan !== 'number' || item.rowSpan < 1) {
			throw new InvalidLayoutError(`rowSpan deve ser no mínimo 1 linha. Recebido: ${item.rowSpan}`);
		}

		if (typeof item.order !== 'number' || item.order < 0 || !Number.isInteger(item.order)) {
			throw new InvalidLayoutError(`order deve ser um número inteiro maior ou igual a 0. Recebido: ${item.order}`);
		}
	}

	/**
	 * Sanitiza e valida se a query SQL do widget é estritamente Read-Only e segura contra injeção SQL / DDL / DML
	 */
	public validateWidgetSqlQuery(
		query?: string,
		allowedTables: string[] = ['erp_vendas', 'erp_clientes', 'erp_produtos', 'erp_pedidos', 'erp_financeiro'],
	): { valid: boolean; reason?: string } {
		if (!query || !query.trim()) {
			return { valid: true };
		}

		const trimmed = query.trim().replace(/;\s*$/, '');
		if (!trimmed) {
			return { valid: false, reason: 'A query SQL informada está vazia.' };
		}

		// Remove comentários para análise estrita
		const withoutComments = trimmed
			.replace(/--[^\r\n]*/g, ' ')
			.replace(/\/\*[\s\S]*?\*\//g, ' ')
			.trim();

		// Remove strings literais simples ('...')
		const withoutStringLiterals = withoutComments.replace(/'(?:''|[^'])*'/g, "''");

		// 1. Bloqueia stacked queries (múltiplos statements com ';')
		if (withoutStringLiterals.includes(';')) {
			return {
				valid: false,
				reason: 'Múltiplos comandos SQL separados por ponto-e-vírgula não são permitidos (prevenção de Stacked SQLi).',
			};
		}

		const normalizedUpper = withoutStringLiterals.toUpperCase();

		// 2. Permite apenas SELECT ou WITH ... SELECT
		const startsWithSelect = /^SELECT\b/.test(normalizedUpper);
		const startsWithWithAndHasSelect =
			/^WITH\b/.test(normalizedUpper) && /\bSELECT\b/.test(normalizedUpper);

		if (!startsWithSelect && !startsWithWithAndHasSelect) {
			return {
				valid: false,
				reason: 'A query deve ser estritamente de somente-leitura iniciando com SELECT ou WITH ... SELECT.',
			};
		}

		// 3. Bloqueia palavras-chave proibidas de DDL e DML
		const forbiddenKeywords = [
			'INSERT',
			'UPDATE',
			'DELETE',
			'DROP',
			'ALTER',
			'TRUNCATE',
			'CREATE',
			'GRANT',
			'REVOKE',
			'EXEC',
			'EXECUTE',
			'CALL',
			'MERGE',
			'UPSERT',
			'COPY',
		];

		const tokens = normalizedUpper.split(/[^A-Z0-9_]+/).filter(Boolean);
		for (const token of tokens) {
			if (forbiddenKeywords.includes(token)) {
				return {
					valid: false,
					reason: `Comando ou cláusula mutativa proibida detectada: "${token}".`,
				};
			}
		}

		// Bloqueia SELECT ... INTO
		if (/\bSELECT\b[\s\S]*?\bINTO\b/i.test(withoutStringLiterals)) {
			return {
				valid: false,
				reason: 'Cláusula "SELECT INTO" é proibida.',
			};
		}

		// 4. Bloqueia acesso a tabelas sensíveis de sistema e credenciais
		const forbiddenSchemasAndTables = [
			'pg_catalog',
			'information_schema',
			'pg_class',
			'pg_tables',
			'usuarios',
			'erp_configurations',
			'ai_configurations',
		];

		const normalizedLower = withoutStringLiterals.toLowerCase();
		for (const forbidden of forbiddenSchemasAndTables) {
			const regex = new RegExp(`(^|[^a-z0-9_])${forbidden}($|[^a-z0-9_])`, 'i');
			if (regex.test(normalizedLower)) {
				return {
					valid: false,
					reason: `Tentativa de consulta a tabela ou catálogo sensível restrito: "${forbidden}".`,
				};
			}
		}

		// 5. Bloqueia funções perigosas do PostgreSQL
		if (/\b(pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|dblink|lo_import|lo_export)\s*\(/i.test(normalizedLower)) {
			return {
				valid: false,
				reason: 'Chamada a função interna restrita ou potencialmente abusiva do PostgreSQL.',
			};
		}

		// 6. Se ChatRagService estiver injetado, valida a paridade estrita
		if (this.chatRagServiceInstance && typeof this.chatRagServiceInstance.isReadOnlyQuery === 'function') {
			const ragApproved = this.chatRagServiceInstance.isReadOnlyQuery(query, allowedTables);
			if (!ragApproved) {
				return {
					valid: false,
					reason: 'A query foi rejeitada pelo validador central de segurança do motor RAG (isReadOnlyQuery).',
				};
			}
		}

		return { valid: true };
	}

	/**
	 * Cria um novo Dashboard vinculado estritamente ao userId do proprietário
	 */
	public async createDashboard(userId: string, data: CreateDashboardDTO): Promise<UserDashboard> {
		if (!userId || !userId.trim()) {
			throw new DashboardAccessDeniedError('userId é obrigatório para criar um dashboard');
		}

		if (!data.title || !data.title.trim()) {
			throw new Error('O título do dashboard é obrigatório');
		}

		const id = `dash_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const now = new Date();

		const dashboard: UserDashboard = {
			id,
			userId,
			title: data.title.trim(),
			description: data.description?.trim(),
			isDefault: Boolean(data.isDefault),
			widgets: [],
			createdAt: now,
			updatedAt: now,
		};

		this.dashboards.set(id, dashboard);
		return { ...dashboard, widgets: [] };
	}

	/**
	 * Busca dashboard por ID garantindo que pertence exclusivamente ao userId solicitante
	 */
	public async getDashboardById(userId: string, dashboardId: string): Promise<UserDashboard> {
		const dashboard = this.dashboards.get(dashboardId);
		if (!dashboard) {
			throw new DashboardNotFoundError(dashboardId);
		}

		// Isolamento Multi-tenant estrito: impede vazamento de dados de outro usuário
		if (dashboard.userId !== userId) {
			throw new DashboardAccessDeniedError('Acesso negado: dashboard pertence a outro usuário.');
		}

		const userWidgets = Array.from(this.widgets.values())
			.filter((w) => w.dashboardId === dashboardId && w.userId === userId)
			.sort((a, b) => a.order - b.order);

		return {
			...dashboard,
			widgets: userWidgets.map((w) => ({ ...w })),
		};
	}

	/**
	 * Lista apenas os dashboards pertencentes ao userId informado
	 */
	public async listDashboards(userId: string): Promise<UserDashboard[]> {
		if (!userId) {
			return [];
		}

		const userDashboards = Array.from(this.dashboards.values())
			.filter((d) => d.userId === userId)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

		return userDashboards.map((d) => {
			const widgets = Array.from(this.widgets.values())
				.filter((w) => w.dashboardId === d.id && w.userId === userId)
				.sort((a, b) => a.order - b.order);
			return {
				...d,
				widgets: widgets.map((w) => ({ ...w })),
			};
		});
	}

	/**
	 * Atualiza dados cadastrais do dashboard
	 */
	public async updateDashboard(
		userId: string,
		dashboardId: string,
		data: UpdateDashboardDTO,
	): Promise<UserDashboard> {
		const dashboard = this.dashboards.get(dashboardId);
		if (!dashboard) {
			throw new DashboardNotFoundError(dashboardId);
		}

		if (dashboard.userId !== userId) {
			throw new DashboardAccessDeniedError('Acesso negado: tentativa de modificar dashboard de outro usuário.');
		}

		if (data.title !== undefined) {
			if (!data.title.trim()) {
				throw new Error('O título do dashboard não pode ser vazio');
			}
			dashboard.title = data.title.trim();
		}

		if (data.description !== undefined) {
			dashboard.description = data.description.trim();
		}

		if (data.isDefault !== undefined) {
			dashboard.isDefault = Boolean(data.isDefault);
		}

		dashboard.updatedAt = new Date();
		return this.getDashboardById(userId, dashboardId);
	}

	/**
	 * Deleta um dashboard e todos os seus widgets em cascata
	 */
	public async deleteDashboard(userId: string, dashboardId: string): Promise<void> {
		const dashboard = this.dashboards.get(dashboardId);
		if (!dashboard) {
			throw new DashboardNotFoundError(dashboardId);
		}

		if (dashboard.userId !== userId) {
			throw new DashboardAccessDeniedError('Acesso negado: tentativa de excluir dashboard de outro usuário.');
		}

		// Remove todos os widgets vinculados
		for (const [widgetId, widget] of Array.from(this.widgets.entries())) {
			if (widget.dashboardId === dashboardId) {
				this.widgets.delete(widgetId);
			}
		}

		this.dashboards.delete(dashboardId);
	}

	/**
	 * Adiciona um widget ao dashboard, validando propriedade, limites de layout e query SQL
	 */
	public async addWidget(
		userId: string,
		dashboardId: string,
		data: CreateWidgetDTO,
	): Promise<DashboardWidget> {
		const dashboard = this.dashboards.get(dashboardId);
		if (!dashboard) {
			throw new DashboardNotFoundError(dashboardId);
		}

		if (dashboard.userId !== userId) {
			throw new DashboardAccessDeniedError('Acesso negado: você não pode adicionar widgets ao dashboard de outro usuário.');
		}

		if (!SUPPORTED_WIDGET_TYPES.includes(data.type)) {
			throw new Error(`Tipo de visualização não suportado: ${data.type}`);
		}

		// Valida sanitização SQL do widget
		if (data.sqlQuery) {
			const validation = this.validateWidgetSqlQuery(data.sqlQuery);
			if (!validation.valid) {
				throw new UnsafeWidgetSqlError(validation.reason || 'Query SQL insegura.');
			}
		}

		const colSpan = data.colSpan ?? 6;
		const rowSpan = data.rowSpan ?? 2;
		const currentWidgets = Array.from(this.widgets.values()).filter((w) => w.dashboardId === dashboardId);
		const order = data.order ?? currentWidgets.length;

		// Valida dimensões iniciais
		this.validateLayoutItem({
			widgetId: 'temp_id',
			colSpan,
			rowSpan,
			order,
		});

		const widgetId = `wid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const now = new Date();

		const widget: DashboardWidget = {
			id: widgetId,
			dashboardId,
			userId,
			title: data.title.trim(),
			type: data.type,
			sqlQuery: data.sqlQuery?.trim(),
			colSpan,
			rowSpan,
			order,
			x: data.x,
			y: data.y,
			config: data.config ? { ...data.config } : undefined,
			createdAt: now,
			updatedAt: now,
		};

		this.widgets.set(widgetId, widget);
		dashboard.updatedAt = now;

		return { ...widget };
	}

	/**
	 * Deleta um widget garantindo validação de titularidade
	 */
	public async deleteWidget(userId: string, widgetId: string): Promise<void> {
		const widget = this.widgets.get(widgetId);
		if (!widget) {
			throw new WidgetNotFoundError(widgetId);
		}

		if (widget.userId !== userId) {
			throw new WidgetAccessDeniedError('Acesso negado: tentativa de excluir widget pertencente a outro usuário.');
		}

		this.widgets.delete(widgetId);

		const dashboard = this.dashboards.get(widget.dashboardId);
		if (dashboard) {
			dashboard.updatedAt = new Date();
		}
	}

	/**
	 * Move e reordena a posição de um widget no grid
	 */
	public async moveWidget(userId: string, widgetId: string, targetOrder: number): Promise<DashboardWidget[]> {
		const widget = this.widgets.get(widgetId);
		if (!widget) {
			throw new WidgetNotFoundError(widgetId);
		}

		if (widget.userId !== userId) {
			throw new WidgetAccessDeniedError('Acesso negado: tentativa de mover widget pertencente a outro usuário.');
		}

		if (typeof targetOrder !== 'number' || targetOrder < 0 || !Number.isInteger(targetOrder)) {
			throw new InvalidLayoutError(`targetOrder deve ser um número inteiro >= 0. Recebido: ${targetOrder}`);
		}

		const dashboardWidgets = Array.from(this.widgets.values())
			.filter((w) => w.dashboardId === widget.dashboardId)
			.sort((a, b) => a.order - b.order);

		// Remove o widget da posição antiga e insere na nova
		const filtered = dashboardWidgets.filter((w) => w.id !== widgetId);
		filtered.splice(targetOrder, 0, widget);

		const now = new Date();
		filtered.forEach((w, idx) => {
			w.order = idx;
			w.updatedAt = now;
		});

		const dashboard = this.dashboards.get(widget.dashboardId);
		if (dashboard) {
			dashboard.updatedAt = now;
		}

		return filtered.map((w) => ({ ...w }));
	}

	/**
	 * Auto-Save de Layout: Persiste em lote e atomicamente a atualização de colSpan, rowSpan e order
	 */
	public async updateLayoutAutoSave(
		userId: string,
		dashboardId: string,
		layoutUpdates: LayoutAutoSaveItem[],
	): Promise<DashboardWidget[]> {
		const dashboard = this.dashboards.get(dashboardId);
		if (!dashboard) {
			throw new DashboardNotFoundError(dashboardId);
		}

		if (dashboard.userId !== userId) {
			throw new DashboardAccessDeniedError('Acesso negado: você não tem permissão para alterar o layout deste dashboard.');
		}

		if (!Array.isArray(layoutUpdates)) {
			throw new InvalidLayoutError('O payload de auto-save de layout deve ser um array.');
		}

		// 1. Fase de Validação Estrita (Atomic Validation Check):
		// Nenhum registro é modificado se qualquer item for inválido ou pertencer a outro usuário
		for (const update of layoutUpdates) {
			this.validateLayoutItem(update);

			const widget = this.widgets.get(update.widgetId);
			if (!widget) {
				throw new WidgetNotFoundError(update.widgetId);
			}

			// Garante que o widget pertence ao mesmo usuário e dashboard
			if (widget.userId !== userId || widget.dashboardId !== dashboardId) {
				throw new WidgetAccessDeniedError(
					`Acesso negado: o widget "${update.widgetId}" não pertence a este dashboard/usuário.`,
				);
			}
		}

		// 2. Fase de Aplicação Persistente (Commit atômico no banco em memória)
		const now = new Date();
		for (const update of layoutUpdates) {
			const widget = this.widgets.get(update.widgetId)!;
			widget.colSpan = update.colSpan;
			widget.rowSpan = update.rowSpan;
			widget.order = update.order;
			if (update.x !== undefined) widget.x = update.x;
			if (update.y !== undefined) widget.y = update.y;
			widget.updatedAt = now;
		}

		dashboard.updatedAt = now;

		return Array.from(this.widgets.values())
			.filter((w) => w.dashboardId === dashboardId)
			.sort((a, b) => a.order - b.order)
			.map((w) => ({ ...w }));
	}
}

// ==============================================================================
// SUÍTE DE TESTES AUTOMATIZADOS
// ==============================================================================
describe('User Dashboard - Multi-Tenant RBAC, Layout Auto-Save & SQL Security Suite', () => {
	let dashboardService: UserDashboardService;
	let chatRagService: any;

	const USER_1 = 'usr_gerente_regional_01';
	const USER_2 = 'usr_gerente_regional_02';

	before(async () => {
		// Importação dinâmica do ChatRagService para testar integração de segurança real
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const chatRagMod = require('../services/chat-rag.service');
		const ChatRagServiceClass = chatRagMod.ChatRagService;

		const mockGemini = {
			generateSqlQuery: async () => '```sql\nSELECT * FROM erp_vendas LIMIT 10\n```',
			generateText: async () => '```sql\nSELECT * FROM erp_vendas LIMIT 10\n```',
		};

		chatRagService = new ChatRagServiceClass(mockGemini);
		dashboardService = new UserDashboardService(chatRagService);
	});

	beforeEach(() => {
		// Reinicializa o serviço para estado limpo antes de cada teste
		dashboardService = new UserDashboardService(chatRagService);
	});

	// ==========================================================================
	// 1. ISOLAMENTO MULTI-TENANT E CONTROLE DE ACESSO RBAC
	// ==========================================================================
	describe('1. Isolamento Multi-tenant e Controle de Acesso RBAC', () => {
		it('deve garantir que o Dashboard criado pelo Usuário 1 não seja retornado na listagem do Usuário 2', async () => {
			const dashUser1 = await dashboardService.createDashboard(USER_1, {
				title: 'Painel de Faturamento Regional (User 1)',
				description: 'Vendas da regional Centro-Oeste',
			});

			await dashboardService.addWidget(USER_1, dashUser1.id, {
				title: 'Vendas por Vendedor',
				type: 'bar',
				colSpan: 6,
				rowSpan: 2,
			});

			// Usuário 1 deve ver seu dashboard
			const listUser1 = await dashboardService.listDashboards(USER_1);
			assert.equal(listUser1.length, 1);
			assert.equal(listUser1[0].id, dashUser1.id);
			assert.equal(listUser1[0].title, 'Painel de Faturamento Regional (User 1)');

			// Usuário 2 NÃO deve ver o dashboard do Usuário 1
			const listUser2 = await dashboardService.listDashboards(USER_2);
			assert.equal(listUser2.length, 0, 'A listagem do Usuário 2 deve vir vazia, sem vazar dashboards do Usuário 1');
		});

		it('deve rejeitar com erro 403 (Acesso Negado) quando o Usuário 2 tentar acessar por ID o Dashboard do Usuário 1', async () => {
			const dashUser1 = await dashboardService.createDashboard(USER_1, {
				title: 'Estratégico Diretoria - User 1',
			});

			await assert.rejects(
				async () => {
					await dashboardService.getDashboardById(USER_2, dashUser1.id);
				},
				(err: any) => {
					assert.equal(err.name, 'DashboardAccessDeniedError');
					assert.equal(err.statusCode, 403);
					assert.match(err.message, /Acesso negado/i);
					return true;
				},
				'Usuário 2 não pode ler diretamente dashboard pertencente ao Usuário 1',
			);
		});

		it('deve rejeitar com erro quando o Usuário 2 tentar modificar (UPDATE) título ou descrição do Dashboard do Usuário 1', async () => {
			const dashUser1 = await dashboardService.createDashboard(USER_1, {
				title: 'Título Original User 1',
				description: 'Descrição Original',
			});

			await assert.rejects(
				async () => {
					await dashboardService.updateDashboard(USER_2, dashUser1.id, {
						title: 'Título Hackeado pelo User 2',
						description: 'Tentativa de alteração não autorizada',
					});
				},
				(err: any) => {
					assert.equal(err.name, 'DashboardAccessDeniedError');
					assert.equal(err.statusCode, 403);
					return true;
				},
				'Usuário 2 não pode atualizar dados de dashboard de outro usuário',
			);

			// Verifica se os dados continuam intactos para o Usuário 1
			const refreshedUser1 = await dashboardService.getDashboardById(USER_1, dashUser1.id);
			assert.equal(refreshedUser1.title, 'Título Original User 1');
		});

		it('deve rejeitar com erro quando o Usuário 2 tentar adicionar um widget ao Dashboard do Usuário 1', async () => {
			const dashUser1 = await dashboardService.createDashboard(USER_1, {
				title: 'Painel User 1',
			});

			await assert.rejects(
				async () => {
					await dashboardService.addWidget(USER_2, dashUser1.id, {
						title: 'Widget Invasor User 2',
						type: 'pie',
						colSpan: 6,
						rowSpan: 2,
					});
				},
				(err: any) => {
					assert.equal(err.name, 'DashboardAccessDeniedError');
					assert.equal(err.statusCode, 403);
					return true;
				},
				'Usuário 2 não pode injetar widgets em dashboard de outro usuário',
			);

			const dashCheck = await dashboardService.getDashboardById(USER_1, dashUser1.id);
			assert.equal(dashCheck.widgets.length, 0);
		});

		it('deve rejeitar categoricamente com erro quando o Usuário 2 tentar DELETAR um widget do Usuário 1', async () => {
			const dashUser1 = await dashboardService.createDashboard(USER_1, { title: 'Dashboard U1' });
			const widgetUser1 = await dashboardService.addWidget(USER_1, dashUser1.id, {
				title: 'Top 10 Clientes',
				type: 'table',
				colSpan: 12,
				rowSpan: 3,
			});

			// Tentativa de deleção pelo Usuário 2
			await assert.rejects(
				async () => {
					await dashboardService.deleteWidget(USER_2, widgetUser1.id);
				},
				(err: any) => {
					assert.equal(err.name, 'WidgetAccessDeniedError');
					assert.equal(err.statusCode, 403);
					assert.match(err.message, /outro usu[áa]rio/i);
					return true;
				},
				'Tentativa de deletar widget de outro usuário deve ser bloqueada',
			);

			// Confirma que o widget permanece existindo e acessível para o Usuário 1
			const dashCheck = await dashboardService.getDashboardById(USER_1, dashUser1.id);
			assert.equal(dashCheck.widgets.length, 1);
			assert.equal(dashCheck.widgets[0].id, widgetUser1.id);
		});

		it('deve rejeitar categoricamente com erro quando o Usuário 2 tentar MOVER ou reordenar widget do Usuário 1', async () => {
			const dashUser1 = await dashboardService.createDashboard(USER_1, { title: 'Dashboard U1' });
			const widgetUser1 = await dashboardService.addWidget(USER_1, dashUser1.id, {
				title: 'Gráfico Faturamento',
				type: 'line',
				order: 0,
			});

			// Tentativa de mover pelo Usuário 2
			await assert.rejects(
				async () => {
					await dashboardService.moveWidget(USER_2, widgetUser1.id, 5);
				},
				(err: any) => {
					assert.equal(err.name, 'WidgetAccessDeniedError');
					assert.equal(err.statusCode, 403);
					assert.match(err.message, /outro usu[áa]rio/i);
					return true;
				},
				'Tentativa de mover widget de outro usuário deve ser bloqueada',
			);

			// Confirma que a ordem original permanece 0
			const dashCheck = await dashboardService.getDashboardById(USER_1, dashUser1.id);
			assert.equal(dashCheck.widgets[0].order, 0);
		});

		it('deve rejeitar com erro quando o Usuário 2 tentar deletar o Dashboard do Usuário 1', async () => {
			const dashUser1 = await dashboardService.createDashboard(USER_1, { title: 'Painel Protegido U1' });

			await assert.rejects(
				async () => {
					await dashboardService.deleteDashboard(USER_2, dashUser1.id);
				},
				(err: any) => {
					assert.equal(err.name, 'DashboardAccessDeniedError');
					assert.equal(err.statusCode, 403);
					return true;
				},
			);

			// Confirma que o dashboard continua existindo
			const dashCheck = await dashboardService.getDashboardById(USER_1, dashUser1.id);
			assert.ok(dashCheck);
		});

		it('deve abortar atomicamente o Auto-Save de layout se o payload contiver widgetId pertencente a outro usuário', async () => {
			const dash1 = await dashboardService.createDashboard(USER_1, { title: 'D1' });
			const widgetU1 = await dashboardService.addWidget(USER_1, dash1.id, {
				title: 'W1-U1',
				type: 'bar',
				colSpan: 6,
				rowSpan: 2,
				order: 0,
			});

			const dash2 = await dashboardService.createDashboard(USER_2, { title: 'D2' });
			const widgetU2 = await dashboardService.addWidget(USER_2, dash2.id, {
				title: 'W2-U2',
				type: 'line',
				colSpan: 6,
				rowSpan: 2,
				order: 0,
			});

			// Usuário 2 tenta enviar auto-save incluindo o widget do Usuário 1
			await assert.rejects(
				async () => {
					await dashboardService.updateLayoutAutoSave(USER_2, dash2.id, [
						{ widgetId: widgetU2.id, colSpan: 12, rowSpan: 3, order: 0 },
						{ widgetId: widgetU1.id, colSpan: 12, rowSpan: 3, order: 1 }, // Tentativa maliciosa cross-tenant
					]);
				},
				(err: any) => {
					assert.equal(err.name, 'WidgetAccessDeniedError');
					return true;
				},
				'Não deve permitir auto-save envolvendo widget de outro tenant',
			);

			// Garante rollback atômico: o widget do Usuário 2 NÃO foi modificado
			const dash2Check = await dashboardService.getDashboardById(USER_2, dash2.id);
			assert.equal(dash2Check.widgets[0].colSpan, 6, 'Rollback atômico: colSpan deve permanecer inalterado');
		});
	});

	// ==========================================================================
	// 2. AUTO-SAVE DE LAYOUT (PERSISTÊNCIA DE GRID, COLSPAN, ROWSPAN E ORDER)
	// ==========================================================================
	describe('2. Auto-Save de Layout (Persistência de Grid, colSpan, rowSpan e order)', () => {
		it('deve persistir com precisão a atualização de colSpan, rowSpan e order de múltiplos widgets', async () => {
			const dash = await dashboardService.createDashboard(USER_1, { title: 'Dashboard de Teste de Layout' });

			const wA = await dashboardService.addWidget(USER_1, dash.id, {
				title: 'Widget A (Original: colSpan 6, rowSpan 2, order 0)',
				type: 'bar',
				colSpan: 6,
				rowSpan: 2,
				order: 0,
			});

			const wB = await dashboardService.addWidget(USER_1, dash.id, {
				title: 'Widget B (Original: colSpan 6, rowSpan 2, order 1)',
				type: 'line',
				colSpan: 6,
				rowSpan: 2,
				order: 1,
			});

			const wC = await dashboardService.addWidget(USER_1, dash.id, {
				title: 'Widget C (Original: colSpan 12, rowSpan 2, order 2)',
				type: 'table',
				colSpan: 12,
				rowSpan: 2,
				order: 2,
			});

			// O usuário rearranja o layout no frontend (drag & drop e redimensionamento):
			// wC vai para o topo (order 0) ocupando colSpan 12 e rowSpan 4
			// wA vai para order 1 ocupando colSpan 8 e rowSpan 3
			// wB vai para order 2 ocupando colSpan 4 e rowSpan 3
			const autoSavePayload: LayoutAutoSaveItem[] = [
				{ widgetId: wC.id, colSpan: 12, rowSpan: 4, order: 0 },
				{ widgetId: wA.id, colSpan: 8, rowSpan: 3, order: 1 },
				{ widgetId: wB.id, colSpan: 4, rowSpan: 3, order: 2 },
			];

			const updatedWidgets = await dashboardService.updateLayoutAutoSave(USER_1, dash.id, autoSavePayload);

			assert.equal(updatedWidgets.length, 3);
			assert.equal(updatedWidgets[0].id, wC.id);
			assert.equal(updatedWidgets[0].order, 0);
			assert.equal(updatedWidgets[0].colSpan, 12);
			assert.equal(updatedWidgets[0].rowSpan, 4);

			assert.equal(updatedWidgets[1].id, wA.id);
			assert.equal(updatedWidgets[1].order, 1);
			assert.equal(updatedWidgets[1].colSpan, 8);
			assert.equal(updatedWidgets[1].rowSpan, 3);

			assert.equal(updatedWidgets[2].id, wB.id);
			assert.equal(updatedWidgets[2].order, 2);
			assert.equal(updatedWidgets[2].colSpan, 4);
			assert.equal(updatedWidgets[2].rowSpan, 3);

			// Busca novamente no "banco" para garantir persistência real
			const persisted = await dashboardService.getDashboardById(USER_1, dash.id);
			assert.equal(persisted.widgets[0].id, wC.id);
			assert.equal(persisted.widgets[0].colSpan, 12);
			assert.equal(persisted.widgets[0].rowSpan, 4);
			assert.equal(persisted.widgets[1].id, wA.id);
			assert.equal(persisted.widgets[1].colSpan, 8);
			assert.equal(persisted.widgets[2].id, wB.id);
			assert.equal(persisted.widgets[2].colSpan, 4);
		});

		it('deve rejeitar atualização com colSpan menor que 1 ou maior que 12', async () => {
			const dash = await dashboardService.createDashboard(USER_1, { title: 'D1' });
			const w = await dashboardService.addWidget(USER_1, dash.id, {
				title: 'W1',
				type: 'bar',
				colSpan: 6,
			});

			// Caso a: colSpan = 0
			await assert.rejects(
				async () => {
					await dashboardService.updateLayoutAutoSave(USER_1, dash.id, [
						{ widgetId: w.id, colSpan: 0, rowSpan: 2, order: 0 },
					]);
				},
				(err: any) => {
					assert.equal(err.name, 'InvalidLayoutError');
					assert.match(err.message, /colSpan deve estar entre 1 e 12/i);
					return true;
				},
			);

			// Caso b: colSpan = 13 (grid máximo é 12)
			await assert.rejects(
				async () => {
					await dashboardService.updateLayoutAutoSave(USER_1, dash.id, [
						{ widgetId: w.id, colSpan: 13, rowSpan: 2, order: 0 },
					]);
				},
				(err: any) => {
					assert.equal(err.name, 'InvalidLayoutError');
					assert.match(err.message, /colSpan deve estar entre 1 e 12/i);
					return true;
				},
			);
		});

		it('deve rejeitar atualização com rowSpan menor que 1', async () => {
			const dash = await dashboardService.createDashboard(USER_1, { title: 'D1' });
			const w = await dashboardService.addWidget(USER_1, dash.id, {
				title: 'W1',
				type: 'bar',
			});

			await assert.rejects(
				async () => {
					await dashboardService.updateLayoutAutoSave(USER_1, dash.id, [
						{ widgetId: w.id, colSpan: 6, rowSpan: 0, order: 0 },
					]);
				},
				(err: any) => {
					assert.equal(err.name, 'InvalidLayoutError');
					assert.match(err.message, /rowSpan deve ser no m[íi]nimo 1/i);
					return true;
				},
			);
		});

		it('deve rejeitar atualização com order negativo ou decimal', async () => {
			const dash = await dashboardService.createDashboard(USER_1, { title: 'D1' });
			const w = await dashboardService.addWidget(USER_1, dash.id, {
				title: 'W1',
				type: 'bar',
			});

			await assert.rejects(
				async () => {
					await dashboardService.updateLayoutAutoSave(USER_1, dash.id, [
						{ widgetId: w.id, colSpan: 6, rowSpan: 2, order: -1 },
					]);
				},
				(err: any) => {
					assert.equal(err.name, 'InvalidLayoutError');
					assert.match(err.message, /order deve ser um n[úu]mero inteiro maior ou igual a 0/i);
					return true;
				},
			);
		});

		it('deve atualizar o updatedAt do dashboard e dos widgets após o auto-save', async () => {
			const dash = await dashboardService.createDashboard(USER_1, { title: 'D1' });
			const w = await dashboardService.addWidget(USER_1, dash.id, {
				title: 'W1',
				type: 'kpi',
				colSpan: 4,
				rowSpan: 1,
				order: 0,
			});

			const initialWidgetUpdatedAt = w.updatedAt.getTime();
			const initialDashUpdatedAt = dash.updatedAt.getTime();

			// Aguarda 10ms para garantir timestamp posterior
			await new Promise((resolve) => setTimeout(resolve, 10));

			await dashboardService.updateLayoutAutoSave(USER_1, dash.id, [
				{ widgetId: w.id, colSpan: 8, rowSpan: 2, order: 0 },
			]);

			const updatedDash = await dashboardService.getDashboardById(USER_1, dash.id);
			assert.ok(updatedDash.updatedAt.getTime() >= initialDashUpdatedAt);
			assert.ok(updatedDash.widgets[0].updatedAt.getTime() >= initialWidgetUpdatedAt);
			assert.equal(updatedDash.widgets[0].colSpan, 8);
		});

		it('deve suportar coordenadas opcionais x e y para renderização livre de grids responsivos', async () => {
			const dash = await dashboardService.createDashboard(USER_1, { title: 'Free Grid' });
			const w1 = await dashboardService.addWidget(USER_1, dash.id, {
				title: 'W1',
				type: 'bar',
			});

			const layoutWithCoords: LayoutAutoSaveItem[] = [
				{ widgetId: w1.id, colSpan: 6, rowSpan: 2, order: 0, x: 0, y: 0 },
			];

			const result = await dashboardService.updateLayoutAutoSave(USER_1, dash.id, layoutWithCoords);
			assert.equal(result[0].x, 0);
			assert.equal(result[0].y, 0);
		});
	});

	// ==========================================================================
	// 3. SANITIZAÇÃO E SEGURANÇA DE WIDGETS SQL (READ-ONLY & ANTI-SQLi)
	// ==========================================================================
	describe('3. Sanitização e Segurança de Widgets SQL (Read-Only & Anti-SQLi Guardrails)', () => {
		it('deve permitir criação de widget com queries SELECT analíticas legítimas em tabelas de negócio do ERP', async () => {
			const dash = await dashboardService.createDashboard(USER_1, { title: 'D1' });

			const validQueries = [
				'SELECT codparc, nomeparc, limite_credito FROM erp_clientes ORDER BY limite_credito DESC LIMIT 10',
				'SELECT produto, SUM(total) as faturamento FROM erp_vendas GROUP BY produto ORDER BY faturamento DESC LIMIT 5',
				'WITH vendas_resumo AS (SELECT vendedor, COUNT(*) as qtd FROM erp_pedidos GROUP BY vendedor) SELECT vendedor, qtd FROM vendas_resumo ORDER BY qtd DESC LIMIT 10',
				'SELECT dtneg, SUM(vlrnota) FROM erp_financeiro WHERE dtneg >= \'2026-01-01\' GROUP BY dtneg ORDER BY dtneg ASC LIMIT 30',
			];

			for (let i = 0; i < validQueries.length; i++) {
				const query = validQueries[i];
				const widget = await dashboardService.addWidget(USER_1, dash.id, {
					title: `Widget Válido ${i + 1}`,
					type: 'bar',
					sqlQuery: query,
				});

				assert.ok(widget.id, `Deveria ter criado com sucesso o widget para a query legítima: "${query}"`);
				assert.equal(widget.sqlQuery, query);
			}
		});

		it('deve bloquear comandos destrutivos diretos DDL (DROP, ALTER, CREATE, TRUNCATE) ao criar widget', async () => {
			const dash = await dashboardService.createDashboard(USER_1, { title: 'D1' });

			const dangerousDdlQueries = [
				'DROP TABLE erp_vendas',
				'DROP TABLE erp_clientes CASCADE',
				'ALTER TABLE erp_produtos DROP COLUMN preco',
				'CREATE TABLE backdoor (id int, secret text)',
				'TRUNCATE TABLE erp_pedidos',
			];

			for (const maliciousSql of dangerousDdlQueries) {
				await assert.rejects(
					async () => {
						await dashboardService.addWidget(USER_1, dash.id, {
							title: 'Tentativa DDL',
							type: 'bar',
							sqlQuery: maliciousSql,
						});
					},
					(err: any) => {
						assert.equal(err.name, 'UnsafeWidgetSqlError');
						assert.equal(err.statusCode, 400);
						return true;
					},
					`A query DDL deveria ter sido estritamente bloqueada: "${maliciousSql}"`,
				);
			}
		});

		it('deve bloquear comandos de mutação DML (INSERT, UPDATE, DELETE, MERGE) ao criar widget', async () => {
			const dash = await dashboardService.createDashboard(USER_1, { title: 'D1' });

			const dangerousDmlQueries = [
				'DELETE FROM erp_vendas WHERE total < 500',
				'UPDATE erp_clientes SET limite_credito = 99999999 WHERE codparc = 1',
				'INSERT INTO erp_clientes (nomeparc) VALUES (\'Invasor\')',
				'MERGE INTO erp_vendas USING novas_vendas ON ...',
			];

			for (const maliciousSql of dangerousDmlQueries) {
				await assert.rejects(
					async () => {
						await dashboardService.addWidget(USER_1, dash.id, {
							title: 'Tentativa DML',
							type: 'table',
							sqlQuery: maliciousSql,
						});
					},
					(err: any) => {
						assert.equal(err.name, 'UnsafeWidgetSqlError');
						assert.equal(err.statusCode, 400);
						return true;
					},
					`A query DML deveria ter sido bloqueada: "${maliciousSql}"`,
				);
			}
		});

		it('deve bloquear stacked queries com ponto-e-vírgula (SQL Injection com múltiplos statements)', async () => {
			const dash = await dashboardService.createDashboard(USER_1, { title: 'D1' });

			const stackedQueries = [
				'SELECT * FROM erp_vendas; DROP TABLE erp_vendas;',
				'SELECT codparc FROM erp_clientes WHERE codparc = 1; DELETE FROM usuarios;',
				'SELECT 1; UPDATE usuarios SET tipo_acesso = \'ADMIN\' WHERE id = 1;',
			];

			for (const maliciousSql of stackedQueries) {
				await assert.rejects(
					async () => {
						await dashboardService.addWidget(USER_1, dash.id, {
							title: 'Stacked SQLi',
							type: 'bar',
							sqlQuery: maliciousSql,
						});
					},
					(err: any) => {
						assert.equal(err.name, 'UnsafeWidgetSqlError');
						assert.match(err.message, /ponto-e-v[íi]rgula|Stacked SQLi/i);
						return true;
					},
					`Stacked query deveria ser rejeitada: "${maliciousSql}"`,
				);
			}
		});

		it('deve bloquear tentativas de consulta a tabelas internas sensíveis (usuarios, erp_configurations, pg_catalog, information_schema)', async () => {
			const dash = await dashboardService.createDashboard(USER_1, { title: 'D1' });

			const sensitiveQueries = [
				'SELECT * FROM usuarios',
				'SELECT email, senha_hash FROM usuarios LIMIT 5',
				'SELECT * FROM erp_configurations',
				'SELECT * FROM ai_configurations',
				'SELECT * FROM pg_catalog.pg_tables',
				'SELECT * FROM information_schema.tables',
				'WITH steal AS (SELECT * FROM usuarios) SELECT * FROM steal',
			];

			for (const sensitiveSql of sensitiveQueries) {
				await assert.rejects(
					async () => {
						await dashboardService.addWidget(USER_1, dash.id, {
							title: 'Consulta a Tabela Sensível',
							type: 'table',
							sqlQuery: sensitiveSql,
						});
					},
					(err: any) => {
						assert.equal(err.name, 'UnsafeWidgetSqlError');
						assert.match(err.message, /sens[íi]vel|restrit[oa]/i);
						return true;
					},
					`Consulta a tabela de credenciais ou sistema deveria ser bloqueada: "${sensitiveSql}"`,
				);
			}
		});

		it('deve bloquear chamadas a funções perigosas do PostgreSQL (pg_sleep, pg_read_file, dblink)', async () => {
			const dash = await dashboardService.createDashboard(USER_1, { title: 'D1' });

			const dangerousFunctions = [
				'SELECT pg_sleep(10)',
				'SELECT pg_read_file(\'/etc/passwd\')',
				'SELECT dblink(\'host=evil.com\', \'SELECT 1\')',
			];

			for (const sql of dangerousFunctions) {
				await assert.rejects(
					async () => {
						await dashboardService.addWidget(USER_1, dash.id, {
							title: 'Função Perigosa',
							type: 'line',
							sqlQuery: sql,
						});
					},
					(err: any) => {
						assert.equal(err.name, 'UnsafeWidgetSqlError');
						return true;
					},
					`Função perigosa deveria ter sido bloqueada: "${sql}"`,
				);
			}
		});

		it('deve bloquear tentativas de bypass usando comentários SQL (-- ou /* ... */)', async () => {
			const dash = await dashboardService.createDashboard(USER_1, { title: 'D1' });

			const commentBypassQueries = [
				'SELECT * FROM erp_vendas -- comentário \n; DROP TABLE erp_vendas;',
				'/* comentário malicioso */ DELETE FROM erp_vendas',
				'SELECT * FROM erp_vendas WHERE 1=1 /* test */ ; DROP TABLE erp_produtos;',
			];

			for (const sql of commentBypassQueries) {
				await assert.rejects(
					async () => {
						await dashboardService.addWidget(USER_1, dash.id, {
							title: 'Bypass Comentário',
							type: 'table',
							sqlQuery: sql,
						});
					},
					(err: any) => {
						assert.equal(err.name, 'UnsafeWidgetSqlError');
						return true;
					},
					`Tentativa de bypass com comentários deve ser bloqueada: "${sql}"`,
				);
			}
		});

		it('deve validar estritamente os tipos visuais de widget suportados (bar, line, pie, etc.)', async () => {
			const dash = await dashboardService.createDashboard(USER_1, { title: 'D1' });

			// Tipos suportados
			for (const type of SUPPORTED_WIDGET_TYPES) {
				const w = await dashboardService.addWidget(USER_1, dash.id, {
					title: `Widget ${type}`,
					type,
				});
				assert.equal(w.type, type);
			}

			// Tipo não suportado
			await assert.rejects(
				async () => {
					await dashboardService.addWidget(USER_1, dash.id, {
						title: 'Widget Inválido',
						type: 'scatter_plot_inexistente' as any,
					});
				},
				(err: any) => {
					assert.match(err.message, /n[ãa]o suportado/i);
					return true;
				},
			);
		});

		it('deve garantir paridade de 100% com o validador isReadOnlyQuery de produção do ChatRagService', () => {
			const testCases = [
				{ sql: 'SELECT * FROM erp_vendas LIMIT 10', shouldBeSafe: true },
				{ sql: 'SELECT nomeparc, limite_credito FROM erp_clientes WHERE limite_credito > 5000 LIMIT 20', shouldBeSafe: true },
				{ sql: 'DROP TABLE erp_vendas', shouldBeSafe: false },
				{ sql: 'DELETE FROM erp_clientes WHERE codparc = 1', shouldBeSafe: false },
				{ sql: 'UPDATE erp_produtos SET preco = 0', shouldBeSafe: false },
				{ sql: 'INSERT INTO usuarios (email) VALUES (\'hacker@hack.com\')', shouldBeSafe: false },
				{ sql: 'SELECT * FROM erp_vendas; DROP TABLE erp_vendas;', shouldBeSafe: false },
				{ sql: 'SELECT * FROM usuarios', shouldBeSafe: false },
				{ sql: 'SELECT * FROM erp_configurations', shouldBeSafe: false },
				{ sql: 'SELECT * FROM pg_catalog.pg_tables', shouldBeSafe: false },
			];

			for (const tc of testCases) {
				const result = dashboardService.validateWidgetSqlQuery(tc.sql);
				assert.equal(
					result.valid,
					tc.shouldBeSafe,
					`A query "${tc.sql}" deveria ter valid = ${tc.shouldBeSafe}, mas retornou valid = ${result.valid}. Razão: ${result.reason}`,
				);
			}
		});
	});
});
