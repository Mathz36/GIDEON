import { ILlmKeywordExtractor } from '../../domain/gateways/llm-keyword-extractor.interface';

export interface ExtractKeywordsInput {
	question: string;
}

export class ExtractKeywordsUseCase {
	constructor(private readonly llmExtractor: ILlmKeywordExtractor) {}

	async execute(input: ExtractKeywordsInput): Promise<string[]> {
		if (!input.question || !input.question.trim()) {
			return [];
		}

		try {
			const keywords = await this.llmExtractor.extract(input.question);
			return [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
		} catch (error) {
			console.warn('[ExtractKeywordsUseCase] Falha no LLM extractor, aplicando fallback heurístico:', error);
			return this.heuristicFallback(input.question);
		}
	}

	/**
	 * Fallback resiliente baseado em NLP leve caso a chamada de rede ao LLM falhe ou esteja offline.
	 */
	private heuristicFallback(question: string): string[] {
		const stopwords = new Set([
			'a', 'ao', 'aos', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos', 'e', 'em',
			'mais', 'menos', 'na', 'nao', 'nas', 'no', 'nos', 'o', 'os', 'ou', 'para', 'por',
			'qual', 'quais', 'quando', 'quanto', 'quantos', 'quanta', 'quantas', 'que', 'quem',
			'sao', 'se', 'sem', 'sua', 'suas', 'seu', 'seus', 'tem', 'temos', 'tenho', 'um', 'uma',
		]);

		return question
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9_]+/g, ' ')
			.split(/\s+/)
			.filter((word) => word.length >= 3 && !stopwords.has(word));
	}
}
