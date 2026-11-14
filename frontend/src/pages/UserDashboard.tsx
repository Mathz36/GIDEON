import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
	Sparkles,
	RefreshCw,
	Trash2,
	GripVertical,
	Maximize2,
	Minimize2,
	ChevronLeft,
	ChevronRight,
	Plus,
	Check,
	CheckCircle2,
	AlertCircle,
	BarChart3,
	BarChartHorizontal,
	TrendingUp,
	AreaChart as LucideAreaChart,
	PieChart as PieIcon,
	Table as TableIcon,
	LayoutDashboard,
	Layers,
	Clock,
	HelpCircle,
	Loader2,
} from 'lucide-react';
import { DynamicDashboard, parseDashboardConfig } from '../components/chat/DynamicDashboard';
import ErrorBoundary from '../components/common/ErrorBoundary';
import { useAuth } from '../context/AuthContext';

export type CardSize = 'P' | 'M' | 'G';

export interface DashboardCard {
	id: string;
	title: string;
	prompt: string;
	chartType: 'bar' | 'horizontal-bar' | 'line' | 'area' | 'pie' | 'table';
	size: CardSize;
	isExpandedHeight?: boolean;
	order: number;
	configString: string;
	lastRefreshedAt?: string;
	isLoading?: boolean;
	error?: string;
}

const STORAGE_KEY_PREFIX = 'gideon.dashboard.cards';

// Template padrão das 3 sugestões didáticas de 1 clique
const SUGGESTION_TEMPLATES: Array<{
	idSuffix: string;
	title: string;
	prompt: string;
	chartType: DashboardCard['chartType'];
	size: CardSize;
	badge: string;
	description: string;
}> = [
	{
		idSuffix: 'fat-mes',
		title: 'Faturamento Deste Mês',
		prompt: 'Faturamento diário deste mês em área com evolução da receita',
		chartType: 'area',
		size: 'M',
		badge: 'Área • Médio (M)',
		description: 'Evolução diária da receita acumulada no mês em gráfico de área preenchida',
	},
	{
		idSuffix: 'top-clientes',
		title: 'Top 5 Maiores Clientes',
		prompt: 'Top 5 maiores clientes em barras horizontais por faturamento',
		chartType: 'horizontal-bar',
		size: 'P',
		badge: 'Barras • Compacto (P)',
		description: 'Ranking consolidado dos parceiros comerciais que mais faturaram no ERP',
	},
	{
		idSuffix: 'formas-pagto',
		title: 'Vendas por Forma de Pagamento',
		prompt: 'Distribuição de vendas por forma de pagamento em pizza',
		chartType: 'pie',
		size: 'P',
		badge: 'Pizza • Compacto (P)',
		description: 'Participação percentual entre PIX, Cartão, Boleto Bancário e Transferência',
	},
];

