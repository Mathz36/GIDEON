import { NextFunction, Request, Response, Router } from 'express';

import GeminiService, { GeminiMessage, GeminiParameters } from '../services/gemini.service';
import erpConfigurationService, { ErpConfigurationInput } from '../services/erp-configuration.service';
import aiConfigurationService, { AiConfigurationInput } from '../services/ai-configuration.service';
import chatRagService, { RagPipelineResult } from '../services/chat-rag.service';
import { ResponseReviewerService } from '../services/response-reviewer.service';
import SankhyaService from '../services/sankhya.service';
import authRouter from './auth.routes';
import userRouter from './user.routes';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '../middlewares/auth.middleware';
import prismaClient from '../config/prisma';
import erpSyncScheduler from '../services/erp-sync.scheduler';
import syncQueueManager from '../services/sync-queue.manager';
import userDashboardService, {
	appendSaveToDashboardQuestionIfChartPresent,
	extractLastDashboardBlockFromText,
	isSaveChartToDashboardConfirmation,
} from '../services/user-dashboard.service';
import chatHistoryMemoryService, { MemoryCategory } from '../services/chat-history-memory.service';
import chatFeedbackService from '../services/chat-feedback.service';
import { autoDetectRelationshipsUseCase } from '../modules/data-dictionary';

interface ErpQueryBody {
	query?: unknown;
	expectedFields?: unknown;
}

interface ChatBody {
	conversationId?: unknown;
	history?: unknown;
	systemPrompt?: unknown;
	parameters?: unknown;
}

interface ErpConfigurationBody {
	context?: unknown;
	description?: unknown;
	query?: unknown;
	expectedFields?: unknown;
	columnDescriptions?: unknown;
	primaryKey?: unknown;
	syncStrategy?: unknown;
	lastSyncCursor?: unknown;
	batchSize?: unknown;
	activeColumn?: unknown;
	activeValue?: unknown;
	syncFrequency?: unknown;
	syncInterval?: unknown;
	syncTime?: unknown;
	syncDayOfMonth?: unknown;
	syncActive?: unknown;
}

const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);

apiRouter.post('/erp/query', requireAuth, async (req: Request<Record<string, string>, unknown, ErpQueryBody>, res, next) => {
	try {
		const query = validateReadOnlyQuery(req.body.query);
		const expectedFields = validateExpectedFields(req.body.expectedFields);
		const rows = await new SankhyaService().executeQuery(query, expectedFields);

		res.status(200).json({ data: rows });
	} catch (error) {
		next(error);
	}
});

apiRouter.get('/erp/configurations', requireAdmin, async (_req, res, next) => {
	try {
		res.status(200).json({ data: await erpConfigurationService.list() });
	} catch (error) {
		next(error);
	}
});

apiRouter.post('/erp/configurations', requireAdmin, async (req: Request<Record<string, string>, unknown, ErpConfigurationBody>, res, next) => {
	try {
		res.status(201).json({ data: await erpConfigurationService.create(validateErpConfiguration(req.body)) });
	} catch (error) {
		next(error);
	}
});

apiRouter.put('/erp/configurations/:id', requireAdmin, async (req: Request<{ id: string }, unknown, ErpConfigurationBody>, res, next) => {
	try {
		const configuration = await erpConfigurationService.update(req.params.id, validateErpConfiguration(req.body));
		if (!configuration) {
			res.status(404).json({ error: 'Configuração SQL não encontrada.' });
			return;
		}

		res.status(200).json({ data: configuration });
	} catch (error) {
		next(error);
	}
});

apiRouter.delete('/erp/configurations/:id', requireAdmin, async (req: Request<{ id: string }>, res, next) => {
	try {
		if (!await erpConfigurationService.delete(req.params.id)) {
			res.status(404).json({ error: 'Configuração SQL não encontrada.' });
			return;
		}

		res.status(204).end();
	} catch (error) {
		next(error);
	}
});

apiRouter.post('/erp/configurations/:id/sync', requireAdmin, async (req: Request<{ id: string }>, res, next) => {
	try {
		const config = await prismaClient.erpConfiguration.findUnique({
			where: { id: req.params.id },
		});

		if (!config) {
			res.status(404).json({ error: 'Configuração SQL não encontrada.' });
			return;
		}

		const result = await erpConfigurationService.syncNow(req.params.id);
		res.status(200).json({
			success: result.success,
			message: result.message,
			data: result,
		});
	} catch (error) {
		next(error);
	}
});

apiRouter.get('/erp/queue', requireAdmin, (_req, res) => {
	res.status(200).json({ data: syncQueueManager.getStatus() });
});

apiRouter.get('/erp/schema', requireAdmin, async (_req, res, next) => {
	try {
		const schema = await erpConfigurationService.getSchemaOverview();
		res.status(200).json({ data: schema });
	} catch (error) {
		next(error);
	}
});

apiRouter.post('/erp/schema/positions', requireAdmin, async (req, res, next) => {
	try {
		const positions = req.body?.positions;
		if (!positions || typeof positions !== 'object') {
			res.status(400).json({ error: 'Objeto de posições inválido.' });
			return;
		}
		await erpConfigurationService.saveSchemaPositions(positions);
		res.status(200).json({ success: true, message: 'Posições do esquema salvas com sucesso!' });
	} catch (error) {
		next(error);
	}
});

