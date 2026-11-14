import { PrismaClient } from '@prisma/client';
import prismaClient from '../config/prisma';
import GeminiService, { GeminiMessage } from './gemini.service';

export const MAX_CONVERSATIONS_PER_USER = 10;
export const MAX_PINNED_CONVERSATIONS = 2;
export const COMPACTION_MESSAGE_THRESHOLD = 16; // 8 perguntas + 8 respostas
export const COMPACTION_CHAR_THRESHOLD = 12000; // ~3.000 tokens
export const RECENT_INTACT_MESSAGES_COUNT = 6; // Mantém os últimos 3 turnos 100% intactos
export const MAX_MEMORIES_PER_USER = 25;

export type MemoryCategory =
	| 'PREFERENCIA_COMUNICACAO'
	| 'PREFERENCIA_ANALISE'
	| 'CONTEXTO_CARGO_FOCO'
	| 'PREFERENCIA_GERAL';

export interface ExtractedMemoryCandidate {
	category: MemoryCategory;
	fact: string;
}

export interface ConversationSummaryDto {
	id: string;
	userId: string;
	title: string;
	summary: string | null;
	isPinned: boolean;
	messageCount: number;
	hasCompactedContext: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface ConversationMessageDto {
	id: string;
	conversationId: string;
	role: 'user' | 'assistant';
	content: string;
	isCompacted: boolean;
	createdAt: Date;
}

export interface ConversationDetailDto extends ConversationSummaryDto {
	messages: ConversationMessageDto[];
}

export interface UserMemoryDto {
	id: string;
	userId: string;
	category: MemoryCategory;
	fact: string;
	source: 'AUTO' | 'MANUAL';
	createdAt: Date;
	updatedAt: Date;
}

export class ChatHistoryMemoryService {
	private readonly prisma: PrismaClient;
	private readonly gemini: GeminiService;
	private schemaInitialized = false;

	constructor(prisma: PrismaClient = prismaClient, gemini?: GeminiService) {
		this.prisma = prisma;
		this.gemini = gemini ?? new GeminiService();
	}

	/**
	 * Garante de forma idempotente que as tabelas de histórico de conversas e memória do usuário
	 * existam no PostgreSQL sem tocar nas tabelas dinâmicas `erp_*`.
	 */
	public async ensureSchemaInitialized(): Promise<void> {
		if (this.schemaInitialized) {
			return;
		}

		// Em testes unitários com mock de Prisma sem $executeRawUnsafe real, apenas marca como inicializado
		if (
			typeof this.prisma.$executeRawUnsafe !== 'function' ||
			!(this.prisma as any).chatConversation
		) {
			this.schemaInitialized = true;
			return;
		}

		try {
			await this.prisma.$executeRawUnsafe(`
				CREATE TABLE IF NOT EXISTS "chat_conversations" (
					"id" TEXT NOT NULL,
					"user_id" TEXT NOT NULL,
					"title" TEXT NOT NULL DEFAULT 'Nova Conversa',
					"summary" TEXT,
					"compacted_up_to_id" TEXT,
					"is_pinned" BOOLEAN NOT NULL DEFAULT false,
					"message_count" INTEGER NOT NULL DEFAULT 0,
					"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id"),
					CONSTRAINT "chat_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE
				);
			`);

			await this.prisma.$executeRawUnsafe(`
				CREATE INDEX IF NOT EXISTS "chat_conversations_user_id_updated_at_idx"
				ON "chat_conversations"("user_id", "updated_at");
			`);

			await this.prisma.$executeRawUnsafe(`
				CREATE TABLE IF NOT EXISTS "chat_messages" (
					"id" TEXT NOT NULL,
					"conversation_id" TEXT NOT NULL,
					"role" TEXT NOT NULL,
					"content" TEXT NOT NULL,
					"is_compacted" BOOLEAN NOT NULL DEFAULT false,
					"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id"),
					CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
				);
			`);

			await this.prisma.$executeRawUnsafe(`
				CREATE INDEX IF NOT EXISTS "chat_messages_conversation_id_created_at_idx"
				ON "chat_messages"("conversation_id", "created_at");
			`);

			await this.prisma.$executeRawUnsafe(`
				CREATE TABLE IF NOT EXISTS "user_memories" (
					"id" TEXT NOT NULL,
					"user_id" TEXT NOT NULL,
					"category" TEXT NOT NULL DEFAULT 'PREFERENCIA_GERAL',
					"fact" TEXT NOT NULL,
					"source" TEXT NOT NULL DEFAULT 'AUTO',
					"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					CONSTRAINT "user_memories_pkey" PRIMARY KEY ("id"),
					CONSTRAINT "user_memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE
				);
			`);

			await this.prisma.$executeRawUnsafe(`
				CREATE INDEX IF NOT EXISTS "user_memories_user_id_idx"
				ON "user_memories"("user_id");
			`);

			this.schemaInitialized = true;
		} catch (err) {
			console.warn('[ChatHistoryMemoryService] Aviso ao inicializar tabelas de histórico/memória:', err);
		}
	}

