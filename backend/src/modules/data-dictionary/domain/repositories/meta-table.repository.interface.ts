import { MetaTableEntity } from '../entities/meta-table.entity';

export interface IMetaTableRepository {
	/**
	 * Salva ou atualiza os metadados de uma tabela e suas colunas (upsert em transação).
	 */
	save(metaTable: MetaTableEntity): Promise<MetaTableEntity>;

	/**
	 * Busca os metadados de uma tabela específica de um tenant.
	 */
	findByTenantAndTableName(tenantId: string, tableName: string): Promise<MetaTableEntity | null>;

	/**
	 * Retorna várias tabelas por seus nomes físicos para um tenant.
	 */
	findByTableNames(tenantId: string, tableNames: string[]): Promise<MetaTableEntity[]>;

	/**
	 * Retorna todas as tabelas e colunas de metadados cadastradas para o tenant.
	 */
	findAllByTenant(tenantId: string): Promise<MetaTableEntity[]>;

	/**
	 * Busca semântica e textual no banco usando ILIKE / contains em tabelas e colunas.
	 */
	searchByKeywords(tenantId: string, keywords: string[]): Promise<MetaTableEntity[]>;

	/**
	 * Busca tabelas que possuem Chave Estrangeira apontando para alguma das tabelas informadas.
	 */
	findReferencingTables(tenantId: string, targetTableNames: string[]): Promise<MetaTableEntity[]>;

	/**
	 * Remove os metadados de uma tabela (com cascade nas colunas).
	 */
	delete(tenantId: string, tableName: string): Promise<boolean>;
}