apiRouter.put('/erp/schema/:tableName', requireAdmin, async (req: Request<{ tableName: string }>, res, next) => {
	try {
		const body = req.body ?? {};
		if (typeof body.description !== 'string' || !body.description.trim()) {
			res.status(400).json({ error: 'A descrição da tabela é obrigatória.' });
			return;
		}
		if (!Array.isArray(body.columns) || body.columns.length === 0) {
			res.status(400).json({ error: 'A lista de colunas da tabela é obrigatória.' });
			return;
		}

		const updatedTable = await erpConfigurationService.updateTableSchema(req.params.tableName, {
			description: body.description,
			columns: body.columns,
		});
		res.status(200).json({ data: updatedTable });
	} catch (error) {
		next(error);
	}
});

apiRouter.post('/erp/schema/auto-detect-fks', requireAdmin, async (_req, res, next) => {
	try {
		const detectionResult = await autoDetectRelationshipsUseCase.execute('default');
		const schema = await erpConfigurationService.getSchemaOverview();
		res.status(200).json({
			data: schema,
			detection: detectionResult,
		});
	} catch (error) {
		next(error);
	}
});

apiRouter.post('/erp/extract-sql-columns', requireAdmin, async (req, res, next) => {
	try {
		const query = typeof req.body?.query === 'string' ? req.body.query : '';
		const context = typeof req.body?.context === 'string' ? req.body.context : 'ERP';
		const primaryKey = typeof req.body?.primaryKey === 'string' ? req.body.primaryKey : undefined;

		if (!query.trim()) {
			res.status(400).json({ error: 'Informe a consulta SQL para extrair as colunas.' });
			return;
		}

		const columns = erpConfigurationService.extractColumnsFromQuery(query, context, primaryKey);
		const expectedFields = columns.map((c) => c.columnName);
		const columnDescriptions: Record<string, string> = {};
		for (const col of columns) {
			columnDescriptions[col.columnName] = col.description;
		}
		const suggestedPrimaryKey =
			primaryKey?.trim() ||
			expectedFields.find((f) => /^(ID|COD|NUNOTA|CODPARC|CODPROD|CODVEND)/i.test(f)) ||
			expectedFields[0] ||
			'';

		res.status(200).json({
			data: {
				expectedFields,
				columnDescriptions,
				suggestedPrimaryKey,
				columns,
			},
		});
	} catch (error) {
		next(error);
	}
});

apiRouter.get('/ai/configurations', requireAdmin, async (_req, res, next) => {
	try {
		const config = await aiConfigurationService.get();
		res.status(200).json({ data: config });
	} catch (error) {
		next(error);
	}
});

apiRouter.put('/ai/configurations', requireAdmin, async (req: Request<Record<string, string>, unknown, AiConfigurationInput>, res, next) => {
	try {
		const input = validateAIConfiguration(req.body);
		const config = await aiConfigurationService.update(input);
		res.status(200).json({ data: config });
	} catch (error) {
		next(error);
	}
});

/* ==================== Rotas de Histórico de Conversas (Máx 10 / FIFO) & Memória Pessoal ==================== */

apiRouter.get('/chat/conversations', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const authReq = req as AuthenticatedRequest;
		const userId = authReq.user?.id;
		if (!userId) {
			res.status(401).json({ error: 'Usuário não autenticado.' });
			return;
		}

		const result = await chatHistoryMemoryService.listUserConversations(userId);
		res.status(200).json({ data: result });
	} catch (error) {
		next(error);
	}
});

apiRouter.post('/chat/conversations', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const authReq = req as AuthenticatedRequest;
		const userId = authReq.user?.id;
		if (!userId) {
			res.status(401).json({ error: 'Usuário não autenticado.' });
			return;
		}

		const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
		const result = await chatHistoryMemoryService.createConversation(userId, title);
		res.status(201).json({
			data: result.conversation,
			evictedConversationIds: result.evictedConversationIds,
		});
	} catch (error) {
		next(error);
	}
});

apiRouter.get('/chat/conversations/:id', requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
	try {
		const authReq = req as AuthenticatedRequest;
		const userId = authReq.user?.id;
		if (!userId) {
			res.status(401).json({ error: 'Usuário não autenticado.' });
			return;
		}

		const detail = await chatHistoryMemoryService.getConversationWithMessages(userId, req.params.id);
		res.status(200).json({ data: detail });
	} catch (error) {
		if (error instanceof Error && error.message.includes('Acesso negado')) {
			res.status(403).json({ error: error.message });
			return;
		}
		if (error instanceof Error && error.message.includes('não encontrada')) {
			res.status(404).json({ error: error.message });
			return;
		}
		next(error);
	}
});

