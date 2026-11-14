import { useCallback, useEffect, useRef, useState } from 'react';
import { syncSavedWidgetToLocalDashboardCache } from '../components/chat/DynamicDashboard';

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	isCompacted?: boolean;
	createdAt?: string;
}

export interface ChatStatusStep {
	step: number;
	title: string;
	subtitle: string;
}

export interface ConversationSummary {
	id: string;
	title: string;
	summary: string | null;
	isPinned: boolean;
	messageCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface UserMemoryItem {
	id: string;
	category: 'PREFERENCIA_COMUNICACAO' | 'PREFERENCIA_ANALISE' | 'CONTEXTO_CARGO_FOCO' | 'PREFERENCIA_GERAL' | string;
	fact: string;
	source: 'AUTO' | 'MANUAL' | 'implicit' | 'explicit';
	updatedAt: string;
}

interface GeminiStreamPayload {
	text?: unknown;
	message?: unknown;
	step?: unknown;
	title?: unknown;
	subtitle?: unknown;
	conversationId?: unknown;
	wasCompacted?: unknown;
	evictedConversationIds?: unknown;
	newMemoriesSavedCount?: unknown;
	widget?: unknown;
}

const createId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

function getAuthHeaders(): Record<string, string> {
	const token = localStorage.getItem('gideon.auth.token');
	return {
		'Content-Type': 'application/json',
		...(token ? { Authorization: `Bearer ${token}` } : {}),
	};
}

export function useChat() {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [statusStep, setStatusStep] = useState<ChatStatusStep | null>(null);
	const [error, setError] = useState('');

	// Multi-Conversation FIFO state
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [maxConversations, setMaxConversations] = useState<number>(10);
	const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
	const [activeConversationSummary, setActiveConversationSummary] = useState<string | null>(null);
	const [isLoadingConversations, setIsLoadingConversations] = useState(false);
	const [compactionBanner, setCompactionBanner] = useState<string | null>(null);

	// Personal Memory state
	const [memories, setMemories] = useState<UserMemoryItem[]>([]);
	const [isLoadingMemories, setIsLoadingMemories] = useState(false);
	const [recentMemoriesSavedCount, setRecentMemoriesSavedCount] = useState(0);

	const abortControllerRef = useRef<AbortController | null>(null);
	const messagesRef = useRef<ChatMessage[]>([]);
	const activeConversationIdRef = useRef<string | null>(null);

	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);

	useEffect(() => {
		activeConversationIdRef.current = activeConversationId;
	}, [activeConversationId]);

	// Cancela qualquer stream ativa ao desmontar o componente
	useEffect(() => {
		return () => {
			abortControllerRef.current?.abort();
		};
	}, []);

	const loadConversations = useCallback(async () => {
		const token = localStorage.getItem('gideon.auth.token');
		if (!token) return;

		setIsLoadingConversations(true);
		try {
			const response = await fetch('/api/chat/conversations', {
				method: 'GET',
				headers: getAuthHeaders(),
			});
			if (!response.ok) return;
			const json = (await response.json()) as {
				data?: {
					conversations?: ConversationSummary[];
					maxLimit?: number;
				};
				conversations?: ConversationSummary[];
				maxConversations?: number;
			};
			const list = json.data?.conversations ?? json.conversations;
			const maxLim = json.data?.maxLimit ?? json.maxConversations;
			if (Array.isArray(list)) {
				setConversations(list);
			}
			if (typeof maxLim === 'number') {
				setMaxConversations(maxLim);
			}
		} catch {
			// Silencioso em background
		} finally {
			setIsLoadingConversations(false);
		}
	}, []);

	const loadMemories = useCallback(async () => {
		const token = localStorage.getItem('gideon.auth.token');
		if (!token) return;

		setIsLoadingMemories(true);
		try {
			const response = await fetch('/api/chat/memories', {
				method: 'GET',
				headers: getAuthHeaders(),
			});
			if (!response.ok) return;
			const json = (await response.json()) as {
				data?: UserMemoryItem[];
				memories?: UserMemoryItem[];
			};
			const list = json.data ?? json.memories;
			if (Array.isArray(list)) {
				setMemories(list);
			}
		} catch {
			// Silencioso em background
		} finally {
			setIsLoadingMemories(false);
		}
	}, []);

