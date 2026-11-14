import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChatFeedbackService } from '../services/chat-feedback.service';
import { ChatRagService } from '../services/chat-rag.service';

function createMockPrisma() {
	const feedbacks: any[] = [];
	const users: Record<string, { id: string; nome: string; email: string; tipo_acesso: string }> = {
		'user-1': {
			id: 'user-1',
			nome: 'Matheus Henrique',
			email: 'matheus@empresa.com',
			tipo_acesso: 'ADMIN',
		},
		'user-2': {
			id: 'user-2',
			nome: 'Ana Paula',
			email: 'ana@empresa.com',
			tipo_acesso: 'GERENTE',
		},
	};

	let idCounter = 1;

	return {
		$executeRawUnsafe: async () => 0,
		chatFeedback: {
			findMany: async ({ where, orderBy }: any = {}) => {
				let list = [...feedbacks];
				if (where) {
					if (where.userId) {
						list = list.filter((f) => f.userId === where.userId);
					}
					if (where.messageId) {
						list = list.filter((f) => f.messageId === where.messageId);
					}
					if (where.rating) {
						list = list.filter((f) => f.rating === where.rating);
					}
					if (where.status) {
						list = list.filter((f) => f.status === where.status);
					}
				}
				if (orderBy?.createdAt === 'desc') {
					list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
				}
				return list.map((f) => ({
					...f,
					usuario: users[f.userId] || {
						id: f.userId,
						nome: 'Desconhecido',
						email: '',
						tipo_acesso: 'GERENTE',
					},
				}));
			},
			findUnique: async ({ where }: any) => {
				const found = feedbacks.find((f) => f.id === where.id);
				return found ? { ...found, usuario: users[found.userId] } : null;
			},
			create: async ({ data }: any) => {
				const record = {
					id: `fb-${idCounter++}`,
					...data,
					createdAt: data.createdAt || new Date(),
					updatedAt: data.updatedAt || new Date(),
					resolvedAt: null,
					resolvedBy: null,
				};
				feedbacks.push(record);
				return {
					...record,
					usuario: users[record.userId],
				};
			},
			update: async ({ where, data }: any) => {
				const idx = feedbacks.findIndex((f) => f.id === where.id);
				if (idx === -1) throw new Error('Not found');
				feedbacks[idx] = {
					...feedbacks[idx],
					...data,
				};
				return {
					...feedbacks[idx],
					usuario: users[feedbacks[idx].userId],
				};
			},
		},
		_feedbacks: feedbacks,
	} as any;
}

