import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini-key-dashboard';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/gideon_test';

// Mock do prisma global se necessário
const mockWidgets: any[] = [];
let mockDashboard: any = null;

const globalForPrisma = globalThis as unknown as { prisma?: any };
if (!globalForPrisma.prisma) {
	globalForPrisma.prisma = {
		userDashboard: {
			findFirst: async ({ where }: any) => {
				if (mockDashboard && mockDashboard.userId === where.userId) {
					return {
						...mockDashboard,
						widgets: [...mockWidgets].sort((a, b) => a.order - b.order),
					};
				}
				return null;
			},
			create: async ({ data }: any) => {
				mockDashboard = {
					id: 'dash-uuid-1',
					userId: data.userId,
					title: data.title || 'Meu Dashboard',
					createdAt: new Date(),
					updatedAt: new Date(),
					widgets: [],
				};
				return mockDashboard;
			},
		},
		dashboardWidget: {
			create: async ({ data }: any) => {
				const widget = {
					id: `widget-uuid-${mockWidgets.length + 1}`,
					...data,
					createdAt: new Date(),
					updatedAt: new Date(),
				};
				mockWidgets.push(widget);
				return widget;
			},
			findUnique: async ({ where }: any) => {
				const widget = mockWidgets.find((w) => w.id === where.id);
				if (!widget) return null;
				return {
					...widget,
					dashboard: { userId: 'user-uuid-1', id: 'dash-uuid-1' },
				};
			},
			findMany: async () => [...mockWidgets].sort((a, b) => a.order - b.order),
			update: async ({ where, data }: any) => {
				const idx = mockWidgets.findIndex((w) => w.id === where.id);
				if (idx >= 0) {
					mockWidgets[idx] = { ...mockWidgets[idx], ...data, updatedAt: new Date() };
					return mockWidgets[idx];
				}
				throw new Error('Not found');
			},
			delete: async ({ where }: any) => {
				const idx = mockWidgets.findIndex((w) => w.id === where.id);
				if (idx >= 0) {
					mockWidgets.splice(idx, 1);
					return { success: true };
				}
				throw new Error('Not found');
			},
		},
		$transaction: async (arg: any) => {
			if (typeof arg === 'function') {
				return arg({
					$executeRawUnsafe: async () => 0,
					$queryRawUnsafe: async () => [
						{ codparc: 1, nomeparc: 'Cliente Teste', valor: 5000 },
					],
				});
			}
			if (Array.isArray(arg)) {
				return Promise.all(arg);
			}
			return null;
		},
	};
}

describe('UserDashboardService Test Suite', () => {
	let userDashboardService: any;

	before(async () => {
		// Importa dinamicamente após inicializar mock do Prisma
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const mod = require('../services/user-dashboard.service');
		userDashboardService = mod.userDashboardService;
	});

	it('1. deve obter ou criar dashboard vazio para o usuário', async () => {
		const dash = await userDashboardService.getOrCreateDashboard('user-uuid-1');
		assert.ok(dash);
		assert.equal(dash.userId, 'user-uuid-1');
		assert.equal(dash.title, 'Meu Dashboard');
	});

	it('2. deve criar um widget pronto no dashboard (createWidget)', async () => {
		const widget = await userDashboardService.createWidget('user-uuid-1', {
			title: 'Top 5 Clientes',
			type: 'horizontal-bar',
			data: [
				{ name: 'Empresa A', value: 10000 },
				{ name: 'Empresa B', value: 7500 },
			],
			colSpan: 2,
			rowSpan: 1,
			sqlQuery: 'SELECT nome, valor FROM erp_vendas LIMIT 5',
		});

		assert.ok(widget);
		assert.equal(widget.title, 'Top 5 Clientes');
		assert.equal(widget.type, 'horizontal-bar');
		assert.equal(widget.colSpan, 2);
		assert.equal(widget.order, 0);
	});

	it('3. deve atualizar layout em lote com isolamento RBAC', async () => {
		const widget1 = mockWidgets[0];
		assert.ok(widget1);

		const updated = await userDashboardService.updateLayout('user-uuid-1', [
			{ id: widget1.id, colSpan: 3, rowSpan: 2, order: 1 },
		]);

		assert.ok(Array.isArray(updated));
		const found = updated.find((w: any) => w.id === widget1.id);
		assert.equal(found.colSpan, 3);
		assert.equal(found.rowSpan, 2);
		assert.equal(found.order, 1);
	});

	it('4. deve rejeitar atualização de layout se widget não pertencer ao usuário', async () => {
		await assert.rejects(
			async () => {
				await userDashboardService.updateLayout('user-uuid-1', [
					{ id: 'widget-alheio-999', colSpan: 1, rowSpan: 1, order: 0 },
				]);
			},
			{
				message: /Acesso negado: o widget "widget-alheio-999" não pertence ao seu dashboard/,
			},
		);
	});

	it('5. deve executar refresh do widget via transação Read-Only', async () => {
		const widget1 = mockWidgets[0];
		const refreshed = await userDashboardService.refreshWidget('user-uuid-1', widget1.id);
		assert.ok(refreshed);
		assert.ok(refreshed.cachedData);
	});

	it('6. deve rejeitar refresh se o usuário não for o dono do widget', async () => {
		const widget1 = mockWidgets[0];
		await assert.rejects(
			async () => {
				await userDashboardService.refreshWidget('outro-usuario-hacker', widget1.id);
			},
			{
				message: /Widget não encontrado ou você não possui permissão/,
			},
		);
	});

	it('7. deve remover o widget com sucesso quando autorizado', async () => {
		const widget1 = mockWidgets[0];
		const res = await userDashboardService.removeWidget('user-uuid-1', widget1.id);
		assert.deepEqual(res, { success: true });
	});
});
