export interface GetContextForPromptDTO {
	tenantId: string;
	question: string;
	maxTables?: number; // Limite de tabelas para não exceder a janela de contexto do LLM (padrão: 5)
}

export interface PromptContextResult {
	formattedContext: string;
	matchedTablesCount: number;
	totalTablesCount: number;
	selectedTableNames: string[];
}
