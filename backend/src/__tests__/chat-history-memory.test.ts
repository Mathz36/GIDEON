import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
process.env.SANKHYA_SERVICE_URL = process.env.SANKHYA_SERVICE_URL || 'https://api.sankhya.test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import {
	ChatHistoryMemoryService,
	COMPACTION_MESSAGE_THRESHOLD,
	MAX_CONVERSATIONS_PER_USER,
	MAX_PINNED_CONVERSATIONS,
	RECENT_INTACT_MESSAGES_COUNT,
} from '../services/chat-history-memory.service';
import { ChatRagService } from '../services/chat-rag.service';

interface InMemoryConv {
	id: string;
	userId: string;
	title: string;
	summary: string | null;
	compactedUpToId: string | null;
	isPinned: boolean;
	messageCount: number;
	createdAt: Date;
	updatedAt: Date;
}

interface InMemoryMsg {
	id: string;
	conversationId: string;
	role: string;
	content: string;
	isCompacted: boolean;
	createdAt: Date;
}

interface InMemoryUserMemory {
	id: string;
	userId: string;
	category: string;
	fact: string;
	source: string;
	createdAt: Date;
	updatedAt: Date;
}

function createInMemoryPrismaMock() {
	const conversations: InMemoryConv[] = [];
	const messages: InMemoryMsg[] = [];
	const memories: InMemoryUserMemory[] = [];
	let idCounter = 1;
	let fakeClockMs = 1_700_000_000_000;

	const nextTimestamp = () => {
		fakeClockMs += 1000;
		return new Date(fakeClockMs);
	};

	const prismaMock = {
		chatConversation: {
			findMany: async ({ where, orderBy }: any) => {
				let list = conversations.filter((c) => !where?.userId || c.userId === where.userId);
				if (Array.isArray(orderBy)) {
					list = [...list].sort((a, b) => {
						for (const rule of orderBy) {
							if (rule.isPinned) {
								const pinA = a.isPinned ? 1 : 0;
								const pinB = b.isPinned ? 1 : 0;
								if (pinA !== pinB) {
									return rule.isPinned === 'asc' ? pinA - pinB : pinB - pinA;
								}
							}
							if (rule.updatedAt) {
								const diff = a.updatedAt.getTime() - b.updatedAt.getTime();
								if (diff !== 0) {
									return rule.updatedAt === 'asc' ? diff : -diff;
								}
							}
							if (rule.createdAt) {
								const diff = a.createdAt.getTime() - b.createdAt.getTime();
								if (diff !== 0) {
									return rule.createdAt === 'asc' ? diff : -diff;
								}
							}
						}
						return 0;
					});
				}
				return list;
			},
			findUnique: async ({ where, include }: any) => {
				const found = conversations.find((c) => c.id === where.id);
				if (!found) return null;
				if (include?.messages) {
					let convMsgs = messages.filter((m) => m.conversationId === found.id);
					if (typeof include.messages.where?.isCompacted === 'boolean') {
						convMsgs = convMsgs.filter(
							(m) => m.isCompacted === include.messages.where.isCompacted,
						);
					}
					convMsgs = [...convMsgs].sort(
						(a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
					);
					return { ...found, messages: convMsgs };
				}
				return { ...found };
			},
			create: async ({ data }: any) => {
				const ts = nextTimestamp();
				const item: InMemoryConv = {
					id: `conv-${idCounter++}`,
					userId: data.userId,
					title: data.title ?? 'Nova Conversa',
					summary: data.summary ?? null,
					compactedUpToId: data.compactedUpToId ?? null,
					isPinned: Boolean(data.isPinned),
					messageCount: data.messageCount ?? 0,
					createdAt: ts,
					updatedAt: ts,
				};
				conversations.push(item);
				return { ...item };
			},
			update: async ({ where, data }: any) => {
				const idx = conversations.findIndex((c) => c.id === where.id);
				if (idx === -1) throw new Error('Not found');
				const updated: InMemoryConv = {
					...conversations[idx],
					...data,
					updatedAt: data.updatedAt ?? nextTimestamp(),
				};
				conversations[idx] = updated;
				return { ...updated };
			},
			delete: async ({ where }: any) => {
				const idx = conversations.findIndex((c) => c.id === where.id);
				if (idx !== -1) {
					const removed = conversations.splice(idx, 1)[0];
					for (let i = messages.length - 1; i >= 0; i--) {
						if (messages[i].conversationId === removed.id) {
							messages.splice(i, 1);
						}
					}
				}
			},
			count: async ({ where }: any) => {
				return conversations.filter(
					(c) =>
						(!where?.userId || c.userId === where.userId) &&
						(typeof where?.isPinned !== 'boolean' || c.isPinned === where.isPinned),
				).length;
			},
		},
		chatMessage: {
			create: async ({ data }: any) => {
				const ts = nextTimestamp();
				const msg: InMemoryMsg = {
					id: `msg-${idCounter++}`,
					conversationId: data.conversationId,
					role: data.role,
					content: data.content,
					isCompacted: Boolean(data.isCompacted),
					createdAt: ts,
				};
				messages.push(msg);
				return { ...msg };
			},
			findMany: async ({ where }: any) => {
				return messages
					.filter((m) => !where?.conversationId || m.conversationId === where.conversationId)
					.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
			},
			updateMany: async ({ where, data }: any) => {
				const targetIds = new Set<string>(where?.id?.in ?? []);
				let count = 0;
				for (const msg of messages) {
					if (targetIds.has(msg.id)) {
						if (typeof data.isCompacted === 'boolean') {
							msg.isCompacted = data.isCompacted;
						}
						count++;
					}
				}
				return { count };
			},
		},
		userMemory: {
			findMany: async ({ where, orderBy }: any) => {
				const list = memories.filter((m) => !where?.userId || m.userId === where.userId);
				if (orderBy?.updatedAt === 'asc') {
					return [...list].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
				}
				return [...list].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
			},
			findUnique: async ({ where }: any) => {
				return memories.find((m) => m.id === where.id) ?? null;
			},
			create: async ({ data }: any) => {
				const ts = nextTimestamp();
				const item: InMemoryUserMemory = {
					id: `mem-${idCounter++}`,
					userId: data.userId,
					category: data.category ?? 'PREFERENCIA_GERAL',
					fact: data.fact,
					source: data.source ?? 'MANUAL',
					createdAt: ts,
					updatedAt: ts,
				};
				memories.push(item);
				return { ...item };
			},
			update: async ({ where, data }: any) => {
				const idx = memories.findIndex((m) => m.id === where.id);
				if (idx === -1) throw new Error('Memory not found');
				memories[idx] = {
					...memories[idx],
					...data,
					updatedAt: data.updatedAt ?? nextTimestamp(),
				};
				return { ...memories[idx] };
			},
			delete: async ({ where }: any) => {
				const idx = memories.findIndex((m) => m.id === where.id);
				if (idx !== -1) {
					memories.splice(idx, 1);
				}
			},
		},
	};

	const geminiStub = {
		generateText: async () =>
			'Resumo Consolidado: Cliente ABC Comércio analisado em Outubro/2026 com faturamento líquido de R$ 145.000,00.',
	};

	return {
		service: new ChatHistoryMemoryService(prismaMock as any, geminiStub as any),
		conversations,
		messages,
		memories,
	};
}

describe('Multi-Conversas FIFO (Máx 10), Compactação Automática e Memória Pessoal da Gideon', () => {
	describe('1. Fila FIFO de Até 10 Conversas por Usuário + Proteção de Fixadas (Pin)', () => {
		it('deve permitir até 10 conversas por usuário e remover a mais antiga (FIFO) ao criar a 11ª conversa', async () => {
			const { service } = createInMemoryPrismaMock();
			const userId = 'user-matheus';

			const createdIds: string[] = [];
			for (let i = 1; i <= MAX_CONVERSATIONS_PER_USER; i++) {
				const res = await service.createConversation(userId, `Pergunta comercial número ${i}`);
				assert.equal(res.evictedConversationIds.length, 0);
				createdIds.push(res.conversation.id);
			}

			const listBefore = await service.listUserConversations(userId);
			assert.equal(listBefore.totalCount, 10);

			// Cria a 11ª conversa -> deve remover a 1ª (conv-1) automaticamente (FIFO)
			const eleventh = await service.createConversation(userId, 'Décima primeira conversa sobre faturamento');
			assert.deepEqual(eleventh.evictedConversationIds, [createdIds[0]]);

			const listAfter = await service.listUserConversations(userId);
			assert.equal(listAfter.totalCount, 10);
			assert.equal(
				listAfter.conversations.some((c) => c.id === createdIds[0]),
				false,
				'A conversa mais antiga (conv-1) deve ter sido removida pela fila FIFO',
			);
			assert.equal(
				listAfter.conversations.some((c) => c.id === eleventh.conversation.id),
				true,
				'A 11ª conversa deve estar presente na lista',
			);
		});

		it('deve proteger conversas fixadas (isPinned = true, até 2) contra a substituição FIFO', async () => {
			const { service } = createInMemoryPrismaMock();
			const userId = 'user-matheus';

			const createdIds: string[] = [];
			for (let i = 1; i <= MAX_CONVERSATIONS_PER_USER; i++) {
				const res = await service.createConversation(userId, `Conversa ${i}`);
				createdIds.push(res.conversation.id);
			}

			// Fixa a conversa 1 (mais antiga) e a conversa 2
			await service.togglePinConversation(userId, createdIds[0], true);
			await service.togglePinConversation(userId, createdIds[1], true);

			// Tentar fixar uma 3ª conversa deve lançar erro de limite (máximo 2 fixadas)
			await assert.rejects(
				async () => {
					await service.togglePinConversation(userId, createdIds[2], true);
				},
				new RegExp(`fixar no máximo ${MAX_PINNED_CONVERSATIONS}`),
			);

			// Ao criar a 11ª conversa, como conv-1 e conv-2 estão fixadas, a conv-3 (mais antiga não fixada) deve sair!
			const eleventh = await service.createConversation(userId, 'Conversa 11');
			assert.deepEqual(eleventh.evictedConversationIds, [createdIds[2]]);

			const listAfter = await service.listUserConversations(userId);
			assert.equal(listAfter.totalCount, 10);
			assert.equal(listAfter.conversations.some((c) => c.id === createdIds[0]), true);
			assert.equal(listAfter.conversations.some((c) => c.id === createdIds[1]), true);
			assert.equal(listAfter.conversations.some((c) => c.id === createdIds[2]), false);
		});

		it('deve garantir isolamento estrito por usuário (RBAC): Usuário A não acessa nem afeta conversas do Usuário B', async () => {
			const { service } = createInMemoryPrismaMock();

			const convA = await service.createConversation('user-a', 'Vendas da carteira A');
			const convB = await service.createConversation('user-b', 'Vendas da carteira B');

			const listA = await service.listUserConversations('user-a');
			assert.equal(listA.totalCount, 1);
			assert.equal(listA.conversations[0].id, convA.conversation.id);

			await assert.rejects(
				async () => {
					await service.getConversationWithMessages('user-a', convB.conversation.id);
				},
				/Acesso negado/,
			);

			await assert.rejects(
				async () => {
					await service.deleteConversation('user-a', convB.conversation.id);
				},
				/Acesso negado/,
			);
		});
	});

	describe('2. Compactação Automática de Conversas Longas (Sliding Window + Rolling Summary)', () => {
		it('deve compactar automaticamente ao atingir 16 mensagens, resumindo as 10 mais antigas e mantendo as últimas 6 intactas', async () => {
			const { service } = createInMemoryPrismaMock();
			const userId = 'user-matheus';
			const { conversation } = await service.createConversation(userId);

			// Envia 7 turnos (14 mensagens) -> ainda abaixo do limite de 16 mensagens
			for (let turn = 1; turn <= 7; turn++) {
				const res = await service.appendExchangeAndCompactIfNeeded({
					userId,
					conversationId: conversation.id,
					userMessage: `Qual o faturamento líquido do turno ${turn}?`,
					assistantMessage: `O faturamento líquido apurado no turno ${turn} foi de R$ ${turn * 10000},00.`,
				});
				assert.equal(res.wasCompacted, false);
			}

			// O 8º turno (total = 16 mensagens = COMPACTION_MESSAGE_THRESHOLD) dispara a compactação!
			const eighthTurn = await service.appendExchangeAndCompactIfNeeded({
				userId,
				conversationId: conversation.id,
				userMessage: 'E qual o acumulado do cliente ABC Comércio?',
				assistantMessage: 'O acumulado líquido do cliente ABC Comércio é R$ 145.000,00.',
			});

			assert.equal(eighthTurn.wasCompacted, true);
			assert.ok(eighthTurn.summary && eighthTurn.summary.includes('ABC Comércio'));

			// Verifica como ficaram as mensagens no banco (10 compactadas + 6 intactas)
			const detail = await service.getConversationWithMessages(userId, conversation.id);
			assert.equal(detail.messages.length, COMPACTION_MESSAGE_THRESHOLD);

			const compactedMsgs = detail.messages.filter((m) => m.isCompacted);
			const intactMsgs = detail.messages.filter((m) => !m.isCompacted);

			assert.equal(
				compactedMsgs.length,
				COMPACTION_MESSAGE_THRESHOLD - RECENT_INTACT_MESSAGES_COUNT,
			);
			assert.equal(intactMsgs.length, RECENT_INTACT_MESSAGES_COUNT);

			// Verifica o payload enviado ao LLM: [Resumo Compactado + Confirmação] + [6 mensagens recentes intactas] + [Nova pergunta]
			const llmHistory = await service.buildOptimizedHistoryForLlm(
				userId,
				conversation.id,
				'Mostre isso em gráfico de barras',
			);

			assert.ok(
				llmHistory[0].parts[0].text.includes('[CONTEXTO COMPACTADO DAS MENSAGENS ANTERIORES DESTA CONVERSA]'),
			);
			// 2 mensagens do par de resumo + 6 mensagens intactas + 1 nova pergunta = 9 mensagens totais para o LLM (em vez de 17!)
			assert.equal(llmHistory.length, 2 + RECENT_INTACT_MESSAGES_COUNT + 1);
		});
	});

	describe('3. Memória Pessoal de Longo Prazo por Usuário (Gideon Personal Memory)', () => {
		it('deve extrair automaticamente preferências de tratamento, estilo de resposta, análise e cargo a partir do chat', async () => {
			const { service } = createInMemoryPrismaMock();
			const userId = 'user-matheus';

			const saved = await service.extractAndSaveImplicitUserMemories(
				userId,
				'Oi Gideon, pode me chamar de Matheus. Sou gerente comercial da filial Sul e prefiro respostas curtas e diretas em tabela. Sempre que eu pedir vendas mostre por representante.',
			);

			assert.ok(saved.length >= 3);
			const memories = await service.listUserMemories(userId);

			assert.ok(
				memories.some((m) => m.fact.includes('Matheus')),
				'Deve memorizar como o usuário gosta de ser chamado',
			);
			assert.ok(
				memories.some((m) => m.category === 'CONTEXTO_CARGO_FOCO' && m.fact.includes('gerente comercial')),
				'Deve memorizar o cargo e foco do usuário',
			);
			assert.ok(
				memories.some((m) => m.category === 'PREFERENCIA_ANALISE' && m.fact.includes('representante')),
				'Deve memorizar a preferência analítica do usuário',
			);

			// Se o usuário mudar como gosta de ser chamado, deve atualizar em vez de duplicar
			await service.extractAndSaveImplicitUserMemories(
				userId,
				'A partir de agora me chame de Sr. Matheus Henrique.',
			);

			const updatedMemories = await service.listUserMemories(userId);
			const callMeFacts = updatedMemories.filter((m) =>
				m.fact.toLowerCase().includes('gosta de ser chamado de'),
			);
			assert.equal(callMeFacts.length, 1, 'Deve substituir a forma de tratamento anterior sem duplicar');
			assert.ok(callMeFacts[0].fact.includes('Sr. Matheus Henrique'));

			// Verifica o bloco injetado no System Prompt da Gideon
			const promptBlock = await service.buildUserMemoryPromptBlock(userId, {
				nome: 'Matheus H.',
				role: 'ADMIN',
			});
			assert.ok(promptBlock.includes('[MEMÓRIA PESSOAL E PERFIL DO USUÁRIO COM QUEM VOCÊ ESTÁ FALANDO]'));
			assert.ok(promptBlock.includes('Sr. Matheus Henrique'));
		});
	});

	describe('4. Blindagem de Segurança Text-to-SQL nas Tabelas Privadas de Conversas e Memória', () => {
		it('deve bloquear qualquer tentativa da IA de consultar chat_conversations, chat_messages ou user_memories via SQL', () => {
			const ragService = new ChatRagService();
			assert.equal(
				ragService.isReadOnlyQuery(
					'SELECT * FROM chat_conversations LIMIT 10',
					['erp_nota_fiscal', 'chat_conversations'],
				),
				false,
				'Deve bloquear acesso à tabela chat_conversations',
			);
			assert.equal(
				ragService.isReadOnlyQuery(
					'SELECT content FROM chat_messages LIMIT 10',
					['erp_nota_fiscal', 'chat_messages'],
				),
				false,
				'Deve bloquear acesso à tabela chat_messages',
			);
			assert.equal(
				ragService.isReadOnlyQuery(
					'SELECT fact FROM user_memories LIMIT 10',
					['erp_nota_fiscal', 'user_memories'],
				),
				false,
				'Deve bloquear acesso à tabela user_memories',
			);
		});
	});
});
