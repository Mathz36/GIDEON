import { ILlmKeywordExtractor } from '../../domain/gateways/llm-keyword-extractor.interface';

export interface ExtractKeywordsInput {
	question: string;
}

export interface CorporateSynonymRule {
	domain: string;
	triggers: string[];
	canonicalTokens: string[];
}

/**
 * Dicionário Determinístico de Sinônimos Corporativos (Camada 2 - Blindagem Akita).
 * Garante 100% de recall semântico mapeando jargões de negócios (ex: "praça", "freguês",
 * "representante", "ticket médio", "bonificação", "família") diretamente para os identificadores
 * físicos de tabelas e colunas do ERP, independentemente de variações do LLM.
 */
export const CORPORATE_SYNONYM_DICTIONARY: CorporateSynonymRule[] = [
	{
		domain: 'FATURAMENTO_E_NOTAS_FISCAIS',
		triggers: ['fatur', 'receit', 'vend', 'nota', 'fiscal', 'fiscais', 'ticket', 'pedido', 'evoluc', 'mensal', 'diari'],
		canonicalTokens: [
			'nota_fiscal',
			'notas_fiscais',
			'erp_nota_fiscal',
			'valor_liquido',
			'valor_bruto',
			'operacao',
			'data_emissao',
			'vendas',
			'faturamento',
			'receita',
			'pedidos',
		],
	},
	{
		domain: 'OPERACOES_FISCAIS_DEVOLUCAO_BONIFICACAO',
		triggers: ['devoluc', 'devolv', 'bonific', 'brind', 'troc', 'operac', 'moviment', 'remess', 'entrad', 'saida'],
		canonicalTokens: ['nota_fiscal', 'erp_nota_fiscal', 'operacao', 'tipo_movimento', 'valor_liquido', 'valor_bruto'],
	},
	{
		domain: 'CLIENTES_E_CARTEIRA',
		triggers: ['client', 'comprador', 'fregues', 'parceir', 'carteir', 'razao', 'cnpj', 'cpf', 'consumidor', 'destinatari'],
		canonicalTokens: [
			'clientes',
			'erp_clientes',
			'cod_cliente',
			'razaosocial',
			'nome_fantasia',
			'cidade',
			'uf',
			'parceiros',
			'compradores',
		],
	},
	{
		domain: 'GEOGRAFIA_E_PRACAS_COMERCIAIS',
		triggers: ['prac', 'regia', 'regional', 'estad', 'uf', 'cidad', 'municip', 'bairr', 'local', 'geograf', 'cep'],
		canonicalTokens: ['clientes', 'erp_clientes', 'cidade', 'uf', 'bairro', 'cep', 'nota_fiscal'],
	},
	{
		domain: 'FORCA_DE_VENDAS_E_EQUIPE',
		triggers: ['vendedor', 'representant', 'consultor', 'corretor', 'gerent', 'supervisor', 'equip', 'comercial'],
		canonicalTokens: ['vendedores', 'erp_vendedores', 'cod_vendedor', 'representante_nome', 'gerente_nome', 'supervisor_nome'],
	},
	{
		domain: 'PRODUTOS_MIX_E_ESTOQUE',
		triggers: ['produt', 'item', 'itens', 'mercadori', 'sku', 'peca', 'grup', 'famili', 'categori', 'linh', 'unidad', 'pes', 'quantidad', 'volume', 'mix', 'catalogo', 'estoq'],
		canonicalTokens: [
			'produtos',
			'erp_produtos',
			'cod_produto',
			'descricao_produto',
			'grupo_de_produtos',
			'unidade',
			'peso',
			'quantidade',
			'itens',
			'mercadorias',
			'estoque',
		],
	},
];

export class ExtractKeywordsUseCase {
	constructor(private readonly llmExtractor: ILlmKeywordExtractor) {}

	async execute(input: ExtractKeywordsInput): Promise<string[]> {
		if (!input.question || !input.question.trim()) {
			return [];
		}

		// SEMPRE extrai os tokens determinísticos + expansão de sinônimos corporativos (Design by Contract)
		const deterministicTokens = this.expandDeterministicSynonyms(input.question);

		try {
			const llmKeywords = await this.llmExtractor.extract(input.question);
			const cleanLlm = (llmKeywords || [])
				.map((k) => k.trim().toLowerCase())
				.filter(Boolean);

			// Mescla as palavras-chave da LLM com o dicionário determinístico corporativo
			return Array.from(new Set([...cleanLlm, ...deterministicTokens]));
		} catch (error) {
			console.warn('[ExtractKeywordsUseCase] Falha no LLM extractor, utilizando dicionário determinístico corporativo:', error);
			return deterministicTokens;
		}
	}

	/**
	 * Expansão determinística de tokens e sinônimos corporativos sobre a pergunta do usuário.
	 * Funciona tanto em conjunto com a LLM quanto isoladamente se a LLM falhar.
	 */
	public expandDeterministicSynonyms(question: string): string[] {
		const stopwords = new Set([
			'a', 'ao', 'aos', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos', 'e', 'em',
			'mais', 'menos', 'na', 'nao', 'nas', 'no', 'nos', 'o', 'os', 'ou', 'para', 'por',
			'qual', 'quais', 'quando', 'quanto', 'quantos', 'quanta', 'quantas', 'que', 'quem',
			'sao', 'se', 'sem', 'sua', 'suas', 'seu', 'seus', 'tem', 'temos', 'tenho', 'um', 'uma',
			'resumo', 'executivo', 'mostrar', 'mostre', 'ver', 'listar', 'traga', 'relatorio',
		]);

		const normalizedQuestion = question
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase();

		const tokens = normalizedQuestion
			.replace(/[^a-z0-9_]+/g, ' ')
			.split(/\s+/)
			.filter((word) => (word.length >= 3 || word === 'uf' || word === 'nf') && !stopwords.has(word));

		const expanded = new Set(tokens);

		for (const rule of CORPORATE_SYNONYM_DICTIONARY) {
			const matched = tokens.some((token) =>
				rule.triggers.some((trigger) =>
					trigger.length <= 2 ? token === trigger : token.includes(trigger),
				),
			);
			if (matched) {
				for (const canonical of rule.canonicalTokens) {
					expanded.add(canonical);
				}
			}
		}

		// Mantém compatibilidade com termos financeiros caso existam tabelas customizadas
		for (const t of tokens) {
			if (t.includes('financ') || t.includes('pagar') || t.includes('receber') || t.includes('caixa')) {
				['financeiro', 'contas_a_pagar', 'contas_a_receber', 'fluxo_de_caixa'].forEach((s) => expanded.add(s));
			}
		}

		return Array.from(expanded);
	}
}