apiRouter.patch('/chat/conversations/:id', requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
	try {
		const authReq = req as AuthenticatedRequest;
		const userId = authReq.user?.id;
		if (!userId) {
			res.status(401).json({ error: 'Usuário não autenticado.' });
			return;
		}

		let updated;
		if (typeof req.body?.isPinned === 'boolean') {
			updated = await chatHistoryMemoryService.togglePinConversation(
				userId,
				req.params.id,
				req.body.isPinned,
			);
		}
		if (typeof req.body?.title === 'string' && req.body.title.trim()) {
			updated = await chatHistoryMemoryService.renameConversation(
				userId,
				req.params.id,
				req.body.title,
			);
		}

		if (!updated) {
			res.status(400).json({ error: 'Informe title ou isPinned para atualizar a conversa.' });
			return;
		}

		res.status(200).json({ data: updated });
	} catch (error) {
		if (error instanceof Error && error.message.includes('Acesso negado')) {
			res.status(403).json({ error: error.message });
			return;
		}
		if (error instanceof Error && error.message.includes('fixar no máximo')) {
			res.status(400).json({ error: error.message });
			return;
		}
		next(error);
	}
});

apiRouter.delete('/chat/conversations/:id', requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
	try {
		const authReq = req as AuthenticatedRequest;
		const userId = authReq.user?.id;
		if (!userId) {
			res.status(401).json({ error: 'Usuário não autenticado.' });
			return;
		}

		await chatHistoryMemoryService.deleteConversation(userId, req.params.id);
		res.status(204).end();
	} catch (error) {
		if (error instanceof Error && error.message.includes('Acesso negado')) {
			res.status(403).json({ error: error.message });
			return;
		}
		next(error);
	}
});

apiRouter.get('/chat/memories', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const authReq = req as AuthenticatedRequest;
		const userId = authReq.user?.id;
		if (!userId) {
			res.status(401).json({ error: 'Usuário não autenticado.' });
			return;
		}

		const memories = await chatHistoryMemoryService.listUserMemories(userId);
		res.status(200).json({ data: memories });
	} catch (error) {
		next(error);
	}
});

apiRouter.post('/chat/memories', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const authReq = req as AuthenticatedRequest;
		const userId = authReq.user?.id;
		if (!userId) {
			res.status(401).json({ error: 'Usuário não autenticado.' });
			return;
		}

		const fact = typeof req.body?.fact === 'string' ? req.body.fact.trim() : '';
		const category = typeof req.body?.category === 'string' ? (req.body.category as MemoryCategory) : 'PREFERENCIA_GERAL';

		if (!fact) {
			res.status(400).json({ error: 'Informe o fato ou preferência para memorizar.' });
			return;
		}

		const saved = await chatHistoryMemoryService.addOrUpdateUserMemory({
			userId,
			fact,
			category,
			source: 'MANUAL',
		});
		res.status(201).json({ data: saved });
	} catch (error) {
		next(error);
	}
});

apiRouter.delete('/chat/memories/:id', requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
	try {
		const authReq = req as AuthenticatedRequest;
		const userId = authReq.user?.id;
		if (!userId) {
			res.status(401).json({ error: 'Usuário não autenticado.' });
			return;
		}

		await chatHistoryMemoryService.deleteUserMemory(userId, req.params.id);
		res.status(204).end();
	} catch (error) {
		if (error instanceof Error && error.message.includes('Acesso negado')) {
			res.status(403).json({ error: error.message });
			return;
		}
		next(error);
	}
});

/* ==================== Rotas de Avaliação de Respostas (Feedback & Qualidade IA) ==================== */

apiRouter.post('/chat/feedback', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const authReq = req as AuthenticatedRequest;
		const userId = authReq.user?.id;
		if (!userId) {
			res.status(401).json({ error: 'Usuário não autenticado.' });
			return;
		}

		const body = req.body ?? {};
		const rawRating = typeof body.rating === 'string' ? body.rating.trim().toUpperCase() : '';
		if (rawRating !== 'POSITIVE' && rawRating !== 'NEGATIVE') {
			res.status(400).json({ error: 'O campo rating deve ser POSITIVE ou NEGATIVE.' });
			return;
		}

		const assistantResponse =
			typeof body.assistantResponse === 'string' ? body.assistantResponse.trim() : '';
		if (!assistantResponse) {
			res.status(400).json({ error: 'O conteúdo da resposta avaliada é obrigatório.' });
			return;
		}

		const saved = await chatFeedbackService.submitOrUpdateFeedback({
			userId,
			conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
			messageId: typeof body.messageId === 'string' ? body.messageId : null,
			rating: rawRating,
			tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
			comment: typeof body.comment === 'string' ? body.comment : null,
			userPrompt: typeof body.userPrompt === 'string' ? body.userPrompt : '',
			assistantResponse,
			contextSummary: typeof body.contextSummary === 'string' ? body.contextSummary : null,
			generatedSql: typeof body.generatedSql === 'string' ? body.generatedSql : null,
			fullConversation: body.fullConversation,
		});

		res.status(201).json({ data: saved });
	} catch (error) {
		next(error);
	}
});

