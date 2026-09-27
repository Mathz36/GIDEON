import { MetaTableEntity } from '../../domain/entities/meta-table.entity';
import { IMetaTableRepository } from '../../domain/repositories/meta-table.repository.interface';
import { GetContextForPromptDTO, PromptContextResult } from '../dtos/get-context-for-prompt.dto';

interface ScoredTable {
	table: MetaTableEntity;
	score: number;
	matchedReasons: string[];
}

/**
 * Interface extensível para futura injeção de busca vetorial (Embeddings / Cosine Similarity).
 */
export interface IVectorSimilaritySearch {
	findRelevantTables(tenantId: string, question: string, topK: number): Promise<string[]>;
}

export class GetContextForPromptUseCase {
	private static readonly STOPWORDS = new Set([
		'a', 'ao', 'aos', 'aquela', 'aquelas', 'aquele', 'aqueles', 'aquilo', 'as', 'ate',
		'com', 'como', 'da', 'das', 'de', 'dela', 'delas', 'dele', 'deles', 'depois', 'do',
		'dos', 'e', 'ela', 'elas', 'ele', 'eles', 'em', 'entre', 'era', 'eram', 'essa',
		'essas', 'esse', 'esses', 'esta', 'estao', 'estas', 'estava', 'estavam', 'este',
		'estes', 'eu', 'foi', 'fomos', 'foram', 'ha', 'isso', 'isto', 'ja', 'lhe', 'lhes',
		'mais', 'mas', 'me', 'mesmo', 'meu', 'meus', 'minha', 'minhas', 'muito', 'na',
		'nao', 'nas', 'nem', 'no', 'nos', 'nossa', 'nossas', 'nosso', 'nossos', 'num',
		'numa', 'o', 'os', 'ou', 'para', 'pela', 'pelas', 'pelo', 'pelos', 'por', 'pra',
		'qual', 'quais', 'quando', 'quanta', 'quantas', 'quanto', 'quantos', 'que', 'quem',
		'sao', 'se', 'seja', 'sejam', 'sem', 'seu', 'seus', 'so', 'sua', 'suas', 'tambem',
		'tem', 'temos', 'tenho', 'tinha', 'tinham', 'todas', 'todos', 'um', 'uma', 'umas',
		'uns', 'voce', 'voces',
	]);

	constructor(
		private readonly repository: IMetaTableRepository,
		private readonly vectorSearch?: IVectorSimilaritySearch,
	) {}

	async execute(dto: GetContextForPromptDTO): Promise<PromptContextResult> {
		if (!dto.tenantId || !dto.tenantId.trim()) {
			throw new Error('O tenantId é obrigatório para recuperar o contexto do prompt.');
		}

		const maxTables = dto.maxTables && dto.maxTables > 0 ? dto.maxTables : 5;
		const allTables = await this.repository.findAllByTenant(dto.tenantId.trim());

		if (allTables.length === 0) {
			return {
				formattedContext: '',
				matchedTablesCount: 0,
				totalTablesCount: 0,
				selectedTableNames: [],
			};
		}

		// Se o schema tiver poucas tabelas (ex: <= 3), retorna todas para contexto completo
		if (allTables.length <= 3) {
			return this.buildResult(allTables, allTables.length);
		}

		// 1. Extração de termos-chave da pergunta
		const questionTokens = this.extractTokens(dto.question);

		// 2. Pontuação léxica e semântica por tabela e coluna
		const scoredTables = this.scoreTables(allTables, questionTokens, dto.question);

		// 3. Expansão relacional por Chaves Estrangeiras (FK)
		this.boostRelatedTables(scoredTables);

		// 4. Seleção das tabelas mais relevantes
		const selected = this.selectTopTables(scoredTables, allTables, maxTables);

		return this.buildResult(selected, allTables.length);
	}

