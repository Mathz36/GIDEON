export interface MetaColumnProps {
	id?: string;
	metaTableId?: string;
	columnName: string;
	dataType?: string;
	description: string;
	isPrimaryKey?: boolean;
	foreignKeyToTable?: string | null;
	foreignKeyToColumn?: string | null;
	createdAt?: Date;
	updatedAt?: Date;
}

export class MetaColumnEntity {
	private readonly _id?: string;
	private _metaTableId?: string;
	private readonly _columnName: string;
	private readonly _dataType: string;
	private _description: string;
	private _isPrimaryKey: boolean;
	private _foreignKeyToTable?: string | null;
	private _foreignKeyToColumn?: string | null;
	private readonly _createdAt?: Date;
	private _updatedAt?: Date;

	constructor(props: MetaColumnProps) {
		MetaColumnEntity.validate(props);

		this._id = props.id;
		this._metaTableId = props.metaTableId;
		this._columnName = props.columnName.trim().toLowerCase();
		this._dataType = (props.dataType ?? 'TEXT').trim().toUpperCase();
		this._description = props.description.trim();
		this._isPrimaryKey = Boolean(props.isPrimaryKey);
		this._foreignKeyToTable = props.foreignKeyToTable ? props.foreignKeyToTable.trim().toLowerCase() : null;
		this._foreignKeyToColumn = props.foreignKeyToColumn ? props.foreignKeyToColumn.trim().toLowerCase() : null;
		this._createdAt = props.createdAt;
		this._updatedAt = props.updatedAt;
	}

	private static validate(props: MetaColumnProps): void {
		if (!props.columnName || !props.columnName.trim()) {
			throw new Error('O nome da coluna (columnName) é obrigatório.');
		}

		if (!props.description || !props.description.trim()) {
			throw new Error(`A descrição semântica da coluna "${props.columnName}" é obrigatória para a compreensão da IA.`);
		}
	}

	get id(): string | undefined {
		return this._id;
	}

	get metaTableId(): string | undefined {
		return this._metaTableId;
	}

	set metaTableId(id: string | undefined) {
		this._metaTableId = id;
	}

	get columnName(): string {
		return this._columnName;
	}

	get dataType(): string {
		return this._dataType;
	}

	get description(): string {
		return this._description;
	}

	updateDescription(newDescription: string): void {
		if (!newDescription || !newDescription.trim()) {
			throw new Error('A descrição da coluna não pode ser vazia.');
		}
		this._description = newDescription.trim();
		this._updatedAt = new Date();
	}

	get isPrimaryKey(): boolean {
		return this._isPrimaryKey;
	}

	setPrimaryKey(isPk: boolean): void {
		this._isPrimaryKey = isPk;
		this._updatedAt = new Date();
	}

	get foreignKeyToTable(): string | null | undefined {
		return this._foreignKeyToTable;
	}

	get foreignKeyToColumn(): string | null | undefined {
		return this._foreignKeyToColumn;
	}

	setForeignKey(table: string | null, column: string | null): void {
		this._foreignKeyToTable = table ? table.trim().toLowerCase() : null;
		this._foreignKeyToColumn = column ? column.trim().toUpperCase() : null;
		this._updatedAt = new Date();
	}

	hasForeignKey(): boolean {
		return Boolean(this._foreignKeyToTable && this._foreignKeyToColumn);
	}

	get createdAt(): Date | undefined {
		return this._createdAt;
	}

	get updatedAt(): Date | undefined {
		return this._updatedAt;
	}

	toJSON(): MetaColumnProps {
		return {
			id: this._id,
			metaTableId: this._metaTableId,
			columnName: this._columnName,
			dataType: this._dataType,
			description: this._description,
			isPrimaryKey: this._isPrimaryKey,
			foreignKeyToTable: this._foreignKeyToTable,
			foreignKeyToColumn: this._foreignKeyToColumn,
			createdAt: this._createdAt,
			updatedAt: this._updatedAt,
		};
	}
}