describe('ChatFeedbackService — Avaliação de Respostas e Dashboard de Qualidade da Gideon', () => {
	it('deve armazenar avaliação positiva e negativa com resumo do contexto, usuário e conversa completa', async () => {
		const mockPrisma = createMockPrisma();
		const service = new ChatFeedbackService(mockPrisma);

		service.recordLastTurnMetadata('user-1', {
			generatedSql: 'SELECT SUM(totalliquido) FROM erp_nota_fiscal WHERE cancelado IS DISTINCT FROM \'S\'',
		});

		const created = await service.submitOrUpdateFeedback({
			userId: 'user-1',
			conversationId: 'conv-101',
			messageId: 'msg-1',
			rating: 'NEGATIVE',
			tags: ['Valor / Cálculo incorreto', 'Faltou informação'],
			comment: 'O faturamento de outubro parece incompleto.',
			userPrompt: 'Qual foi o faturamento líquido de outubro?',
			assistantResponse: 'O faturamento líquido de outubro foi de R$ 150.000,00.',
			fullConversation: [
				{ role: 'user', content: 'Olá Gideon' },
				{ role: 'assistant', content: 'Olá! Como posso ajudar?' },
				{ role: 'user', content: 'Qual foi o faturamento líquido de outubro?' },
				{ role: 'assistant', content: 'O faturamento líquido de outubro foi de R$ 150.000,00.' },
			],
		});

		assert.equal(created.rating, 'NEGATIVE');
		assert.equal(created.status, 'PENDING');
		assert.equal(created.userName, 'Matheus Henrique');
		assert.deepEqual(created.tags, ['Valor / Cálculo incorreto', 'Faltou informação']);
		assert.equal(created.fullConversation.length, 4);
		assert.ok(created.contextSummary.includes('Qual foi o faturamento líquido de outubro?'));
		assert.ok(created.contextSummary.includes('Consulta SQL executada'));
		assert.ok(created.generatedSql?.includes('erp_nota_fiscal'));
	});

	it('deve atualizar a avaliação existente quando o mesmo usuário complementa tags ou comentário na mesma mensagem', async () => {
		const mockPrisma = createMockPrisma();
		const service = new ChatFeedbackService(mockPrisma);

		const first = await service.submitOrUpdateFeedback({
			userId: 'user-1',
			messageId: 'msg-abc',
			rating: 'POSITIVE',
			userPrompt: 'Gere um gráfico de vendas por vendedor',
			assistantResponse: 'Aqui está o gráfico solicitado.',
		});

		const updated = await service.submitOrUpdateFeedback({
			userId: 'user-1',
			messageId: 'msg-abc',
			rating: 'POSITIVE',
			tags: ['Gráfico excelente'],
			comment: 'Muito claro e direto!',
			userPrompt: 'Gere um gráfico de vendas por vendedor',
			assistantResponse: 'Aqui está o gráfico solicitado.',
		});

		assert.equal(updated.id, first.id);
		assert.deepEqual(updated.tags, ['Gráfico excelente']);
		assert.equal(updated.comment, 'Muito claro e direto!');
		assert.equal(mockPrisma._feedbacks.length, 1);
	});

	it('deve permitir filtrar feedbacks por tipo (POSITIVE / NEGATIVE), status (PENDING / RESOLVED) e marcar como resolvido', async () => {
		const mockPrisma = createMockPrisma();
		const service = new ChatFeedbackService(mockPrisma);

		const neg = await service.submitOrUpdateFeedback({
			userId: 'user-1',
			messageId: 'msg-neg-1',
			rating: 'NEGATIVE',
			tags: ['Informação incorreta'],
			userPrompt: 'Quantos clientes ativos temos?',
			assistantResponse: 'Temos 500 clientes.',
		});

		await service.submitOrUpdateFeedback({
			userId: 'user-2',
			messageId: 'msg-pos-1',
			rating: 'POSITIVE',
			tags: ['Resposta exata e rápida'],
			userPrompt: 'Qual o top 5 produtos?',
			assistantResponse: 'Segue o top 5 produtos por faturamento líquido.',
		});

		const onlyNegative = await service.listFeedbacks({ rating: 'NEGATIVE' });
		assert.equal(onlyNegative.length, 1);
		assert.equal(onlyNegative[0].id, neg.id);

		const onlyPositive = await service.listFeedbacks({ rating: 'POSITIVE' });
		assert.equal(onlyPositive.length, 1);
		assert.equal(onlyPositive[0].userName, 'Ana Paula');

		// Marca o feedback negativo como resolvido manualmente pelo Admin
		const resolved = await service.updateFeedbackStatus(neg.id, 'RESOLVED', 'Matheus Henrique');
		assert.equal(resolved.status, 'RESOLVED');
		assert.equal(resolved.resolvedBy, 'Matheus Henrique');
		assert.ok(resolved.resolvedAt instanceof Date);

		const pendingList = await service.listFeedbacks({ status: 'PENDING' });
		assert.equal(pendingList.length, 1);

		const resolvedList = await service.listFeedbacks({ status: 'RESOLVED' });
		assert.equal(resolvedList.length, 1);
		assert.equal(resolvedList[0].id, neg.id);
	});

	it('deve calcular corretamente o dashboard de analytics (% positivos vs negativos, usuários que mais avaliam e tendência)', async () => {
		const mockPrisma = createMockPrisma();
		const service = new ChatFeedbackService(mockPrisma);

		// 3 avaliações do user-1 (2 positivas, 1 negativa) e 1 avaliação positiva do user-2 = 4 total (75% positivo, 25% negativo)
		await service.submitOrUpdateFeedback({
			userId: 'user-1',
			messageId: 'm1',
			rating: 'POSITIVE',
			tags: ['Resposta exata e rápida'],
			userPrompt: 'P1',
			assistantResponse: 'R1',
		});
		await service.submitOrUpdateFeedback({
			userId: 'user-1',
			messageId: 'm2',
			rating: 'POSITIVE',
			tags: ['Gráfico excelente'],
			userPrompt: 'P2',
			assistantResponse: 'R2',
		});
		await service.submitOrUpdateFeedback({
			userId: 'user-1',
			messageId: 'm3',
			rating: 'NEGATIVE',
			tags: ['Valor / Cálculo incorreto'],
			userPrompt: 'P3',
			assistantResponse: 'R3',
		});
		await service.submitOrUpdateFeedback({
			userId: 'user-2',
			messageId: 'm4',
			rating: 'POSITIVE',
			tags: ['Resposta exata e rápida'],
			userPrompt: 'P4',
			assistantResponse: 'R4',
		});

		const analytics = await service.getDashboardAnalytics();

		assert.equal(analytics.summary.totalFeedbacks, 4);
		assert.equal(analytics.summary.positiveCount, 3);
		assert.equal(analytics.summary.negativeCount, 1);
		assert.equal(analytics.summary.positivePercentage, 75);
		assert.equal(analytics.summary.negativePercentage, 25);

		// Top users: user-1 tem 3 avaliações, user-2 tem 1 avaliação
		assert.equal(analytics.topUsers.length, 2);
		assert.equal(analytics.topUsers[0].userId, 'user-1');
		assert.equal(analytics.topUsers[0].totalCount, 3);
		assert.equal(analytics.topUsers[1].userId, 'user-2');
		assert.equal(analytics.topUsers[1].totalCount, 1);

		// Trend data possui pelo menos 1 dia consolidado
		assert.ok(analytics.trendData.length >= 1);
		assert.equal(analytics.trendData[0].total, 4);
		assert.equal(analytics.trendData[0].approvalRate, 75);

		// Tag breakdown: 'Resposta exata e rápida' apareceu 2 vezes
		assert.equal(analytics.tagBreakdown[0].tag, 'Resposta exata e rápida');
		assert.equal(analytics.tagBreakdown[0].count, 2);
	});

	it('deve bloquear consultas Text-to-SQL que tentem acessar a tabela interna chat_feedbacks', () => {
		const rag = new ChatRagService({} as any);
		assert.equal(rag.isReadOnlyQuery('SELECT * FROM chat_feedbacks'), false);
	});
});
