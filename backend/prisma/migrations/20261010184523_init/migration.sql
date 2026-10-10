-- CreateTable
CREATE TABLE "ai_configurations" (
    "id" TEXT NOT NULL DEFAULT 'ai-config',
    "systemPrompt" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "topP" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "memorySize" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_configurations" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_tables" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_columns" (
    "id" TEXT NOT NULL,
    "metaTableId" TEXT NOT NULL,
    "columnName" TEXT NOT NULL,
    "dataType" TEXT NOT NULL DEFAULT 'TEXT',
    "description" TEXT NOT NULL,
    "isPrimaryKey" BOOLEAN NOT NULL DEFAULT false,
    "foreignKeyToTable" TEXT,
    "foreignKeyToColumn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "usuario_erp" TEXT NOT NULL,
    "cod_gerente_erp" TEXT NOT NULL,
    "tipo_acesso" TEXT NOT NULL DEFAULT 'GERENTE',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meta_tables_tenantId_idx" ON "meta_tables"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "meta_tables_tenantId_tableName_key" ON "meta_tables"("tenantId", "tableName");

-- CreateIndex
CREATE INDEX "meta_columns_metaTableId_idx" ON "meta_columns"("metaTableId");

-- CreateIndex
CREATE UNIQUE INDEX "meta_columns_metaTableId_columnName_key" ON "meta_columns"("metaTableId", "columnName");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- AddForeignKey
ALTER TABLE "meta_columns" ADD CONSTRAINT "meta_columns_metaTableId_fkey" FOREIGN KEY ("metaTableId") REFERENCES "meta_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