	// Carrega conversas e memórias ao montar o hook
	useEffect(() => {
		void loadConversations();
		void loadMemories();
	}, [loadConversations, loadMemories]);

	const stopGeneration = useCallback(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
			setIsLoading(false);
		}
	}, []);

	const startNewConversation = useCallback(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
		}
		activeConversationIdRef.current = null;
		setActiveConversationId(null);
		setActiveConversationSummary(null);
		setMessages([]);
		setError('');
		setCompactionBanner(null);
		setIsLoading(false);
	}, []);

	const clearMessages = startNewConversation;

	const selectConversation = useCallback(async (conversationId: string) => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
		}
		setIsLoading(false);
		setError('');
		setCompactionBanner(null);

		try {
			const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
				method: 'GET',
				headers: getAuthHeaders(),
			});
			if (!response.ok) {
				throw new Error(await getResponseError(response));
			}
			const json = (await response.json()) as {
				data?: ConversationSummary & {
					messages: Array<{
						id: string;
						role: 'user' | 'assistant';
						content: string;
						isCompacted: boolean;
						createdAt: string;
					}>;
				};
				conversation?: ConversationSummary & {
					messages: Array<{
						id: string;
						role: 'user' | 'assistant';
						content: string;
						isCompacted: boolean;
						createdAt: string;
					}>;
				};
			};

			const conv = json.data ?? json.conversation;
			if (conv) {
				activeConversationIdRef.current = conv.id;
				setActiveConversationId(conv.id);
				setActiveConversationSummary(conv.summary ?? null);
				setMessages(
					(conv.messages ?? []).map((msg) => ({
						id: msg.id,
						role: msg.role === 'assistant' ? 'assistant' : 'user',
						content: msg.content,
						isCompacted: msg.isCompacted,
						createdAt: msg.createdAt,
					}))
				);
			}
		} catch (err) {
			setError(formatFriendlyError(err));
		}
	}, []);

	const renameConversation = useCallback(
		async (conversationId: string, title: string) => {
			const trimmed = title.trim();
			if (!trimmed) return;
			try {
				const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
					method: 'PATCH',
					headers: getAuthHeaders(),
					body: JSON.stringify({ title: trimmed }),
				});
				if (!response.ok) {
					throw new Error(await getResponseError(response));
				}
				setConversations((prev) =>
					prev.map((conv) => (conv.id === conversationId ? { ...conv, title: trimmed } : conv))
				);
			} catch (err) {
				setError(formatFriendlyError(err));
			}
		},
		[]
	);

	const togglePinConversation = useCallback(
		async (conversationId: string, isPinned: boolean) => {
			try {
				const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
					method: 'PATCH',
					headers: getAuthHeaders(),
					body: JSON.stringify({ isPinned }),
				});
				if (!response.ok) {
					throw new Error(await getResponseError(response));
				}
				await loadConversations();
			} catch (err) {
				setError(formatFriendlyError(err));
			}
		},
		[loadConversations]
	);

	const deleteConversation = useCallback(
		async (conversationId: string) => {
			try {
				const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
					method: 'DELETE',
					headers: getAuthHeaders(),
				});
				if (!response.ok) {
					throw new Error(await getResponseError(response));
				}
				setConversations((prev) => prev.filter((conv) => conv.id !== conversationId));
				if (activeConversationIdRef.current === conversationId) {
					startNewConversation();
				}
			} catch (err) {
				setError(formatFriendlyError(err));
			}
		},
		[startNewConversation]
	);

	const addMemory = useCallback(
		async (fact: string, category: string = 'PREFERENCIA_GERAL') => {
			const trimmed = fact.trim();
			if (!trimmed) return;
			const response = await fetch('/api/chat/memories', {
				method: 'POST',
				headers: getAuthHeaders(),
				body: JSON.stringify({ fact: trimmed, category }),
			});
			if (!response.ok) {
				throw new Error(await getResponseError(response));
			}
			await loadMemories();
		},
		[loadMemories]
	);

	const deleteMemory = useCallback(async (memoryId: string) => {
		const response = await fetch(`/api/chat/memories/${encodeURIComponent(memoryId)}`, {
			method: 'DELETE',
			headers: getAuthHeaders(),
		});
		if (!response.ok) {
			throw new Error(await getResponseError(response));
		}
		setMemories((prev) => prev.filter((m) => m.id !== memoryId));
	}, []);

	const sendMessage = useCallback(
		async (content: string) => {
			const text = content.trim();
			if (!text) {
				return;
			}

			// Se houver uma requisição anterior ainda ativa, cancela de forma limpa antes de iniciar a nova
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
				abortControllerRef.current = null;
			}

			const controller = new AbortController();
			abortControllerRef.current = controller;

			const userMessage: ChatMessage = { id: createId(), role: 'user', content: text };
			const assistantMessage: ChatMessage = { id: createId(), role: 'assistant', content: '' };

			const currentHistory = messagesRef.current.filter(
				(msg) => msg.role === 'user' || (msg.role === 'assistant' && msg.content.trim().length > 0)
			);
			const history = [...currentHistory, userMessage];

			setMessages([...history, assistantMessage]);
			setError('');
			setCompactionBanner(null);
			setRecentMemoriesSavedCount(0);
			setIsLoading(true);

			let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

			try {
				const response = await fetch('/api/chat', {
					method: 'POST',
					headers: getAuthHeaders(),
					body: JSON.stringify({
						conversationId: activeConversationIdRef.current ?? undefined,
						history: history.map((message) => ({
							role: message.role === 'assistant' ? 'model' : 'user',
							parts: [{ text: message.content }],
						})),
					}),
					signal: controller.signal,
				});

				if (!response.ok) {
					throw new Error(await getResponseError(response));
				}

				if (!response.body) {
					throw new Error('O servidor não retornou um fluxo de dados contínuo. Tente enviar sua pergunta novamente.');
				}

				reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';

				const appendChunk = (chunk: string) => {
					if (!chunk) return;
					setMessages((currentMessages) =>
						currentMessages.map((message) =>
							message.id === assistantMessage.id
								? { ...message, content: message.content + chunk }
								: message
						)
					);
				};

				const consumeEvents = (data: string) => {
					const frames = data.split('\n\n');
					buffer = frames.pop() ?? '';

					for (const frame of frames) {
						const lines = frame.split('\n');
						const eventName = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
						const serializedData = lines
							.filter((line) => line.startsWith('data:'))
							.map((line) => line.slice(5).trimStart())
							.join('\n');

						if (!serializedData || eventName === 'done') {
							continue;
						}

						let payload: GeminiStreamPayload;
						try {
							payload = JSON.parse(serializedData) as GeminiStreamPayload;
						} catch {
							continue;
						}

						if (eventName === 'error') {
							throw new Error(
								typeof payload.message === 'string' && payload.message.trim()
									? payload.message
									: 'Ocorreu uma falha ao processar a consulta no assistente.'
							);
						}

						if (eventName === 'status' && typeof payload.step === 'number' && typeof payload.title === 'string') {
							setStatusStep({
								step: payload.step,
								title: payload.title,
								subtitle: typeof payload.subtitle === 'string' ? payload.subtitle : '',
							});
							continue;
						}

						if (eventName === 'dashboard_saved' && payload.widget && typeof payload.widget === 'object') {
							syncSavedWidgetToLocalDashboardCache(payload.widget as any);
							window.dispatchEvent(
								new CustomEvent('gideon:dashboard-widget-saved', {
									detail: payload.widget,
								})
							);
							continue;
						}

						if (eventName === 'conversation') {
							if (typeof payload.conversationId === 'string') {
								activeConversationIdRef.current = payload.conversationId;
								setActiveConversationId(payload.conversationId);
							}
							if (payload.wasCompacted === true) {
								setCompactionBanner(
									'Conversa longa compactada automaticamente: mensagens antigas foram resumidas preservando os pontos principais.'
								);
								if (typeof payload.conversationId === 'string') {
									void fetch(`/api/chat/conversations/${encodeURIComponent(payload.conversationId)}`, {
										method: 'GET',
										headers: getAuthHeaders(),
									})
										.then((r) => (r.ok ? r.json() : null))
										.then((detail) => {
											const summaryText = detail?.data?.summary ?? detail?.conversation?.summary;
											if (summaryText) {
												setActiveConversationSummary(summaryText);
											}
										})
										.catch(() => {});
								}
							}
							if (typeof payload.newMemoriesSavedCount === 'number' && payload.newMemoriesSavedCount > 0) {
								setRecentMemoriesSavedCount(payload.newMemoriesSavedCount);
								void loadMemories();
							}
							void loadConversations();
							continue;
						}

						if (typeof payload.text === 'string') {
							appendChunk(payload.text);
						}
					}
				};

				while (true) {
					const { done, value } = await reader.read();
					if (done) {
						break;
					}

					buffer += decoder.decode(value, { stream: true });
					consumeEvents(buffer);
				}

				buffer += decoder.decode();
				if (buffer.trim()) {
					consumeEvents(`${buffer}\n\n`);
				}
			} catch (requestError) {
				// Ignora cancelamento explícito pelo usuário ou troca de requisição
				if (
					(requestError instanceof DOMException && requestError.name === 'AbortError') ||
					(requestError instanceof Error && requestError.name === 'AbortError') ||
					controller.signal.aborted
				) {
					setMessages((currentMessages) =>
						currentMessages.filter((message) => message.id !== assistantMessage.id || message.content.trim().length > 0)
					);
					return;
				}

				const friendlyMessage = formatFriendlyError(requestError);
				setError(friendlyMessage);
				setMessages((currentMessages) =>
					currentMessages.filter((message) => message.id !== assistantMessage.id || message.content.trim().length > 0)
				);
			} finally {
				if (reader) {
					try {
						await reader.cancel();
					} catch {
						// Leitor já fechado
					}
				}
				if (abortControllerRef.current === controller) {
					abortControllerRef.current = null;
					setIsLoading(false);
					setStatusStep(null);
				}
			}
		},
		[loadConversations, loadMemories]
	);

	return {
		messages,
		isLoading,
		statusStep,
		error,
		conversations,
		maxConversations,
		activeConversationId,
		activeConversationSummary,
		isLoadingConversations,
		compactionBanner,
		memories,
		isLoadingMemories,
		recentMemoriesSavedCount,
		sendMessage,
		stopGeneration,
		clearMessages,
		startNewConversation,
		selectConversation,
		renameConversation,
		togglePinConversation,
		deleteConversation,
		loadConversations,
		loadMemories,
		addMemory,
		deleteMemory,
	};
}