	/* ============================================================================
	 * 1. GESTÃO DE MÚLTIPLAS CONVERSAS POR USUÁRIO + FILA FIFO (MÁX 10)
	 * ============================================================================ */

	public async listUserConversations(userId: string): Promise<{
		conversations: ConversationSummaryDto[];
		maxLimit: number;
		totalCount: number;
	}> {
		await this.ensureSchemaInitialized();

		const records = await this.prisma.chatConversation.findMany({
			where: { userId },
			orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
		});

		const conversations: ConversationSummaryDto[] = records.map((c) => ({
			id: c.id,
			userId: c.userId,
			title: c.title,
			summary: c.summary,
			isPinned: c.isPinned,
			messageCount: c.messageCount,
			hasCompactedContext: Boolean(c.summary && c.summary.trim().length > 0),
			createdAt: c.createdAt,
			updatedAt: c.updatedAt,
		}));

		return {
			conversations,
			maxLimit: MAX_CONVERSATIONS_PER_USER,
			totalCount: conversations.length,
		};
	}

	public async getConversationWithMessages(
		userId: string,
		conversationId: string,
	): Promise<ConversationDetailDto> {
		await this.ensureSchemaInitialized();

		const conv = await this.prisma.chatConversation.findUnique({
			where: { id: conversationId },
			include: {
				messages: {
					orderBy: { createdAt: 'asc' },
				},
			},
		});

		if (!conv) {
			throw new Error('Conversa não encontrada.');
		}

		if (conv.userId !== userId) {
			throw new Error('Acesso negado: esta conversa pertence a outro usuário.');
		}

		return {
			id: conv.id,
			userId: conv.userId,
			title: conv.title,
			summary: conv.summary,
			isPinned: conv.isPinned,
			messageCount: conv.messageCount,
			hasCompactedContext: Boolean(conv.summary && conv.summary.trim().length > 0),
			createdAt: conv.createdAt,
			updatedAt: conv.updatedAt,
			messages: conv.messages.map((m) => ({
				id: m.id,
				conversationId: m.conversationId,
				role: m.role === 'assistant' ? 'assistant' : 'user',
				content: m.content,
				isCompacted: m.isCompacted,
				createdAt: m.createdAt,
			})),
		};
	}

