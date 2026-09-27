// Domain
export * from './domain/entities/meta-table.entity';
export * from './domain/entities/meta-column.entity';
export * from './domain/repositories/meta-table.repository.interface';
export * from './domain/gateways/llm-keyword-extractor.interface';

// Application DTOs
export * from './application/dtos/save-table-metadata.dto';
export * from './application/dtos/get-context-for-prompt.dto';

// Application Use Cases
export * from './application/use-cases/save-table-metadata.use-case';
export * from './application/use-cases/get-context-for-prompt.use-case';
export * from './application/use-cases/extract-keywords.use-case';
export * from './application/use-cases/search-metadata.use-case';
export * from './application/use-cases/expand-relationships.use-case';
export * from './application/use-cases/build-sql-generation-prompt.use-case';
export * from './application/use-cases/rag-sql-pipeline';

// Infrastructure
export * from './infrastructure/repositories/prisma-meta-table.repository';
export * from './infrastructure/gateways/gemini-keyword-extractor.gateway';

// Wire dependencies (Clean Architecture Composition Root)
import prismaClient from '../../config/prisma';
import { PrismaMetaTableRepository } from './infrastructure/repositories/prisma-meta-table.repository';
import { GeminiKeywordExtractorGateway } from './infrastructure/gateways/gemini-keyword-extractor.gateway';
import { SaveTableMetadataUseCase } from './application/use-cases/save-table-metadata.use-case';
import { GetContextForPromptUseCase } from './application/use-cases/get-context-for-prompt.use-case';
import { ExtractKeywordsUseCase } from './application/use-cases/extract-keywords.use-case';
import { SearchMetadataUseCase } from './application/use-cases/search-metadata.use-case';
import { ExpandRelationshipsUseCase } from './application/use-cases/expand-relationships.use-case';
import { BuildSqlGenerationPromptUseCase } from './application/use-cases/build-sql-generation-prompt.use-case';
import { RagSqlPipeline } from './application/use-cases/rag-sql-pipeline';

export const metaTableRepository = new PrismaMetaTableRepository(prismaClient);
export const geminiKeywordExtractor = new GeminiKeywordExtractorGateway();

export const saveTableMetadataUseCase = new SaveTableMetadataUseCase(metaTableRepository);
export const getContextForPromptUseCase = new GetContextForPromptUseCase(metaTableRepository);
export const extractKeywordsUseCase = new ExtractKeywordsUseCase(geminiKeywordExtractor);
export const searchMetadataUseCase = new SearchMetadataUseCase(metaTableRepository);
export const expandRelationshipsUseCase = new ExpandRelationshipsUseCase(metaTableRepository);
export const buildSqlGenerationPromptUseCase = new BuildSqlGenerationPromptUseCase();

export const ragSqlPipeline = new RagSqlPipeline(
	extractKeywordsUseCase,
	searchMetadataUseCase,
	expandRelationshipsUseCase,
	buildSqlGenerationPromptUseCase,
);
