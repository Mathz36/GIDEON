import { useCallback, useEffect, useState } from 'react';
import {
	ResponsiveContainer,
	AreaChart,
	Area,
	BarChart,
	Bar,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	Legend,
} from 'recharts';
import {
	ThumbsUp,
	ThumbsDown,
	CheckCircle2,
	Clock,
	Search,
	RefreshCw,
	Eye,
	X,
	Users,
	TrendingUp,
	MessageSquare,
	Database,
	Tag,
	AlertTriangle,
	RotateCcw,
} from 'lucide-react';

interface FeedbackItem {
	id: string;
	userId: string;
	userName: string;
	userEmail: string;
	userRole: string;
	conversationId: string | null;
	messageId: string | null;
	rating: 'POSITIVE' | 'NEGATIVE';
	tags: string[];
	comment: string | null;
	userPrompt: string;
	assistantResponse: string;
	contextSummary: string;
	generatedSql: string | null;
	fullConversation: Array<{ role: string; content: string; createdAt?: string }>;
	status: 'PENDING' | 'RESOLVED';
	resolvedAt: string | null;
	resolvedBy: string | null;
	createdAt: string;
	updatedAt: string;
}

interface FeedbackAnalytics {
	summary: {
		totalFeedbacks: number;
		positiveCount: number;
		negativeCount: number;
		positivePercentage: number;
		negativePercentage: number;
		pendingCount: number;
		resolvedCount: number;
	};
	trendData: Array<{
		date: string;
		isoDate: string;
		positive: number;
		negative: number;
		total: number;
		approvalRate: number;
	}>;
	topUsers: Array<{
		userId: string;
		nome: string;
		email: string;
		role: string;
		totalCount: number;
		positiveCount: number;
		negativeCount: number;
		approvalRate: number;
	}>;
	tagBreakdown: Array<{
		tag: string;
		count: number;
		rating: 'POSITIVE' | 'NEGATIVE';
	}>;
}

const DEFAULT_ANALYTICS: FeedbackAnalytics = {
	summary: {
		totalFeedbacks: 0,
		positiveCount: 0,
		negativeCount: 0,
		positivePercentage: 0,
		negativePercentage: 0,
		pendingCount: 0,
		resolvedCount: 0,
	},
	trendData: [],
	topUsers: [],
	tagBreakdown: [],
};