	/**
	 * Cria uma nova conversa para o usuário aplicando a regra de fila FIFO:
	 * Quando o usuário já possui 10 conversas, a conversa mais antiga (não fixada) é removida
	 * automaticamente antes da criação da nova.
	 */
	public async createConversation(
		userId: string,
		initialTitle?: string,
	): Promise<{
		conversation: ConversationSummaryDto;
		evictedConversationIds: string[];
	}> {
		await this.ensureSchemaInitialized();

		const existing = await this.prisma.chatConversation.findMany({
			where: { userId },
			orderBy: [
				{ isPinned: 'asc' }, // Não fixadas vêm primeiro na fila de descarte
				{ updatedAt: 'asc' }, // Mais antigas por última interação saem primeiro (FIFO/LRU)
				{ createdAt: 'asc' },
			],
		});

		const evictedConversationIds: string[] = [];

		if (existing.length >= MAX_CONVERSATIONS_PER_USER) {
			const excessCount = existing.length - MAX_CONVERSATIONS_PER_USER + 1;
			const toEvict = existing.slice(0, excessCount);
			for (const oldConv of toEvict) {
				await this.prisma.chatConversation.delete({
					where: { id: oldConv.id },
				});
				evictedConversationIds.push(oldConv.id);
			}
		}

		const cleanTitle = initialTitle?.trim()
			? this.generateSmartTitle(initialTitle)
			: 'Nova Conversa';

		const created = await this.prisma.chatConversation.create({
			data: {
				userId,
				title: cleanTitle,
			},
		});

		return {
			conversation: {
				id: created.id,
				userId: created.userId,
				title: created.title,
				summary: created.summary,
				isPinned: created.isPinned,
				messageCount: created.messageCount,
				hasCompactedContext: false,
				createdAt: created.createdAt,
				updatedAt: created.updatedAt,
			},
			evictedConversationIds,
		};
	}

	public async renameConversation(
		userId: string,
		conversationId: string,
		newTitle: string,
	): Promise<ConversationSummaryDto> {
		await this.ensureSchemaInitialized();

		const cleanTitle = newTitle?.trim();
		if (!cleanTitle) {
			throw new Error('O título da conversa não pode ser vazio.');
		}

		const conv = await this.prisma.chatConversation.findUnique({
			where: { id: conversationId },
		});

		if (!conv) {
			throw new Error('Conversa não encontrada.');
		}
		if (conv.userId !== userId) {
			throw new Error('Acesso negado: esta conversa pertence a outro usuário.');
		}

		const updated = await this.prisma.chatConversation.update({
			where: { id: conversationId },
			data: { title: cleanTitle.slice(0, 80) },
		});

		return {
			id: updated.id,
			userId: updated.userId,
			title: updated.title,
			summary: updated.summary,
			isPinned: updated.isPinned,
			messageCount: updated.messageCount,
			hasCompactedContext: Boolean(updated.summary && updated.summary.trim().length > 0),
			createdAt: updated.createdAt,
			updatedAt: updated.updatedAt,
		};
	}

	public async togglePinConversation(
		userId: string,
		conversationId: string,
		isPinned: boolean,
	): Promise<ConversationSummaryDto> {
		await this.ensureSchemaInitialized();

		const conv = await this.prisma.chatConversation.findUnique({
			where: { id: conversationId },
		});

		if (!conv) {
			throw new Error('Conversa não encontrada.');
		}
		if (conv.userId !== userId) {
			throw new Error('Acesso negado: esta conversa pertence a outro usuário.');
		}

		if (isPinned && !conv.isPinned) {
			const pinnedCount = await this.prisma.chatConversation.count({
				where: { userId, isPinned: true },
			});
			if (pinnedCount >= MAX_PINNED_CONVERSATIONS) {
				throw new Error(
					`Você pode fixar no máximo ${MAX_PINNED_CONVERSATIONS} conversas simultaneamente.`,
				);
			}
		}

		const updated = await this.prisma.chatConversation.update({
			where: { id: conversationId },
			data: { isPinned },
		});

		return {
			id: updated.id,
			userId: updated.userId,
			title: updated.title,
			summary: updated.summary,
			isPinned: updated.isPinned,
			messageCount: updated.messageCount,
			hasCompactedContext: Boolean(updated.summary && updated.summary.trim().length > 0),
			createdAt: updated.createdAt,
			updatedAt: updated.updatedAt,
		};
	}

	public async deleteConversation(userId: string, conversationId: string): Promise<void> {
		await this.ensureSchemaInitialized();

		const conv = await this.prisma.chatConversation.findUnique({
			where: { id: conversationId },
		});

		if (!conv) {
			throw new Error('Conversa não encontrada.');
		}
		if (conv.userId !== userId) {
			throw new Error('Acesso negado: esta conversa pertence a outro usuário.');
		}

		await this.prisma.chatConversation.delete({
			where: { id: conversationId },
		});
	}

