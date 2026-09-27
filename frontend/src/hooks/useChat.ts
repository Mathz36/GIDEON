import { useState } from 'react';

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
}

interface GeminiStreamPayload {
	text?: unknown;
	message?: unknown;
}

const DEFAULT_SYSTEM_PROMPT = 'Você é Gideon, um assistente útil e objetivo. Responda em Markdown quando isso melhorar a clareza.';

const createId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export function useChat() {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');

	const sendMessage = async (content: string) => {
		const text = content.trim();
		if (!text || isLoading) {
			return;
		}

		const userMessage: ChatMessage = { id: createId(), role: 'user', content: text };
		const assistantMessage: ChatMessage = { id: createId(), role: 'assistant', content: '' };
		const history = [...messages, userMessage];

		setMessages([...history, assistantMessage]);
		setError('');
		setIsLoading(true);

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
			});

			if (!response.ok) {
				throw new Error(await getResponseError(response));
			}

			if (!response.body) {
				throw new Error('O servidor não retornou um stream de resposta.');
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			const appendChunk = (chunk: string) => {
				setMessages((currentMessages) => currentMessages.map((message) => (
					message.id === assistantMessage.id ? { ...message, content: message.content + chunk } : message
				)));
			};

			const consumeEvents = (data: string) => {
				const frames = data.split('\n\n');
				buffer = frames.pop() ?? '';

				frames.forEach((frame) => {
					const eventName = frame.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim();
					const serializedData = frame
						.split('\n')
						.filter((line) => line.startsWith('data:'))
						.map((line) => line.slice(5).trimStart())
						.join('\n');

					if (!serializedData || eventName === 'done') {
						return;
					}

					const payload = JSON.parse(serializedData) as GeminiStreamPayload;
					if (eventName === 'error') {
						throw new Error(typeof payload.message === 'string' ? payload.message : 'Falha ao gerar a resposta.');
					}

					if (typeof payload.text === 'string') {
						appendChunk(payload.text);
					}
				});
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
			setError(requestError instanceof Error ? requestError.message : 'Não foi possível enviar a mensagem.');
			setMessages((currentMessages) => currentMessages.filter((message) => message.id !== assistantMessage.id || message.content));
		} finally {
			setIsLoading(false);
		}
	};

	return { messages, isLoading, error, sendMessage };
}

async function getResponseError(response: Response): Promise<string> {
	try {
		const payload = await response.json() as { error?: unknown };
		if (typeof payload.error === 'string') {
			return payload.error;
		}
	} catch {
		// A resposta pode não ser JSON em caso de falha de proxy ou servidor.
	}

	return `Não foi possível iniciar a conversa (HTTP ${response.status}).`;
}
