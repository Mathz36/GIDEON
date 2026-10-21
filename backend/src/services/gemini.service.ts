import {
	Content,
	GoogleGenerativeAI,
	GenerativeModel,
	GenerationConfig,
	EnhancedGenerateContentResponse,
	GenerateContentStreamResult,
} from '@google/generative-ai';

export const STRICT_GROUNDING_SYSTEM_INSTRUCTION =
	'REGRA INVIOLÁVEL DE GROUNDING: Você NUNCA deve inventar, estimar, supor ou alucinar nomes de clientes, valores financeiros, quantidades de estoque, datas, códigos ou quaisquer dados que não estejam explicitamente presentes nos DADOS REAIS DO BANCO fornecidos no contexto. Se os dados fornecidos estiverem vazios ou não contiverem a resposta para a pergunta, diga claramente que não há registros disponíveis no banco de dados sincronizado do ERP para responder à solicitação.';

export const DEFAULT_SQL_SYSTEM_INSTRUCTION =
	'Você é um gerador determinístico de queries SQL PostgreSQL somente leitura (SELECT / WITH). Retorne APENAS o bloco SQL dentro de ```sql ... ```, utilizando exclusivamente as tabelas e colunas presentes no esquema fornecido.';

export interface GeminiMessage {
	role: 'user' | 'model';
	parts: Array<{ text: string }>;
}

export interface GeminiParameters {
	temperature: number;
	topP: number;
}

interface GeminiServiceOptions {
	apiKey?: string;
	modelName?: string;
	maxRetries?: number;
	initialRetryDelayMs?: number;
}

export class GeminiService {
	private readonly ai: GoogleGenerativeAI;
	private readonly modelName: string;
	private readonly maxRetries: number;
	private readonly initialRetryDelayMs: number;

	constructor(options: GeminiServiceOptions = {}) {
		const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;

		if (!apiKey) {
			throw new Error('A variavel GEMINI_API_KEY nao foi configurada.');
		}

		this.ai = new GoogleGenerativeAI(apiKey);
		this.modelName = options.modelName ?? process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';
		this.maxRetries = options.maxRetries ?? 3;
		this.initialRetryDelayMs = options.initialRetryDelayMs ?? 500;
	}

	/**
	 * Gera query SQL com determinismo máximo (temperature: 0.0).
	 */
	async generateSqlQuery(
		promptOrHistory: string | GeminiMessage[],
		systemPrompt: string = DEFAULT_SQL_SYSTEM_INSTRUCTION,
	): Promise<string> {
		const history: GeminiMessage[] =
			typeof promptOrHistory === 'string'
				? [{ role: 'user', parts: [{ text: promptOrHistory }] }]
				: promptOrHistory;

		const model = this.createModel(systemPrompt, {
			temperature: 0.0,
			topP: 0.8,
		});
		const contents = GeminiService.normalizeHistory(history);
		const result = await model.generateContent({ contents });
		return result.response.text();
	}

	/**
	 * Gera resposta de chat em streaming com Grounding Estrito e Zero Alucinação reforçados na systemInstruction.
	 */
	async *streamChatResponse(
		history: GeminiMessage[],
		systemPrompt: string,
		parameters: GeminiParameters = { temperature: 0.1, topP: 0.9 },
	): AsyncGenerator<string, void, undefined> {
		const groundedSystemPrompt = GeminiService.withStrictGroundingInstruction(systemPrompt);
		const model = this.createModel(groundedSystemPrompt, parameters);
		const contents = GeminiService.normalizeHistory(history);

		for await (const chunk of this.withExponentialBackoff(() => model.generateContentStream({ contents }))) {
			const text = chunk.text();
			if (text) {
				yield text;
			}
		}
	}

	/**
	 * Gera resposta de chat completa com Grounding Estrito e Zero Alucinação reforçados na systemInstruction.
	 */
	async generateChatResponse(
		history: GeminiMessage[],
		systemPrompt: string,
		parameters: GeminiParameters = { temperature: 0.1, topP: 0.9 },
	): Promise<string> {
		const groundedSystemPrompt = GeminiService.withStrictGroundingInstruction(systemPrompt);
		const model = this.createModel(groundedSystemPrompt, parameters);
		const contents = GeminiService.normalizeHistory(history);
		const result = await model.generateContent({ contents });
		return result.response.text();
	}