apiRouter.get('/admin/feedbacks', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const ratingQuery = typeof req.query.rating === 'string' ? req.query.rating.toUpperCase() : 'ALL';
		const statusQuery = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'ALL';
		const searchQuery = typeof req.query.search === 'string' ? req.query.search : '';

		const ratingFilter =
			ratingQuery === 'POSITIVE' || ratingQuery === 'NEGATIVE' ? ratingQuery : 'ALL';
		const statusFilter =
			statusQuery === 'PENDING' || statusQuery === 'RESOLVED' ? statusQuery : 'ALL';

		const [feedbacks, analytics] = await Promise.all([
			chatFeedbackService.listFeedbacks({
				rating: ratingFilter,
				status: statusFilter,
				search: searchQuery,
			}),
			chatFeedbackService.getDashboardAnalytics(),
		]);

		res.status(200).json({
			data: {
				feedbacks,
				analytics,
			},
		});
	} catch (error) {
		next(error);
	}
});

apiRouter.patch(
	'/admin/feedbacks/:id/status',
	requireAdmin,
	async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
		try {
			const authReq = req as AuthenticatedRequest;
			const rawStatus =
				typeof req.body?.status === 'string' ? req.body.status.trim().toUpperCase() : '';
			if (rawStatus !== 'PENDING' && rawStatus !== 'RESOLVED') {
				res.status(400).json({ error: 'O status deve ser PENDING ou RESOLVED.' });
				return;
			}

			const adminName = authReq.user?.nome || authReq.user?.email || 'Administrador';
			const updated = await chatFeedbackService.updateFeedbackStatus(
				req.params.id,
				rawStatus,
				adminName,
			);

			res.status(200).json({ data: updated });
		} catch (error) {
			if (error instanceof Error && error.message.includes('não encontrada')) {
				res.status(404).json({ error: error.message });
				return;
			}
			next(error);
		}
	},
);

