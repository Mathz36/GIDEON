import { PrismaClient } from '@prisma/client';
import prismaClient from '../config/prisma';

export type FeedbackRating = 'POSITIVE' | 'NEGATIVE';
export type FeedbackStatus = 'PENDING' | 'RESOLVED';

export interface SubmitFeedbackInput {
	userId: string;
	conversationId?: string | null;
	messageId?: string | null;
	rating: FeedbackRating;
	tags?: string[];
	comment?: string | null;
	userPrompt: string;
	assistantResponse: string;
	contextSummary?: string | null;
	generatedSql?: string | null;
	fullConversation?: unknown;
}

export interface FeedbackItemDto {
	id: string;
	userId: string;
	userName: string;
	userEmail: string;
	userRole: string;
	conversationId: string | null;
	messageId: string | null;
	rating: FeedbackRating;
	tags: string[];
	comment: string | null;
	userPrompt: string;
	assistantResponse: string;
	contextSummary: string;
	generatedSql: string | null;
	fullConversation: Array<{ role: string; content: string; createdAt?: string }>;
	status: FeedbackStatus;
	resolvedAt: Date | null;
	resolvedBy: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface FeedbackAnalyticsDto {
	summary: {
		totalFeedbacks: number;
		positiveCount: number;
		negativeCount: number;
		positivePercentage: number;
		negativePercentage: number;
		pendingCount: number;
		resolvedCount: number;
	};
	trendData: Array<{
		date: string;
		isoDate: string;
		positive: number;
		negative: number;
		total: number;
		approvalRate: number;
	}>;
	topUsers: Array<{
		userId: string;
		nome: string;
		email: string;
		role: string;
		totalCount: number;
		positiveCount: number;
		negativeCount: number;
		approvalRate: number;
	}>;
	tagBreakdown: Array<{
		tag: string;
		count: number;
		rating: FeedbackRating;
	}>;
}

export class ChatFeedbackService {
	private readonly prisma: PrismaClient;
	private schemaInitialized = false;
	private readonly lastTurnMetaByUser = new Map<
		string,
		{ generatedSql: string | null; contextSummary: string | null; updatedAt: number }
	>();

	constructor(prisma: PrismaClient = prismaClient) {
		this.prisma = prisma;
	}

	public recordLastTurnMetadata(
		userId: string,
		meta: { generatedSql?: string | null; contextSummary?: string | null },
	): void {
		if (!userId) return;
		this.lastTurnMetaByUser.set(userId, {
			generatedSql: meta.generatedSql ?? null,
			contextSummary: meta.contextSummary ?? null,
			updatedAt: Date.now(),
		});
	}

	public getLastTurnMetadata(userId: string): {
		generatedSql: string | null;
		contextSummary: string | null;
	} | null {
		if (!userId) return null;
		return this.lastTurnMetaByUser.get(userId) ?? null;
	}

	/**
	 * Garante de forma idempotente que a tabela `chat_feedbacks` exista no PostgreSQL
	 * sem afetar nenhuma tabela dinâmica `erp_*`.
	 */
	public async ensureSchemaInitialized(): Promise<void> {
		if (this.schemaInitialized) {
			return;
		}

		if (
			typeof this.prisma.$executeRawUnsafe !== 'function' ||
			!(this.prisma as any).chatFeedback
		) {
			this.schemaInitialized = true;
			return;
		}

		try {
			await this.prisma.$executeRawUnsafe(`
				CREATE TABLE IF NOT EXISTS "chat_feedbacks" (
					"id" TEXT NOT NULL,
					"user_id" TEXT NOT NULL,
					"conversation_id" TEXT,
					"message_id" TEXT,
					"rating" TEXT NOT NULL,
					"tags" JSONB,
					"comment" TEXT,
					"user_prompt" TEXT NOT NULL,
					"assistant_response" TEXT NOT NULL,
					"context_summary" TEXT,
					"generated_sql" TEXT,
					"full_conversation" JSONB,
					"status" TEXT NOT NULL DEFAULT 'PENDING',
					"resolved_at" TIMESTAMP(3),
					"resolved_by" TEXT,
					"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					CONSTRAINT "chat_feedbacks_pkey" PRIMARY KEY ("id"),
					CONSTRAINT "chat_feedbacks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE
				);
			`);

			await this.prisma.$executeRawUnsafe(`
				CREATE INDEX IF NOT EXISTS "chat_feedbacks_user_id_created_at_idx"
				ON "chat_feedbacks"("user_id", "created_at");
			`);

			await this.prisma.$executeRawUnsafe(`
				CREATE INDEX IF NOT EXISTS "chat_feedbacks_rating_status_created_at_idx"
				ON "chat_feedbacks"("rating", "status", "created_at");
			`);

			this.schemaInitialized = true;
		} catch (err) {
			console.warn('[ChatFeedbackService] Aviso ao inicializar tabela chat_feedbacks:', err);
		}
	}

