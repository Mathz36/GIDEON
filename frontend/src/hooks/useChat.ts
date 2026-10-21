import { useCallback, useEffect, useRef, useState } from 'react';

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
}

interface GeminiStreamPayload {
	text?: unknown;
	message?: unknown;
}

const createId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export function useChat() {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');
	const abortControllerRef = useRef<AbortController | null>(null);
	const messagesRef = useRef<ChatMessage[]>([]);

	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);

	// Cancela qualquer stream ativa ao desmontar o componente
	useEffect(() => {
		return () => {
			abortControllerRef.current?.abort();
		};
	}, []);

	const stopGeneration = useCallback(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
			setIsLoading(false);
		}
	}, []);

	const clearMessages = useCallback(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
		}
		setMessages([]);
		setError('');
		setIsLoading(false);
	}, []);

	const sendMessage = useCallback(async (content: string) => {
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
		setIsLoading(true);

		let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

		try {
			const token = localStorage.getItem('gideon.auth.token');
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({
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
			}
		}
	}, []);

	return { messages, isLoading, error, sendMessage, stopGeneration, clearMessages };
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