	/**
	 * Gera um título executivo conciso a partir da primeira pergunta do usuário.
	 */
	public generateSmartTitle(firstQuestion: string): string {
		const cleaned = firstQuestion
			.replace(/[\r\n]+/g, ' ')
			.replace(/^(oi|ol[áa]|bom dia|boa tarde|boa noite|gideon|por favor|me mostre|mostre|qual [ée]|quais s[ãa]o|gere um|traga o)[,\s]*/i, '')
			.trim();

		if (!cleaned) {
			return 'Nova Conversa';
		}

		const capitalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
		if (capitalized.length <= 48) {
			return capitalized.replace(/[?.!]+$/, '');
		}

		return `${capitalized.slice(0, 45).trim()}...`;
	}

	/* ============================================================================
	 * 2. COMPACTAÇÃO DE CONVERSAS LONGAS (SLIDING WINDOW + ROLLING SUMMARY)
	 * ============================================================================ */

	/**
	 * Registra um turno completo (pergunta do usuário + resposta da Gideon) na conversa
	 * e executa a compactação automática se atingir o limite de 16 mensagens ou 12.000 caracteres.
	 */
	public async appendExchangeAndCompactIfNeeded(params: {
		userId: string;
		conversationId: string;
		userMessage: string;
		assistantMessage: string;
	}): Promise<{
		wasCompacted: boolean;
		summary: string | null;
		title: string;
	}> {
		await this.ensureSchemaInitialized();

		const { userId, conversationId, userMessage, assistantMessage } = params;

		const conv = await this.prisma.chatConversation.findUnique({
			where: { id: conversationId },
		});

		if (!conv || conv.userId !== userId) {
			throw new Error('Conversa inválida ou acesso negado.');
		}

		// Se ainda estiver com o título padrão "Nova Conversa", gera o título inteligente pela 1ª pergunta
		const shouldUpdateTitle =
			conv.title === 'Nova Conversa' || conv.messageCount === 0;
		const nextTitle = shouldUpdateTitle
			? this.generateSmartTitle(userMessage)
			: conv.title;

		await this.prisma.chatMessage.create({
			data: {
				conversationId,
				role: 'user',
				content: userMessage,
				isCompacted: false,
			},
		});

		await this.prisma.chatMessage.create({
			data: {
				conversationId,
				role: 'assistant',
				content: assistantMessage,
				isCompacted: false,
			},
		});

		const allMessages = await this.prisma.chatMessage.findMany({
			where: { conversationId },
			orderBy: { createdAt: 'asc' },
		});

		const uncompacted = allMessages.filter((m) => !m.isCompacted);
		const uncompactedChars = uncompacted.reduce((acc, m) => acc + m.content.length, 0);

		const needsCompaction =
			uncompacted.length >= COMPACTION_MESSAGE_THRESHOLD ||
			(uncompacted.length > RECENT_INTACT_MESSAGES_COUNT &&
				uncompactedChars >= COMPACTION_CHAR_THRESHOLD);

		let updatedSummary = conv.summary;
		let compactedUpToId = conv.compactedUpToId;
		let wasCompacted = false;

		if (needsCompaction && uncompacted.length > RECENT_INTACT_MESSAGES_COUNT) {
			const toCompact = uncompacted.slice(0, uncompacted.length - RECENT_INTACT_MESSAGES_COUNT);
			updatedSummary = await this.summarizeMessagesSegment(conv.summary, toCompact);
			compactedUpToId = toCompact[toCompact.length - 1]?.id ?? conv.compactedUpToId;
			wasCompacted = true;

			const idsToMark = toCompact.map((m) => m.id);
			await this.prisma.chatMessage.updateMany({
				where: { id: { in: idsToMark } },
				data: { isCompacted: true },
			});
		}

		await this.prisma.chatConversation.update({
			where: { id: conversationId },
			data: {
				title: nextTitle,
				summary: updatedSummary,
				compactedUpToId,
				messageCount: allMessages.length,
				updatedAt: new Date(),
			},
		});

		return {
			wasCompacted,
			summary: updatedSummary,
			title: nextTitle,
		};
	}