apiRouter.post('/chat', requireAuth, async (req: Request<Record<string, string>, unknown, ChatBody>, res, next) => {
	try {
		const authReq = req as AuthenticatedRequest;
		const userId = authReq.user?.id;
		const rawHistory = validateHistory(req.body.history);

		// Abre o canal SSE imediatamente para emitir eventos de progresso real ao frontend
		res.status(200);
		res.set({
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no',
		});
		res.flushHeaders();

		const emitStatus = (step: number, title: string, subtitle: string) => {
			if (!res.writableEnded && !res.closed) {
				res.write(`event: status\ndata: ${JSON.stringify({ step, title, subtitle })}\n\n`);
			}
		};

		emitStatus(1, 'Analisando pergunta e contexto...', 'Interpretando histórico da conversa e memória pessoal');

		const lastUserMessage = [...rawHistory].reverse().find((m) => m.role === 'user')?.parts.map((p) => p.text).join(' ') ?? '';

		// Se houver usuário autenticado, extrai memórias implícitas da mensagem e prepara conversa ativa (FIFO 10)
		let activeConversationId =
			typeof req.body.conversationId === 'string' && req.body.conversationId.trim()
				? req.body.conversationId.trim()
				: null;
		let evictedConversationIds: string[] = [];
		let newMemoriesSavedCount = 0;

		if (userId && lastUserMessage) {
			try {
				const extracted = await chatHistoryMemoryService.extractAndSaveImplicitUserMemories(
					userId,
					lastUserMessage,
				);
				newMemoriesSavedCount = extracted.length;
			} catch (memErr) {
				console.warn('[ChatRoute] Aviso ao extrair memórias implícitas:', memErr);
			}

			if (!activeConversationId) {
				try {
					const createdConv = await chatHistoryMemoryService.createConversation(userId, lastUserMessage);
					activeConversationId = createdConv.conversation.id;
					evictedConversationIds = createdConv.evictedConversationIds;
				} catch (convErr) {
					console.warn('[ChatRoute] Aviso ao criar conversa automática:', convErr);
				}
			}
		}

		// Constrói o histórico otimizado (Resumo Compactado + Últimas Mensagens Intactas) se houver conversa salva
		let effectiveHistory = rawHistory;
		if (userId && activeConversationId && lastUserMessage) {
			try {
				effectiveHistory = await chatHistoryMemoryService.buildOptimizedHistoryForLlm(
					userId,
					activeConversationId,
					lastUserMessage,
				);
			} catch {
				effectiveHistory = rawHistory;
			}
		}

		// Verifica se o usuário está respondendo "Sim" para salvar no seu Dashboard o último gráfico gerado no chat
		if (userId && lastUserMessage && isSaveChartToDashboardConfirmation(lastUserMessage)) {
			const previousModelMessages = rawHistory.filter((m) => m.role === 'model');
			const lastModelText =
				previousModelMessages.length > 0
					? previousModelMessages[previousModelMessages.length - 1].parts.map((p) => p.text).join('\n')
					: '';
			const previousUserMessages = rawHistory.filter((m) => m.role === 'user');
			const previousUserPrompt =
				previousUserMessages.length >= 2
					? previousUserMessages[previousUserMessages.length - 2].parts.map((p) => p.text).join(' ')
					: '';

			const chartFromHistory = extractLastDashboardBlockFromText(lastModelText);
			const chartFromSession = userDashboardService.getLastChatChart(userId);
			const pendingChart = chartFromHistory ?? chartFromSession;

			if (
				pendingChart &&
				(chartFromHistory !== null || /\b(dashboard|painel|indicador|gr[áa]fico)\b/i.test(lastUserMessage))
			) {
				emitStatus(
					2,
					'Salvando gráfico no Seu Dashboard...',
					'Enviando indicador com o mesmo layout e dados',
				);

				const createdWidget = await userDashboardService.createWidget(userId, {
					title: pendingChart.title,
					type: pendingChart.type,
					data: pendingChart.data,
					sqlQuery: chartFromSession?.sqlQuery ?? null,
					queryPrompt:
						previousUserPrompt || chartFromSession?.queryPrompt || pendingChart.title,
				});

				if (!res.writableEnded && !res.closed) {
					res.write(
						`event: dashboard_saved\ndata: ${JSON.stringify({ widget: createdWidget })}\n\n`,
					);
				}

				const layoutNames: Record<string, string> = {
					bar: 'Gráfico de Barras Verticais',
					'horizontal-bar': 'Ranking em Barras Horizontais',
					line: 'Gráfico de Linha (Série Temporal)',
					area: 'Gráfico de Área',
					pie: 'Gráfico de Pizza',
					table: 'Tabela Analítica',
				};
				const layoutDesc = layoutNames[pendingChart.type] || pendingChart.type;

				const confirmationText = `✅ Perfeito! Enviei o gráfico **"${pendingChart.title}"** para o **Seu Dashboard** como um indicador mantendo exatamente o mesmo layout (**${layoutDesc}**).\n\nVocê já pode acompanhá-lo, redimensioná-lo ou atualizá-lo a qualquer momento acessando a aba **Seu Dashboard** no menu superior!`;

				if (activeConversationId) {
					try {
						const savedExchange = await chatHistoryMemoryService.appendExchangeAndCompactIfNeeded({
							userId,
							conversationId: activeConversationId,
							userMessage: lastUserMessage,
							assistantMessage: confirmationText,
						});
						if (!res.writableEnded && !res.closed) {
							res.write(
								`event: conversation\ndata: ${JSON.stringify({
									conversationId: activeConversationId,
									title: savedExchange.title,
									wasCompacted: savedExchange.wasCompacted,
									evictedConversationIds,
									newMemoriesSavedCount,
								})}\n\n`,
							);
						}
					} catch (persistErr) {
						console.warn('[ChatRoute] Aviso ao salvar confirmação de dashboard na conversa:', persistErr);
					}
				}

				if (!res.writableEnded && !res.closed) {
					res.write(`data: ${JSON.stringify({ text: confirmationText })}\n\n`);
					res.write('event: done\ndata: {}\n\n');
					res.end();
				}
				return;
			}
		}

		// Carrega as configurações da IA e as integrações cadastradas do banco de dados
		const aiConfig = await aiConfigurationService.get();
		const erpIntegrations = await erpConfigurationService.list();

		const companyBusinessRulesPrompt =
			typeof req.body.systemPrompt === 'string' && req.body.systemPrompt.trim()
				? req.body.systemPrompt.trim()
				: aiConfig.systemPrompt;

		let erpContext = '';
		if (erpIntegrations.length > 0) {
			erpContext = '\n\nTabelas e Integrações do ERP disponíveis no banco:\n' + erpIntegrations.map((i) => (
				`- Contexto: "${i.context}" (Tabela: "${i.tableName}"): ${i.description}. Colunas: ${i.expectedFields.join(', ')}`
			)).join('\n');
		}

		// Carrega o bloco de Memória Pessoal de Longo Prazo do Usuário
		let userMemoryContext = '';
		if (userId) {
			try {
				userMemoryContext = await chatHistoryMemoryService.buildUserMemoryPromptBlock(userId, {
					nome: authReq.user?.nome,
					email: authReq.user?.email,
					role: authReq.user?.role,
				});
			} catch {
				userMemoryContext = '';
			}
		}

		// Executa pipeline RAG / Text-to-SQL com Query Rewriter, Regras de Negócio da Empresa e Self-Healing SQL Retry
		let ragResult: RagPipelineResult = {
			noDataFound: true,
			reason: 'EMPTY_QUESTION',
			fallbackMessage: null,
			contextPrompt: null,
			generatedSql: null,
			rowCount: 0,
			rows: [],
		};

		if (lastUserMessage) {
			emitStatus(2, 'Consultando dados sincronizados do Sankhya ERP...', 'Executando query segura Read-Only no PostgreSQL');
			try {
				ragResult = await chatRagService.executeRagPipeline(
					lastUserMessage,
					effectiveHistory,
					companyBusinessRulesPrompt,
				);
			} catch (ragErr) {
				console.warn('[ChatRoute] Erro ao buscar dados reais via RAG:', ragErr);
			}
		}

		const realDatabaseContext = ragResult.contextPrompt ? `\n\n${ragResult.contextPrompt}` : '';

		// Combina as Regras de Negócio da Empresa (editáveis na UI) + Memória Pessoal do Usuário + Diretivas Técnicas Internas (ocultas)
		const fullBaseSystemPrompt = aiConfigurationService.buildFullSystemPrompt(companyBusinessRulesPrompt);
		const systemPrompt = `${fullBaseSystemPrompt}${userMemoryContext}${erpContext}${realDatabaseContext}`;

		let parameters: GeminiParameters = {
			temperature: aiConfig.temperature,
			topP: aiConfig.topP,
		};
		if (isRecord(req.body.parameters) && typeof req.body.parameters.temperature === 'number' && typeof req.body.parameters.topP === 'number') {
			parameters = {
				temperature: req.body.parameters.temperature,
				topP: req.body.parameters.topP,
			};
		}

		const gemini = new GeminiService();
		const reviewer = new ResponseReviewerService(gemini, 2);

		// Executa Geração + Revisão em 2 Camadas (Guardrail Determinístico + Agente Crítico LLM) + Auto-Correção + Fallback Determinístico
		const reviewOutcome = await reviewer.generateAndReviewResponse({
			userQuestion: lastUserMessage,
			history: effectiveHistory,
			systemPrompt,
			ragResult,
			parameters,
			onStatusUpdate: (st) => emitStatus(st.step, st.title, st.subtitle),
		});

		const generatedChart = extractLastDashboardBlockFromText(reviewOutcome.finalResponse);
		if (userId && generatedChart) {
			userDashboardService.recordLastChatChart(userId, {
				title: generatedChart.title,
				type: generatedChart.type,
				data: generatedChart.data,
				sqlQuery: ragResult.generatedSql,
				queryPrompt: lastUserMessage,
			});
		}

		const validatedText = appendSaveToDashboardQuestionIfChartPresent(reviewOutcome.finalResponse);

		if (userId) {
			chatFeedbackService.recordLastTurnMetadata(userId, {
				generatedSql: ragResult.generatedSql,
				contextSummary: chatFeedbackService.buildContextSummary(
					lastUserMessage,
					validatedText,
					ragResult.generatedSql,
				),
			});
		}

		// Persiste o turno na conversa do usuário e executa compactação automática se atingir o limite (16 msgs / 12k chars)
		if (userId && activeConversationId && lastUserMessage) {
			try {
				const savedExchange = await chatHistoryMemoryService.appendExchangeAndCompactIfNeeded({
					userId,
					conversationId: activeConversationId,
					userMessage: lastUserMessage,
					assistantMessage: validatedText,
				});
				if (!res.writableEnded && !res.closed) {
					res.write(
						`event: conversation\ndata: ${JSON.stringify({
							conversationId: activeConversationId,
							title: savedExchange.title,
							wasCompacted: savedExchange.wasCompacted,
							evictedConversationIds,
							newMemoriesSavedCount,
						})}\n\n`,
					);
				}
			} catch (persistErr) {
				console.warn('[ChatRoute] Aviso ao salvar turno na conversa:', persistErr);
			}
		}
		const chunkSize = 180;

		for (let offset = 0; offset < validatedText.length; offset += chunkSize) {
			if (res.writableEnded || res.closed) {
				break;
			}
			const textChunk = validatedText.slice(offset, offset + chunkSize);
			if (!res.write(`data: ${JSON.stringify({ text: textChunk })}\n\n`)) {
				await waitForDrain(res);
			}
		}

		if (!res.writableEnded && !res.closed) {
			res.write('event: done\ndata: {}\n\n');
			res.end();
		}
	} catch (error) {
		if (res.headersSent && !res.writableEnded && !res.closed) {
			res.write(`event: error\ndata: ${JSON.stringify({ message: toPublicErrorMessage(error) })}\n\n`);
			res.end();
			return;
		}

		next(error);
	}
});

