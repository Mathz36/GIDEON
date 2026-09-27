export interface SaveColumnMetadataDTO {
	columnName: string;
	dataType?: string;
	description: string; // Obrigatório: semântica da coluna (ex: "Limite de crédito do cliente")
	isPrimaryKey?: boolean; // Flag indicando se esta coluna é a Chave Primária (PK) da tabela
	foreignKeyToTable?: string;
	foreignKeyToColumn?: string;
}

export interface SaveTableMetadataDTO {
	tenantId: string;
	tableName: string;
	description: string; // Obrigatório: semântica da tabela (ex: "Cadastro geral de clientes e limites")
	columns: SaveColumnMetadataDTO[]; // Obrigatório: exatamente uma coluna com isPrimaryKey: true
}
