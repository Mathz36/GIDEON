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
			'resumo', 'executivo', 'mostrar', 'mostre', 'ver', 'listar', 'traga', 'relatorio',
		]);

		const tokens = question
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9_]+/g, ' ')
			.split(/\s+/)
			.filter((word) => word.length >= 3 && !stopwords.has(word));

		const expanded = new Set(tokens);
		for (const t of tokens) {
			if (t.includes('fatur') || t.includes('vend') || t.includes('nota') || t.includes('receit')) {
				['faturamento', 'vendas', 'receita', 'notas_fiscais', 'pedidos'].forEach((s) => expanded.add(s));
			}
			if (t.includes('client') || t.includes('parcer') || t.includes('comprador')) {
				['clientes', 'parceiros', 'compradores'].forEach((s) => expanded.add(s));
			}
			if (t.includes('produt') || t.includes('estoq') || t.includes('item') || t.includes('mercadori')) {
				['produtos', 'itens', 'mercadorias', 'estoque'].forEach((s) => expanded.add(s));
			}
			if (t.includes('financ') || t.includes('pagar') || t.includes('receber') || t.includes('caixa')) {
				['financeiro', 'contas_a_pagar', 'contas_a_receber', 'fluxo_de_caixa'].forEach((s) => expanded.add(s));
			}
		}

		return Array.from(expanded);
	}
}