	/**
	 * Normaliza e tokeniza a pergunta removendo acentos e stopwords da língua portuguesa.
	 */
	private extractTokens(text: string): string[] {
		if (!text || !text.trim()) {
			return [];
		}

		const normalized = text
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9_]+/g, ' ');

		return normalized
			.split(/\s+/)
			.map((t) => t.trim())
			.filter((t) => t.length >= 2 && !GetContextForPromptUseCase.STOPWORDS.has(t));
	}

	/**
	 * Calcula pontuação de relevância para cada tabela baseada no texto da pergunta.
	 */
	private scoreTables(tables: MetaTableEntity[], tokens: string[], rawQuestion: string): ScoredTable[] {
		const rawQuestionNorm = rawQuestion
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase();

		return tables.map((table) => {
			let score = 0;
			const matchedReasons: string[] = [];

			const tableNameNorm = table.tableName.toLowerCase();
			const tableDescNorm = table.description
				.normalize('NFD')
				.replace(/[\u0300-\u036f]/g, '')
				.toLowerCase();

			// Match direto no nome ou na descrição da tabela
			if (tableDescNorm && rawQuestionNorm.includes(tableDescNorm)) {
				score += 20;
				matchedReasons.push('Match completo na descrição da tabela');
			}

			for (const token of tokens) {
				if (tableNameNorm.includes(token)) {
					score += 5;
					matchedReasons.push(`Token "${token}" no nome da tabela`);
				}
				if (tableDescNorm.includes(token)) {
					score += 7;
					matchedReasons.push(`Token "${token}" na descrição da tabela`);
				}
			}

			// Match nas colunas (nome e descrição semântica)
			for (const col of table.columns) {
				const colNameNorm = col.columnName.toLowerCase();
				const colDescNorm = col.description
					.normalize('NFD')
					.replace(/[\u0300-\u036f]/g, '')
					.toLowerCase();

				// Ex: "limite" em "Limite de crédito do cliente"
				for (const token of tokens) {
					if (colNameNorm.includes(token)) {
						score += 4;
						matchedReasons.push(`Token "${token}" na coluna ${col.columnName}`);
					}
					if (colDescNorm.includes(token)) {
						score += 8;
						matchedReasons.push(`Token "${token}" no significado da coluna ${col.columnName}`);
					}
				}
			}

			return { table, score, matchedReasons };
		});
	}

	/**
	 * Expansão de Chaves Estrangeiras: Se a Tabela A tem alta relevância e referencia a Tabela B,
	 * a Tabela B recebe pontuação adicional para permitir que o LLM formule o JOIN corretamente.
	 */
	private boostRelatedTables(scoredTables: ScoredTable[]): void {
		const scoreMap = new Map<string, ScoredTable>();
		scoredTables.forEach((st) => scoreMap.set(st.table.tableName.toLowerCase(), st));

		for (const st of scoredTables) {
			if (st.score > 0) {
				for (const col of st.table.columns) {
					if (col.hasForeignKey() && col.foreignKeyToTable) {
						const referenced = scoreMap.get(col.foreignKeyToTable.toLowerCase());
						if (referenced && referenced.score === 0) {
							referenced.score += 6; // Dá visibilidade à tabela de destino do relacionamento
							referenced.matchedReasons.push(`Relacionamento FK a partir de "${st.table.tableName}"`);
						}
					}
				}
			}
		}
	}

	/**
	 * Ordena e seleciona as tabelas mais pontuadas, aplicando fallback se nada pontuar.
	 */
	private selectTopTables(
		scoredTables: ScoredTable[],
		allTables: MetaTableEntity[],
		maxTables: number,
	): MetaTableEntity[] {
		const sorted = [...scoredTables].sort((a, b) => b.score - a.score);
		const positive = sorted.filter((s) => s.score > 0);

		if (positive.length > 0) {
			return positive.slice(0, maxTables).map((s) => s.table);
		}

		// Fallback: se nenhum termo pontuou, seleciona as primeiras tabelas do tenant até o limite
		return allTables.slice(0, maxTables);
	}

	/**
	 * Constrói a string formatada pronta para injeção no prompt do LLM.
	 */
	private buildResult(selectedTables: MetaTableEntity[], totalTablesCount: number): PromptContextResult {
		const sections: string[] = [
			'### ESQUEMA DO BANCO DE DADOS (DICIONÁRIO DE DADOS DINÂMICO)',
			'Utilize as tabelas e colunas abaixo para gerar comandos SQL exatos para o PostgreSQL.',
			'INFORMAÇÃO CRÍTICA DE SCHEMA: Cada tabela possui uma Chave Primária (PK) explicitamente indicada.',
			'Utilize a PK para identificar unicidade de registros, agregações assertivas (ex: COUNT(DISTINCT pk)) e cláusulas de junção (JOINs) sem duplicar linhas.',
			'Atenção às descrições semânticas de negócio e aos relacionamentos de chaves estrangeiras indicados.\n',
		];

		for (const table of selectedTables) {
			sections.push(table.toSimplifiedDDL());
			sections.push(''); // Linha em branco entre tabelas
		}

		return {
			formattedContext: sections.join('\n').trim(),
			matchedTablesCount: selectedTables.length,
			totalTablesCount,
			selectedTableNames: selectedTables.map((t) => t.tableName),
		};
	}
}
