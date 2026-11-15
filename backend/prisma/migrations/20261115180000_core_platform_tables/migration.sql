-- CreateTable: user_dashboards
CREATE TABLE IF NOT EXISTS "user_dashboards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Meu Dashboard',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable: dashboard_widgets
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
);

-- CreateTable: chat_conversations
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
);

-- CreateTable: chat_messages
CREATE TABLE IF NOT EXISTS "chat_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_compacted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable: user_memories
CREATE TABLE IF NOT EXISTS "user_memories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'PREFERENCIA_GERAL',
    "fact" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'AUTO',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable: chat_feedbacks
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
);

-- CreateIndexes
CREATE INDEX IF NOT EXISTS "user_dashboards_user_id_idx" ON "user_dashboards"("user_id");
CREATE INDEX IF NOT EXISTS "dashboard_widgets_dashboard_id_idx" ON "dashboard_widgets"("dashboard_id");
CREATE INDEX IF NOT EXISTS "chat_conversations_user_id_updated_at_idx" ON "chat_conversations"("user_id", "updated_at");
CREATE INDEX IF NOT EXISTS "chat_messages_conversation_id_created_at_idx" ON "chat_messages"("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "user_memories_user_id_idx" ON "user_memories"("user_id");
CREATE INDEX IF NOT EXISTS "chat_feedbacks_user_id_created_at_idx" ON "chat_feedbacks"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "chat_feedbacks_rating_status_created_at_idx" ON "chat_feedbacks"("rating", "status", "created_at");

-- AddForeignKey constraints safely
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_dashboards_user_id_fkey') THEN
        ALTER TABLE "user_dashboards" ADD CONSTRAINT "user_dashboards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_widgets_dashboard_id_fkey') THEN
        ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "user_dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_conversations_user_id_fkey') THEN
        ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_conversation_id_fkey') THEN
        ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_memories_user_id_fkey') THEN
        ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_feedbacks_user_id_fkey') THEN
        ALTER TABLE "chat_feedbacks" ADD CONSTRAINT "chat_feedbacks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
