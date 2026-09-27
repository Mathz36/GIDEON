import { ExtractKeywordsUseCase } from './extract-keywords.use-case';
import { SearchMetadataUseCase, SearchMetadataOutput } from './search-metadata.use-case';
import { ExpandRelationshipsUseCase, ExpandedRelationshipsOutput } from './expand-relationships.use-case';
import { BuildSqlGenerationPromptUseCase, BuildSqlGenerationPromptOutput } from './build-sql-generation-prompt.use-case';

export interface RagSqlPipelineInput {
	tenantId: string;
	question: string;
	maxInitialTables?: number;
	includeInverseRelations?: boolean;
	dialect?: string;
	customInstructions?: string;
}

export interface RagSqlPipelineOutput {
	extractedKeywords: string[];
	searchResult: SearchMetadataOutput;
	schemaGraph: ExpandedRelationshipsOutput;
	promptResult: BuildSqlGenerationPromptOutput;
}

/**
 * Pipeline de RAG (Retrieval-Augmented Generation) com Expansão de Contexto
 * Orquestra as 4 etapas:
 * 1. Extração de Entidades (NLP/LLM)
 * 2. Busca Semântica no Dicionário de Dados (PostgreSQL/Prisma)
 * 3. Expansão Relacional de Chaves Estrangeiras (FK Graph)
 * 4. Montagem do Prompt Dinâmico com Pseudo-DDL e Guardrails
 */
export class RagSqlPipeline {
	constructor(
		private readonly extractKeywordsUseCase: ExtractKeywordsUseCase,
		private readonly searchMetadataUseCase: SearchMetadataUseCase,
		private readonly expandRelationshipsUseCase: ExpandRelationshipsUseCase,
		private readonly buildSqlPromptUseCase: BuildSqlGenerationPromptUseCase,
	) {}

	async execute(input: RagSqlPipelineInput): Promise<RagSqlPipelineOutput> {
		// Etapa 1: Extração de Palavras-Chave e Entidades
		const extractedKeywords = await this.extractKeywordsUseCase.execute({
			question: input.question,
		});

		// Etapa 2: Busca Semântica de Tabelas e Colunas no Dicionário
		const searchResult = await this.searchMetadataUseCase.execute({
			tenantId: input.tenantId,
			keywords: extractedKeywords,
			limit: input.maxInitialTables ?? 5,
		});

		// Etapa 3: Expansão de Relacionamentos Bidirecionais (FKs e PKs)
		const schemaGraph = await this.expandRelationshipsUseCase.execute({
			tenantId: input.tenantId,
			initialTables: searchResult.tables,
			includeInverseRelations: input.includeInverseRelations ?? true,
		});

		// Etapa 4: Montagem do Prompt Dinâmico Formatado para o LLM
		const promptResult = this.buildSqlPromptUseCase.execute({
			question: input.question,
			schemaGraph,
			dialect: input.dialect ?? 'PostgreSQL',
			customInstructions: input.customInstructions,
		});

		return {
			extractedKeywords,
			searchResult,
			schemaGraph,
			promptResult,
		};
	}
}