/* ==================== Rotas de "Seu Dashboard" (Personalizado) ==================== */

apiRouter.get('/dashboard/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const authReq = req as AuthenticatedRequest;
		const userId = authReq.user?.id;
		if (!userId) {
			res.status(401).json({ error: 'Usuário não autenticado.' });
			return;
		}

		const dashboard = await userDashboardService.getOrCreateDashboard(userId);
		res.status(200).json({ data: dashboard });
	} catch (error) {
		next(error);
	}
});

apiRouter.post('/dashboard/widgets/generate', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const authReq = req as AuthenticatedRequest;
		const userId = authReq.user?.id;
		if (!userId) {
			res.status(401).json({ error: 'Usuário não autenticado.' });
			return;
		}

		const prompt = req.body?.prompt;
		if (typeof prompt !== 'string' || !prompt.trim()) {
			res.status(400).json({ error: 'O prompt para geração do widget é obrigatório.' });
			return;
		}

		const widget = await userDashboardService.generateAndAddWidget(userId, prompt.trim());
		res.status(201).json({ data: widget });
	} catch (error) {
		next(error);
	}
});

apiRouter.post('/dashboard/widgets', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const authReq = req as AuthenticatedRequest;
		const userId = authReq.user?.id;
		if (!userId) {
			res.status(401).json({ error: 'Usuário não autenticado.' });
			return;
		}

		const { title, type, data, colSpan, rowSpan, sqlQuery, queryPrompt } = req.body ?? {};
		if (typeof title !== 'string' || !title.trim()) {
			res.status(400).json({ error: 'O título do widget é obrigatório.' });
			return;
		}
		if (typeof type !== 'string' || !type.trim()) {
			res.status(400).json({ error: 'O tipo do widget é obrigatório.' });
			return;
		}

		const widget = await userDashboardService.createWidget(userId, {
			title: title.trim(),
			type: type.trim() as any,
			data,
			colSpan: typeof colSpan === 'number' ? colSpan : undefined,
			rowSpan: typeof rowSpan === 'number' ? rowSpan : undefined,
			sqlQuery: typeof sqlQuery === 'string' ? sqlQuery : undefined,
			queryPrompt: typeof queryPrompt === 'string' ? queryPrompt : undefined,
		});

		res.status(201).json({ data: widget });
	} catch (error) {
		next(error);
	}
});

