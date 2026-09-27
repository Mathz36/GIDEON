export interface ILlmKeywordExtractor {
	/**
	 * Extrai entidades de negócio, métricas, dimensões e termos de filtro
	 * a partir da pergunta em linguagem natural do usuário.
	 */
	extract(question: string): Promise<string[]>;
}
