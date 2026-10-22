import { ILlmKeywordExtractor } from '../../domain/gateways/llm-keyword-extractor.interface';
import GeminiService from '../../../../services/gemini.service';

export class GeminiKeywordExtractorGateway implements ILlmKeywordExtractor {
	private gemini: GeminiService | null = null;

	private getGemini(): GeminiService {
		if (!this.gemini) {
			this.gemini = new GeminiService();
		}
		return this.gemini;
	}

	async extract(question: string): Promise<string[]> {
		const systemPrompt = `Você é um componente de Processamento de Linguagem Natural (NLP) para um pipeline Text-to-SQL em ERP.
Sua missão é ler a pergunta do usuário e extrair os conceitos-chave, entidades de negócio, tabelas implícitas, atributos, métricas, filtros e sinônimos de negócio correlatos típicos de ERP corporativo (exemplo: se o usuário perguntar de 'faturamento', inclua também 'faturamento', 'vendas', 'receita', 'notas_fiscais', 'pedidos'; se perguntar de 'compradores', inclua 'clientes', 'parceiros'; se perguntar de 'itens', inclua 'produtos', 'estoque').
Retorne APENAS um array JSON de strings minúsculas normalizadas no formato: ["termo1", "termo2", ...]. Sem markdown adicional, sem explicações.`;

		const userMessage = `Pergunta do Usuário: "${question}"`;

		try {
			const gemini = this.getGemini();
			const stream = gemini.streamResponse(
				[{ role: 'user', parts: [{ text: userMessage }] }],
				systemPrompt,
				{ temperature: 0.1, topP: 0.9 },
			);

			let fullText = '';
			for await (const chunk of stream) {
				fullText += chunk;
			}

			// Extrai bloco JSON da resposta
			const jsonMatch = fullText.match(/\[[\s\S]*?\]/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]);
				if (Array.isArray(parsed)) {
					return parsed.map((item) => String(item).trim()).filter(Boolean);
				}
			}
		} catch (error) {
			console.warn('[GeminiKeywordExtractorGateway] Fallback ativado para extração de keywords:', error);
		}

		// Fallback automático caso o LLM não responda ou ocorra falha de rede
		return this.tokenizeFallback(question);
	}

	private tokenizeFallback(text: string): string[] {
		const stopwords = new Set([
			'a', 'ao', 'aos', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos', 'e', 'em',
			'mais', 'menos', 'na', 'nao', 'nas', 'no', 'nos', 'o', 'os', 'ou', 'para', 'por',
			'qual', 'quais', 'quando', 'quanto', 'quantos', 'quanta', 'quantas', 'que', 'quem',
			'sao', 'se', 'sem', 'sua', 'suas', 'seu', 'seus', 'tem', 'temos', 'tenho', 'um', 'uma',
			'resumo', 'executivo', 'mostrar', 'mostre', 'ver', 'listar', 'traga', 'relatorio',
		]);

		const tokens = text
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9_]+/g, ' ')
			.split(/\s+/)
			.filter((w) => w.length >= 3 && !stopwords.has(w));

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