apiRouter.put('/dashboard/layout', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const authReq = req as AuthenticatedRequest;
		const userId = authReq.user?.id;
		if (!userId) {
			res.status(401).json({ error: 'Usuário não autenticado.' });
			return;
		}

		const items = req.body?.items;
		if (!Array.isArray(items)) {
			res.status(400).json({ error: 'O campo items deve ser um array com o layout dos widgets.' });
			return;
		}

		const updatedWidgets = await userDashboardService.updateLayout(userId, items);
		res.status(200).json({ data: updatedWidgets });
	} catch (error) {
		const err = error as Error;
		if (err.message && err.message.includes('Acesso negado')) {
			res.status(403).json({ error: err.message });
			return;
		}
		next(error);
	}
});

apiRouter.post('/dashboard/widgets/:id/refresh', requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
	try {
		const authReq = req as AuthenticatedRequest;
		const userId = authReq.user?.id;
		if (!userId) {
			res.status(401).json({ error: 'Usuário não autenticado.' });
			return;
		}

		const widgetId = req.params.id;
		const refreshedWidget = await userDashboardService.refreshWidget(userId, widgetId);
		res.status(200).json({ data: refreshedWidget });
	} catch (error) {
		const err = error as Error;
		if (err.message && (err.message.includes('não possui permissão') || err.message.includes('não encontrado'))) {
			res.status(404).json({ error: err.message });
			return;
		}
		next(error);
	}
});

apiRouter.delete('/dashboard/widgets/:id', requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
	try {
		const authReq = req as AuthenticatedRequest;
		const userId = authReq.user?.id;
		if (!userId) {
			res.status(401).json({ error: 'Usuário não autenticado.' });
			return;
		}

		const widgetId = req.params.id;
		const result = await userDashboardService.removeWidget(userId, widgetId);
		res.status(200).json(result);
	} catch (error) {
		const err = error as Error;
		if (err.message && (err.message.includes('não possui permissão') || err.message.includes('não encontrado'))) {
			res.status(404).json({ error: err.message });
			return;
		}
		next(error);
	}
});

function validateReadOnlyQuery(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new RequestValidationError('query deve ser uma string nao vazia.');
	}

	const query = value.trim();
	if (!/^select\b/i.test(query) || /;|--|\/\*|\*\//.test(query)) {
		throw new RequestValidationError('Apenas uma consulta SELECT, sem comentarios ou multiplos comandos, e permitida.');
	}

	return query;
}

function validateExpectedFields(value: unknown): string[] {
	if (!Array.isArray(value) || value.length === 0 || value.some((field) => typeof field !== 'string')) {
		throw new RequestValidationError('expectedFields deve conter ao menos um campo.');
	}

	const fields = [...new Set(value.map((field) => field.trim()))];
	if (fields.some((field) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field))) {
		throw new RequestValidationError('Os campos esperados devem ser identificadores validos.');
	}

	return fields;
}