export default function AdminFeedbacks() {
	const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
	const [analytics, setAnalytics] = useState<FeedbackAnalytics>(DEFAULT_ANALYTICS);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState('');

	// Filtros de visualização
	const [ratingFilter, setRatingFilter] = useState<'ALL' | 'NEGATIVE' | 'POSITIVE'>('ALL');
	const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'RESOLVED'>('ALL');
	const [searchQuery, setSearchQuery] = useState('');

	// Estado de atualização de status e modal de conversa completa
	const [updatingId, setUpdatingId] = useState<string | null>(null);
	const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(null);

	const loadData = useCallback(async () => {
		setIsLoading(true);
		setError('');
		try {
			const token = localStorage.getItem('gideon.auth.token');
			const params = new URLSearchParams({
				rating: ratingFilter,
				status: statusFilter,
				...(searchQuery.trim() ? { search: searchQuery.trim() } : {}),
			});

			const response = await fetch(`/api/admin/feedbacks?${params.toString()}`, {
				headers: {
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
			});

			if (!response.ok) {
				throw new Error('Não foi possível carregar os feedbacks e métricas de qualidade.');
			}

			const json = await response.json();
			const payload = json?.data ?? json;
			if (Array.isArray(payload?.feedbacks)) {
				setFeedbacks(payload.feedbacks);
			}
			if (payload?.analytics) {
				setAnalytics(payload.analytics);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao carregar dados.');
		} finally {
			setIsLoading(false);
		}
	}, [ratingFilter, statusFilter, searchQuery]);

	useEffect(() => {
		void loadData();
	}, [loadData]);

	const handleToggleStatus = async (item: FeedbackItem) => {
		const nextStatus: 'PENDING' | 'RESOLVED' =
			item.status === 'RESOLVED' ? 'PENDING' : 'RESOLVED';
		setUpdatingId(item.id);
		try {
			const token = localStorage.getItem('gideon.auth.token');
			const response = await fetch(`/api/admin/feedbacks/${encodeURIComponent(item.id)}/status`, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({ status: nextStatus }),
			});

			if (!response.ok) {
				throw new Error('Falha ao atualizar status da avaliação.');
			}

			await loadData();
			if (selectedFeedback?.id === item.id) {
				const resJson = await response.json();
				if (resJson?.data) {
					setSelectedFeedback(resJson.data);
				}
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao atualizar status.');
		} finally {
			setUpdatingId(null);
		}
	};

	const { summary, trendData, topUsers, tagBreakdown } = analytics;

	return (
		<main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
			{/* Cabeçalho Executivo */}
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div>
					<h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
						Feedbacks & Qualidade da Gideon
					</h1>
					<p className="mt-1 text-xs sm:text-sm text-slate-500">
						Acompanhe o índice de aprovação, evolução temporal, engajamento por usuário e revise manualmente cada avaliação para direcionar a IA.
					</p>
				</div>

				<button
					type="button"
					onClick={() => void loadData()}
					disabled={isLoading}
					className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50 disabled:opacity-50"
				>
					<RefreshCw className={`h-4 w-4 text-indigo-600 ${isLoading ? 'animate-spin' : ''}`} />
					<span>Atualizar Painel</span>
				</button>
			</div>

			{error && (
				<div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
					<AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
					<span>{error}</span>
				</div>
			)}

			{/* 1. Cards de KPI Executivos */}
			<section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
					<div className="flex items-center justify-between">
						<span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
							Total de Avaliações
						</span>
						<div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
							<MessageSquare className="h-4 w-4" />
						</div>
					</div>
					<p className="mt-2 text-2xl font-bold text-slate-900">{summary.totalFeedbacks}</p>
					<p className="mt-1 text-xs text-slate-500">
						{summary.resolvedCount} revisada(s) • {summary.pendingCount} pendente(s)
					</p>
				</div>

				<div className="rounded-2xl border border-emerald-200/80 bg-white p-4 shadow-xs">
					<div className="flex items-center justify-between">
						<span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
							% Feedbacks Positivos
						</span>
						<div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
							<ThumbsUp className="h-4 w-4" />
						</div>
					</div>
					<div className="mt-2 flex items-baseline gap-2">
						<p className="text-2xl font-bold text-emerald-700">{summary.positivePercentage}%</p>
						<span className="text-xs font-medium text-slate-500">
							({summary.positiveCount} 👍)
						</span>
					</div>
					<div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
						<div
							className="h-full rounded-full bg-emerald-500 transition-all duration-500"
							style={{ width: `${Math.min(100, summary.positivePercentage)}%` }}
						/>
					</div>
				</div>

				<div className="rounded-2xl border border-rose-200/80 bg-white p-4 shadow-xs">
					<div className="flex items-center justify-between">
						<span className="text-xs font-semibold uppercase tracking-wider text-rose-700">
							% Feedbacks Negativos
						</span>
						<div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
							<ThumbsDown className="h-4 w-4" />
						</div>
					</div>
					<div className="mt-2 flex items-baseline gap-2">
						<p className="text-2xl font-bold text-rose-700">{summary.negativePercentage}%</p>
						<span className="text-xs font-medium text-slate-500">
							({summary.negativeCount} 👎)
						</span>
					</div>
					<div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
						<div
							className="h-full rounded-full bg-rose-500 transition-all duration-500"
							style={{ width: `${Math.min(100, summary.negativePercentage)}%` }}
						/>
					</div>
				</div>

				<div className="rounded-2xl border border-amber-200/80 bg-white p-4 shadow-xs">
					<div className="flex items-center justify-between">
						<span className="text-xs font-semibold uppercase tracking-wider text-amber-800">
							Pendentes de Revisão
						</span>
						<div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
							<Clock className="h-4 w-4" />
						</div>
					</div>
					<p className="mt-2 text-2xl font-bold text-amber-700">{summary.pendingCount}</p>
					<p className="mt-1 text-xs text-slate-500">
						Aguardando análise e marcação como resolvido
					</p>
				</div>
			</section>

			{/* 2. Gráficos do Dashboard de Qualidade (Tendência Temporal & Top Usuários) */}
			<section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
				{/* Gráfico de Tendência de Feedback ao longo do tempo */}
				<div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-xs lg:col-span-2">
					<div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5">
						<div className="flex items-center gap-2">
							<TrendingUp className="h-4 w-4 text-indigo-600" />
							<div>
								<h2 className="text-sm font-bold text-slate-800">
									Tendência de Feedbacks ao Longo do Tempo
								</h2>
								<p className="text-[11px] text-slate-500">
									Evolução diária de avaliações Positivas (👍) vs Negativas (👎) para medir a melhoria contínua
								</p>
							</div>
						</div>
					</div>

					{trendData.length === 0 ? (
						<div className="flex h-64 flex-col items-center justify-center text-center text-xs text-slate-400">
							<TrendingUp className="mb-2 h-7 w-7 text-slate-300" />
							<p>Ainda não há avaliações suficientes para traçar a curva de tendência.</p>
						</div>
					) : (
						<div className="h-64 w-full pt-2">
							<ResponsiveContainer width="100%" height="100%">
								<AreaChart data={trendData} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
									<CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
									<XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} />
									<YAxis stroke="#64748b" fontSize={11} tickLine={false} allowDecimals={false} />
									<Tooltip
										contentStyle={{
											backgroundColor: '#0f172a',
											borderRadius: '0.75rem',
											border: '1px solid #334155',
											color: '#fff',
											fontSize: '0.75rem',
										}}
									/>
									<Legend wrapperStyle={{ fontSize: '0.75rem', paddingTop: '8px' }} />
									<Area
										type="monotone"
										dataKey="positive"
										name="Positivos (👍)"
										stroke="#10b981"
										fill="#10b981"
										fillOpacity={0.2}
										strokeWidth={2.5}
									/>
									<Area
										type="monotone"
										dataKey="negative"
										name="Negativos (👎)"
										stroke="#f43f5e"
										fill="#f43f5e"
										fillOpacity={0.18}
										strokeWidth={2.5}
									/>
								</AreaChart>
							</ResponsiveContainer>
						</div>
					)}
				</div>

				{/* Ranking de Usuários que Mais Avaliam */}
				<div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
					<div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5">
						<div className="flex items-center gap-2">
							<Users className="h-4 w-4 text-indigo-600" />
							<div>
								<h2 className="text-sm font-bold text-slate-800">
									Usuários que Mais Avaliam
								</h2>
								<p className="text-[11px] text-slate-500">
									Participação e taxa de aprovação por usuário
								</p>
							</div>
						</div>
					</div>

					{topUsers.length === 0 ? (
						<div className="flex h-64 flex-col items-center justify-center text-center text-xs text-slate-400">
							<Users className="mb-2 h-7 w-7 text-slate-300" />
							<p>Nenhum usuário registrou avaliações até o momento.</p>
						</div>
					) : (
						<div className="flex-1 space-y-3 overflow-y-auto pr-1 custom-scrollbar">
							<div className="h-36 w-full">
								<ResponsiveContainer width="100%" height="100%">
									<BarChart
										layout="vertical"
										data={topUsers.slice(0, 5)}
										margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
									>
										<CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
										<XAxis type="number" fontSize={10} allowDecimals={false} />
										<YAxis
											type="category"
											dataKey="nome"
											width={85}
											fontSize={10}
											tickFormatter={(v) =>
												String(v).length > 12 ? `${String(v).slice(0, 12)}…` : String(v)
											}
										/>
										<Tooltip
											contentStyle={{
												backgroundColor: '#0f172a',
												borderRadius: '0.75rem',
												border: '1px solid #334155',
												color: '#fff',
												fontSize: '0.72rem',
											}}
										/>
										<Bar dataKey="positiveCount" name="Positivos" stackId="a" fill="#10b981" />
										<Bar dataKey="negativeCount" name="Negativos" stackId="a" fill="#f43f5e" />
									</BarChart>
								</ResponsiveContainer>
							</div>

							<div className="space-y-1.5 border-t border-slate-100 pt-2">
								{topUsers.slice(0, 5).map((u, idx) => (
									<div
										key={u.userId}
										className="flex items-center justify-between rounded-xl bg-slate-50 px-2.5 py-1.5 text-xs"
									>
										<div className="min-w-0 flex-1">
											<p className="truncate font-semibold text-slate-800">
												{idx + 1}. {u.nome}
											</p>
											<p className="truncate text-[10px] text-slate-400">{u.email}</p>
										</div>
										<div className="flex items-center gap-2 shrink-0">
											<span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
												👍 {u.positiveCount}
											</span>
											<span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
												👎 {u.negativeCount}
											</span>
											<span className="font-mono text-[11px] font-bold text-slate-700">
												{u.totalCount} total
											</span>
										</div>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			</section>

			{/* Motivos / Tags mais frequentes (se houver) */}
			{tagBreakdown.length > 0 && (
				<section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
					<div className="mb-2.5 flex items-center gap-2">
						<Tag className="h-4 w-4 text-indigo-600" />
						<h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
							Principais Motivos Apontados nas Avaliações
						</h3>
					</div>
					<div className="flex flex-wrap gap-2">
						{tagBreakdown.map((item) => (
							<span
								key={`${item.rating}-${item.tag}`}
								className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
									item.rating === 'POSITIVE'
										? 'border-emerald-200 bg-emerald-50 text-emerald-800'
										: 'border-rose-200 bg-rose-50 text-rose-800'
								}`}
							>
								<span>{item.rating === 'POSITIVE' ? '👍' : '👎'}</span>
								<span>{item.tag}</span>
								<strong className="ml-0.5 rounded-full bg-white/80 px-1.5 py-0.2 text-[10px]">
									{item.count}
								</strong>
							</span>
						))}
					</div>
				</section>
			)}

			{/* 3. Central de Triagem e Resolução Manual de Feedbacks */}
			<section className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
				<div className="border-b border-slate-200 bg-slate-50/70 p-4 space-y-3">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 className="text-sm font-bold text-slate-900">
								Histórico de Respostas Avaliadas
							</h2>
							<p className="text-xs text-slate-500">
								Filtre por avaliações positivas ou negativas, inspecione a conversa completa e marque como resolvido após realizar os ajustes.
							</p>
						</div>

						{/* Busca Textual */}
						<div className="relative w-full sm:w-72">
							<Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
							<input
								type="text"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="Buscar por usuário, pergunta ou tag..."
								className="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-800 outline-none focus:border-indigo-500"
							/>
						</div>
					</div>

					{/* Abas de Filtro: Positivos vs Negativos & Pendentes vs Resolvidos */}
					<div className="flex flex-wrap items-center justify-between gap-2 pt-1">
						<div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
							<button
								type="button"
								onClick={() => setRatingFilter('ALL')}
								className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
									ratingFilter === 'ALL'
										? 'bg-indigo-600 text-white'
										: 'text-slate-600 hover:bg-slate-100'
								}`}
							>
								Todos ({summary.totalFeedbacks})
							</button>
							<button
								type="button"
								onClick={() => setRatingFilter('NEGATIVE')}
								className={`inline-flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-semibold transition ${
									ratingFilter === 'NEGATIVE'
										? 'bg-rose-600 text-white'
										: 'text-rose-700 hover:bg-rose-50'
								}`}
							>
								<ThumbsDown className="h-3 w-3" />
								<span>Negativos ({summary.negativeCount})</span>
							</button>
							<button
								type="button"
								onClick={() => setRatingFilter('POSITIVE')}
								className={`inline-flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-semibold transition ${
									ratingFilter === 'POSITIVE'
										? 'bg-emerald-600 text-white'
										: 'text-emerald-700 hover:bg-emerald-50'
								}`}
							>
								<ThumbsUp className="h-3 w-3" />
								<span>Positivos ({summary.positiveCount})</span>
							</button>
						</div>

						<div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
							<button
								type="button"
								onClick={() => setStatusFilter('ALL')}
								className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
									statusFilter === 'ALL'
										? 'bg-slate-800 text-white'
										: 'text-slate-600 hover:bg-slate-100'
								}`}
							>
								Todos os Status
							</button>
							<button
								type="button"
								onClick={() => setStatusFilter('PENDING')}
								className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
									statusFilter === 'PENDING'
										? 'bg-amber-500 text-white'
										: 'text-amber-800 hover:bg-amber-50'
								}`}
							>
								<Clock className="h-3 w-3" />
								<span>Pendentes ({summary.pendingCount})</span>
							</button>
							<button
								type="button"
								onClick={() => setStatusFilter('RESOLVED')}
								className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
									statusFilter === 'RESOLVED'
										? 'bg-emerald-600 text-white'
										: 'text-emerald-800 hover:bg-emerald-50'
								}`}
							>
								<CheckCircle2 className="h-3 w-3" />
								<span>Resolvidos ({summary.resolvedCount})</span>
							</button>
						</div>
					</div>
				</div>

				{/* Lista de Avaliações */}
				<div className="divide-y divide-slate-200">
					{feedbacks.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-12 px-4 text-center">
							<MessageSquare className="mb-2 h-8 w-8 text-slate-300" />
							<p className="text-sm font-semibold text-slate-700">
								Nenhuma avaliação encontrada para este filtro
							</p>
							<p className="mt-1 text-xs text-slate-400">
								Quando os usuários avaliarem respostas com 👍 ou 👎 no Chat, elas aparecerão aqui com todo o contexto.
							</p>
						</div>
					) : (
						feedbacks.map((item) => {
							const isPositive = item.rating === 'POSITIVE';
							const isResolved = item.status === 'RESOLVED';

							return (
								<div
									key={item.id}
									className={`p-4 transition hover:bg-slate-50/80 ${
										isResolved ? 'bg-slate-50/40' : ''
									}`}
								>
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div className="space-y-1.5 min-w-0 flex-1">
											<div className="flex flex-wrap items-center gap-2">
												<span
													className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${
														isPositive
															? 'border-emerald-200 bg-emerald-50 text-emerald-700'
															: 'border-rose-200 bg-rose-50 text-rose-700'
													}`}
												>
													{isPositive ? (
														<>
															<ThumbsUp className="h-3 w-3" />
															<span>Positivo</span>
														</>
													) : (
														<>
															<ThumbsDown className="h-3 w-3" />
															<span>Negativo</span>
														</>
													)}
												</span>

												<span
													className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
														isResolved
															? 'border-emerald-200 bg-emerald-50/70 text-emerald-800'
															: 'border-amber-200 bg-amber-50 text-amber-800'
													}`}
												>
													{isResolved ? (
														<>
															<CheckCircle2 className="h-3 w-3 text-emerald-600" />
															<span>
																Resolvido
																{item.resolvedBy ? ` por ${item.resolvedBy}` : ''}
															</span>
														</>
													) : (
														<>
															<Clock className="h-3 w-3 text-amber-600" />
															<span>Pendente de Revisão</span>
														</>
													)}
												</span>

												<span className="text-xs font-semibold text-slate-800">
													{item.userName}
												</span>
												<span className="text-xs text-slate-400">({item.userEmail})</span>
												<span className="text-[11px] text-slate-400">
													• {new Date(item.createdAt).toLocaleString('pt-BR')}
												</span>
											</div>

											{/* Resumo do Contexto da Resposta */}
											<p className="text-xs font-medium text-slate-800 bg-slate-100/80 rounded-xl px-3 py-2 border border-slate-200/70">
												{item.contextSummary}
											</p>

											{/* Tags e Comentário do Usuário */}
											{(item.tags.length > 0 || item.comment) && (
												<div className="flex flex-wrap items-center gap-2 pt-1">
													{item.tags.map((tag) => (
														<span
															key={tag}
															className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700"
														>
															#{tag}
														</span>
													))}
													{item.comment && (
														<span className="text-xs italic text-slate-700 bg-amber-50/90 border border-amber-200/80 rounded-lg px-2.5 py-1">
															&ldquo;{item.comment}&rdquo;
														</span>
													)}
												</div>
											)}
										</div>

										{/* Botões de Ação: Ver Conversa Completa & Marcar como Resolvido */}
										<div className="flex items-center gap-2 shrink-0">
											<button
												type="button"
												onClick={() => setSelectedFeedback(item)}
												className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:border-indigo-200 hover:bg-indigo-50/50 hover:text-indigo-700"
											>
												<Eye className="h-3.5 w-3.5" />
												<span>Ver Conversa Completa</span>
											</button>

											<button
												type="button"
												disabled={updatingId === item.id}
												onClick={() => void handleToggleStatus(item)}
												className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold shadow-2xs transition disabled:opacity-50 ${
													isResolved
														? 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
														: 'bg-emerald-600 text-white hover:bg-emerald-700'
												}`}
											>
												{isResolved ? (
													<>
														<RotateCcw className="h-3.5 w-3.5" />
														<span>Reabrir</span>
													</>
												) : (
													<>
														<CheckCircle2 className="h-3.5 w-3.5" />
														<span>Marcar como Resolvido</span>
													</>
												)}
											</button>
										</div>
									</div>
								</div>
							);
						})
					)}
				</div>
			</section>

			{/* Modal de Auditoria: Resumo, Pergunta, Resposta, SQL e Conversa Completa */}
			{selectedFeedback && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
					role="dialog"
					aria-modal="true"
				>
					<div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
							<div className="flex items-center gap-2.5">
								<span
									className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${
										selectedFeedback.rating === 'POSITIVE'
											? 'border-emerald-200 bg-emerald-50 text-emerald-700'
											: 'border-rose-200 bg-rose-50 text-rose-700'
									}`}
								>
									{selectedFeedback.rating === 'POSITIVE' ? '👍 Positivo' : '👎 Negativo'}
								</span>
								<div>
									<h3 className="text-sm font-bold text-slate-900">
										Auditoria Completa da Avaliação
									</h3>
									<p className="text-xs text-slate-500">
										Avaliado por <strong>{selectedFeedback.userName}</strong> ({selectedFeedback.userEmail}) em{' '}
										{new Date(selectedFeedback.createdAt).toLocaleString('pt-BR')}
									</p>
								</div>
							</div>

							<button
								type="button"
								onClick={() => setSelectedFeedback(null)}
								className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700"
							>
								<X className="h-4 w-4" />
							</button>
						</div>

						<div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar text-xs">
							{/* Motivos e Comentário do Usuário */}
							{(selectedFeedback.tags.length > 0 || selectedFeedback.comment) && (
								<div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 space-y-2">
									<span className="font-bold uppercase tracking-wider text-amber-900 text-[11px]">
										Observações do Usuário
									</span>
									{selectedFeedback.tags.length > 0 && (
										<div className="flex flex-wrap gap-1.5">
											{selectedFeedback.tags.map((t) => (
												<span
													key={t}
													className="rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-900 border border-amber-200"
												>
													#{t}
												</span>
											))}
										</div>
									)}
									{selectedFeedback.comment && (
										<p className="text-slate-800 font-medium">
											Comentário: &ldquo;{selectedFeedback.comment}&rdquo;
										</p>
									)}
								</div>
							)}

							{/* Turno Avaliado: Pergunta e Resposta */}
							<div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
								<div>
									<span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
										Pergunta do Usuário neste turno:
									</span>
									<p className="mt-1 rounded-lg bg-white p-2.5 text-slate-800 border border-slate-200 font-medium">
										{selectedFeedback.userPrompt}
									</p>
								</div>

								<div>
									<span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
										Resposta da Gideon avaliada:
									</span>
									<pre className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white p-2.5 font-sans text-slate-800 border border-slate-200 custom-scrollbar">
										{selectedFeedback.assistantResponse}
									</pre>
								</div>

								{selectedFeedback.generatedSql && (
									<div>
										<span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700">
											<Database className="h-3 w-3" />
											Query SQL Executada no RAG:
										</span>
										<pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900 p-2.5 font-mono text-[11px] text-slate-100">
											{selectedFeedback.generatedSql}
										</pre>
									</div>
								)}
							</div>

							{/* Conversa Completa Armazenada */}
							<div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
								<span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
									Conversa Completa ({selectedFeedback.fullConversation.length} mensagens no momento da avaliação)
								</span>
								<div className="max-h-64 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
									{selectedFeedback.fullConversation.map((msg, idx) => (
										<div
											key={idx}
											className={`rounded-xl p-2.5 ${
												msg.role === 'user'
													? 'bg-indigo-50/80 border border-indigo-100 text-indigo-950 ml-6'
													: 'bg-slate-50 border border-slate-200 text-slate-800 mr-6'
											}`}
										>
											<span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
												{msg.role === 'user' ? selectedFeedback.userName : 'Gideon'}
											</span>
											<p className="whitespace-pre-wrap break-words">{msg.content}</p>
										</div>
									))}
								</div>
							</div>
						</div>

						<div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3">
							<button
								type="button"
								disabled={updatingId === selectedFeedback.id}
								onClick={() => void handleToggleStatus(selectedFeedback)}
								className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition ${
									selectedFeedback.status === 'RESOLVED'
										? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
										: 'bg-emerald-600 text-white hover:bg-emerald-700'
								}`}
							>
								<CheckCircle2 className="h-4 w-4" />
								<span>
									{selectedFeedback.status === 'RESOLVED'
										? 'Reabrir como Pendente'
										: 'Marcar como Resolvido'}
								</span>
							</button>

							<button
								type="button"
								onClick={() => setSelectedFeedback(null)}
								className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
							>
								Fechar
							</button>
						</div>
					</div>
				</div>
			)}
		</main>
	);
}
