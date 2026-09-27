import { MetaColumnEntity, MetaColumnProps } from './meta-column.entity';

export interface MetaTableProps {
	id?: string;
	tenantId: string;
	tableName: string;
	description: string;
	columns?: (MetaColumnEntity | MetaColumnProps)[];
	createdAt?: Date;
	updatedAt?: Date;
}

export class MetaTableEntity {
	private readonly _id?: string;
	private readonly _tenantId: string;
	private readonly _tableName: string;
	private _description: string;
	private _columns: MetaColumnEntity[];
	private readonly _createdAt?: Date;
	private _updatedAt?: Date;

	constructor(props: MetaTableProps) {
		MetaTableEntity.validate(props);

		this._id = props.id;
		this._tenantId = props.tenantId.trim();
		this._tableName = props.tableName.trim().toLowerCase();
		this._description = props.description.trim();
		this._createdAt = props.createdAt;
		this._updatedAt = props.updatedAt;

		this._columns = (props.columns ?? []).map((col) => {
			if (col instanceof MetaColumnEntity) {
				return col;
			}
			return new MetaColumnEntity({
				...col,
				metaTableId: this._id,
			});
		});
	}

	private static validate(props: MetaTableProps): void {
		if (!props.tenantId || !props.tenantId.trim()) {
			throw new Error('O tenantId é obrigatório para isolamento multitenant.');
		}

		if (!props.tableName || !props.tableName.trim()) {
			throw new Error('O nome físico da tabela (tableName) é obrigatório.');
		}

		if (!props.description || !props.description.trim()) {
			throw new Error(`A descrição semântica da tabela "${props.tableName}" é obrigatória para a IA entender seu propósito.`);
		}
	}

	get id(): string | undefined {
		return this._id;
	}

	get tenantId(): string {
		return this._tenantId;
	}

	get tableName(): string {
		return this._tableName;
	}

	get description(): string {
		return this._description;
	}

	updateDescription(newDescription: string): void {
		if (!newDescription || !newDescription.trim()) {
			throw new Error('A descrição da tabela não pode ser vazia.');
		}
		this._description = newDescription.trim();
		this._updatedAt = new Date();
	}

	get columns(): MetaColumnEntity[] {
		return [...this._columns];
	}

	setColumns(columns: (MetaColumnEntity | MetaColumnProps)[]): void {
		this._columns = columns.map((col) => {
			if (col instanceof MetaColumnEntity) {
				col.metaTableId = this._id;
				return col;
			}
			return new MetaColumnEntity({
				...col,
				metaTableId: this._id,
			});
		});
		this._updatedAt = new Date();
	}

	addColumn(column: MetaColumnEntity | MetaColumnProps): void {
		const newCol = column instanceof MetaColumnEntity ? column : new MetaColumnEntity(column);
		const existingIndex = this._columns.findIndex(
			(c) => c.columnName.toUpperCase() === newCol.columnName.toUpperCase(),
		);

		if (existingIndex >= 0) {
			this._columns[existingIndex] = newCol;
		} else {
			this._columns.push(newCol);
		}
		this._updatedAt = new Date();
	}

	removeColumn(columnName: string): boolean {
		const initialLength = this._columns.length;
		this._columns = this._columns.filter(
			(c) => c.columnName.toUpperCase() !== columnName.trim().toUpperCase(),
		);
		const removed = this._columns.length !== initialLength;
		if (removed) {
			this._updatedAt = new Date();
		}
		return removed;
	}

	findColumn(columnName: string): MetaColumnEntity | undefined {
		return this._columns.find((c) => c.columnName.toUpperCase() === columnName.trim().toUpperCase());
	}

	getPrimaryKeyColumn(): MetaColumnEntity | undefined {
		return this._columns.find((c) => c.isPrimaryKey);
	}

	validatePrimaryKeyConstraint(): void {
		const pkColumns = this._columns.filter((c) => c.isPrimaryKey);
		if (pkColumns.length === 0) {
			throw new Error(
				`Regra de Negócio Violada: A tabela "${this._tableName}" deve conter exatamente uma coluna definida como Chave Primária (PK).`,
			);
		}
		if (pkColumns.length > 1) {
			const names = pkColumns.map((c) => c.columnName).join(', ');
			throw new Error(
				`Regra de Negócio Violada: A tabela "${this._tableName}" deve conter apenas uma PK única. Foram encontradas múltiplas PKs: [${names}].`,
			);
		}
	}

	/**
	 * Gera a representação simplificada em DDL destacando explicitamente a Chave Primária (PK)
	 * e os relacionamentos para que o LLM formule queries precisas.
	 */
	toSimplifiedDDL(): string {
		const pkColumn = this.getPrimaryKeyColumn();
		const lines: string[] = [];

		lines.push(`-- Tabela: ${this._tableName}`);
		lines.push(`-- Descrição de Negócio: ${this._description}`);
		if (pkColumn) {
			lines.push(`-- Chave Primária (PK): "${pkColumn.columnName}"`);
		}
		lines.push(`CREATE TABLE "${this._tableName}" (`);

		const columnDefs = this._columns.map((col) => {
			const isPk = col.isPrimaryKey;
			const pkSuffix = isPk ? ' PRIMARY KEY' : '';
			let def = `  "${col.columnName}" ${col.dataType}${pkSuffix}`;

			const notes: string[] = [];
			if (isPk) {
				notes.push('[CHAVE PRIMÁRIA / PK]');
			}
			notes.push(`significa: "${col.description}"`);

			if (col.hasForeignKey()) {
				notes.push(`FK -> "${col.foreignKeyToTable}"("${col.foreignKeyToColumn}")`);
			}

			return `${def}, -- ${notes.join(' | ')}`;
		});

		lines.push(columnDefs.join('\n'));
		lines.push(');');
		return lines.join('\n');
	}

	get createdAt(): Date | undefined {
		return this._createdAt;
	}

	get updatedAt(): Date | undefined {
		return this._updatedAt;
	}

	toJSON(): MetaTableProps {
		return {
			id: this._id,
			tenantId: this._tenantId,
			tableName: this._tableName,
			description: this._description,
			columns: this._columns.map((c) => c.toJSON()),
			createdAt: this._createdAt,
			updatedAt: this._updatedAt,
		};
	}
}