	/**
	 * Gera de forma determinística um resumo conciso do contexto da resposta avaliada.
	 */
	public buildContextSummary(
		userPrompt: string,
		assistantResponse: string,
		generatedSql?: string | null,
	): string {
		const cleanQuestion = (userPrompt || '').replace(/\s+/g, ' ').trim();
		let chartInfo = '';

		const cleanAnswer = (assistantResponse || '')
			.replace(/```dashboard\s*([\s\S]*?)\s*```/gi, (_full, jsonStr: string) => {
				try {
					const parsed = JSON.parse(jsonStr);
					chartInfo = ` | Gráfico gerado: "${parsed.title || parsed.type}" (${parsed.type})`;
				} catch {
					chartInfo = ' | Gráfico gerado no chat';
				}
				return '';
			})
			.replace(/---\s*📊\s*\*\*Deseja salvar este gráfico[\s\S]*$/i, '')
			.replace(/\s+/g, ' ')
			.trim();

		const answerSnippet =
			cleanAnswer.length > 180 ? `${cleanAnswer.slice(0, 177)}...` : cleanAnswer;
		const sqlBadge = generatedSql ? ' | Consulta SQL executada' : '';

		return `Pergunta: "${cleanQuestion.slice(0, 120)}" → Resposta: ${answerSnippet}${chartInfo}${sqlBadge}`;
	}

	/**
	 * Registra ou atualiza a avaliação (Positiva / Negativa) de uma resposta da Gideon,
	 * salvando o contexto resumido, a avaliação, o usuário que avaliou e a conversa completa.
	 */
	public async submitOrUpdateFeedback(input: SubmitFeedbackInput): Promise<FeedbackItemDto> {
		await this.ensureSchemaInitialized();

		if (!input.userId || typeof input.userId !== 'string') {
			throw new Error('Usuário inválido para registro de avaliação.');
		}

		const rating: FeedbackRating = input.rating === 'NEGATIVE' ? 'NEGATIVE' : 'POSITIVE';
		const userPrompt = (input.userPrompt || '').trim() || 'Pergunta não informada';
		const assistantResponse = (input.assistantResponse || '').trim();

		if (!assistantResponse) {
			throw new Error('A resposta avaliada não pode ser vazia.');
		}

		const lastMeta = this.getLastTurnMetadata(input.userId);
		const generatedSql = input.generatedSql ?? lastMeta?.generatedSql ?? null;
		const contextSummary =
			input.contextSummary?.trim() ||
			this.buildContextSummary(userPrompt, assistantResponse, generatedSql);

		const cleanTags = Array.isArray(input.tags)
			? input.tags.map((t) => String(t).trim()).filter(Boolean)
			: [];
		const cleanComment = input.comment?.trim() ? input.comment.trim() : null;

		// Normaliza a conversa completa para armazenamento JSON seguro
		let normalizedFullConversation: Array<{ role: string; content: string; createdAt?: string }> = [];
		if (Array.isArray(input.fullConversation) && input.fullConversation.length > 0) {
			normalizedFullConversation = input.fullConversation
				.filter((m) => m && typeof m === 'object')
				.map((m: any) => ({
					role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
					content: typeof m.content === 'string' ? m.content : '',
					...(typeof m.createdAt === 'string' ? { createdAt: m.createdAt } : {}),
				}))
				.filter((m) => m.content.trim().length > 0);
		} else {
			normalizedFullConversation = [
				{ role: 'user', content: userPrompt },
				{ role: 'assistant', content: assistantResponse },
			];
		}

		// Verifica se o usuário já avaliou esta mesma mensagem para atualizar (ex: adicionando comentário/tags)
		let existingRecord: any = null;
		if (input.messageId && input.messageId.trim()) {
			const existingList = await this.prisma.chatFeedback.findMany({
				where: {
					userId: input.userId,
					messageId: input.messageId.trim(),
				},
				orderBy: { createdAt: 'desc' },
			});
			existingRecord = existingList[0] ?? null;
		}

		let savedRecord: any;
		if (existingRecord) {
			savedRecord = await this.prisma.chatFeedback.update({
				where: { id: existingRecord.id },
				data: {
					rating,
					tags: cleanTags.length > 0 ? cleanTags : (existingRecord.tags ?? []),
					comment: cleanComment !== null ? cleanComment : existingRecord.comment,
					contextSummary,
					fullConversation: normalizedFullConversation as any,
					updatedAt: new Date(),
				},
				include: {
					usuario: {
						select: {
							id: true,
							nome: true,
							email: true,
							tipo_acesso: true,
						},
					},
				},
			});
		} else {
			savedRecord = await this.prisma.chatFeedback.create({
				data: {
					userId: input.userId,
					conversationId: input.conversationId?.trim() || null,
					messageId: input.messageId?.trim() || null,
					rating,
					tags: cleanTags as any,
					comment: cleanComment,
					userPrompt,
					assistantResponse,
					contextSummary,
					generatedSql,
					fullConversation: normalizedFullConversation as any,
					status: 'PENDING',
				},
				include: {
					usuario: {
						select: {
							id: true,
							nome: true,
							email: true,
							tipo_acesso: true,
						},
					},
				},
			});
		}

		return this.mapRecordToDto(savedRecord);
	}