// Gerador de ID único resiliente
const generateCardId = (): string => {
	if (typeof globalThis.crypto?.randomUUID === 'function') {
		return globalThis.crypto.randomUUID();
	}
	return `card_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

export default function UserDashboard() {
	const { user } = useAuth();
	const [cards, setCards] = useState<DashboardCard[]>([]);
	const [isInitialLoading, setIsInitialLoading] = useState(true);
	const [promptInput, setPromptInput] = useState('');
	const [isGenerating, setIsGenerating] = useState(false);
	const [generationStatusText, setGenerationStatusText] = useState('');
	const [errorMessage, setErrorMessage] = useState('');
	const [isGlobalRefreshing, setIsGlobalRefreshing] = useState(false);
	const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'saved_local' | 'error'>('idle');
	const [deletingCardId, setDeletingCardId] = useState<string | null>(null);

	// Drag & Drop State
	const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
	const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

	// Debounce timer para Auto-Save no PostgreSQL
	const debounceSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const cardsRef = useRef<DashboardCard[]>([]);
	cardsRef.current = cards;

	const storageKey = useMemo(() => {
		const userId = user?.id || user?.email || 'guest';
		return `${STORAGE_KEY_PREFIX}_${userId}`;
	}, [user]);

	// Função de salvamento (PostgreSQL com fallback para LocalStorage)
	const triggerAutoSave = useCallback(
		(updatedCards: DashboardCard[]) => {
			// Salva imediatamente no localStorage para experiência offline e zero latência
			try {
				localStorage.setItem(storageKey, JSON.stringify(updatedCards));
			} catch (err) {
				console.warn('[UserDashboard] Falha ao gravar cache local:', err);
			}

			setSaveStatus('saving');

			if (debounceSaveTimerRef.current) {
				clearTimeout(debounceSaveTimerRef.current);
			}

			debounceSaveTimerRef.current = setTimeout(async () => {
				try {
					const token = localStorage.getItem('gideon.auth.token');
					const response = await fetch('/api/dashboard/layout', {
						method: 'PUT',
						headers: {
							'Content-Type': 'application/json',
							...(token ? { Authorization: `Bearer ${token}` } : {}),
						},
						body: JSON.stringify({
							items: updatedCards.map((c, i) => ({
								id: c.id,
								colSpan: c.size === 'P' ? 1 : c.size === 'M' ? 2 : 3,
								rowSpan: c.isExpandedHeight ? 2 : 1,
								order: i,
							})),
						}),
					});

					if (response.ok) {
						setSaveStatus('saved');
					} else {
						// Backend retornou erro ou 404 (rota ainda sendo mapeada): mantém salvo localmente
						setSaveStatus('saved_local');
					}
				} catch {
					// Falha de rede: estado seguro no cliente
					setSaveStatus('saved_local');
				} finally {
					// Limpa o status após 3 segundos
					setTimeout(() => {
						setSaveStatus((prev) => (prev === 'saved' || prev === 'saved_local' ? 'idle' : prev));
					}, 3000);
				}
			}, 600);
		},
		[storageKey]
	);

	// Carregamento inicial de cards
	useEffect(() => {
		let isMounted = true;

		async function loadDashboard() {
			setIsInitialLoading(true);

			let loadedCards: DashboardCard[] = [];
			let backendSuccess = false;
			const token = localStorage.getItem('gideon.auth.token');

			// 1. Tenta carregar do backend (GET /api/dashboard/me)
			try {
				const response = await fetch('/api/dashboard/me', {
					headers: {
						...(token ? { Authorization: `Bearer ${token}` } : {}),
					},
				});

				if (response.ok) {
					backendSuccess = true;
					const result = await response.json();
					const dashboard = result.data || result;
					const widgets = dashboard?.widgets || [];
					if (Array.isArray(widgets)) {
						loadedCards = widgets.map((w: any, idx: number) => {
							const colSpan = typeof w.colSpan === 'number' ? w.colSpan : 2;
							const cardSize: CardSize = colSpan === 1 ? 'P' : colSpan === 3 ? 'G' : 'M';
							const rows = Array.isArray(w.data)
								? w.data
								: Array.isArray(w.cachedData?.data)
									? w.cachedData.data
									: Array.isArray(w.cachedData)
										? w.cachedData
										: [];

							return {
								id: w.id || generateCardId(),
								title: w.title || 'Indicador Executivo',
								prompt: w.queryPrompt || w.title || '',
								chartType: (w.type || 'bar') as DashboardCard['chartType'],
								size: cardSize,
								isExpandedHeight: Boolean(w.rowSpan && w.rowSpan > 1),
								order: typeof w.order === 'number' ? w.order : idx,
								configString: JSON.stringify({
									type: w.type || 'bar',
									title: w.title || 'Indicador Executivo',
									data: rows,
								}),
								lastRefreshedAt: w.updatedAt || new Date().toISOString(),
							};
						});
					}
					// Atualiza cache local sincronizado com o banco real
					try {
						localStorage.setItem(storageKey, JSON.stringify(loadedCards));
					} catch {
						// Ignora quota de localStorage
					}
				}
			} catch {
				// Ignora falha de rede do backend e passa para o cache local
			}

			// 2. Se backend não esteve disponível, carrega do cache local
			if (!backendSuccess) {
				try {
					const cached = localStorage.getItem(storageKey);
					if (cached) {
						const parsed = JSON.parse(cached);
						if (Array.isArray(parsed)) {
							loadedCards = parsed;
						}
					}
				} catch {
					// Cache corrompido
				}
			}

			if (isMounted) {
				setCards(loadedCards.sort((a, b) => a.order - b.order));
				setIsInitialLoading(false);
			}
		}

		loadDashboard();

		return () => {
			isMounted = false;
			if (debounceSaveTimerRef.current) {
				clearTimeout(debounceSaveTimerRef.current);
			}
		};
	}, [storageKey]);

	// Ação de Gerar Indicador via Barra de Criação da Gideon
	const handleGenerateCard = async (textToGenerate?: string) => {
		const targetPrompt = (textToGenerate || promptInput).trim();
		if (!targetPrompt) return;

		setErrorMessage('');
		setIsGenerating(true);
		setGenerationStatusText('Gideon está analisando seus dados no Sankhya ERP...');

		try {
			const token = localStorage.getItem('gideon.auth.token');

			const response = await fetch('/api/dashboard/widgets/generate', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({ prompt: targetPrompt }),
			});

			const resData = await response.json().catch(() => null);

			if (response.ok && resData?.data) {
				const widget = resData.data;
				const colSpan = typeof widget.colSpan === 'number' ? widget.colSpan : 2;
				const cardSize: CardSize = colSpan === 1 ? 'P' : colSpan === 3 ? 'G' : 'M';
				const rows = Array.isArray(widget.data)
					? widget.data
					: Array.isArray(widget.cachedData?.data)
						? widget.cachedData.data
						: Array.isArray(widget.cachedData)
							? widget.cachedData
							: [];

				const newCard: DashboardCard = {
					id: widget.id || generateCardId(),
					title: widget.title || 'Indicador Executivo',
					prompt: targetPrompt,
					chartType: (widget.type || 'bar') as DashboardCard['chartType'],
					size: cardSize,
					isExpandedHeight: Boolean(widget.rowSpan && widget.rowSpan > 1),
					order: 0,
					configString: JSON.stringify({
						type: widget.type || 'bar',
						title: widget.title || 'Indicador Executivo',
						data: rows,
					}),
					lastRefreshedAt: widget.updatedAt || new Date().toISOString(),
				};

				// Insere no início do painel e reordena os demais
				const updated = [newCard, ...cardsRef.current.map((c, i) => ({ ...c, order: i + 1 }))];
				setCards(updated);
				triggerAutoSave(updated);

				setPromptInput('');
			} else {
				const errorMsg =
					resData?.error ||
					resData?.message ||
					'Não foram encontrados registros no banco de dados para criar este indicador.';
				setErrorMessage(errorMsg);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Falha na comunicação com o servidor ao gerar indicador.';
			setErrorMessage(msg);
		} finally {
			setIsGenerating(false);
			setGenerationStatusText('');
		}
	};

	// Adicionar sugestão didática de 1 toque consultando dados reais do PostgreSQL
	const handleAddSuggestion = async (templateIndex: number) => {
		const template = SUGGESTION_TEMPLATES[templateIndex];
		if (!template) return;

		// Verifica se já não existe um com mesmo título
		const existing = cards.find((c) => c.title.toLowerCase() === template.title.toLowerCase());
		if (existing) {
			setErrorMessage(`O indicador "${template.title}" já está adicionado no seu dashboard.`);
			setTimeout(() => setErrorMessage(''), 4000);
			return;
		}

		await handleGenerateCard(template.prompt);
	};

	// Preencher o dashboard com todos os indicadores recomendados consultando dados reais
	const handlePopulateAllSuggestions = async () => {
		if (isGenerating) return;
		for (const tpl of SUGGESTION_TEMPLATES) {
			const existing = cardsRef.current.find((c) => c.title.toLowerCase() === tpl.title.toLowerCase());
			if (!existing) {
				await handleGenerateCard(tpl.prompt);
			}
		}
	};

	// Redimensionar card (P, M, G)
	const handleResizeCard = (cardId: string, newSize: CardSize) => {
		const updated = cards.map((c) => (c.id === cardId ? { ...c, size: newSize } : c));
		setCards(updated);
		triggerAutoSave(updated);
	};

	// Alternar altura expandida (normal vs alta)
	const handleToggleHeight = (cardId: string) => {
		const updated = cards.map((c) => (c.id === cardId ? { ...c, isExpandedHeight: !c.isExpandedHeight } : c));
		setCards(updated);
		triggerAutoSave(updated);
	};

	// Mover card para esquerda ou direita (botões rápidos de acessibilidade / touch)
	const handleMoveCard = (index: number, direction: 'left' | 'right') => {
		const targetIndex = direction === 'left' ? index - 1 : index + 1;
		if (targetIndex < 0 || targetIndex >= cards.length) return;

		const updated = [...cards];
		const temp = updated[index];
		updated[index] = updated[targetIndex];
		updated[targetIndex] = temp;

		const reordered = updated.map((c, i) => ({ ...c, order: i }));
		setCards(reordered);
		triggerAutoSave(reordered);
	};

	// Excluir card
	const handleDeleteCard = async (cardId: string) => {
		const token = localStorage.getItem('gideon.auth.token');

		// Tenta remover no backend
		try {
			await fetch(`/api/dashboard/widgets/${cardId}`, {
				method: 'DELETE',
				headers: {
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
			});
		} catch {
			// Prossegue com exclusão local
		}

		const updated = cards.filter((c) => c.id !== cardId).map((c, i) => ({ ...c, order: i }));
		setCards(updated);
		triggerAutoSave(updated);
		setDeletingCardId(null);
	};

	// Atualizar dados de um card individual consultando o PostgreSQL
	const handleRefreshSingleCard = async (cardId: string) => {
		const targetCard = cards.find((c) => c.id === cardId);
		if (!targetCard) return;

		setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, isLoading: true, error: undefined } : c)));

		try {
			const token = localStorage.getItem('gideon.auth.token');
			const response = await fetch(`/api/dashboard/widgets/${cardId}/refresh`, {
				method: 'POST',
				headers: {
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
			});

			const resData = await response.json().catch(() => null);

			if (response.ok && resData?.data) {
				const widget = resData.data;
				const rows = Array.isArray(widget.data)
					? widget.data
					: Array.isArray(widget.cachedData?.data)
						? widget.cachedData.data
						: Array.isArray(widget.cachedData)
							? widget.cachedData
							: [];

				const refreshedConfigString = JSON.stringify({
					type: widget.type || targetCard.chartType,
					title: widget.title || targetCard.title,
					data: rows,
				});

				const updated = cardsRef.current.map((c) =>
					c.id === cardId
						? {
								...c,
								configString: refreshedConfigString,
								lastRefreshedAt: new Date().toISOString(),
								isLoading: false,
								error: undefined,
							}
						: c
				);

				setCards(updated);
				triggerAutoSave(updated);
			} else {
				const errorMsg = resData?.error || 'Não foi possível atualizar este indicador no banco de dados.';
				setCards((prev) =>
					prev.map((c) =>
						c.id === cardId
							? {
									...c,
									isLoading: false,
									error: errorMsg,
								}
							: c
					)
				);
			}
		} catch (err) {
			setCards((prev) =>
				prev.map((c) =>
					c.id === cardId
						? {
								...c,
								isLoading: false,
								error: err instanceof Error ? err.message : 'Falha ao atualizar dados.',
							}
						: c
				)
			);
		}
	};

	// Atualizar todos os cards do dashboard
	const handleRefreshAll = async () => {
		if (cards.length === 0 || isGlobalRefreshing) return;

		setIsGlobalRefreshing(true);
		setCards((prev) => prev.map((c) => ({ ...c, isLoading: true })));

		for (const card of cardsRef.current) {
			await handleRefreshSingleCard(card.id);
		}

		setIsGlobalRefreshing(false);
	};

	// Handlers de HTML5 Drag & Drop Nativo
	const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', String(index));
		setDraggedIndex(index);
	};

	const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		if (dragOverIndex !== index) {
			setDragOverIndex(index);
		}
	};

	const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
		e.preventDefault();
		if (draggedIndex === null || draggedIndex === targetIndex) {
			setDraggedIndex(null);
			setDragOverIndex(null);
			return;
		}

		const newCards = [...cards];
		const [movedItem] = newCards.splice(draggedIndex, 1);
		newCards.splice(targetIndex, 0, movedItem);

		const updated = newCards.map((c, i) => ({ ...c, order: i }));
		setCards(updated);
		setDraggedIndex(null);
		setDragOverIndex(null);
		triggerAutoSave(updated);
	};

	const handleDragEnd = () => {
		setDraggedIndex(null);
		setDragOverIndex(null);
	};

	// Retorna o ícone representativo do tipo de gráfico
	const renderChartIcon = (type: DashboardCard['chartType']) => {
		switch (type) {
			case 'bar':
				return <BarChart3 className="h-4 w-4 text-indigo-600 shrink-0" />;
			case 'horizontal-bar':
				return <BarChartHorizontal className="h-4 w-4 text-indigo-600 shrink-0" />;
			case 'line':
				return <TrendingUp className="h-4 w-4 text-emerald-600 shrink-0" />;
			case 'area':
				return <LucideAreaChart className="h-4 w-4 text-indigo-600 shrink-0" />;
			case 'pie':
				return <PieIcon className="h-4 w-4 text-amber-600 shrink-0" />;
			case 'table':
				return <TableIcon className="h-4 w-4 text-sky-600 shrink-0" />;
			default:
				return <BarChart3 className="h-4 w-4 text-indigo-600 shrink-0" />;
		}
	};

	// Retorna a classe Tailwind responsiva de colunas para o card
	const getCardColumnSpanClass = (size: CardSize): string => {
		switch (size) {
			case 'P':
				return 'col-span-1';
			case 'M':
				return 'col-span-1 md:col-span-2';
			case 'G':
				return 'col-span-1 md:col-span-2 lg:col-span-3';
			default:
				return 'col-span-1 md:col-span-2';
		}
	};

	return (
		<div className="min-h-full bg-slate-50/50 pb-16">
			{/* Barra Superior / Cabeçalho Executivo */}
			<section className="border-b border-slate-200/80 bg-white shadow-xs">
				<div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
					<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
						<div>
							<div className="flex items-center gap-2.5">
								<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-200">
									<LayoutDashboard className="h-5 w-5" />
								</div>
								<div>
									<h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
										Seu Dashboard
									</h1>
									<p className="text-xs text-slate-500 sm:text-sm">
										Personalize seu painel executivo com a Gideon. Peça gráficos, arraste e redimensione como preferir.
									</p>
								</div>
							</div>
						</div>

						<div className="flex items-center gap-3">
							{/* Indicador de Auto-Save do PostgreSQL */}
							<div className="flex items-center gap-1.5 text-xs text-slate-500">
								{saveStatus === 'saving' && (
									<span className="inline-flex items-center gap-1 text-indigo-600">
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
										<span>Salvando layout...</span>
									</span>
								)}
								{saveStatus === 'saved' && (
									<span className="inline-flex items-center gap-1 font-medium text-emerald-600">
										<CheckCircle2 className="h-3.5 w-3.5" />
										<span>Layout salvo no banco</span>
									</span>
								)}
								{saveStatus === 'saved_local' && (
									<span className="inline-flex items-center gap-1 text-slate-600" title="Salvo em cache de alta velocidade">
										<Check className="h-3.5 w-3.5 text-slate-400" />
										<span>Salvo localmente</span>
									</span>
								)}
							</div>

							{/* Contador de Cards */}
							<span className="hidden sm:inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
								<Layers className="h-3.5 w-3.5 text-slate-500" />
								<span>{cards.length} {cards.length === 1 ? 'indicador' : 'indicadores'}</span>
							</span>

							{/* Botão de Atualizar Tudo */}
							{cards.length > 0 && (
								<button
									type="button"
									onClick={handleRefreshAll}
									disabled={isGlobalRefreshing}
									className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
									title="Recarregar dados de todos os gráficos"
								>
									<RefreshCw className={`h-3.5 w-3.5 ${isGlobalRefreshing ? 'animate-spin text-indigo-600' : 'text-slate-500'}`} />
									<span className="hidden sm:inline">Recarregar Painel</span>
								</button>
							)}
						</div>
					</div>

					{/* Barra de Criação com a Gideon */}
					<div className="mt-5 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/70 via-white to-violet-50/70 p-3 shadow-xs sm:p-4">
						<form
							onSubmit={(e) => {
								e.preventDefault();
								handleGenerateCard();
							}}
							className="flex flex-col gap-2.5 sm:flex-row sm:items-center"
						>
							<div className="relative flex-1">
								<div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
									<Sparkles className="h-4 w-4 text-indigo-600" />
								</div>
								<input
									type="text"
									value={promptInput}
									onChange={(e) => setPromptInput(e.target.value)}
									disabled={isGenerating}
									placeholder="Peça à Gideon: ex: 'Top 5 maiores clientes em barras horizontais' ou 'Faturamento diário em área'..."
									className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-xs text-slate-900 placeholder-slate-400 shadow-2xs transition focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 sm:text-sm"
								/>
							</div>

							<button
								type="submit"
								disabled={isGenerating || !promptInput.trim()}
								className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-98 disabled:pointer-events-none disabled:opacity-50 sm:text-sm"
							>
								{isGenerating ? (
									<>
										<Loader2 className="h-4 w-4 animate-spin" />
										<span>Criando indicador...</span>
									</>
								) : (
									<>
										<Sparkles className="h-4 w-4" />
										<span>Gerar Indicador</span>
									</>
								)}
							</button>
						</form>

						{/* Feedback de status durante geração pela IA */}
						{isGenerating && generationStatusText && (
							<div className="mt-2.5 flex items-center gap-2 text-xs font-medium text-indigo-700 animate-pulse">
								<div className="h-2 w-2 rounded-full bg-indigo-600 animate-ping" />
								<span>{generationStatusText}</span>
							</div>
						)}

						{/* Mensagem de Erro amigável */}
						{errorMessage && (
							<div className="mt-2.5 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 border border-rose-200">
								<AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
								<span>{errorMessage}</span>
							</div>
						)}

						{/* Chips de Sugestões Rápidas */}
						<div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
							<span className="text-[11px] font-semibold text-slate-500 mr-1 flex items-center gap-1">
								<HelpCircle className="h-3 w-3" />
								Sugestões:
							</span>
							<button
								type="button"
								onClick={() => handleGenerateCard('Top 5 maiores clientes em barras horizontais')}
								disabled={isGenerating}
								className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-700 disabled:opacity-50"
							>
								📊 Top 5 Clientes em barras
							</button>
							<button
								type="button"
								onClick={() => handleGenerateCard('Faturamento diário em área')}
								disabled={isGenerating}
								className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-700 disabled:opacity-50"
							>
								📈 Faturamento diário em área
							</button>
							<button
								type="button"
								onClick={() => handleGenerateCard('Vendas por forma de pagamento em pizza')}
								disabled={isGenerating}
								className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-700 disabled:opacity-50"
							>
								💳 Vendas por Pagamento em pizza
							</button>
						</div>
					</div>
				</div>
			</section>

			{/* Conteúdo Principal do Painel */}
			<main className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
				{/* Loading State Inicial (Zero CLS) */}
				{isInitialLoading && (
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
						{[1, 2, 3].map((i) => (
							<div
								key={i}
								className="flex h-80 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-xs animate-pulse"
							>
								<div className="flex items-center justify-between border-b border-slate-100 pb-3">
									<div className="flex items-center gap-2">
										<div className="h-5 w-5 rounded-md bg-slate-200" />
										<div className="h-4 w-32 rounded bg-slate-200" />
									</div>
									<div className="h-6 w-16 rounded bg-slate-200" />
								</div>
								<div className="flex-1 mt-4 rounded-xl bg-slate-100/70" />
							</div>
						))}
					</div>
				)}

				{/* Estado Vazio Didático (Onboarding de 1 Clique) */}
				{!isInitialLoading && cards.length === 0 && (
					<section className="rounded-3xl border border-dashed border-indigo-200 bg-white/90 p-8 text-center shadow-xs sm:p-12">
						<div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 shadow-inner">
							<LayoutDashboard className="h-8 w-8" />
						</div>

						<h2 className="mt-4 text-lg font-bold text-slate-900 sm:text-xl">
							Seu painel executivo está pronto para ser montado
						</h2>
						<p className="mx-auto mt-1.5 max-w-xl text-xs text-slate-500 sm:text-sm">
							Você ainda não adicionou nenhum indicador ao seu dashboard. Peça qualquer métrica à Gideon na barra acima ou comece agora mesmo com nossas recomendações com 1 clique:
						</p>

						<div className="mt-8 grid grid-cols-1 gap-4 text-left sm:grid-cols-3">
							{SUGGESTION_TEMPLATES.map((tpl, idx) => (
								<div
									key={tpl.idSuffix}
									className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-indigo-300 hover:shadow-md"
								>
									<div>
										<div className="flex items-center justify-between gap-2">
											<span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
												{tpl.badge}
											</span>
											{renderChartIcon(tpl.chartType)}
										</div>
										<h3 className="mt-2.5 text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition">
											{tpl.title}
										</h3>
										<p className="mt-1 text-xs text-slate-500 leading-relaxed">
											{tpl.description}
										</p>
									</div>

									<button
										type="button"
										onClick={() => handleAddSuggestion(idx)}
										className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/50 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-600 hover:text-white active:scale-98"
									>
										<Plus className="h-3.5 w-3.5" />
										<span>Adicionar Indicador</span>
									</button>
								</div>
							))}
						</div>

						<div className="mt-6 flex justify-center">
							<button
								type="button"
								onClick={handlePopulateAllSuggestions}
								className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-600 active:scale-98"
							>
								<Sparkles className="h-4 w-4 text-amber-400" />
								<span>Preencher Dashboard Completo (Recomendado)</span>
							</button>
						</div>
					</section>
				)}

				{/* Grid de Cards Dinâmicos Customizáveis */}
				{!isInitialLoading && cards.length > 0 && (
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
						{cards.map((card, index) => {
							const isDragging = draggedIndex === index;
							const isOver = dragOverIndex === index && draggedIndex !== index;
							const columnSpanClass = getCardColumnSpanClass(card.size);
							const isExpanded = Boolean(card.isExpandedHeight);

							return (
								<div
									key={card.id}
									draggable
									onDragStart={(e) => handleDragStart(e, index)}
									onDragOver={(e) => handleDragOver(e, index)}
									onDrop={(e) => handleDrop(e, index)}
									onDragEnd={handleDragEnd}
									className={`group relative flex flex-col rounded-2xl border bg-white shadow-xs transition-all duration-200 ${columnSpanClass} ${
										isExpanded ? 'min-h-[500px]' : 'min-h-[360px]'
									} ${
										isDragging
											? 'opacity-40 border-dashed border-indigo-400 scale-[0.98]'
											: 'border-slate-200 hover:shadow-md hover:border-slate-300'
									} ${isOver ? 'ring-2 ring-indigo-500 ring-offset-2' : ''}`}
								>
									{/* Header Modular do Card */}
									<div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 shrink-0">
										<div className="flex min-w-0 items-center gap-2">
											{/* Grip de Arrasto HTML5 */}
											<div
												title="Arraste para reorganizar a posição deste gráfico"
												className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-700 p-0.5 rounded transition"
											>
												<GripVertical className="h-4 w-4" />
											</div>

											{/* Ícone e Título do Gráfico */}
											{renderChartIcon(card.chartType)}
											<h3
												className="truncate text-xs font-bold text-slate-800 sm:text-sm"
												title={card.title}
											>
												{card.title}
											</h3>
										</div>

										{/* Controles de Edição: Tamanho (P/M/G), Atualizar, Excluir */}
										<div className="flex items-center gap-1">
											{/* Botões rápidos de navegação (Acessibilidade e Mobile) */}
											<div className="hidden sm:flex items-center gap-0.5 mr-1">
												<button
													type="button"
													onClick={() => handleMoveCard(index, 'left')}
													disabled={index === 0}
													title="Mover para esquerda/cima"
													className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:pointer-events-none"
												>
													<ChevronLeft className="h-3.5 w-3.5" />
												</button>
												<button
													type="button"
													onClick={() => handleMoveCard(index, 'right')}
													disabled={index === cards.length - 1}
													title="Mover para direita/baixo"
													className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:pointer-events-none"
												>
													<ChevronRight className="h-3.5 w-3.5" />
												</button>
											</div>

											{/* Seletor Compacto de Tamanho: P (1 col), M (2 cols), G (full) */}
											<div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-semibold">
												<button
													type="button"
													onClick={() => handleResizeCard(card.id, 'P')}
													className={`rounded px-1.5 py-0.5 transition ${
														card.size === 'P'
															? 'bg-indigo-600 text-white shadow-2xs'
															: 'text-slate-600 hover:text-slate-900'
													}`}
													title="Tamanho Pequeno (1 coluna)"
												>
													P
												</button>
												<button
													type="button"
													onClick={() => handleResizeCard(card.id, 'M')}
													className={`rounded px-1.5 py-0.5 transition ${
														card.size === 'M'
															? 'bg-indigo-600 text-white shadow-2xs'
															: 'text-slate-600 hover:text-slate-900'
													}`}
													title="Tamanho Médio (2 colunas)"
												>
													M
												</button>
												<button
													type="button"
													onClick={() => handleResizeCard(card.id, 'G')}
													className={`rounded px-1.5 py-0.5 transition ${
														card.size === 'G'
															? 'bg-indigo-600 text-white shadow-2xs'
															: 'text-slate-600 hover:text-slate-900'
													}`}
													title="Tamanho Grande (Largura Total)"
												>
													G
												</button>
											</div>

											{/* Botão de Alternar Altura Expandida */}
											<button
												type="button"
												onClick={() => handleToggleHeight(card.id)}
												className={`rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 ${
													isExpanded ? 'text-indigo-600 bg-indigo-50' : ''
												}`}
												title={isExpanded ? 'Recolher altura do gráfico' : 'Expandir altura do gráfico'}
											>
												{isExpanded ? (
													<Minimize2 className="h-3.5 w-3.5" />
												) : (
													<Maximize2 className="h-3.5 w-3.5" />
												)}
											</button>

											{/* Botão de Atualizar Dados Individuais */}
											<button
												type="button"
												onClick={() => handleRefreshSingleCard(card.id)}
												disabled={card.isLoading}
												className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
												title="Recarregar dados deste indicador"
											>
												<RefreshCw className={`h-3.5 w-3.5 ${card.isLoading ? 'animate-spin text-indigo-600' : ''}`} />
											</button>

											{/* Botão de Excluir Card com Confirmação Rápida */}
											{deletingCardId === card.id ? (
												<div className="flex items-center gap-1 rounded-lg bg-rose-50 px-1.5 py-0.5 text-[11px] text-rose-700">
													<span>Excluir?</span>
													<button
														type="button"
														onClick={() => handleDeleteCard(card.id)}
														className="rounded px-1 py-0.5 font-bold text-rose-700 hover:bg-rose-200"
														title="Confirmar exclusão"
													>
														Sim
													</button>
													<button
														type="button"
														onClick={() => setDeletingCardId(null)}
														className="rounded px-1 py-0.5 text-slate-500 hover:bg-slate-200"
														title="Cancelar"
													>
														Não
													</button>
												</div>
											) : (
												<button
													type="button"
													onClick={() => setDeletingCardId(card.id)}
													className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
													title="Remover indicador do painel"
												>
													<Trash2 className="h-3.5 w-3.5" />
												</button>
											)}
										</div>
									</div>

									{/* Corpo do Card: Gráfico via DynamicDashboard encapsulado em ErrorBoundary */}
									<div className="relative flex flex-1 flex-col p-4 overflow-hidden">
										{/* Overlay de carregamento individual */}
										{card.isLoading && (
											<div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-2xs">
												<div className="flex items-center gap-2 text-xs font-semibold text-indigo-700">
													<RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
													<span>Atualizando dados do Sankhya ERP...</span>
												</div>
											</div>
										)}

										{/* Mensagem de erro de atualização individual */}
										{card.error && (
											<div className="mb-2 flex items-center gap-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700 border border-rose-200">
												<AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
												<span className="truncate">{card.error}</span>
											</div>
										)}

										{/* Renderização Segura do Gráfico */}
										<ErrorBoundary
											compact
											fallbackTitle="Falha na renderização visual"
											fallbackMessage="Não foi possível exibir este gráfico com a configuração atual."
										>
											<div className="flex-1 flex flex-col min-h-0 w-full">
												<DynamicDashboard
													configString={card.configString}
													hideHeader={true}
													className="w-full flex-1 flex flex-col min-h-0"
												/>
											</div>
										</ErrorBoundary>

										{/* Rodapé com timestamp sutil */}
										{card.lastRefreshedAt && (
											<div className="mt-2 flex items-center justify-between border-t border-slate-50 pt-2 text-[10px] text-slate-400">
												<span className="truncate max-w-[200px]" title={card.prompt}>
													{card.prompt}
												</span>
												<span className="flex items-center gap-1 shrink-0">
													<Clock className="h-2.5 w-2.5" />
													{new Date(card.lastRefreshedAt).toLocaleTimeString('pt-BR', {
														hour: '2-digit',
														minute: '2-digit',
													})}
												</span>
											</div>
										)}
									</div>
								</div>
							);
						})}
					</div>
				)}
			</main>
		</div>
	);
}