	/**
	 * Alias compatível com rotas existentes que transmite a resposta aplicando a diretiva de Grounding Estrito.
	 */
	async *streamResponse(
		history: GeminiMessage[],
		systemPrompt: string,
		parameters: GeminiParameters,
	): AsyncGenerator<string, void, undefined> {
		const isInternalKeywordExtractor = systemPrompt.includes('Processamento de Linguagem Natural (NLP)');
		const effectiveSystemPrompt = isInternalKeywordExtractor
			? systemPrompt
			: GeminiService.withStrictGroundingInstruction(systemPrompt);

		const model = this.createModel(effectiveSystemPrompt, parameters);
		const contents = GeminiService.normalizeHistory(history);

		for await (const chunk of this.withExponentialBackoff(() => model.generateContentStream({ contents }))) {
			const text = chunk.text();
			if (text) {
				yield text;
			}
		}
	}

	async generateText(
		history: GeminiMessage[],
		systemPrompt: string,
		parameters: GeminiParameters = { temperature: 0.1, topP: 0.9 },
	): Promise<string> {
		const model = this.createModel(systemPrompt, parameters);
		const contents = GeminiService.normalizeHistory(history);
		const result = await model.generateContent({ contents });
		return result.response.text();
	}

	private static withStrictGroundingInstruction(systemPrompt: string): string {
		const trimmed = systemPrompt.trim();
		if (trimmed.includes('REGRA INVIOLÁVEL DE GROUNDING:')) {
			return trimmed;
		}
		return `${trimmed}\n\n${STRICT_GROUNDING_SYSTEM_INSTRUCTION}`;
	}

	private createModel(systemPrompt: string, parameters: GeminiParameters): GenerativeModel {
		const normalizedPrompt = systemPrompt.trim();

		if (!normalizedPrompt) {
			throw new Error('O System Prompt do Gemini nao pode ser vazio.');
		}

		if (!Number.isFinite(parameters.temperature) || parameters.temperature < 0 || parameters.temperature > 2) {
			throw new Error('Temperature deve estar entre 0 e 2.');
		}

		if (!Number.isFinite(parameters.topP) || parameters.topP < 0 || parameters.topP > 1) {
			throw new Error('Top-P deve estar entre 0 e 1.');
		}

		const generationConfig: GenerationConfig = {
			temperature: parameters.temperature,
			topP: parameters.topP,
		};

		return this.ai.getGenerativeModel({
			model: this.modelName,
			systemInstruction: normalizedPrompt,
			generationConfig,
		});
	}

	private static normalizeHistory(history: GeminiMessage[]): Content[] {
		if (!Array.isArray(history)) {
			throw new Error('O historico do Gemini deve ser um array de mensagens.');
		}

		return history.map((message, index) => {
			if (!message || !['user', 'model'].includes(message.role)) {
				throw new Error(`Mensagem invalida no historico do Gemini na posicao ${index}.`);
			}

			const parts = message.parts
				.filter((part) => typeof part?.text === 'string' && part.text.trim())
				.map((part) => ({ text: part.text }));

			if (parts.length === 0) {
				throw new Error(`A mensagem na posicao ${index} nao possui texto.`);
			}

			return { role: message.role, parts };
		});
	}

	private async *withExponentialBackoff(
		operation: () => Promise<GenerateContentStreamResult>,
	): AsyncGenerator<EnhancedGenerateContentResponse, void, undefined> {
		for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
			let hasYieldedChunks = false;

			try {
				const result = await operation();

				for await (const chunk of result.stream) {
					hasYieldedChunks = true;
					yield chunk;
				}

				return;
			} catch (error: unknown) {
				if (!GeminiService.isTransientError(error) || hasYieldedChunks || attempt === this.maxRetries) {
					throw GeminiService.toServiceError(error);
				}

				await GeminiService.delay(this.getRetryDelay(attempt));
			}
		}
	}

	private getRetryDelay(attempt: number): number {
		return this.initialRetryDelayMs * 2 ** attempt;
	}

	private static isTransientError(error: unknown): boolean {
		if (!error || typeof error !== 'object') {
			return false;
		}

		const candidate = error as { status?: number; message?: string };
		return (
			candidate.status === 429 ||
			candidate.status === 503 ||
			/429|503|too many requests|resource exhausted|high demand|service unavailable/i.test(candidate.message ?? '')
		);
	}

	private static toServiceError(error: unknown): Error {
		if (error instanceof Error) {
			return new Error(`Falha na API do Gemini: ${error.message}`, { cause: error });
		}

		return new Error('Falha inesperada na API do Gemini.', { cause: error });
	}

	private static delay(milliseconds: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, milliseconds));
	}
}

export default GeminiService;