	/**
	 * Lista todas as avaliações com filtros por tipo (POSITIVE / NEGATIVE), status (PENDING / RESOLVED) e busca textual.
	 */
	public async listFeedbacks(filters?: {
		rating?: 'ALL' | 'POSITIVE' | 'NEGATIVE';
		status?: 'ALL' | 'PENDING' | 'RESOLVED';
		search?: string;
	}): Promise<FeedbackItemDto[]> {
		await this.ensureSchemaInitialized();

		const whereClause: Record<string, unknown> = {};
		if (filters?.rating && filters.rating !== 'ALL') {
			whereClause.rating = filters.rating;
		}
		if (filters?.status && filters.status !== 'ALL') {
			whereClause.status = filters.status;
		}

		const records = await this.prisma.chatFeedback.findMany({
			where: whereClause as any,
			orderBy: { createdAt: 'desc' },
			include: {
				usuario: {
					select: {
						id: true,
						nome: true,
						email: true,
						tipo_acesso: true,
					},
				},
			},
		});

		let dtos = records.map((r) => this.mapRecordToDto(r));

		if (filters?.search && filters.search.trim()) {
			const q = filters.search.trim().toLowerCase();
			dtos = dtos.filter(
				(item) =>
					item.userName.toLowerCase().includes(q) ||
					item.userEmail.toLowerCase().includes(q) ||
					item.userPrompt.toLowerCase().includes(q) ||
					item.assistantResponse.toLowerCase().includes(q) ||
					item.contextSummary.toLowerCase().includes(q) ||
					(item.comment && item.comment.toLowerCase().includes(q)) ||
					item.tags.some((t) => t.toLowerCase().includes(q)),
			);
		}

		return dtos;
	}

	/**
	 * Permite ao administrador marcar uma avaliação como Resolvida (RESOLVED) ou Reabrir como Pendente (PENDING).
	 */
	public async updateFeedbackStatus(
		feedbackId: string,
		status: FeedbackStatus,
		resolvedBy?: string,
	): Promise<FeedbackItemDto> {
		await this.ensureSchemaInitialized();

		const existing = await this.prisma.chatFeedback.findUnique({
			where: { id: feedbackId },
		});

		if (!existing) {
			throw new Error('Avaliação não encontrada.');
		}

		const isResolved = status === 'RESOLVED';
		const updated = await this.prisma.chatFeedback.update({
			where: { id: feedbackId },
			data: {
				status: isResolved ? 'RESOLVED' : 'PENDING',
				resolvedAt: isResolved ? new Date() : null,
				resolvedBy: isResolved ? (resolvedBy || 'Administrador') : null,
				updatedAt: new Date(),
			},
			include: {
				usuario: {
					select: {
						id: true,
						nome: true,
						email: true,
						tipo_acesso: true,
					},
				},
			},
		});

		return this.mapRecordToDto(updated);
	}