	/**
	 * Constrói o histórico otimizado para enviar ao LLM:
	 * Combina `[Resumo Compactado do Contexto Anterior]` + `[Últimas Mensagens Intactas]`.
	 */
	public async buildOptimizedHistoryForLlm(
		userId: string,
		conversationId: string,
		currentUserQuestion: string,
	): Promise<GeminiMessage[]> {
		await this.ensureSchemaInitialized();

		const conv = await this.prisma.chatConversation.findUnique({
			where: { id: conversationId },
			include: {
				messages: {
					where: { isCompacted: false },
					orderBy: { createdAt: 'asc' },
				},
			},
		});

		if (!conv || conv.userId !== userId) {
			return [{ role: 'user', parts: [{ text: currentUserQuestion }] }];
		}

		const history: GeminiMessage[] = [];

		if (conv.summary && conv.summary.trim()) {
			history.push({
				role: 'user',
				parts: [
					{
						text: `[CONTEXTO COMPACTADO DAS MENSAGENS ANTERIORES DESTA CONVERSA]:\n${conv.summary.trim()}`,
					},
				],
			});
			history.push({
				role: 'model',
				parts: [
					{
						text: 'Compreendido. Mantive todos os fatos, filtros, clientes, períodos e números do resumo anterior em memória para dar continuidade à nossa conversa.',
					},
				],
			});
		}

		for (const msg of conv.messages) {
			history.push({
				role: msg.role === 'assistant' ? 'model' : 'user',
				parts: [{ text: msg.content }],
			});
		}

		// Garante que a pergunta atual esteja no final do histórico
		const lastMsg = history[history.length - 1];
		const lastText = lastMsg?.parts?.[0]?.text?.trim() ?? '';
		if (!lastMsg || lastMsg.role !== 'user' || lastText !== currentUserQuestion.trim()) {
			history.push({
				role: 'user',
				parts: [{ text: currentUserQuestion }],
			});
		}

		return history;
	}

	/**
	 * Gera um resumo executivo estruturado das mensagens antigas que estão saindo da janela deslizante,
	 * preservando entidades (clientes, vendedores, produtos, datas) e números-chave.
	 */
	public async summarizeMessagesSegment(
		previousSummary: string | null,
		messagesToCompact: Array<{ role: string; content: string }>,
	): Promise<string> {
		const formattedDialogue = messagesToCompact
			.map((m) => {
				const speaker = m.role === 'assistant' ? 'Gideon' : 'Usuário';
				// Substitui blocos JSON de gráficos apenas pelo título e tamanho para economizar tokens
				const cleanContent = m.content.replace(/```dashboard\s*([\s\S]*?)\s*```/gi, (_f, jsonStr: string) => {
					try {
						const parsed = JSON.parse(jsonStr);
						return `[Visualização Gerada: "${parsed.title || parsed.type}" com ${Array.isArray(parsed.data) ? parsed.data.length : 0} itens]`;
					} catch {
						return '[Visualização de Dados Exibida]';
					}
				});
				return `${speaker}: ${cleanContent.slice(0, 600)}`;
			})
			.join('\n');

		const deterministicSummary = this.buildDeterministicRollingSummary(
			previousSummary,
			messagesToCompact,
		);

		try {
			const systemInstruction =
				'Você é um especialista em compactação de contexto de conversas executivas de BI (Conversation Summarizer). Consolide o resumo anterior (se houver) e as novas mensagens em um resumo conciso em português (máximo de 180 palavras), preservando OBRIGATORIAMENTE: nomes/códigos de clientes, vendedores, produtos, períodos/datas analisados e valores financeiros apurados. Retorne apenas o resumo consolidado.';

			const prompt = `${previousSummary ? `Resumo Anterior:\n${previousSummary}\n\n` : ''}Novas mensagens para compactar:\n${formattedDialogue}\n\nResumo Executivo Consolidado:`;

			if (typeof this.gemini.generateText === 'function') {
				const llmSummary = await this.gemini.generateText(
					[{ role: 'user', parts: [{ text: prompt }] }],
					systemInstruction,
					{ temperature: 0.0, topP: 0.8 },
				);
				if (llmSummary && llmSummary.trim().length >= 20) {
					return llmSummary.trim().slice(0, 1800);
				}
			}
		} catch (err) {
			console.warn('[ChatHistoryMemoryService] Usando compactador determinístico de conversa:', err);
		}

		return deterministicSummary;
	}

