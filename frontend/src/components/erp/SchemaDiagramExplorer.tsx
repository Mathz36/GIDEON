import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from 'react';
import {
	AlertCircle,
	ArrowRight,
	CheckCircle2,
	CircleDot,
	Database,
	Edit3,
	GitBranch,
	Info,
	KeyRound,
	Link2,
	Maximize2,
	Minimize2,
	Plus,
	RefreshCw,
	RotateCcw,
	Save,
	Search,
	Sparkles,
	Table as TableIcon,
	X,
	ZoomIn,
	ZoomOut,
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

interface NodePosition {
	x: number;
	y: number;
}

const NODE_WIDTH = 270;
const HEADER_HEIGHT = 46;
const ROW_HEIGHT = 28;
const STORAGE_KEY = 'gideon_supabase_schema_positions_v1';

/**
 * Gera posições automáticas harmoniosas em camadas para as tabelas
 */
function computeDefaultPositions(tables: SchemaTableItem[]): Record<string, NodePosition> {
	const positions: Record<string, NodePosition> = {};
	const priorities: Record<string, { col: number; row: number }> = {
		erp_clientes: { col: 0, row: 0 },
		erp_vendedores: { col: 0, row: 1 },
		erp_produtos: { col: 0, row: 2 },
		erp_clientes_vendedores: { col: 1, row: 0 },
		erp_nota_fiscal: { col: 1, row: 1 },
		erp_nota_fiscal_prod: { col: 2, row: 0 },
	};

	let genericCol = 0;
	let genericRow = 3;

	for (const table of tables) {
		const tName = table.tableName.toLowerCase();
		if (priorities[tName]) {
			const { col, row } = priorities[tName];
			positions[tName] = {
				x: 80 + col * 360,
				y: 60 + row * 280,
			};
		} else {
			positions[tName] = {
				x: 80 + genericCol * 360,
				y: 60 + genericRow * 280,
			};
			genericCol++;
			if (genericCol > 2) {
				genericCol = 0;
				genericRow++;
			}
		}
	}

	return positions;
}

export default function SchemaDiagramExplorer({ token }: SchemaDiagramExplorerProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [tables, setTables] = useState<SchemaTableItem[]>([]);
	const [relationships, setRelationships] = useState<SchemaRelationshipItem[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isDetectingFks, setIsDetectingFks] = useState(false);
	const [error, setError] = useState('');
	const [successMessage, setSuccessMessage] = useState('');

	// Câmera do Canvas (pan & zoom)
	const [camera, setCamera] = useState<{ x: number; y: number; zoom: number }>({
		x: 40,
		y: 40,
		zoom: 0.9,
	});

	// Posições dos nós das tabelas
	const [positions, setPositions] = useState<Record<string, NodePosition>>({});

	// Estados de interação do Canvas
	const [isPanning, setIsPanning] = useState(false);
	const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
	const [draggingNode, setDraggingNode] = useState<{ tableName: string; offsetX: number; offsetY: number } | null>(null);

	// Filtros, Busca & Destaques
	const [searchQuery, setSearchQuery] = useState('');
	const [hoveredTable, setHoveredTable] = useState<string | null>(null);
	const [hoveredRelationship, setHoveredRelationship] = useState<SchemaRelationshipItem | null>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);

	// Popup / Modal de Edição da Tabela (ao clicar)
	const [activeModalTable, setActiveModalTable] = useState<SchemaTableItem | null>(null);
	const [editTableDescription, setEditTableDescription] = useState('');
	const [editColumns, setEditColumns] = useState<SchemaColumnItem[]>([]);
	const [isSavingSchema, setIsSavingSchema] = useState(false);

	// Carrega esquema e dados
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
				throw new Error('Não foi possível carregar o esquema do banco de dados.');
			}
			const json = (await res.json()) as {
				data?: { tables: SchemaTableItem[]; relationships: SchemaRelationshipItem[] };
			};
			const loadedTables = json.data?.tables ?? [];
			setTables(loadedTables);
			setRelationships(json.data?.relationships ?? []);

			// Carrega posições salvas ou computa padrão
			try {
				const saved = localStorage.getItem(STORAGE_KEY);
				if (saved) {
					const parsed = JSON.parse(saved) as Record<string, NodePosition>;
					const merged = { ...computeDefaultPositions(loadedTables), ...parsed };
					setPositions(merged);
				} else {
					setPositions(computeDefaultPositions(loadedTables));
				}
			} catch {
				setPositions(computeDefaultPositions(loadedTables));
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao carregar dados do esquema.');
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		void loadSchema();
	}, [token]);

	// Salva posições no localStorage ao mover
	const savePositions = useCallback((newPos: Record<string, NodePosition>) => {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(newPos));
		} catch {
			// ignore quota
		}
	}, []);

	// Auto-layout / Organizar
	const handleAutoLayout = () => {
		const defaultPos = computeDefaultPositions(tables);
		setPositions(defaultPos);
		savePositions(defaultPos);
		setCamera({ x: 40, y: 40, zoom: 0.9 });
	};

	// Fit to view
	const handleFitView = () => {
		if (tables.length === 0) return;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;

		for (const t of tables) {
			const pos = positions[t.tableName.toLowerCase()] ?? { x: 0, y: 0 };
			const h = HEADER_HEIGHT + t.columns.length * ROW_HEIGHT + 20;
			minX = Math.min(minX, pos.x);
			minY = Math.min(minY, pos.y);
			maxX = Math.max(maxX, pos.x + NODE_WIDTH);
			maxY = Math.max(maxY, pos.y + h);
		}

		const container = containerRef.current;
		if (!container) return;
		const width = container.clientWidth;
		const height = container.clientHeight;

		const contentWidth = maxX - minX + 120;
		const contentHeight = maxY - minY + 120;

		const zoomX = width / contentWidth;
		const zoomY = height / contentHeight;
		const zoom = Math.min(1.2, Math.max(0.4, Math.min(zoomX, zoomY)));

		const x = (width - contentWidth * (zoom / 0.9)) / 2 - minX * zoom + 40;
		const y = (height - contentHeight * (zoom / 0.9)) / 2 - minY * zoom + 40;

		setCamera({ x, y, zoom });
	};

	// Mouse handlers para pan e drag
	const handleMouseDownCanvas = (e: ReactMouseEvent<HTMLDivElement>) => {
		// Se clicou no fundo do canvas (não em um nó ou botão)
		if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'svg') {
			setIsPanning(true);
			setPanStart({ x: e.clientX - camera.x, y: e.clientY - camera.y });
		}
	};

	const handleMouseMoveCanvas = (e: ReactMouseEvent<HTMLDivElement>) => {
		if (isPanning) {
			setCamera((prev) => ({
				...prev,
				x: e.clientX - panStart.x,
				y: e.clientY - panStart.y,
			}));
		} else if (draggingNode) {
			const newX = (e.clientX - camera.x) / camera.zoom - draggingNode.offsetX;
			const newY = (e.clientY - camera.y) / camera.zoom - draggingNode.offsetY;

			setPositions((prev) => {
				const next = {
					...prev,
					[draggingNode.tableName]: { x: Math.round(newX), y: Math.round(newY) },
				};
				return next;
			});
		}
	};

	const handleMouseUpCanvas = () => {
		if (isPanning) {
			setIsPanning(false);
		}
		if (draggingNode) {
			setDraggingNode(null);
			savePositions(positions);
		}
	};

	const handleWheelCanvas = (e: ReactWheelEvent<HTMLDivElement>) => {
		e.preventDefault();
		const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
		setCamera((prev) => {
			const newZoom = Math.min(2.0, Math.max(0.3, prev.zoom * zoomFactor));
			return {
				...prev,
				zoom: newZoom,
			};
		});
	};

	const handleStartDragNode = (e: ReactMouseEvent, tableName: string) => {
		e.stopPropagation();
		const tName = tableName.toLowerCase();
		const currentPos = positions[tName] ?? { x: 0, y: 0 };
		const mouseCanvasX = (e.clientX - camera.x) / camera.zoom;
		const mouseCanvasY = (e.clientY - camera.y) / camera.zoom;

		setDraggingNode({
			tableName: tName,
			offsetX: mouseCanvasX - currentPos.x,
			offsetY: mouseCanvasY - currentPos.y,
		});
	};

	// Abertura do Popup / Modal
	const handleOpenTableModal = (table: SchemaTableItem) => {
		setActiveModalTable(table);
		setEditTableDescription(table.description);
		setEditColumns(table.columns.map((c) => ({ ...c })));
		setError('');
		setSuccessMessage('');
	};

	const handleCloseTableModal = () => {
		setActiveModalTable(null);
	};

	// Salvar alterações no Modal
	const handleSaveTableSchema = async () => {
		if (!activeModalTable) return;
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
			const res = await fetch(`/api/erp/schema/${activeModalTable.tableName}`, {
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
				throw new Error(json.error ?? 'Falha ao salvar metadados da tabela.');
			}

			setSuccessMessage(`Dicionário de Dados da tabela "${activeModalTable.tableName}" salvo com sucesso!`);
			handleCloseTableModal();
			await loadSchema();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao salvar alterações.');
		} finally {
			setIsSavingSchema(false);
		}
	};

	// Auto-detectar ligações
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
			};
			if (json.data) {
				setTables(json.data.tables);
				setRelationships(json.data.relationships);
			}
			setSuccessMessage(
				`Detecção concluída! ${json.data?.relationships.length ?? 0} relacionamento(s) ativos no banco da Gideon.`,
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

	// Tabelas filtradas pela barra de busca
	const filteredTables = useMemo(() => {
		if (!searchQuery.trim()) return tables;
		const q = searchQuery.toLowerCase().trim();
		return tables.filter(
			(t) =>
				t.tableName.toLowerCase().includes(q) ||
				t.context.toLowerCase().includes(q) ||
				t.columns.some((c) => c.columnName.toLowerCase().includes(q)),
		);
	}, [tables, searchQuery]);

	// Tabela mapeada por nome para lookups rápidos
	const tableMap = useMemo(() => {
		const m = new Map<string, SchemaTableItem>();
		for (const t of tables) {
			m.set(t.tableName.toLowerCase(), t);
		}
		return m;
	}, [tables]);

	// Cálculo das Curvas SVG (Edges de relacionamentos)
	const edges = useMemo(() => {
		const calculated: Array<{
			id: string;
			rel: SchemaRelationshipItem;
			path: string;
			fromX: number;
			fromY: number;
			toX: number;
			toY: number;
			isHighlighted: boolean;
		}> = [];

		for (const rel of relationships) {
			const fromTable = tableMap.get(rel.fromTable.toLowerCase());
			const toTable = tableMap.get(rel.toTable.toLowerCase());
			if (!fromTable || !toTable) continue;

			const fromPos = positions[rel.fromTable.toLowerCase()] ?? { x: 0, y: 0 };
			const toPos = positions[rel.toTable.toLowerCase()] ?? { x: 0, y: 0 };

			const fromColIndex = fromTable.columns.findIndex(
				(c) => c.columnName.toUpperCase() === rel.fromColumn.toUpperCase(),
			);
			const toColIndex = toTable.columns.findIndex(
				(c) => c.columnName.toUpperCase() === rel.toColumn.toUpperCase(),
			);

			const safeFromIndex = fromColIndex >= 0 ? fromColIndex : 0;
			const safeToIndex = toColIndex >= 0 ? toColIndex : 0;

			const fromY = fromPos.y + HEADER_HEIGHT + safeFromIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
			const toY = toPos.y + HEADER_HEIGHT + safeToIndex * ROW_HEIGHT + ROW_HEIGHT / 2;

			let fromX = fromPos.x + NODE_WIDTH;
			let toX = toPos.x;

			// Se a tabela de destino estiver à esquerda da de origem
			if (toPos.x + NODE_WIDTH < fromPos.x) {
				fromX = fromPos.x;
				toX = toPos.x + NODE_WIDTH;
			} else if (Math.abs(fromPos.x - toPos.x) < NODE_WIDTH) {
				fromX = fromPos.x + NODE_WIDTH;
				toX = toPos.x + NODE_WIDTH;
			}

			const dx = Math.max(40, Math.abs(toX - fromX) * 0.45);
			const path = `M ${fromX} ${fromY} C ${fromX + (toX > fromX ? dx : -dx)} ${fromY}, ${toX + (toX > fromX ? -dx : dx)} ${toY}, ${toX} ${toY}`;

			const isHighlighted =
				hoveredTable === rel.fromTable.toLowerCase() ||
				hoveredTable === rel.toTable.toLowerCase() ||
				(hoveredRelationship?.fromTable === rel.fromTable &&
					hoveredRelationship?.toTable === rel.toTable &&
					hoveredRelationship?.fromColumn === rel.fromColumn);

			calculated.push({
				id: `${rel.fromTable}.${rel.fromColumn}->${rel.toTable}.${rel.toColumn}`,
				rel,
				path,
				fromX,
				fromY,
				toX,
				toY,
				isHighlighted,
			});
		}

		return calculated;
	}, [relationships, tableMap, positions, hoveredTable, hoveredRelationship]);

	// Bounding box para o Minimap
	const minimapData = useMemo(() => {
		if (tables.length === 0) return null;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;

		for (const t of tables) {
			const pos = positions[t.tableName.toLowerCase()] ?? { x: 0, y: 0 };
			const h = HEADER_HEIGHT + t.columns.length * ROW_HEIGHT + 20;
			minX = Math.min(minX, pos.x);
			minY = Math.min(minY, pos.y);
			maxX = Math.max(maxX, pos.x + NODE_WIDTH);
			maxY = Math.max(maxY, pos.y + h);
		}

		const padding = 150;
		minX -= padding;
		minY -= padding;
		maxX += padding;
		maxY += padding;

		const worldWidth = maxX - minX || 1000;
		const worldHeight = maxY - minY || 800;

		return { minX, minY, worldWidth, worldHeight };
	}, [tables, positions]);

	// Métricas de cabeçalho
	const totalRows = useMemo(() => tables.reduce((acc, t) => acc + t.rowCount, 0), [tables]);
	const totalColumns = useMemo(() => tables.reduce((acc, t) => acc + t.columns.length, 0), [tables]);

	return (
		<div className={`flex flex-col rounded-2xl border border-slate-800 bg-[#0c0d10] text-slate-100 shadow-2xl transition-all ${isFullscreen ? 'fixed inset-0 z-50 rounded-none' : 'relative mt-4'}`}>
			{/* Barra Superior de Ferramentas estilo Supabase Studio */}
			<div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-[#12141c]/90 px-4 py-3 backdrop-blur-md">
				<div className="flex items-center gap-3">
					<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
						<GitBranch className="h-4 w-4" />
					</div>
					<div>
						<div className="flex items-center gap-2">
							<span className="font-bold text-sm text-slate-100">Visualizador de Esquema & Banco PostgreSQL</span>
							<span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
								Supabase Mode
							</span>
						</div>
						<p className="text-[11px] text-slate-400">
							{tables.length} tabelas no banco • {totalColumns} colunas • {totalRows.toLocaleString('pt-BR')} registros • {relationships.length} ligações (FKs)
						</p>
					</div>
				</div>

				{/* Controles: Busca, Auto-Layout, Auto-Detectar, Zoom e Fullscreen */}
				<div className="flex flex-wrap items-center gap-2">
					<div className="relative">
						<Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
						<input
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Buscar tabela ou coluna..."
							className="h-8 w-48 rounded-lg border border-slate-700 bg-slate-900/80 pl-8 pr-3 text-xs text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
						/>
						{searchQuery && (
							<button
								type="button"
								onClick={() => setSearchQuery('')}
								className="absolute right-2 top-2 text-slate-400 hover:text-white"
							>
								<X className="h-3.5 w-3.5" />
							</button>
						)}
					</div>

					<button
						type="button"
						onClick={handleAutoLayout}
						title="Organizar tabelas automaticamente em colunas e camadas"
						className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition"
					>
						<RotateCcw className="h-3.5 w-3.5 text-slate-400" />
						<span>Auto-Organizar</span>
					</button>

					<button
						type="button"
						onClick={handleFitView}
						title="Ajustar todas as tabelas na tela"
						className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition"
					>
						<Maximize2 className="h-3.5 w-3.5 text-slate-400" />
						<span>Ajustar à Tela</span>
					</button>

					<button
						type="button"
						onClick={handleAutoDetectFks}
						disabled={isDetectingFks}
						title="Detectar ligações e chaves estrangeiras automaticamente"
						className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/20 transition disabled:opacity-50"
					>
						<Sparkles className={`h-3.5 w-3.5 text-indigo-400 ${isDetectingFks ? 'animate-spin' : ''}`} />
						<span>{isDetectingFks ? 'Detectando...' : 'Auto-Detectar FKs'}</span>
					</button>

					<div className="flex items-center rounded-lg border border-slate-700 bg-slate-800/80 p-0.5">
						<button
							type="button"
							onClick={() => setCamera((prev) => ({ ...prev, zoom: Math.max(0.3, prev.zoom * 0.9) }))}
							title="Zoom Menos"
							className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
						>
							<ZoomOut className="h-3.5 w-3.5" />
						</button>
						<span className="px-1.5 font-mono text-[11px] text-slate-300">
							{Math.round(camera.zoom * 100)}%
						</span>
						<button
							type="button"
							onClick={() => setCamera((prev) => ({ ...prev, zoom: Math.min(2.0, prev.zoom * 1.1) }))}
							title="Zoom Mais"
							className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
						>
							<ZoomIn className="h-3.5 w-3.5" />
						</button>
					</div>

					<button
						type="button"
						onClick={() => setIsFullscreen(!isFullscreen)}
						title={isFullscreen ? 'Sair da Tela Cheia' : 'Tela Cheia'}
						className="rounded-lg border border-slate-700 bg-slate-800/80 p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white transition"
					>
						{isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
					</button>
				</div>
			</div>

			{/* Mensagens de Alerta & Sucesso */}
			{error && (
				<div className="flex items-center justify-between gap-2 border-b border-rose-900/50 bg-rose-950/60 px-4 py-2 text-xs text-rose-300">
					<div className="flex items-center gap-2">
						<AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
						<span>{error}</span>
					</div>
					<button type="button" onClick={() => setError('')} className="text-rose-400 hover:text-white">
						<X className="h-3.5 w-3.5" />
					</button>
				</div>
			)}

			{successMessage && (
				<div className="flex items-center justify-between gap-2 border-b border-emerald-900/50 bg-emerald-950/60 px-4 py-2 text-xs text-emerald-300">
					<div className="flex items-center gap-2">
						<CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
						<span>{successMessage}</span>
					</div>
					<button type="button" onClick={() => setSuccessMessage('')} className="text-emerald-400 hover:text-white">
						<X className="h-3.5 w-3.5" />
					</button>
				</div>
			)}

			{/* Canvas Interativo Infinito (Dot Grid Supabase) */}
			<div
				ref={containerRef}
				onMouseDown={handleMouseDownCanvas}
				onMouseMove={handleMouseMoveCanvas}
				onMouseUp={handleMouseUpCanvas}
				onWheel={handleWheelCanvas}
				className={`relative w-full overflow-hidden select-none cursor-grab active:cursor-grabbing ${isFullscreen ? 'h-[calc(100vh-60px)]' : 'h-[750px]'}`}
				style={{
					backgroundImage: `radial-gradient(#262a36 1px, transparent 1px)`,
					backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
					backgroundPosition: `${camera.x}px ${camera.y}px`,
				}}
			>
				{isLoading ? (
					<div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-xs">
						<RefreshCw className="h-8 w-8 animate-spin text-emerald-400" />
						<p className="mt-3 text-xs font-semibold tracking-wider text-slate-300 uppercase">
							Carregando Esquema & Diagrama ER...
						</p>
					</div>
				) : null}

				{/* Camada SVG dos Relacionamentos / Curvas (Edges) */}
				<svg
					className="pointer-events-none absolute inset-0 h-full w-full"
					style={{
						transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
						transformOrigin: '0 0',
					}}
				>
					<defs>
						<marker
							id="arrow-default"
							viewBox="0 0 10 10"
							refX="6"
							refY="5"
							markerWidth="6"
							markerHeight="6"
							orient="auto-start-reverse"
						>
							<path d="M 0 1 L 8 5 L 0 9 z" fill="#475569" />
						</marker>
						<marker
							id="arrow-active"
							viewBox="0 0 10 10"
							refX="6"
							refY="5"
							markerWidth="7"
							markerHeight="7"
							orient="auto-start-reverse"
						>
							<path d="M 0 1 L 8 5 L 0 9 z" fill="#10b981" />
						</marker>
						<filter id="glow-edge" x="-20%" y="-20%" width="140%" height="140%">
							<feGaussianBlur stdDeviation="3" result="blur" />
							<feComposite in="SourceGraphic" in2="blur" operator="over" />
						</filter>
					</defs>

					{edges.map((edge) => (
						<g key={edge.id} className="transition-all duration-150">
							{/* Linha externa para capturar clique/hover mais facilmente */}
							<path
								d={edge.path}
								fill="none"
								stroke={edge.isHighlighted ? '#10b981' : '#334155'}
								strokeWidth={edge.isHighlighted ? 3 : 1.75}
								strokeDasharray={edge.isHighlighted ? 'none' : '4 3'}
								filter={edge.isHighlighted ? 'url(#glow-edge)' : undefined}
								markerEnd={edge.isHighlighted ? 'url(#arrow-active)' : 'url(#arrow-default)'}
								className="transition-colors duration-200"
							/>
							{/* Ponto inicial na porta de saída (FK) */}
							<circle
								cx={edge.fromX}
								cy={edge.fromY}
								r={edge.isHighlighted ? 4 : 3}
								fill={edge.isHighlighted ? '#10b981' : '#64748b'}
							/>
						</g>
					))}
				</svg>

				{/* Camada dos Nós das Tabelas (Nodes estilo Supabase Studio) */}
				<div
					className="absolute inset-0 pointer-events-none"
					style={{
						transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
						transformOrigin: '0 0',
					}}
				>
					{filteredTables.map((table) => {
						const tName = table.tableName.toLowerCase();
						const pos = positions[tName] ?? { x: 80, y: 80 };
						const isThisHovered = hoveredTable === tName;
						const isSearchMatch = searchQuery && (
							table.tableName.toLowerCase().includes(searchQuery.toLowerCase()) ||
							table.columns.some((c) => c.columnName.toLowerCase().includes(searchQuery.toLowerCase()))
						);

						return (
							<div
								key={table.tableName}
								style={{
									transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
									width: `${NODE_WIDTH}px`,
								}}
								onMouseEnter={() => setHoveredTable(tName)}
								onMouseLeave={() => setHoveredTable(null)}
								onClick={() => handleOpenTableModal(table)}
								className={`pointer-events-auto absolute rounded-xl border bg-[#141721]/95 text-slate-100 shadow-xl transition-shadow backdrop-blur-md cursor-pointer group ${
									isThisHovered
										? 'border-emerald-500/80 shadow-emerald-500/20 shadow-2xl ring-1 ring-emerald-500'
										: isSearchMatch
										? 'border-indigo-500/80 shadow-indigo-500/20 shadow-xl ring-1 ring-indigo-500'
										: 'border-slate-800 hover:border-slate-700 hover:shadow-2xl'
								}`}
							>
								{/* Header do Card da Tabela com Handler de Drag */}
								<div
									onMouseDown={(e) => handleStartDragNode(e, table.tableName)}
									className="flex items-center justify-between border-b border-slate-800/80 bg-[#191c28] px-3 py-2.5 rounded-t-xl cursor-grab active:cursor-grabbing"
								>
									<div className="flex items-center gap-2 overflow-hidden">
										<TableIcon className="h-4 w-4 text-emerald-400 shrink-0" />
										<span className="font-mono text-xs font-bold text-slate-100 truncate" title={table.tableName}>
											{table.tableName}
										</span>
									</div>

									<div className="flex items-center gap-1.5 shrink-0">
										<span className="font-mono text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
											{table.columns.length}
										</span>
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												handleOpenTableModal(table);
											}}
											title="Clique para editar descrições da tabela e colunas"
											className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white transition"
										>
											<Edit3 className="h-3 w-3" />
										</button>
									</div>
								</div>

								{/* Lista de Colunas (estilo Supabase Studio) */}
								<div className="py-1">
									{table.columns.map((col) => {
										const isPk = col.isPrimaryKey;
										const isFk = Boolean(col.foreignKeyToTable && col.foreignKeyToColumn);
										const isMatch = searchQuery && col.columnName.toLowerCase().includes(searchQuery.toLowerCase());

										return (
											<div
												key={col.columnName}
												title={col.description ? `${col.columnName}: ${col.description}` : col.columnName}
												className={`flex items-center justify-between px-3 py-1 text-xs transition-colors hover:bg-slate-800/60 ${
													isMatch ? 'bg-indigo-500/20 font-semibold' : ''
												}`}
												style={{ height: `${ROW_HEIGHT}px` }}
											>
												<div className="flex items-center gap-2 overflow-hidden pr-2">
													{isPk ? (
														<span title="Chave Primária (PK)" className="shrink-0 flex items-center">
															<KeyRound className="h-3 w-3 text-amber-400" />
														</span>
													) : isFk ? (
														<span title={`Chave Estrangeira -> ${col.foreignKeyToTable}.${col.foreignKeyToColumn}`} className="shrink-0 flex items-center">
															<Link2 className="h-3 w-3 text-indigo-400" />
														</span>
													) : (
														<CircleDot className="h-2.5 w-2.5 text-slate-600 shrink-0" />
													)}

													<span
														className={`font-mono text-[11px] truncate ${
															isPk ? 'font-bold text-amber-200' : isFk ? 'text-indigo-200 font-medium' : 'text-slate-300'
														}`}
													>
														{col.columnName}
													</span>
												</div>

												<div className="flex items-center gap-1 shrink-0">
													<span className="font-mono text-[10px] text-slate-500">
														{col.dataType ? col.dataType.toLowerCase() : 'text'}
													</span>
												</div>
											</div>
										);
									})}
								</div>

								{/* Rodapé do Card com Total de Linhas e Dica de Clique */}
								<div className="flex items-center justify-between border-t border-slate-800/80 bg-[#12141c] px-3 py-1.5 text-[10px] text-slate-500 rounded-b-xl">
									<span>{table.rowCount.toLocaleString('pt-BR')} linhas</span>
									<span className="text-[9px] text-slate-500 group-hover:text-emerald-400 transition-colors">
										Clique para editar
									</span>
								</div>
							</div>
						);
					})}
				</div>

				{/* Mini-Mapa no Canto Inferior Direito (estilo Supabase Studio) */}
				{minimapData && (
					<div className="absolute bottom-4 right-4 z-20 h-32 w-52 overflow-hidden rounded-xl border border-slate-800 bg-[#0f1118]/90 p-2 shadow-2xl backdrop-blur-md">
						<div className="relative h-full w-full">
							{tables.map((t) => {
								const pos = positions[t.tableName.toLowerCase()] ?? { x: 0, y: 0 };
								const normX = ((pos.x - minimapData.minX) / minimapData.worldWidth) * 100;
								const normY = ((pos.y - minimapData.minY) / minimapData.worldHeight) * 100;
								const normW = (NODE_WIDTH / minimapData.worldWidth) * 100;
								const nodeH = HEADER_HEIGHT + t.columns.length * ROW_HEIGHT;
								const normH = (nodeH / minimapData.worldHeight) * 100;

								const isHover = hoveredTable === t.tableName.toLowerCase();

								return (
									<div
										key={t.tableName}
										style={{
											left: `${Math.max(0, Math.min(95, normX))}%`,
											top: `${Math.max(0, Math.min(95, normY))}%`,
											width: `${Math.max(4, normW)}%`,
											height: `${Math.max(4, normH)}%`,
										}}
										className={`absolute rounded-xs transition-colors ${
											isHover ? 'bg-emerald-400 ring-1 ring-emerald-300' : 'bg-slate-600'
										}`}
									/>
								);
							})}

							{/* Retângulo do Viewport visível atual */}
							{containerRef.current && (
								<div
									style={{
										left: `${Math.max(0, Math.min(100, ((-camera.x - minimapData.minX) / minimapData.worldWidth) * 100))}%`,
										top: `${Math.max(0, Math.min(100, ((-camera.y - minimapData.minY) / minimapData.worldHeight) * 100))}%`,
										width: `${Math.min(100, (containerRef.current.clientWidth / camera.zoom / minimapData.worldWidth) * 100)}%`,
										height: `${Math.min(100, (containerRef.current.clientHeight / camera.zoom / minimapData.worldHeight) * 100)}%`,
									}}
									className="pointer-events-none absolute border border-indigo-400/80 bg-indigo-500/10 rounded-xs"
								/>
							)}
						</div>
						<div className="pointer-events-none absolute bottom-1 right-2 text-[9px] font-mono text-slate-500">
							Radar ER
						</div>
					</div>
				)}

				{/* Guia de Atalhos / Dicas no Canto Inferior Esquerdo */}
				<div className="absolute bottom-4 left-4 z-20 flex items-center gap-3 rounded-lg border border-slate-800/80 bg-[#12141c]/90 px-3 py-1.5 text-[11px] text-slate-400 backdrop-blur-md">
					<span>💡 <strong>Arrastar fundo:</strong> Navegar</span>
					<span>•</span>
					<span><strong>Scroll:</strong> Zoom</span>
					<span>•</span>
					<span><strong>Arrastar tabela:</strong> Reposicionar</span>
					<span>•</span>
					<span><strong>Clique na tabela:</strong> Detalhes & Editar</span>
				</div>
			</div>

			{/* POPUP / MODAL DE DETALHES E EDIÇÃO DA TABELA (ao clicar na tabela) */}
			{activeModalTable && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-200">
					<div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-700 bg-[#141722] text-slate-100 shadow-2xl overflow-hidden">
						{/* Cabeçalho do Modal */}
						<div className="flex items-center justify-between border-b border-slate-800 bg-[#181b28] px-6 py-4">
							<div className="flex items-center gap-3">
								<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
									<TableIcon className="h-5 w-5" />
								</div>
								<div>
									<div className="flex items-center gap-2">
										<h2 className="text-lg font-bold text-white font-mono">{activeModalTable.tableName}</h2>
										<span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-300 border border-slate-700">
											Contexto: {activeModalTable.context}
										</span>
									</div>
									<p className="text-xs text-slate-400">
										{activeModalTable.rowCount.toLocaleString('pt-BR')} registros no PostgreSQL • {editColumns.length} colunas mapeadas no Dicionário da Gideon
									</p>
								</div>
							</div>

							<button
								type="button"
								onClick={handleCloseTableModal}
								className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
							>
								<X className="h-5 w-5" />
							</button>
						</div>

						{/* Corpo do Modal com Scroll */}
						<div className="flex-1 overflow-y-auto p-6 space-y-6">
							{/* Descrição de Negócio da Tabela */}
							<div>
								<label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
									Descrição de Negócio da Tabela para a IA <span className="text-rose-400">*</span>
								</label>
								<textarea
									rows={2}
									value={editTableDescription}
									onChange={(e) => setEditTableDescription(e.target.value)}
									placeholder="Explique o propósito desta tabela para a Gideon (ex: Cabeçalho de notas fiscais com tipo de operação, clientes e valores)..."
									className="w-full rounded-xl border border-slate-700 bg-slate-900/80 p-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans leading-relaxed"
								/>
								<p className="mt-1 text-[11px] text-slate-400">
									A Gideon utiliza essa descrição para entender quando consultar esta tabela nas perguntas dos usuários.
								</p>
							</div>

							{/* Lista de Colunas e Descrições Obrigatórias */}
							<div>
								<div className="flex items-center justify-between mb-2">
									<label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
										Colunas, Descrições Semânticas & Chaves ({editColumns.length})
									</label>
									<span className="text-[11px] text-slate-400">
										Marque 1 PK e preencha a descrição de cada campo
									</span>
								</div>

								<div className="space-y-3">
									{editColumns.map((col) => {
										const isPk = col.isPrimaryKey;
										const otherTables = tables.filter((t) => t.tableName !== activeModalTable.tableName);
										const currentFkValue = col.foreignKeyToTable && col.foreignKeyToColumn
											? `${col.foreignKeyToTable}.${col.foreignKeyToColumn}`
											: '';

										return (
											<div
												key={col.columnName}
												className={`rounded-xl border p-3 transition-colors ${
													isPk
														? 'border-amber-500/40 bg-amber-500/5'
														: col.foreignKeyToTable
														? 'border-indigo-500/30 bg-indigo-500/5'
														: 'border-slate-800 bg-slate-900/50'
												}`}
											>
												<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/60 pb-2">
													<div className="flex items-center gap-2">
														<button
															type="button"
															onClick={() => handleSetPrimaryKey(col.columnName)}
															title={isPk ? 'Coluna atual é a Chave Primária (PK)' : 'Clique para definir esta coluna como PK'}
															className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold transition ${
																isPk
																	? 'bg-amber-500 text-white shadow-xs'
																	: 'bg-slate-800 text-slate-400 hover:bg-amber-500/20 hover:text-amber-300'
															}`}
														>
															<KeyRound className="h-3 w-3" />
															<span>{isPk ? 'Chave Primária (PK)' : 'Definir PK'}</span>
														</button>

														<span className="font-mono text-xs font-bold text-slate-200">
															{col.columnName}
														</span>
														<span className="font-mono text-[10px] text-slate-500">
															({col.dataType ? col.dataType.toLowerCase() : 'text'})
														</span>
													</div>

													{/* Seletor de Chave Estrangeira (FK) */}
													<div className="flex items-center gap-1.5">
														<Link2 className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
														<span className="text-[11px] text-slate-400">Ligação FK:</span>
														<select
															value={currentFkValue}
															onChange={(e) => handleUpdateForeignKey(col.columnName, e.target.value)}
															className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-indigo-500 focus:outline-none"
														>
															<option value="">Sem ligação externa (Coluna simples)</option>
															{otherTables.flatMap((ot) =>
																ot.columns.map((targetCol) => (
																	<option
																		key={`${ot.tableName}.${targetCol.columnName}`}
																		value={`${ot.tableName}.${targetCol.columnName}`}
																	>
																		➔ {ot.tableName}.{targetCol.columnName} {targetCol.isPrimaryKey ? '(PK)' : ''}
																	</option>
																)),
															)}
														</select>
													</div>
												</div>

												{/* Descrição Semântica Obrigatória */}
												<div className="mt-2.5">
													<input
														type="text"
														required
														value={col.description}
														onChange={(e) => handleUpdateColumnDescription(col.columnName, e.target.value)}
														placeholder={`Descrição de negócio de ${col.columnName} para a IA (obrigatória)...`}
														className={`w-full rounded-lg border px-3 py-1.5 text-xs text-slate-200 outline-none transition focus:border-indigo-500 ${
															!col.description?.trim()
																? 'border-amber-400/60 bg-amber-400/5'
																: 'border-slate-700 bg-slate-800/70'
														}`}
													/>
												</div>

												{/* Amostras Reais do PostgreSQL com botão de injetar com 1 clique */}
												{col.sampleValues && col.sampleValues.length > 0 && (
													<div className="mt-2 flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-slate-800/40 text-[11px]">
														<span className="text-slate-400 font-medium">Valores reais no banco:</span>
														{col.sampleValues.slice(0, 6).map((val) => (
															<span
																key={val}
																className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300 border border-slate-700"
															>
																{val}
															</span>
														))}
														{col.sampleValues.length > 6 && (
															<span className="text-slate-500 text-[10px]">
																+{col.sampleValues.length - 6} outros
															</span>
														)}
														<button
															type="button"
															onClick={() => handleInjectSampleValues(col.columnName, col.sampleValues)}
															className="ml-auto inline-flex items-center gap-1 rounded bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 hover:bg-indigo-500/20 transition"
														>
															<Sparkles className="h-3 w-3 text-indigo-400" />
															<span>Injetar valores na descrição</span>
														</button>
													</div>
												)}
											</div>
										);
									})}
								</div>
							</div>
						</div>

						{/* Rodapé de Ações do Modal */}
						<div className="flex items-center justify-between border-t border-slate-800 bg-[#181b28] px-6 py-4">
							<span className="text-xs text-slate-400">
								Todas as alterações são salvas diretamente no Dicionário de Dados PostgreSQL da Gideon.
							</span>
							<div className="flex items-center gap-3">
								<button
									type="button"
									onClick={handleCloseTableModal}
									className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition"
								>
									Cancelar
								</button>
								<button
									type="button"
									onClick={handleSaveTableSchema}
									disabled={isSavingSchema}
									className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-600/30 hover:bg-emerald-500 transition disabled:opacity-50"
								>
									{isSavingSchema ? (
										<RefreshCw className="h-4 w-4 animate-spin" />
									) : (
										<Save className="h-4 w-4" />
									)}
									<span>Salvar Alterações</span>
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
