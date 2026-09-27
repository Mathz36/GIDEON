import { MetaTableEntity } from '../../domain/entities/meta-table.entity';
import { MetaColumnEntity } from '../../domain/entities/meta-column.entity';
import { IMetaTableRepository } from '../../domain/repositories/meta-table.repository.interface';
import { SaveTableMetadataDTO } from '../dtos/save-table-metadata.dto';

export class SaveTableMetadataUseCase {
	constructor(private readonly repository: IMetaTableRepository) {}

	async execute(dto: SaveTableMetadataDTO): Promise<MetaTableEntity> {
		this.validateInput(dto);

		const existing = await this.repository.findByTenantAndTableName(dto.tenantId, dto.tableName);

		const columns = dto.columns.map(
			(col) =>
				new MetaColumnEntity({
					columnName: col.columnName,
					dataType: col.dataType ?? 'TEXT',
					description: col.description,
					isPrimaryKey: Boolean(col.isPrimaryKey),
					foreignKeyToTable: col.foreignKeyToTable,
					foreignKeyToColumn: col.foreignKeyToColumn,
				}),
		);

		let metaTable: MetaTableEntity;

		if (existing) {
			existing.updateDescription(dto.description);
			existing.setColumns(columns);
			metaTable = existing;
		} else {
			metaTable = new MetaTableEntity({
				tenantId: dto.tenantId,
				tableName: dto.tableName,
				description: dto.description,
				columns,
			});
		}

		// Valida integridade da Chave Primária na entidade de domínio
		metaTable.validatePrimaryKeyConstraint();

		return this.repository.save(metaTable);
	}

	private validateInput(dto: SaveTableMetadataDTO): void {
		if (!dto.tenantId || !dto.tenantId.trim()) {
			throw new Error('O tenantId é obrigatório para persistência de metadados.');
		}

		if (!dto.tableName || !dto.tableName.trim()) {
			throw new Error('O nome da tabela (tableName) é obrigatório.');
		}

		if (!dto.description || !dto.description.trim()) {
			throw new Error(
				`A descrição da tabela "${dto.tableName}" é obrigatória para que a IA compreenda o propósito da tabela.`,
			);
		}

		if (!Array.isArray(dto.columns) || dto.columns.length === 0) {
			throw new Error(`A tabela "${dto.tableName}" deve conter ao menos uma coluna de metadados.`);
		}

		// Validação semântica e estrutural das colunas
		for (const [index, col] of dto.columns.entries()) {
			if (!col.columnName || !col.columnName.trim()) {
				throw new Error(`A coluna no índice ${index} deve possuir um nome válido (columnName).`);
			}

			if (!col.description || !col.description.trim()) {
				throw new Error(
					`A coluna "${col.columnName}" requer uma descrição semântica obrigatória para guiar a IA (ex: "Limite de crédito do cliente").`,
				);
			}
		}

		// Requisito Crítico: Exatamente uma coluna deve ser definida como PK (isPrimaryKey = true)
		const pkColumns = dto.columns.filter((c) => Boolean(c.isPrimaryKey));

		if (pkColumns.length === 0) {
			throw new Error(
				`Requisito Crítico: A criação da tabela "${dto.tableName}" foi bloqueada. É obrigatório definir exatamente uma coluna como Chave Primária (isPrimaryKey: true).`,
			);
		}

		if (pkColumns.length > 1) {
			const pkNames = pkColumns.map((c) => `"${c.columnName}"`).join(', ');
			throw new Error(
				`Requisito Crítico: A tabela "${dto.tableName}" não pode conter múltiplas Chaves Primárias. Foram informadas ${pkColumns.length} colunas com PK: [${pkNames}].`,
			);
		}
	}
}