	public buildDeterministicRollingSummary(
		previousSummary: string | null,
		messagesToCompact: Array<{ role: string; content: string }>,
	): string {
		const bullets: string[] = [];
		if (previousSummary && previousSummary.trim()) {
			bullets.push(previousSummary.trim());
		}

		for (let i = 0; i < messagesToCompact.length; i++) {
			const msg = messagesToCompact[i];
			const cleanText = msg.content
				.replace(/```dashboard\s*([\s\S]*?)\s*```/gi, (_f, jsonStr: string) => {
					try {
						const parsed = JSON.parse(jsonStr);
						return `[Gráfico/Tabela: ${parsed.title || parsed.type}]`;
					} catch {
						return '[Gráfico/Tabela]';
					}
				})
				.replace(/\s+/g, ' ')
				.trim();

			if (msg.role === 'user') {
				bullets.push(`- Pergunta: "${cleanText.slice(0, 160)}"`);
			} else {
				bullets.push(`   Síntese Gideon: ${cleanText.slice(0, 220)}`);
			}
		}

		const combined = bullets.join('\n');
		// Mantém o resumo enxuto (até 1.800 caracteres) priorizando os pontos mais recentes se ficar muito longo
		return combined.length > 1800 ? `...${combined.slice(-1790)}` : combined;
	}

	/* ============================================================================
	 * 3. MEMÓRIA INTERNA DE LONGO PRAZO POR USUÁRIO (USER PERSONAL MEMORY)
	 * ============================================================================ */

	public async listUserMemories(userId: string): Promise<UserMemoryDto[]> {
		await this.ensureSchemaInitialized();

		const items = await this.prisma.userMemory.findMany({
			where: { userId },
			orderBy: { updatedAt: 'desc' },
		});

		return items.map((m) => ({
			id: m.id,
			userId: m.userId,
			category: (m.category as MemoryCategory) || 'PREFERENCIA_GERAL',
			fact: m.fact,
			source: m.source === 'MANUAL' ? 'MANUAL' : 'AUTO',
			createdAt: m.createdAt,
			updatedAt: m.updatedAt,
		}));
	}

	public async addOrUpdateUserMemory(params: {
		userId: string;
		fact: string;
		category?: MemoryCategory;
		source?: 'AUTO' | 'MANUAL';
	}): Promise<UserMemoryDto> {
		await this.ensureSchemaInitialized();

		const cleanFact = params.fact?.trim();
		if (!cleanFact) {
			throw new Error('O conteúdo da memória não pode ser vazio.');
		}

		const category: MemoryCategory = params.category ?? 'PREFERENCIA_GERAL';
		const source = params.source ?? 'MANUAL';

		const existingMemories = await this.prisma.userMemory.findMany({
			where: { userId: params.userId },
			orderBy: { updatedAt: 'asc' },
		});

		// Verifica se já existe um fato equivalente ou da mesma sub-intenção (ex: forma de chamar)
		const normNew = cleanFact.toLowerCase();
		const duplicate = existingMemories.find((m) => {
			const normOld = m.fact.toLowerCase();
			if (normOld === normNew) return true;
			// Se ambos definem "como gosta de ser chamado", substitui o anterior
			if (
				normNew.includes('gosta de ser chamado de') &&
				normOld.includes('gosta de ser chamado de')
			) {
				return true;
			}
			return false;
		});

		if (duplicate) {
			const updated = await this.prisma.userMemory.update({
				where: { id: duplicate.id },
				data: {
					fact: cleanFact.slice(0, 300),
					category,
					source,
					updatedAt: new Date(),
				},
			});
			return {
				id: updated.id,
				userId: updated.userId,
				category: updated.category as MemoryCategory,
				fact: updated.fact,
				source: updated.source === 'MANUAL' ? 'MANUAL' : 'AUTO',
				createdAt: updated.createdAt,
				updatedAt: updated.updatedAt,
			};
		}

		// Mantém no máximo MAX_MEMORIES_PER_USER memórias por usuário (FIFO nas memórias mais antigas)
		if (existingMemories.length >= MAX_MEMORIES_PER_USER) {
			const oldest = existingMemories[0];
			if (oldest) {
				await this.prisma.userMemory.delete({ where: { id: oldest.id } });
			}
		}

		const created = await this.prisma.userMemory.create({
			data: {
				userId: params.userId,
				category,
				fact: cleanFact.slice(0, 300),
				source,
			},
		});

		return {
			id: created.id,
			userId: created.userId,
			category: created.category as MemoryCategory,
			fact: created.fact,
			source: created.source === 'MANUAL' ? 'MANUAL' : 'AUTO',
			createdAt: created.createdAt,
			updatedAt: created.updatedAt,
		};
	}