function validateErpConfiguration(body: ErpConfigurationBody): ErpConfigurationInput {
	if (typeof body.context !== 'string' || !body.context.trim()) {
		throw new RequestValidationError('context deve ser uma string não vazia.');
	}

	if (typeof body.query !== 'string' || !body.query.trim()) {
		throw new RequestValidationError('query deve ser uma string não vazia.');
	}

	if (body.description !== undefined && typeof body.description !== 'string') {
		throw new RequestValidationError('description deve ser uma string.');
	}

	let syncFrequency: 'MINUTES' | 'HOURS' | 'DAILY' | 'MONTHLY' | 'MANUAL' | undefined;
	if (body.syncFrequency !== undefined) {
		const validFrequencies = ['MINUTES', 'HOURS', 'DAILY', 'MONTHLY', 'MANUAL'];
		if (typeof body.syncFrequency !== 'string' || !validFrequencies.includes(body.syncFrequency.toUpperCase())) {
			throw new RequestValidationError('syncFrequency deve ser MINUTES, HOURS, DAILY, MONTHLY ou MANUAL.');
		}
		syncFrequency = body.syncFrequency.toUpperCase() as 'MINUTES' | 'HOURS' | 'DAILY' | 'MONTHLY' | 'MANUAL';
	}

	let syncInterval: number | undefined;
	if (body.syncInterval !== undefined && body.syncInterval !== null) {
		const parsed = Number(body.syncInterval);
		if (Number.isNaN(parsed) || parsed < 1) {
			throw new RequestValidationError('syncInterval deve ser um número maior ou igual a 1.');
		}
		syncInterval = Math.floor(parsed);
	}

	let syncTime: string | undefined;
	if (body.syncTime !== undefined && body.syncTime !== null) {
		if (typeof body.syncTime !== 'string' || !/^\d{1,2}:\d{2}$/.test(body.syncTime.trim())) {
			throw new RequestValidationError('syncTime deve estar no formato HH:mm.');
		}
		syncTime = body.syncTime.trim();
	}

	let syncDayOfMonth: number | undefined;
	if (body.syncDayOfMonth !== undefined && body.syncDayOfMonth !== null) {
		const parsed = Number(body.syncDayOfMonth);
		if (Number.isNaN(parsed) || parsed < 1 || parsed > 31) {
			throw new RequestValidationError('syncDayOfMonth deve ser um número entre 1 e 31.');
		}
		syncDayOfMonth = Math.floor(parsed);
	}

	const syncActive = body.syncActive !== undefined ? Boolean(body.syncActive) : undefined;

	let primaryKey: string | undefined;
	if (body.primaryKey !== undefined && body.primaryKey !== null) {
		if (typeof body.primaryKey !== 'string') {
			throw new RequestValidationError('primaryKey deve ser uma string indicando a coluna PK.');
		}
		primaryKey = body.primaryKey.trim();
	}

	let syncStrategy: 'FULL' | 'HASH_COMPARATOR' | 'INCREMENTAL' | undefined;
	if (body.syncStrategy !== undefined && body.syncStrategy !== null) {
		const s = String(body.syncStrategy).trim().toUpperCase();
		if (s !== 'FULL' && s !== 'HASH_COMPARATOR' && s !== 'INCREMENTAL') {
			throw new RequestValidationError('syncStrategy deve ser FULL ou HASH_COMPARATOR.');
		}
		syncStrategy = (s === 'INCREMENTAL' ? 'HASH_COMPARATOR' : s) as 'FULL' | 'HASH_COMPARATOR';
	}

	let batchSize: number | undefined;
	if (body.batchSize !== undefined && body.batchSize !== null) {
		const parsed = Number(body.batchSize);
		if (Number.isNaN(parsed) || parsed < 1) {
			throw new RequestValidationError('batchSize deve ser um número maior ou igual a 1.');
		}
		batchSize = Math.floor(parsed);
	}

	const lastSyncCursor = typeof body.lastSyncCursor === 'string' ? body.lastSyncCursor.trim() : undefined;
	const activeColumn = typeof body.activeColumn === 'string' ? body.activeColumn.trim() : undefined;
	const activeValue = typeof body.activeValue === 'string' ? body.activeValue.trim() : undefined;

	let columnDescriptions: Record<string, string> | undefined;
	if (isRecord(body.columnDescriptions)) {
		columnDescriptions = {};
		for (const [k, v] of Object.entries(body.columnDescriptions)) {
			if (typeof v === 'string' && v.trim()) {
				columnDescriptions[k.trim().toUpperCase()] = v.trim();
			}
		}
	}

	return {
		context: body.context.trim(),
		description: typeof body.description === 'string' ? body.description.trim() : '',
		query: body.query,
		expectedFields: validateExpectedFields(body.expectedFields),
		columnDescriptions,
		primaryKey,
		syncStrategy,
		lastSyncCursor,
		batchSize,
		activeColumn,
		activeValue,
		syncFrequency,
		syncInterval,
		syncTime,
		syncDayOfMonth,
		syncActive,
	};
}

function validateHistory(value: unknown): GeminiMessage[] {
	if (!Array.isArray(value)) {
		throw new RequestValidationError('history deve ser um array de mensagens.');
	}

	return value as GeminiMessage[];
}

function validateSystemPrompt(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new RequestValidationError('systemPrompt deve ser uma string nao vazia.');
	}

	return value;
}

function validateAIConfiguration(body: AiConfigurationInput): AiConfigurationInput {
	if (typeof body.systemPrompt !== 'string' || !body.systemPrompt.trim()) {
		throw new RequestValidationError('systemPrompt deve ser uma string nao vazia.');
	}

	if (typeof body.temperature !== 'number') {
		throw new RequestValidationError('temperature deve ser um numero.');
	}

	if (typeof body.topP !== 'number') {
		throw new RequestValidationError('topP deve ser um numero.');
	}

	if (typeof body.memorySize !== 'number') {
		throw new RequestValidationError('memorySize deve ser um numero.');
	}

	return {
		systemPrompt: body.systemPrompt.trim(),
		temperature: body.temperature,
		topP: body.topP,
		memorySize: body.memorySize,
	};
}

function validateParameters(value: unknown): GeminiParameters {
	if (!isRecord(value) || typeof value.temperature !== 'number' || typeof value.topP !== 'number') {
		throw new RequestValidationError('parameters deve informar temperature e topP numericos.');
	}

	return { temperature: value.temperature, topP: value.topP };
}

function waitForDrain(res: Response): Promise<void> {
	return new Promise((resolve) => {
		const finish = () => {
			res.off('drain', finish);
			res.off('close', finish);
			resolve();
		};

		res.once('drain', finish);
		res.once('close', finish);
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toPublicErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Falha inesperada ao gerar a resposta.';
}

export class RequestValidationError extends Error {
	readonly statusCode = 400;
}

export function apiErrorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
	const statusCode = error instanceof RequestValidationError ? error.statusCode : 500;
	const message = toPublicErrorMessage(error);

	res.status(statusCode).json({ error: message });
}

export default apiRouter;
