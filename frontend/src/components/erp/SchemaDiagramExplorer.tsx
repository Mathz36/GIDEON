import { useEffect, useMemo, useState } from 'react';
import {
	AlertCircle,
	ArrowRight,
	CheckCircle2,
	Database,
	Edit3,
	GitBranch,
	Info,
	KeyRound,
	Link2,
	RefreshCw,
	Save,
	Sparkles,
	Table as TableIcon,
	X,
} from 'lucide-react';

export interface SchemaColumnItem {
	columnName: string;
	dataType: string;
	description: string;
	isPrimaryKey: boolean;
	foreignKeyToTable: string | null;
	foreignKeyToColumn: string | null;
	isGenericDescription: boolean;
	sampleValues: string[];
}

export interface SchemaTableItem {
	id: string;
	erpConfigId: string | null;
	tableName: string;
	context: string;
	description: string;
	primaryKey: string | null;
	rowCount: number;
	lastSyncAt: string | null;
	lastSyncStatus: string | null;
	columns: SchemaColumnItem[];
}

export interface SchemaRelationshipItem {
	fromTable: string;
	fromColumn: string;
	toTable: string;
	toColumn: string;
}

interface SchemaDiagramExplorerProps {
	token: string | null;
}

export default function SchemaDiagramExplorer({ token }: SchemaDiagramExplorerProps) {
	const [tables, setTables] = useState<SchemaTableItem[]>([]);
	const [relationships, setRelationships] = useState<SchemaRelationshipItem[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isDetectingFks, setIsDetectingFks] = useState(false);
	const [error, setError] = useState('');
	const [successMessage, setSuccessMessage] = useState('');

	// Tabela selecionada para inspeção/edição e tabela destacada no hover de relacionamentos
	const [selectedTableName, setSelectedTableName] = useState<string | null>(null);
	const [highlightedTables, setHighlightedTables] = useState<string[]>([]);

	// Estado de edição do Drawer
	const [editTableDescription, setEditTableDescription] = useState('');
	const [editColumns, setEditColumns] = useState<SchemaColumnItem[]>([]);
	const [isSavingSchema, setIsSavingSchema] = useState(false);

	const loadSchema = async () => {
		setIsLoading(true);
		setError('');
		try {
			const res = await fetch('/api/erp/schema', {
				headers: {
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
			});
			if (!res.ok) {
				throw new Error('Não foi possível carregar o esquema do banco e dicionário de dados.');
			}
			const json = (await res.json()) as {
				data?: { tables: SchemaTableItem[]; relationships: SchemaRelationshipItem[] };
			};
			setTables(json.data?.tables ?? []);
			setRelationships(json.data?.relationships ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao carregar esquema.');
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		void loadSchema();
	}, [token]);

	const selectedTable = useMemo(
		() => tables.find((t) => t.tableName === selectedTableName) ?? null,
		[tables, selectedTableName],
	);

	const openTableInspector = (table: SchemaTableItem) => {
		setSelectedTableName(table.tableName);
		setEditTableDescription(table.description);
		setEditColumns(table.columns.map((c) => ({ ...c })));
		setError('');
		setSuccessMessage('');

		// Destaca tabelas conectadas a esta
		const connected = new Set<string>([table.tableName]);
		for (const rel of relationships) {
			if (rel.fromTable === table.tableName) connected.add(rel.toTable);
			if (rel.toTable === table.tableName) connected.add(rel.fromTable);
		}
		setHighlightedTables(Array.from(connected));
	};

	const closeInspector = () => {
		setSelectedTableName(null);
		setHighlightedTables([]);
	};

	const handleAutoDetectFks = async () => {
		setIsDetectingFks(true);
		setError('');
		setSuccessMessage('');
		try {
			const res = await fetch('/api/erp/schema/auto-detect-fks', {
				method: 'POST',
				headers: {
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
			});
			if (!res.ok) {
				throw new Error('Falha ao detectar chaves estrangeiras.');
			}
			const json = (await res.json()) as {
				data?: { tables: SchemaTableItem[]; relationships: SchemaRelationshipItem[] };
				detection?: { detectedRelationships?: unknown[] };
			};
			if (json.data) {
				setTables(json.data.tables);
				setRelationships(json.data.relationships);
			}
			setSuccessMessage(
				`Mapeamento concluído! ${json.data?.relationships.length ?? 0} ligação(ões) entre tabelas ativas no grafo da Gideon.`,
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao detectar ligações.');
		} finally {
			setIsDetectingFks(false);
		}
	};

	const handleSetPrimaryKey = (colName: string) => {
		setEditColumns((prev) =>
			prev.map((c) => ({
				...c,
				isPrimaryKey: c.columnName === colName,
			})),
		);
	};

	const handleUpdateColumnDescription = (colName: string, newDesc: string) => {
		setEditColumns((prev) =>
			prev.map((c) =>
				c.columnName === colName
					? { ...c, description: newDesc, isGenericDescription: false }
					: c,
			),
		);
	};

	const handleInjectSampleValues = (colName: string, samples: string[]) => {
		if (samples.length === 0) return;
		const formattedSamples = `Valores existentes no banco: [${samples.map((s) => `'${s}'`).join(', ')}].`;
		setEditColumns((prev) =>
			prev.map((c) => {
				if (c.columnName !== colName) return c;
				const current = c.description.trim();
				if (current.includes(samples[0])) return c;
				return {
					...c,
					description: `${current} ${formattedSamples}`.trim(),
					isGenericDescription: false,
				};
			}),
		);
	};

	const handleUpdateForeignKey = (colName: string, targetValue: string) => {
		// targetValue no formato "tableName.columnName" ou ""
		let fkTable: string | null = null;
		let fkCol: string | null = null;
		if (targetValue && targetValue.includes('.')) {
			const [t, c] = targetValue.split('.');
			fkTable = t;
			fkCol = c;
		}
		setEditColumns((prev) =>
			prev.map((c) =>
				c.columnName === colName
					? { ...c, foreignKeyToTable: fkTable, foreignKeyToColumn: fkCol }
					: c,
			),
		);
	};

	const handleSaveTableSchema = async () => {
		if (!selectedTable) return;
		setError('');
		setSuccessMessage('');

		if (!editTableDescription.trim()) {
			setError('A descrição da tabela é obrigatória para que a Gideon compreenda seu objetivo.');
			return;
		}

		const emptyCol = editColumns.find((c) => !c.description || !c.description.trim());
		if (emptyCol) {
			setError(`A descrição da coluna "${emptyCol.columnName}" é obrigatória.`);
			return;
		}

		const pkCount = editColumns.filter((c) => c.isPrimaryKey).length;
		if (pkCount !== 1) {
			setError('Selecione exatamente uma coluna como Chave Primária (PK).');
			return;
		}

		setIsSavingSchema(true);
		try {
			const res = await fetch(`/api/erp/schema/${selectedTable.tableName}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({
					description: editTableDescription.trim(),
					columns: editColumns.map((c) => ({
						columnName: c.columnName,
						description: c.description.trim(),
						isPrimaryKey: c.isPrimaryKey,
						foreignKeyToTable: c.foreignKeyToTable,
						foreignKeyToColumn: c.foreignKeyToColumn,
					})),
				}),
			});

			const json = (await res.json()) as { data?: SchemaTableItem; error?: string };
			if (!res.ok) {
				throw new Error(json.error ?? 'Falha ao salvar dicionário da tabela.');
			}

			await loadSchema();
			setSuccessMessage(`Dicionário semântico da tabela "${selectedTable.tableName}" salvo com sucesso!`);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao salvar alterações.');
		} finally {
			setIsSavingSchema(false);
		}
	};

	// Opções de destino de FK para o seletor no Drawer
	const availableFkTargets = useMemo(() => {
		if (!selectedTable) return [];
		const targets: Array<{ label: string; value: string }> = [];
		for (const t of tables) {
			if (t.tableName === selectedTable.tableName) continue;
			for (const c of t.columns) {
				if (c.isPrimaryKey || c.columnName === 'NOTA_FISCAL' || c.columnName.includes('ID') || c.columnName.includes('COD')) {
					targets.push({
						value: `${t.tableName}.${c.columnName}`,
						label: `${t.tableName}.${c.columnName}${c.isPrimaryKey ? ' (PK)' : ''}`,
					});
				}
			}
		}
		return targets;
	}, [tables, selectedTable]);

	const stats = useMemo(() => {
		const totalTables = tables.length;
		const totalColumns = tables.reduce((acc, t) => acc + t.columns.length, 0);
		const documentedColumns = tables.reduce(
			(acc, t) => acc + t.columns.filter((c) => !c.isGenericDescription).length,
			0,
		);
		const totalRows = tables.reduce((acc, t) => acc + t.rowCount, 0);
		return { totalTables, totalColumns, documentedColumns, totalRows };
	}, [tables]);

	if (isLoading) {
		return (
			<div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-16 shadow-xs">
				<RefreshCw className="h-8 w-8 animate-spin text-indigo-600" />
				<p className="mt-3 text-sm font-medium text-slate-600">
					Mapeando tabelas PostgreSQL, chaves primárias, ligações e valores de domínio...
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Barra de Métricas do Esquema e Ações */}
			<div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:flex-row lg:items-center lg:justify-between">
				<div className="flex flex-wrap items-center gap-6">
					<div className="flex items-center gap-3">
						<div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
							<Database className="h-5 w-5" />
						</div>
						<div>
							<p className="text-xs font-medium text-slate-500">Tabelas no PostgreSQL</p>
							<p className="text-lg font-bold text-slate-900">
								{stats.totalTables} tabelas{' '}
								<span className="text-xs font-normal text-slate-500">
									({stats.totalRows.toLocaleString('pt-BR')} registros)
								</span>
							</p>
						</div>
					</div>

					<div className="h-8 w-px bg-slate-200 hidden sm:block" />

					<div className="flex items-center gap-3">
						<div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
							<Sparkles className="h-5 w-5" />
						</div>
						<div>
							<p className="text-xs font-medium text-slate-500">Dicionário Semântico IA</p>
							<p className="text-lg font-bold text-slate-900">
								{stats.documentedColumns}/{stats.totalColumns} colunas descritas
							</p>
						</div>
					</div>

					<div className="h-8 w-px bg-slate-200 hidden sm:block" />

					<div className="flex items-center gap-3">
						<div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
							<GitBranch className="h-5 w-5" />
						</div>
						<div>
							<p className="text-xs font-medium text-slate-500">Ligações entre Tabelas (JOINs)</p>
							<p className="text-lg font-bold text-slate-900">{relationships.length} conexões FKs</p>
						</div>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-2.5">
					<button
						type="button"
						onClick={handleAutoDetectFks}
						disabled={isDetectingFks}
						className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
					>
						<GitBranch className={`h-4 w-4 ${isDetectingFks ? 'animate-spin' : ''}`} />
						Auto-Detectar Ligações (FKs)
					</button>
					<button
						type="button"
						onClick={loadSchema}
						className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
					>
						<RefreshCw className="h-3.5 w-3.5" />
						Atualizar Mapa
					</button>
				</div>
			</div>

			{error && (
				<div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
					<AlertCircle className="h-4 w-4 shrink-0" />
					<span>{error}</span>
				</div>
			)}

			{successMessage && (
				<div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
					<CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
					<span>{successMessage}</span>
				</div>
			)}

			{/* Mapa de Relacionamentos (Ligações PK <-> FK entre tabelas) */}
			{relationships.length > 0 && (
				<div className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-4 text-white shadow-sm">
					<div className="mb-2.5 flex items-center justify-between">
						<div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-300">
							<Link2 className="h-4 w-4" />
							<span>Mapa de Ligações Relacionais Ativas (Grafo Text-to-SQL)</span>
						</div>
						<span className="text-[11px] text-slate-300">
							Passe o mouse sobre uma ligação ou clique em qualquer tabela abaixo para editar descrições
						</span>
					</div>
					<div className="flex flex-wrap gap-2">
						{relationships.map((rel, idx) => {
							const isHighlighted =
								highlightedTables.includes(rel.fromTable) && highlightedTables.includes(rel.toTable);
							return (
								<button
									key={idx}
									type="button"
									onMouseEnter={() => setHighlightedTables([rel.fromTable, rel.toTable])}
									onMouseLeave={() =>
										setHighlightedTables(selectedTableName ? [selectedTableName] : [])
									}
									onClick={() => {
										const t = tables.find((tbl) => tbl.tableName === rel.fromTable);
										if (t) openTableInspector(t);
									}}
									className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-xs transition ${
										isHighlighted
											? 'border-amber-400 bg-amber-400/20 text-amber-200 shadow-xs'
											: 'border-indigo-500/40 bg-white/10 text-slate-100 hover:border-indigo-400 hover:bg-white/15'
									}`}
								>
									<span className="font-bold text-indigo-300">{rel.fromTable}</span>
									<span className="text-slate-400">.</span>
									<span className="text-amber-300">{rel.fromColumn}</span>
									<ArrowRight className="h-3 w-3 text-emerald-400 mx-0.5" />
									<span className="font-bold text-emerald-300">{rel.toTable}</span>
									<span className="text-slate-400">.</span>
									<span className="text-amber-300">{rel.toColumn}</span>
								</button>
							);
						})}
					</div>
				</div>
			)}

			{/* Grid Principal: Diagrama de Entidades (Cards de Tabelas) + Painel Inspetor Lateral */}
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
				<div className={`${selectedTable ? 'lg:col-span-7' : 'lg:col-span-12'} grid grid-cols-1 gap-5 md:grid-cols-2 ${selectedTable ? '' : 'xl:grid-cols-3'}`}>
					{tables.map((table) => {
						const isSelected = selectedTableName === table.tableName;
						const isHighlighted = highlightedTables.includes(table.tableName);
						const outgoingLinks = relationships.filter((r) => r.fromTable === table.tableName);
						const incomingLinks = relationships.filter((r) => r.toTable === table.tableName);

						return (
							<div
								key={table.tableName}
								onClick={() => openTableInspector(table)}
								className={`group cursor-pointer overflow-hidden rounded-2xl border bg-white transition-all ${
									isSelected
										? 'border-indigo-600 ring-2 ring-indigo-500/30 shadow-lg'
										: isHighlighted
											? 'border-amber-400 ring-2 ring-amber-300/40 shadow-md'
											: 'border-slate-200/90 shadow-xs hover:border-indigo-300 hover:shadow-md'
								}`}
							>
								{/* Cabeçalho do Bloco da Tabela no Diagrama */}
								<div className="border-b border-slate-100 bg-slate-900 px-4 py-3 text-white">
									<div className="flex items-center justify-between gap-2">
										<div className="flex items-center gap-2 min-w-0">
											<TableIcon className="h-4 w-4 shrink-0 text-indigo-400" />
											<h3 className="truncate font-mono text-sm font-bold text-white">
												{table.tableName}
											</h3>
										</div>
										<span className="shrink-0 rounded-md bg-indigo-500/20 border border-indigo-400/30 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-200">
											{table.context}
										</span>
									</div>
									<p className="mt-1.5 line-clamp-2 text-[11px] text-slate-300">
										{table.description}
									</p>
									<div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
										<span>{table.rowCount.toLocaleString('pt-BR')} registros</span>
										<span>
											{table.columns.length} colunas • {outgoingLinks.length + incomingLinks.length} ligações
										</span>
									</div>
								</div>

								{/* Lista de Colunas da Tabela (PK, FKs, Descrições e Chips de Domínio) */}
								<div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
									{table.columns.map((col) => (
										<div
											key={col.columnName}
											className={`px-3.5 py-2 text-xs transition ${
												col.isPrimaryKey
													? 'bg-amber-50/50'
													: col.foreignKeyToTable
														? 'bg-indigo-50/30'
														: 'hover:bg-slate-50'
											}`}
										>
											<div className="flex items-center justify-between gap-2">
												<div className="flex items-center gap-1.5 min-w-0">
													{col.isPrimaryKey && (
														<span
															title="Chave Primária (PK)"
															className="inline-flex items-center gap-0.5 rounded bg-amber-500 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white"
														>
															<KeyRound className="h-2.5 w-2.5" />
															PK
														</span>
													)}
													{col.foreignKeyToTable && (
														<span
															title={`Chave Estrangeira -> ${col.foreignKeyToTable}.${col.foreignKeyToColumn}`}
															className="inline-flex items-center gap-0.5 rounded bg-indigo-600 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white"
														>
															<Link2 className="h-2.5 w-2.5" />
															FK
														</span>
													)}
													<span className="truncate font-mono font-semibold text-slate-800">
														{col.columnName}
													</span>
												</div>

												{col.foreignKeyToTable ? (
													<span className="shrink-0 font-mono text-[10px] font-medium text-indigo-600">
														➔ {col.foreignKeyToTable}
													</span>
												) : (
													<span className="shrink-0 font-mono text-[10px] text-slate-400">
														{col.dataType}
													</span>
												)}
											</div>

											<p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">
												{col.description}
											</p>

											{col.sampleValues.length > 0 && (
												<div className="mt-1 flex flex-wrap gap-1">
													{col.sampleValues.slice(0, 4).map((val) => (
														<span
															key={val}
															className="rounded bg-emerald-50 border border-emerald-200/80 px-1.5 py-0.2 font-mono text-[9px] font-medium text-emerald-800"
														>
															'{val}'
														</span>
													))}
													{col.sampleValues.length > 4 && (
														<span className="text-[9px] text-slate-400">
															+{col.sampleValues.length - 4}
														</span>
													)}
												</div>
											)}
										</div>
									))}
								</div>

								{/* Rodapé do Card */}
								<div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/80 px-4 py-2 text-[11px] font-semibold text-indigo-600 group-hover:bg-indigo-50/60">
									<span className="inline-flex items-center gap-1">
										<Edit3 className="h-3.5 w-3.5" />
										Clicar para inspecionar e editar descrições
									</span>
									<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
								</div>
							</div>
						);
					})}
				</div>

				{/* Painel Inspetor e Editor do Dicionário de Dados da Tabela Selecionada */}
				{selectedTable && (
					<div className="lg:col-span-5">
						<div className="sticky top-6 rounded-2xl border border-indigo-200 bg-white shadow-xl overflow-hidden">
							<div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-5 py-4 text-white">
								<div>
									<div className="flex items-center gap-2">
										<TableIcon className="h-4 w-4 text-indigo-400" />
										<h3 className="font-mono text-base font-bold">{selectedTable.tableName}</h3>
										<span className="rounded bg-indigo-500/30 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-200">
											{selectedTable.context}
										</span>
									</div>
									<p className="mt-0.5 text-xs text-slate-300">
										Edite as descrições semânticas da tabela e de cada coluna para guiar a Gideon.
									</p>
								</div>
								<button
									type="button"
									onClick={closeInspector}
									className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
								>
									<X className="h-5 w-5" />
								</button>
							</div>

							<div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
								{/* Descrição da Tabela */}
								<div>
									<label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
										Descrição Semântica da Tabela (Obrigatória) *
									</label>
									<p className="text-[11px] text-slate-500 mb-1.5">
										Explique o que esta tabela representa no negócio e quando a Gideon deve consultá-la.
									</p>
									<textarea
										rows={2}
										value={editTableDescription}
										onChange={(e) => setEditTableDescription(e.target.value)}
										className="block w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
										placeholder="Ex: Cabeçalho de Notas Fiscais emitidas contendo vendas, bonificações e devoluções..."
									/>
								</div>

								{/* Colunas e Descrições */}
								<div className="space-y-3">
									<div className="flex items-center justify-between border-b border-slate-200 pb-2">
										<span className="text-xs font-bold uppercase tracking-wider text-slate-700">
											Campos da Tabela ({editColumns.length} colunas)
										</span>
										<span className="text-[11px] text-slate-500">
											Toda coluna deve ter descrição clara
										</span>
									</div>

									{editColumns.map((col) => (
										<div
											key={col.columnName}
											className={`rounded-xl border p-3.5 space-y-2.5 transition ${
												col.isPrimaryKey
													? 'border-amber-300 bg-amber-50/40'
													: 'border-slate-200 bg-slate-50/60'
											}`}
										>
											<div className="flex flex-wrap items-center justify-between gap-2">
												<div className="flex items-center gap-2">
													<span className="font-mono text-xs font-bold text-slate-900">
														{col.columnName}
													</span>
													<button
														type="button"
														onClick={() => handleSetPrimaryKey(col.columnName)}
														className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold transition ${
															col.isPrimaryKey
																? 'bg-amber-500 text-white shadow-xs'
																: 'bg-slate-200 text-slate-600 hover:bg-amber-100 hover:text-amber-800'
														}`}
													>
														<KeyRound className="h-3 w-3" />
														{col.isPrimaryKey ? 'Chave Primária (PK)' : 'Definir PK'}
													</button>
												</div>

												{/* Seletor de Ligação FK */}
												{!col.isPrimaryKey && (
													<div className="flex items-center gap-1.5">
														<Link2 className="h-3.5 w-3.5 text-indigo-600" />
														<select
															value={
																col.foreignKeyToTable && col.foreignKeyToColumn
																	? `${col.foreignKeyToTable}.${col.foreignKeyToColumn}`
																	: ''
															}
															onChange={(e) =>
																handleUpdateForeignKey(col.columnName, e.target.value)
															}
															className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-mono text-[10px] text-slate-700 outline-none focus:border-indigo-500"
														>
															<option value="">Sem ligação FK</option>
															{availableFkTargets.map((t) => (
																<option key={t.value} value={t.value}>
																	FK ➔ {t.label}
																</option>
															))}
														</select>
													</div>
												)}
											</div>

											{/* Valores reais detectados no banco (Auto-Profiler) */}
											{col.sampleValues.length > 0 && (
												<div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-2">
													<div className="flex items-center justify-between gap-2 mb-1">
														<span className="text-[10px] font-semibold text-emerald-900 flex items-center gap-1">
															<Info className="h-3 w-3 text-emerald-600" />
															Valores reais encontrados no PostgreSQL:
														</span>
														<button
															type="button"
															onClick={() =>
																handleInjectSampleValues(col.columnName, col.sampleValues)
															}
															className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 underline"
														>
															+ Incluir valores na descrição
														</button>
													</div>
													<div className="flex flex-wrap gap-1">
														{col.sampleValues.map((val) => (
															<span
																key={val}
																className="rounded bg-white border border-emerald-300 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-900"
															>
																'{val}'
															</span>
														))}
													</div>
												</div>
											)}

											{/* Input de Descrição Semântica da Coluna */}
											<div>
												<label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
													Descrição do Campo para a Gideon *
												</label>
												<textarea
													rows={2}
													required
													value={col.description}
													onChange={(e) =>
														handleUpdateColumnDescription(col.columnName, e.target.value)
													}
													placeholder={`Descreva o significado de ${col.columnName} e regras de negócio...`}
													className="block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
												/>
											</div>
										</div>
									))}
								</div>
							</div>

							<div className="flex items-center justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
								<button
									type="button"
									onClick={closeInspector}
									className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
								>
									Fechar
								</button>
								<button
									type="button"
									onClick={handleSaveTableSchema}
									disabled={isSavingSchema}
									className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50"
								>
									{isSavingSchema ? (
										<RefreshCw className="h-3.5 w-3.5 animate-spin" />
									) : (
										<Save className="h-3.5 w-3.5" />
									)}
									Salvar Dicionário da Tabela
								</button>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