	/**
	 * Calcula os indicadores executivos do Dashboard de Qualidade & Feedbacks da Gideon:
	 * - % de feedbacks positivos vs negativos
	 * - Ranking de usuários que mais avaliam
	 * - Gráfico de tendência de feedbacks ao longo do tempo (para entender se estamos melhorando ou piorando)
	 * - Distribuição de motivos/tags
	 */
	public async getDashboardAnalytics(): Promise<FeedbackAnalyticsDto> {
		const allFeedbacks = await this.listFeedbacks({ rating: 'ALL', status: 'ALL' });

		const totalFeedbacks = allFeedbacks.length;
		const positiveCount = allFeedbacks.filter((f) => f.rating === 'POSITIVE').length;
		const negativeCount = allFeedbacks.filter((f) => f.rating === 'NEGATIVE').length;
		const pendingCount = allFeedbacks.filter((f) => f.status === 'PENDING').length;
		const resolvedCount = allFeedbacks.filter((f) => f.status === 'RESOLVED').length;

		const positivePercentage =
			totalFeedbacks > 0 ? Number(((positiveCount / totalFeedbacks) * 100).toFixed(1)) : 0;
		const negativePercentage =
			totalFeedbacks > 0 ? Number(((negativeCount / totalFeedbacks) * 100).toFixed(1)) : 0;

		// 1. Gráfico de Tendência ao longo do tempo (agrupado por dia YYYY-MM-DD em ordem cronológica)
		const byDateMap = new Map<
			string,
			{ isoDate: string; date: string; positive: number; negative: number }
		>();

		for (const fb of allFeedbacks) {
			const dt = fb.createdAt instanceof Date ? fb.createdAt : new Date(fb.createdAt);
			const yyyy = dt.getFullYear();
			const mm = String(dt.getMonth() + 1).padStart(2, '0');
			const dd = String(dt.getDate()).padStart(2, '0');
			const isoDate = `${yyyy}-${mm}-${dd}`;
			const displayDate = `${dd}/${mm}`;

			const entry = byDateMap.get(isoDate) ?? {
				isoDate,
				date: displayDate,
				positive: 0,
				negative: 0,
			};

			if (fb.rating === 'POSITIVE') {
				entry.positive += 1;
			} else {
				entry.negative += 1;
			}
			byDateMap.set(isoDate, entry);
		}

		const trendData = Array.from(byDateMap.values())
			.sort((a, b) => a.isoDate.localeCompare(b.isoDate))
			.map((item) => {
				const total = item.positive + item.negative;
				const approvalRate = total > 0 ? Number(((item.positive / total) * 100).toFixed(1)) : 0;
				return {
					date: item.date,
					isoDate: item.isoDate,
					positive: item.positive,
					negative: item.negative,
					total,
					approvalRate,
				};
			});

		// 2. Ranking de Usuários que mais avaliam
		const byUserMap = new Map<
			string,
			{
				userId: string;
				nome: string;
				email: string;
				role: string;
				totalCount: number;
				positiveCount: number;
				negativeCount: number;
			}
		>();

		for (const fb of allFeedbacks) {
			const u = byUserMap.get(fb.userId) ?? {
				userId: fb.userId,
				nome: fb.userName,
				email: fb.userEmail,
				role: fb.userRole,
				totalCount: 0,
				positiveCount: 0,
				negativeCount: 0,
			};
			u.totalCount += 1;
			if (fb.rating === 'POSITIVE') {
				u.positiveCount += 1;
			} else {
				u.negativeCount += 1;
			}
			byUserMap.set(fb.userId, u);
		}

		const topUsers = Array.from(byUserMap.values())
			.sort((a, b) => b.totalCount - a.totalCount)
			.map((u) => ({
				...u,
				approvalRate:
					u.totalCount > 0 ? Number(((u.positiveCount / u.totalCount) * 100).toFixed(1)) : 0,
			}));

		// 3. Distribuição de Tags / Motivos
		const tagMap = new Map<string, { tag: string; count: number; rating: FeedbackRating }>();
		for (const fb of allFeedbacks) {
			for (const rawTag of fb.tags) {
				const key = `${fb.rating}:${rawTag}`;
				const existing = tagMap.get(key) ?? {
					tag: rawTag,
					count: 0,
					rating: fb.rating,
				};
				existing.count += 1;
				tagMap.set(key, existing);
			}
		}

		const tagBreakdown = Array.from(tagMap.values()).sort((a, b) => b.count - a.count);

		return {
			summary: {
				totalFeedbacks,
				positiveCount,
				negativeCount,
				positivePercentage,
				negativePercentage,
				pendingCount,
				resolvedCount,
			},
			trendData,
			topUsers,
			tagBreakdown,
		};
	}

	private mapRecordToDto(r: any): FeedbackItemDto {
		const tags = Array.isArray(r.tags) ? r.tags.map(String) : [];
		const fullConv = Array.isArray(r.fullConversation) ? r.fullConversation : [];

		return {
			id: r.id,
			userId: r.userId,
			userName: r.usuario?.nome || 'Usuário',
			userEmail: r.usuario?.email || '',
			userRole: r.usuario?.tipo_acesso || 'GERENTE',
			conversationId: r.conversationId ?? null,
			messageId: r.messageId ?? null,
			rating: r.rating === 'NEGATIVE' ? 'NEGATIVE' : 'POSITIVE',
			tags,
			comment: r.comment ?? null,
			userPrompt: r.userPrompt,
			assistantResponse: r.assistantResponse,
			contextSummary:
				r.contextSummary ||
				this.buildContextSummary(r.userPrompt, r.assistantResponse, r.generatedSql),
			generatedSql: r.generatedSql ?? null,
			fullConversation: fullConv,
			status: r.status === 'RESOLVED' ? 'RESOLVED' : 'PENDING',
			resolvedAt: r.resolvedAt ? new Date(r.resolvedAt) : null,
			resolvedBy: r.resolvedBy ?? null,
			createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
			updatedAt: r.updatedAt instanceof Date ? r.updatedAt : new Date(r.updatedAt),
		};
	}
}

export const chatFeedbackService = new ChatFeedbackService();
export default chatFeedbackService;