function formatFriendlyError(error: unknown): string {
	if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
		return 'A conexão com o servidor oscilou ou foi interrompida. Verifique sua internet e tente enviar a pergunta novamente.';
	}
	if (error instanceof Error) {
		if (/network|failed to fetch|load failed/i.test(error.message)) {
			return 'Sem conexão com o servidor do Gideon no momento. Verifique sua rede e tente novamente em instantes.';
		}
		return error.message;
	}
	return 'Não foi possível concluir sua consulta agora. Por favor, tente novamente em alguns segundos.';
}

async function getResponseError(response: Response): Promise<string> {
	try {
		const payload = (await response.json()) as { error?: unknown; message?: unknown };
		if (typeof payload.error === 'string' && payload.error.trim()) {
			return payload.error;
		}
		if (typeof payload.message === 'string' && payload.message.trim()) {
			return payload.message;
		}
	} catch {
		// A resposta pode não ser JSON em caso de falha de proxy ou servidor.
	}

	if (response.status === 401 || response.status === 403) {
		return 'Sua sessão expirou ou não tem permissão para esta consulta. Faça login novamente.';
	}
	if (response.status === 429) {
		return 'Muitas consultas em sequência. Aguarde alguns segundos antes de enviar uma nova pergunta.';
	}
	if (response.status >= 500) {
		return `O servidor encontrou uma instabilidade temporária (HTTP ${response.status}). Tente novamente em instantes.`;
	}

	return `Não foi possível iniciar a conversa (HTTP ${response.status}).`;
}