	public async deleteUserMemory(userId: string, memoryId: string): Promise<void> {
		await this.ensureSchemaInitialized();

		const mem = await this.prisma.userMemory.findUnique({
			where: { id: memoryId },
		});

		if (!mem) {
			throw new Error('Memória não encontrada.');
		}
		if (mem.userId !== userId) {
			throw new Error('Acesso negado: esta memória pertence a outro usuário.');
		}

		await this.prisma.userMemory.delete({
			where: { id: memoryId },
		});
	}

	/**
	 * Inspeciona automaticamente a mensagem do usuário em busca de fatos pessoais,
	 * como gosta de ser tratado, preferências de formato de resposta ou contexto de trabalho.
	 */
	public extractImplicitMemoriesFromText(userMessage: string): ExtractedMemoryCandidate[] {
		const text = userMessage?.trim() ?? '';
		if (!text || text.length < 5) {
			return [];
		}

		const candidates: ExtractedMemoryCandidate[] = [];

		// 1. Como o usuário gosta de ser chamado / tratado
		const callMeMatch = text.match(
			/\b(?:me\s+chame\s+(?:sempre\s+)?de|pode\s+me\s+chamar\s+de|prefiro\s+ser\s+chamado\s+de|prefiro\s+que\s+me\s+chame\s+de|meu\s+nome\s+[ée])\s+((?:(?:Sr|Sra|Dr|Dra|Prof|Eng|Seu|Dona)\.?\s+)?[A-Za-zÀ-ÿ0-9]+(?:\s+[A-Za-zÀ-ÿ0-9]+){0,3}?)(?=\s*(?:[.,;!?]|$|\s+(?:e|pois|porque|sou|prefiro|gosto|quero|sempre)\b))/i,
		);
		if (callMeMatch && callMeMatch[1]) {
			const preferredName = callMeMatch[1].trim();
			candidates.push({
				category: 'PREFERENCIA_COMUNICACAO',
				fact: `O usuário gosta de ser chamado de "${preferredName}".`,
			});
		}

		// 2. Preferências de estilo de resposta / comunicação
		const commStyleRegexes: Array<{ regex: RegExp; factBuilder: (m: RegExpMatchArray) => string }> = [
			{
				regex: /\b(prefiro|gosto\s+de|quero\s+sempre)\s+(respostas?\s+[^.!?\n]{3,80})/i,
				factBuilder: (m) => `Preferência de comunicação: ${m[0].trim()}.`,
			},
			{
				regex: /\b(seja\s+(?:sempre\s+)?mais\s+(?:diret[oa]|objetiv[oa]|resumid[oa]|detalhist[oa]|executiv[oa])[^.!?\n]{0,60})/i,
				factBuilder: (m) => `Preferência de tom: ${m[1].trim()}.`,
			},
			{
				regex: /\b(sempre\s+me\s+responda\s+[^.!?\n]{3,80})/i,
				factBuilder: (m) => `Instrução de resposta: ${m[1].trim()}.`,
			},
		];

		for (const rule of commStyleRegexes) {
			const match = text.match(rule.regex);
			if (match) {
				candidates.push({
					category: 'PREFERENCIA_COMUNICACAO',
					fact: rule.factBuilder(match),
				});
			}
		}

		// 3. Preferências analíticas e visuais (ex: "sempre que eu pedir...", "prefiro gráficos de...")
		const analysisMatch = text.match(
			/\b(sempre\s+que\s+eu\s+(?:pedir|perguntar)\s+[^.!?\n]{5,110}|prefiro\s+gr[áa]ficos?\s+[^.!?\n]{3,80}|n[ãa]o\s+gosto\s+de\s+gr[áa]ficos?\s+[^.!?\n]{3,80})/i,
		);
		if (analysisMatch && analysisMatch[1]) {
			candidates.push({
				category: 'PREFERENCIA_ANALISE',
				fact: `Preferência analítica do usuário: ${analysisMatch[1].trim()}.`,
			});
		}

		// 4. Contexto de cargo, regional, equipe ou carteira
		const roleMatch = text.match(
			/\b(sou\s+(?:o\s+|a\s+)?(?:gerente|supervisor|diretor|respons[áa]vel|vendedor|analista|coordenador)\s+[^.!?\n]{3,90}|cuido\s+da\s+(?:regi[ãa]o|carteira|equipe|filial)\s+[^.!?\n]{3,90}|meu\s+foco\s+[ée]\s+[^.!?\n]{3,90})/i,
		);
		if (roleMatch && roleMatch[1]) {
			candidates.push({
				category: 'CONTEXTO_CARGO_FOCO',
				fact: `Contexto profissional do usuário: ${roleMatch[1].trim()}.`,
			});
		}

		return candidates;
	}

