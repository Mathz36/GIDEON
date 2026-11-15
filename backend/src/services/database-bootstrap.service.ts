import { PrismaClient } from '@prisma/client';
import prismaClient from '../config/prisma';

export class DatabaseBootstrapService {
	private readonly prisma: PrismaClient;
	private initialized = false;

	constructor(prisma: PrismaClient = prismaClient) {
		this.prisma = prisma;
	}

	private async executeSingle(sql: string): Promise<void> {
		const clean = sql.trim();
		if (!clean) return;
		await this.prisma.$executeRawUnsafe(clean);
	}

	/**
	 * Inicializa de forma 100% idempotente todas as 11 tabelas e índices essenciais da aplicação Gideon.
	 * NÃO toca em nenhuma tabela derivada ou sincronizada do ERP (prefixadas com erp_*).
	 * Se as tabelas já existirem, o PostgreSQL ignora sem alterar nada (IF NOT EXISTS).
	 */
	public async bootstrap(): Promise<void> {
		if (this.initialized) {
			return;
		}

		if (typeof this.prisma.$executeRawUnsafe !== 'function') {
			this.initialized = true;
			return;
		}

		try {
			// 1. ai_configurations
			await this.executeSingle(`
				CREATE TABLE IF NOT EXISTS "ai_configurations" (
					"id" TEXT NOT NULL DEFAULT 'ai-config',
					"systemPrompt" TEXT NOT NULL,
					"temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
					"topP" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
					"memorySize" INTEGER NOT NULL DEFAULT 10,
					"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					CONSTRAINT "ai_configurations_pkey" PRIMARY KEY ("id")
				)
			`);

			// 2. erp_configurations
			await this.executeSingle(`
				CREATE TABLE IF NOT EXISTS "erp_configurations" (
					"id" TEXT NOT NULL,
					"context" TEXT NOT NULL,
					"description" TEXT NOT NULL,
					"query" TEXT NOT NULL,
					"expectedFields" TEXT[],
					"tableName" TEXT NOT NULL,
					"primaryKey" TEXT,
					"syncStrategy" TEXT NOT NULL DEFAULT 'FULL',
					"lastSyncCursor" TEXT,
					"batchSize" INTEGER NOT NULL DEFAULT 1000,
					"activeColumn" TEXT,
					"activeValue" TEXT,
					"syncFrequency" TEXT NOT NULL DEFAULT 'HOURS',
					"syncInterval" INTEGER DEFAULT 1,
					"syncTime" TEXT DEFAULT '08:00',
					"syncDayOfMonth" INTEGER DEFAULT 1,
					"syncActive" BOOLEAN NOT NULL DEFAULT true,
					"lastSyncAt" TIMESTAMP(3),
					"nextSyncAt" TIMESTAMP(3),
					"lastSyncStatus" TEXT,
					"lastSyncMessage" TEXT,
					"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					CONSTRAINT "erp_configurations_pkey" PRIMARY KEY ("id")
				)
			`);

			// 3. meta_tables
			await this.executeSingle(`
				CREATE TABLE IF NOT EXISTS "meta_tables" (
					"id" TEXT NOT NULL,
					"tenantId" TEXT NOT NULL,
					"tableName" TEXT NOT NULL,
					"description" TEXT NOT NULL,
					"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					CONSTRAINT "meta_tables_pkey" PRIMARY KEY ("id")
				)
			`);
			await this.executeSingle(`CREATE INDEX IF NOT EXISTS "meta_tables_tenantId_idx" ON "meta_tables"("tenantId")`);
			await this.executeSingle(`CREATE UNIQUE INDEX IF NOT EXISTS "meta_tables_tenantId_tableName_key" ON "meta_tables"("tenantId", "tableName")`);

			// 4. meta_columns
			await this.executeSingle(`
				CREATE TABLE IF NOT EXISTS "meta_columns" (
					"id" TEXT NOT NULL,
					"metaTableId" TEXT NOT NULL,
					"columnName" TEXT NOT NULL,
					"dataType" TEXT NOT NULL DEFAULT 'TEXT',
					"description" TEXT NOT NULL,
					"isPrimaryKey" BOOLEAN NOT NULL DEFAULT false,
					"foreignKeyToTable" TEXT,
					"foreignKeyToColumn" TEXT,
					"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					CONSTRAINT "meta_columns_pkey" PRIMARY KEY ("id")
				)
			`);
			await this.executeSingle(`CREATE INDEX IF NOT EXISTS "meta_columns_metaTableId_idx" ON "meta_columns"("metaTableId")`);
			await this.executeSingle(`CREATE UNIQUE INDEX IF NOT EXISTS "meta_columns_metaTableId_columnName_key" ON "meta_columns"("metaTableId", "columnName")`);

			// 5. usuarios
			await this.executeSingle(`
				CREATE TABLE IF NOT EXISTS "usuarios" (
					"id" TEXT NOT NULL,
					"nome" TEXT NOT NULL,
					"email" TEXT NOT NULL,
					"senha_hash" TEXT NOT NULL,
					"usuario_erp" TEXT NOT NULL,
					"cod_gerente_erp" TEXT NOT NULL,
					"tipo_acesso" TEXT NOT NULL DEFAULT 'GERENTE',
					"criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					"atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
				)
			`);
			await this.executeSingle(`CREATE UNIQUE INDEX IF NOT EXISTS "usuarios_email_key" ON "usuarios"("email")`);

			// 6. user_dashboards
			await this.executeSingle(`
				CREATE TABLE IF NOT EXISTS "user_dashboards" (
					"id" TEXT NOT NULL,
					"user_id" TEXT NOT NULL,
					"title" TEXT NOT NULL DEFAULT 'Meu Dashboard',
					"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					CONSTRAINT "user_dashboards_pkey" PRIMARY KEY ("id")
				)
			`);
			await this.executeSingle(`CREATE INDEX IF NOT EXISTS "user_dashboards_user_id_idx" ON "user_dashboards"("user_id")`);

			// 7. dashboard_widgets
			await this.executeSingle(`
				CREATE TABLE IF NOT EXISTS "dashboard_widgets" (
					"id" TEXT NOT NULL,
					"dashboard_id" TEXT NOT NULL,
					"title" TEXT NOT NULL,
					"type" TEXT NOT NULL,
					"queryPrompt" TEXT NOT NULL,
					"sqlQuery" TEXT,
					"cachedData" JSONB,
					"col_span" INTEGER NOT NULL DEFAULT 1,
					"row_span" INTEGER NOT NULL DEFAULT 1,
					"order" INTEGER NOT NULL DEFAULT 0,
					"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					CONSTRAINT "dashboard_widgets_pkey" PRIMARY KEY ("id")
				)
			`);
			await this.executeSingle(`CREATE INDEX IF NOT EXISTS "dashboard_widgets_dashboard_id_idx" ON "dashboard_widgets"("dashboard_id")`);

			// 8. chat_conversations
			await this.executeSingle(`
				CREATE TABLE IF NOT EXISTS "chat_conversations" (
					"id" TEXT NOT NULL,
					"user_id" TEXT NOT NULL,
					"title" TEXT NOT NULL DEFAULT 'Nova Conversa',
					"summary" TEXT,
					"compacted_up_to_id" TEXT,
					"is_pinned" BOOLEAN NOT NULL DEFAULT false,
					"message_count" INTEGER NOT NULL DEFAULT 0,
					"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
				)
			`);
			await this.executeSingle(`CREATE INDEX IF NOT EXISTS "chat_conversations_user_id_updated_at_idx" ON "chat_conversations"("user_id", "updated_at")`);

			// 9. chat_messages
			await this.executeSingle(`
				CREATE TABLE IF NOT EXISTS "chat_messages" (
					"id" TEXT NOT NULL,
					"conversation_id" TEXT NOT NULL,
					"role" TEXT NOT NULL,
					"content" TEXT NOT NULL,
					"is_compacted" BOOLEAN NOT NULL DEFAULT false,
					"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
				)
			`);
			await this.executeSingle(`CREATE INDEX IF NOT EXISTS "chat_messages_conversation_id_created_at_idx" ON "chat_messages"("conversation_id", "created_at")`);

			// 10. user_memories
			await this.executeSingle(`
				CREATE TABLE IF NOT EXISTS "user_memories" (
					"id" TEXT NOT NULL,
					"user_id" TEXT NOT NULL,
					"category" TEXT NOT NULL DEFAULT 'PREFERENCIA_GERAL',
					"fact" TEXT NOT NULL,
					"source" TEXT NOT NULL DEFAULT 'AUTO',
					"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					CONSTRAINT "user_memories_pkey" PRIMARY KEY ("id")
				)
			`);
			await this.executeSingle(`CREATE INDEX IF NOT EXISTS "user_memories_user_id_idx" ON "user_memories"("user_id")`);

			// 11. chat_feedbacks
			await this.executeSingle(`
				CREATE TABLE IF NOT EXISTS "chat_feedbacks" (
					"id" TEXT NOT NULL,
					"user_id" TEXT NOT NULL,
					"conversation_id" TEXT,
					"message_id" TEXT,
					"rating" TEXT NOT NULL,
					"tags" JSONB,
					"comment" TEXT,
					"user_prompt" TEXT NOT NULL,
					"assistant_response" TEXT NOT NULL,
					"context_summary" TEXT,
					"generated_sql" TEXT,
					"full_conversation" JSONB,
					"status" TEXT NOT NULL DEFAULT 'PENDING',
					"resolved_at" TIMESTAMP(3),
					"resolved_by" TEXT,
					"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
					CONSTRAINT "chat_feedbacks_pkey" PRIMARY KEY ("id")
				)
			`);
			await this.executeSingle(`CREATE INDEX IF NOT EXISTS "chat_feedbacks_user_id_created_at_idx" ON "chat_feedbacks"("user_id", "created_at")`);
			await this.executeSingle(`CREATE INDEX IF NOT EXISTS "chat_feedbacks_rating_status_created_at_idx" ON "chat_feedbacks"("rating", "status", "created_at")`);

			// Foreign Keys relacionais protegidas com DO $$ BEGIN ... EXCEPTION
			await this.executeSingle(`
				DO $$
				BEGIN
					IF NOT EXISTS (
						SELECT 1 FROM pg_constraint WHERE conname = 'meta_columns_metaTableId_fkey'
					) THEN
						ALTER TABLE "meta_columns"
						ADD CONSTRAINT "meta_columns_metaTableId_fkey"
						FOREIGN KEY ("metaTableId") REFERENCES "meta_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
					END IF;

					IF NOT EXISTS (
						SELECT 1 FROM pg_constraint WHERE conname = 'user_dashboards_user_id_fkey'
					) THEN
						ALTER TABLE "user_dashboards"
						ADD CONSTRAINT "user_dashboards_user_id_fkey"
						FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
					END IF;

					IF NOT EXISTS (
						SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_widgets_dashboard_id_fkey'
					) THEN
						ALTER TABLE "dashboard_widgets"
						ADD CONSTRAINT "dashboard_widgets_dashboard_id_fkey"
						FOREIGN KEY ("dashboard_id") REFERENCES "user_dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
					END IF;

					IF NOT EXISTS (
						SELECT 1 FROM pg_constraint WHERE conname = 'chat_conversations_user_id_fkey'
					) THEN
						ALTER TABLE "chat_conversations"
						ADD CONSTRAINT "chat_conversations_user_id_fkey"
						FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
					END IF;

					IF NOT EXISTS (
						SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_conversation_id_fkey'
					) THEN
						ALTER TABLE "chat_messages"
						ADD CONSTRAINT "chat_messages_conversation_id_fkey"
						FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
					END IF;

					IF NOT EXISTS (
						SELECT 1 FROM pg_constraint WHERE conname = 'user_memories_user_id_fkey'
					) THEN
						ALTER TABLE "user_memories"
						ADD CONSTRAINT "user_memories_user_id_fkey"
						FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
					END IF;

					IF NOT EXISTS (
						SELECT 1 FROM pg_constraint WHERE conname = 'chat_feedbacks_user_id_fkey'
					) THEN
						ALTER TABLE "chat_feedbacks"
						ADD CONSTRAINT "chat_feedbacks_user_id_fkey"
						FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
					END IF;
				END $$;
			`);

			this.initialized = true;
			console.info(
				'[DatabaseBootstrap] Estrutura essencial do banco de dados (11 tabelas e índices) sincronizada com sucesso (tabelas dinâmicas erp_* mantidas 100% intactas).',
			);
		} catch (error) {
			console.warn('[DatabaseBootstrap] Aviso durante sincronização de esquema do banco:', error);
		}
	}
}

export const databaseBootstrapService = new DatabaseBootstrapService();
export default databaseBootstrapService;