	public async extractAndSaveImplicitUserMemories(
		userId: string,
		userMessage: string,
	): Promise<UserMemoryDto[]> {
		const candidates = this.extractImplicitMemoriesFromText(userMessage);
		if (candidates.length === 0) {
			return [];
		}

		const saved: UserMemoryDto[] = [];
		for (const candidate of candidates) {
			try {
				const item = await this.addOrUpdateUserMemory({
					userId,
					category: candidate.category,
					fact: candidate.fact,
					source: 'AUTO',
				});
				saved.push(item);
			} catch (err) {
				console.warn('[ChatHistoryMemoryService] Aviso ao salvar memória implícita:', err);
			}
		}

		return saved;
	}

	/**
	 * Constrói o bloco de contexto com o Perfil e a Memória Pessoal do Usuário logado
	 * para ser injetado no System Prompt da Gideon.
	 */
	public async buildUserMemoryPromptBlock(
		userId: string,
		userProfile?: { nome?: string; email?: string; role?: string },
	): Promise<string> {
		await this.ensureSchemaInitialized();

		let memories: UserMemoryDto[] = [];
		try {
			memories = await this.listUserMemories(userId);
		} catch {
			memories = [];
		}

		const lines: string[] = [
			'\n\n[MEMÓRIA PESSOAL E PERFIL DO USUÁRIO COM QUEM VOCÊ ESTÁ FALANDO]:',
		];

		if (userProfile?.nome) {
			lines.push(`- Nome cadastrado no sistema: ${userProfile.nome}`);
		}
		if (userProfile?.role) {
			lines.push(`- Perfil de acesso: ${userProfile.role}`);
		}

		if (memories.length > 0) {
			lines.push('- Fatos e preferências memorizados sobre este usuário (respeite sempre):');
			for (const mem of memories) {
				lines.push(`  * [${mem.category}]: ${mem.fact}`);
			}
		} else {
			lines.push(
				'- Caso o usuário informe como prefere ser chamado ou suas preferências de análise, adapte seu tratamento imediatamente.',
			);
		}

		return lines.join('\n');
	}
}

export const chatHistoryMemoryService = new ChatHistoryMemoryService();
export default chatHistoryMemoryService;
