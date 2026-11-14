import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import {
	Sparkles,
	Send,
	Square,
	TrendingUp,
	Users,
	Package,
	ChevronRight,
	RotateCcw,
	AlertTriangle,
	CheckCircle2,
	Loader2,
	Lightbulb,
	X,
	Plus,
	MessageSquare,
	Pin,
	Pencil,
	Trash2,
	Check,
	Brain,
	PanelLeftClose,
	PanelLeftOpen,
	Archive,
	ChevronDown,
	ChevronUp,
	ThumbsUp,
	ThumbsDown,
} from 'lucide-react';
import { DynamicDashboard } from '../components/chat/DynamicDashboard';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import { useChat } from '../hooks/useChat';
import type { ChatMessage, ChatStatusStep, UserMemoryItem } from '../hooks/useChat';

interface SuggestedCategory {
	id: string;
	title: string;
	badge: string;
	icon: React.ReactNode;
	accentClass: string;
	prompts: Array<{
		label: string;
		query: string;
	}>;
}

const SUGGESTED_CATEGORIES: SuggestedCategory[] = [
	{
		id: 'sales',
		title: '📊 Faturamento & Vendas',
		badge: 'Comercial',
		icon: <TrendingUp className="h-4 w-4 text-indigo-600" />,
		accentClass: 'border-indigo-100 hover:border-indigo-300 hover:bg-indigo-50/40',
		prompts: [
			{
				label: 'Resumo de faturamento e evolução de vendas',
				query: 'Gere um resumo executivo do faturamento e evolução das vendas recentes com um gráfico comparativo.',
			},
			{
				label: 'Top 10 maiores pedidos e notas de venda',
				query: 'Quais são os 10 maiores pedidos/notas de venda registrados? Mostre em formato de tabela ou gráfico.',
			},
		],
	},
	{
		id: 'customers',
		title: '👥 Clientes & Limite de Crédito',
		badge: ' Financeiro / CRM',
		icon: <Users className="h-4 w-4 text-emerald-600" />,
		accentClass: 'border-emerald-100 hover:border-emerald-300 hover:bg-emerald-50/40',
		prompts: [
			{
				label: 'Clientes com maior limite de crédito',
				query: 'Liste os clientes ativos com maior limite de crédito disponível no Sankhya ERP em uma visualização clara.',
			},
			{
				label: 'Ranking de clientes por volume de compras',
				query: 'Quais são os principais clientes por volume financeiro de compras? Apresente um gráfico de barras.',
			},
		],
	},
	{
		id: 'inventory',
		title: '📦 Estoque & Produtos',
		badge: 'Catálogo ERP',
		icon: <Package className="h-4 w-4 text-amber-600" />,
		accentClass: 'border-amber-100 hover:border-amber-300 hover:bg-amber-50/40',
		prompts: [
			{
				label: 'Produtos mais vendidos no período',
				query: 'Quais são os produtos com maior participação nas vendas? Mostre os indicadores e quantidades.',
			},
			{
				label: 'Consulta geral de produtos ativos no ERP',
				query: 'Mostre um panorama dos produtos ativos sincronizados do Sankhya ERP com seus respectivos códigos e unidades.',
			},
		],
	},
];

const LOADING_STEPS = [
	{
		title: 'Analisando pergunta e contexto...',
		subtitle: 'Interpretando histórico da conversa (Query Rewriter)',
	},
	{
		title: 'Consultando dados sincronizados do Sankhya ERP...',
		subtitle: 'Executando leitura segura nas tabelas espelhadas do PostgreSQL',
	},
	{
		title: 'Elaborando análise e indicadores...',
		subtitle: 'Consolidando números reais e formatando visualização',
	},
	{
		title: 'Auditando resposta (Agente Revisor)...',
		subtitle: 'Verificando precisão factual contra o banco de dados',
	},
];

const MEMORY_CATEGORY_LABELS: Record<string, { label: string; colorClass: string }> = {
	PREFERENCIA_COMUNICACAO: {
		label: 'Comunicação & Tratamento',
		colorClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
	},
	PREFERENCIA_ANALISE: {
		label: 'Análise & Gráficos',
		colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
	},
	CONTEXTO_CARGO_FOCO: {
		label: 'Cargo & Atuação',
		colorClass: 'bg-amber-50 text-amber-800 border-amber-200',
	},
	PREFERENCIA_GERAL: {
		label: 'Preferência Geral',
		colorClass: 'bg-slate-100 text-slate-700 border-slate-200',
	},
	preferencia_tratamento: {
		label: 'Como tratar você',
		colorClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
	},
	preferencia_comunicacao: {
		label: 'Estilo de resposta',
		colorClass: 'bg-violet-50 text-violet-700 border-violet-200',
	},
	preferencia_analise: {
		label: 'Análise & Gráficos',
		colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
	},
	contexto_cargo: {
		label: 'Cargo & Atuação',
		colorClass: 'bg-amber-50 text-amber-800 border-amber-200',
	},
	geral: {
		label: 'Preferência Geral',
		colorClass: 'bg-slate-100 text-slate-700 border-slate-200',
	},
};

function formatRelativeDate(isoDate: string): string {
	try {
		const date = new Date(isoDate);
		const diffMs = Date.now() - date.getTime();
		const diffMin = Math.floor(diffMs / 60000);
		if (diffMin < 1) return 'Agora';
		if (diffMin < 60) return `${diffMin}m atrás`;
		const diffHours = Math.floor(diffMin / 60);
		if (diffHours < 24) return `${diffHours}h atrás`;
		const diffDays = Math.floor(diffHours / 24);
		if (diffDays < 7) return `${diffDays}d atrás`;
		return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
	} catch {
		return '';
	}
}

interface DidacticProgressIndicatorProps {
	statusStep?: ChatStatusStep | null;
}

const DidacticProgressIndicator: React.FC<DidacticProgressIndicatorProps> = React.memo(({ statusStep }) => {
	const [fallbackStep, setFallbackStep] = useState(0);

	useEffect(() => {
		const timer1 = window.setTimeout(() => setFallbackStep(1), 1100);
		const timer2 = window.setTimeout(() => setFallbackStep(2), 2400);
		const timer3 = window.setTimeout(() => setFallbackStep(3), 4200);
		return () => {
			window.clearTimeout(timer1);
			window.clearTimeout(timer2);
			window.clearTimeout(timer3);
		};
	}, []);

	const activeStep = statusStep ? Math.min(LOADING_STEPS.length - 1, Math.max(0, statusStep.step - 1)) : fallbackStep;

	return (
		<div
			className="my-1 flex flex-col gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 text-xs text-slate-700"
			role="status"
			aria-live="polite"
		>
			<div className="flex items-center justify-between gap-2">
				<span className="inline-flex items-center gap-1.5 font-semibold text-indigo-700">
					<Sparkles className="h-3.5 w-3.5 animate-pulse" />
					Gideon em ação
				</span>
				<span className="font-mono text-[10px] font-medium text-indigo-500">
					Etapa {activeStep + 1} de {LOADING_STEPS.length}
				</span>
			</div>

			<div className="space-y-2">
				{LOADING_STEPS.map((step, index) => {
					const isCompleted = index < activeStep;
					const isCurrent = index === activeStep;
					const displayTitle = isCurrent && statusStep?.title ? statusStep.title : step.title;
					const displaySubtitle = isCurrent && statusStep?.subtitle ? statusStep.subtitle : step.subtitle;
					return (
						<div
							key={step.title}
							className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-all duration-300 ${
								isCurrent
									? 'bg-white shadow-sm ring-1 ring-indigo-100'
									: isCompleted
										? 'opacity-75'
										: 'opacity-40'
							}`}
						>
							<div className="mt-0.5 shrink-0">
								{isCompleted ? (
									<CheckCircle2 className="h-4 w-4 text-emerald-600" />
								) : isCurrent ? (
									<Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
								) : (
									<div className="h-4 w-4 rounded-full border border-slate-300" />
								)}
							</div>
							<div className="min-w-0 flex-1">
								<p className={`font-medium ${isCurrent ? 'text-slate-900' : 'text-slate-600'}`}>
									{displayTitle}
								</p>
								{isCurrent && (
									<p className="mt-0.5 text-[11px] text-slate-500">{displaySubtitle}</p>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
});

DidacticProgressIndicator.displayName = 'DidacticProgressIndicator';

const markdownComponents = {
	code({ inline, className, children, ...props }: any) {
		const match = /language-(\w+)/.exec(className || '');
		const language = match ? match[1] : '';

		// Intercepta a UI Generativa (Dashboard)
		if (!inline && language === 'dashboard') {
			const rawContent = Array.isArray(children)
				? children.map((c) => (typeof c === 'string' ? c : '')).join('')
				: String(children ?? '');

			return (
				<ErrorBoundary
					compact
					fallbackTitle="Visualização indisponível"
					fallbackMessage="Não foi possível renderizar este gráfico interativo."
				>
					<DynamicDashboard configString={rawContent} />
				</ErrorBoundary>
			);
		}

		// Renderiza blocos de código normais (SQL, JSON puro, etc)
		return !inline && match ? (
			<div className="my-3 overflow-hidden rounded-xl border border-slate-700">
				<div className="bg-slate-800 px-3 py-1 font-mono text-xs uppercase tracking-wider text-slate-400">
					{language}
				</div>
				<pre className="overflow-x-auto bg-slate-900 p-3 text-xs text-slate-100 custom-scrollbar">
					<code className={className} {...props}>
						{children}
					</code>
				</pre>
			</div>
		) : (
			<code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-pink-600" {...props}>
				{children}
			</code>
		);
	},
	table({ children }: any) {
		return (
			<div className="my-3 overflow-x-auto rounded-xl border border-slate-200 custom-scrollbar">
				<table className="min-w-full divide-y divide-slate-200 text-left text-xs text-slate-700">
					{children}
				</table>
			</div>
		);
	},
	th({ children }: any) {
		return (
			<th className="bg-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-800">
				{children}
			</th>
		);
	},
	td({ children }: any) {
		return <td className="whitespace-nowrap border-t border-slate-100 px-3 py-2 text-xs">{children}</td>;
	},
};

interface ChatMessageItemProps {
	message: ChatMessage;
	isStreaming: boolean;
	statusStep?: ChatStatusStep | null;
	userPrompt?: string;
	conversationId?: string | null;
	fullConversationSnapshot?: ChatMessage[];
}

const POSITIVE_FEEDBACK_TAGS = [
	'Números exatos',
	'Excelente explicação',
	'Gráfico muito útil',
	'Rápida e direta',
];

const NEGATIVE_FEEDBACK_TAGS = [
	'Informação incorreta',
	'Faltou informação',
	'Valor / Cálculo incorreto',
	'Gráfico inadequado',
	'Não entendeu a pergunta',
	'Outro motivo',
];

const ChatMessageItem: React.FC<ChatMessageItemProps> = React.memo(
	({
		message,
		isStreaming,
		statusStep,
		userPrompt = '',
		conversationId = null,
		fullConversationSnapshot = [],
	}) => {
		const isUser = message.role === 'user';
		const [selectedRating, setSelectedRating] = useState<'POSITIVE' | 'NEGATIVE' | null>(null);
		const [selectedTags, setSelectedTags] = useState<string[]>([]);
		const [comment, setComment] = useState('');
		const [showDetailsForm, setShowDetailsForm] = useState(false);
		const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
		const [feedbackSaved, setFeedbackSaved] = useState(false);

		const submitFeedbackToApi = async (
			rating: 'POSITIVE' | 'NEGATIVE',
			tagsToSend: string[],
			commentToSend: string,
		) => {
			setIsSubmittingFeedback(true);
			try {
				const token = localStorage.getItem('gideon.auth.token');
				await fetch('/api/chat/feedback', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						...(token ? { Authorization: `Bearer ${token}` } : {}),
					},
					body: JSON.stringify({
						messageId: message.id,
						conversationId,
						rating,
						tags: tagsToSend,
						comment: commentToSend.trim() || null,
						userPrompt,
						assistantResponse: message.content,
						fullConversation: fullConversationSnapshot.map((m) => ({
							role: m.role,
							content: m.content,
							createdAt: m.createdAt,
						})),
					}),
				});
				setFeedbackSaved(true);
			} catch {
				// Silencioso para não interromper a experiência do chat
			} finally {
				setIsSubmittingFeedback(false);
			}
		};

		const handleRateClick = (rating: 'POSITIVE' | 'NEGATIVE') => {
			setSelectedRating(rating);
			setSelectedTags([]);
			setShowDetailsForm(true);
			void submitFeedbackToApi(rating, [], comment);
		};

		const handleToggleTag = (tag: string) => {
			setSelectedTags((prev) =>
				prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
			);
		};

		const handleSaveDetailedFeedback = async (e: React.FormEvent) => {
			e.preventDefault();
			if (!selectedRating) return;
			await submitFeedbackToApi(selectedRating, selectedTags, comment);
			setShowDetailsForm(false);
		};

		return (
			<div className={`flex gap-2.5 sm:gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
				{!isUser && (
					<div
						className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-xs font-bold text-white shadow-sm"
						aria-hidden="true"
					>
						G
					</div>
				)}
				<div
					className={
						isUser
							? 'max-w-[88%] sm:max-w-[80%] rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-3 text-sm leading-6 text-white shadow-sm'
							: 'w-full max-w-[92%] sm:max-w-[85%] rounded-2xl rounded-tl-sm border border-slate-200/90 bg-white px-3.5 py-3 sm:px-4 text-sm leading-6 text-slate-800 shadow-sm'
					}
				>
					{!isUser ? (
						message.content ? (
							<div>
								<div className="prose prose-sm prose-slate max-w-none break-words">
									<ReactMarkdown components={markdownComponents}>{message.content}</ReactMarkdown>
									{isStreaming && (
										<span
											className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-indigo-600 align-middle"
											aria-label="Gerando resposta"
										/>
									)}
								</div>

								{/* Barra de Avaliação da Resposta (exibida após finalizar o streaming) */}
								{!isStreaming && (
									<div className="mt-3 border-t border-slate-100 pt-2.5">
										<div className="flex flex-wrap items-center justify-between gap-2">
											<span className="text-[11px] font-medium text-slate-400">
												{feedbackSaved && !showDetailsForm
													? 'Obrigado! Sua avaliação foi registrada para evolução da Gideon.'
													: 'Esta resposta foi útil?'}
											</span>

											<div className="flex items-center gap-1.5">
												<button
													type="button"
													onClick={() => handleRateClick('POSITIVE')}
													disabled={isSubmittingFeedback}
													title="Avaliar positivamente (Resposta útil e precisa)"
													className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
														selectedRating === 'POSITIVE'
															? 'border-emerald-300 bg-emerald-50 text-emerald-700 font-semibold'
															: 'border-slate-200 bg-slate-50/70 text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/50 hover:text-emerald-700'
													}`}
												>
													<ThumbsUp className="h-3.5 w-3.5" />
													<span>Útil</span>
												</button>

												<button
													type="button"
													onClick={() => handleRateClick('NEGATIVE')}
													disabled={isSubmittingFeedback}
													title="Avaliar negativamente (Precisa melhorar ou corrigir)"
													className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
														selectedRating === 'NEGATIVE'
															? 'border-rose-300 bg-rose-50 text-rose-700 font-semibold'
															: 'border-slate-200 bg-slate-50/70 text-slate-600 hover:border-rose-200 hover:bg-rose-50/50 hover:text-rose-700'
													}`}
												>
													<ThumbsDown className="h-3.5 w-3.5" />
													<span>Precisa melhorar</span>
												</button>
											</div>
										</div>

										{/* Popover inline para complementar a avaliação com tags e comentário opcional */}
										{showDetailsForm && selectedRating && (
											<form
												onSubmit={handleSaveDetailedFeedback}
												className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50/90 p-3 text-xs space-y-2.5"
											>
												<div className="flex items-center justify-between">
													<span className="font-semibold text-slate-700">
														{selectedRating === 'POSITIVE'
															? '👍 O que você mais gostou nesta resposta? (Opcional)'
															: '👎 O que podemos melhorar ou corrigir? (Opcional)'}
													</span>
													<button
														type="button"
														onClick={() => setShowDetailsForm(false)}
														className="text-slate-400 hover:text-slate-600"
														title="Fechar detalhes"
													>
														<X className="h-3.5 w-3.5" />
													</button>
												</div>

												<div className="flex flex-wrap gap-1.5">
													{(selectedRating === 'POSITIVE'
														? POSITIVE_FEEDBACK_TAGS
														: NEGATIVE_FEEDBACK_TAGS
													).map((tag) => {
														const isSelected = selectedTags.includes(tag);
														return (
															<button
																key={tag}
																type="button"
																onClick={() => handleToggleTag(tag)}
																className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
																	isSelected
																		? selectedRating === 'POSITIVE'
																			? 'border-emerald-400 bg-emerald-100 text-emerald-800'
																			: 'border-rose-400 bg-rose-100 text-rose-800'
																		: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
																}`}
															>
																{tag}
															</button>
														);
													})}
												</div>

												<div className="flex items-center gap-2">
													<input
														type="text"
														value={comment}
														onChange={(e) => setComment(e.target.value)}
														placeholder={
															selectedRating === 'POSITIVE'
																? 'Comentário adicional (opcional)...'
																: 'Descreva o erro ou orientação para revisão (opcional)...'
														}
														className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-indigo-500"
													/>
													<button
														type="submit"
														disabled={isSubmittingFeedback}
														className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
													>
														Enviar
													</button>
												</div>
											</form>
										)}
									</div>
								)}
							</div>
						) : (
							<DidacticProgressIndicator statusStep={statusStep} />
						)
					) : (
						<p className="whitespace-pre-wrap break-words">{message.content}</p>
					)}
				</div>
			</div>
		);
	},
	(prevProps, nextProps) =>
		prevProps.message.id === nextProps.message.id &&
		prevProps.message.content === nextProps.message.content &&
		prevProps.message.role === nextProps.message.role &&
		prevProps.isStreaming === nextProps.isStreaming &&
		prevProps.conversationId === nextProps.conversationId &&
		prevProps.statusStep?.step === nextProps.statusStep?.step &&
		prevProps.statusStep?.title === nextProps.statusStep?.title
);

ChatMessageItem.displayName = 'ChatMessageItem';

export default function Chat() {
	const [input, setInput] = useState('');
	const [showSuggestionsDrawer, setShowSuggestionsDrawer] = useState(false);
	const [isSidebarOpen, setIsSidebarOpen] = useState(true);
	const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

	// Estados de edição de conversa na sidebar
	const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
	const [editingTitle, setEditingTitle] = useState('');

	// Estado de expansão do Resumo Compactado (Rolling Summary)
	const [showCompactedSummaryDetail, setShowCompactedSummaryDetail] = useState(false);

	// Modal de Memória Pessoal da Gideon
	const [isMemoryModalOpen, setIsMemoryModalOpen] = useState(false);
	const [newMemoryFact, setNewMemoryFact] = useState('');
	const [newMemoryCategory, setNewMemoryCategory] = useState('PREFERENCIA_COMUNICACAO');
	const [isSavingMemory, setIsSavingMemory] = useState(false);

	const bottomRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const {
		messages,
		isLoading,
		statusStep,
		error,
		conversations,
		maxConversations,
		activeConversationId,
		activeConversationSummary,
		compactionBanner,
		memories,
		recentMemoriesSavedCount,
		sendMessage,
		stopGeneration,
		startNewConversation,
		selectConversation,
		renameConversation,
		togglePinConversation,
		deleteConversation,
		addMemory,
		deleteMemory,
	} = useChat();

	const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? null;

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
	}, [messages, isLoading]);

	// Ajusta a altura do textarea automaticamente no mobile/desktop
	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
	}, [input]);

	const handleSelectSuggestion = useCallback(
		async (queryText: string) => {
			if (isLoading) return;
			setShowSuggestionsDrawer(false);
			setInput('');
			await sendMessage(queryText);
		},
		[isLoading, sendMessage]
	);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const text = input.trim();
		if (!text || isLoading) {
			return;
		}

		setShowSuggestionsDrawer(false);
		setInput('');
		await sendMessage(text);
	};

	const handleStartRename = (convId: string, currentTitle: string, event: React.MouseEvent) => {
		event.stopPropagation();
		setEditingConversationId(convId);
		setEditingTitle(currentTitle);
	};

	const handleConfirmRename = async (convId: string, event?: React.MouseEvent | React.FormEvent) => {
		event?.stopPropagation();
		if (editingTitle.trim()) {
			await renameConversation(convId, editingTitle.trim());
		}
		setEditingConversationId(null);
		setEditingTitle('');
	};

	const handleAddMemorySubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!newMemoryFact.trim() || isSavingMemory) return;
		setIsSavingMemory(true);
		try {
			await addMemory(newMemoryFact.trim(), newMemoryCategory);
			setNewMemoryFact('');
		} finally {
			setIsSavingMemory(false);
		}
	};

	const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
	const isAtFifoLimit = conversations.length >= maxConversations;

	const renderSidebarContent = () => (
		<div className="flex h-full flex-col bg-white text-slate-800">
			{/* Topo da Sidebar: Botão Nova Conversa + Contador FIFO */}
			<div className="border-b border-slate-200/80 p-3">
				<div className="mb-2.5 flex items-center justify-between gap-2">
					<button
						type="button"
						onClick={() => {
							startNewConversation();
							setIsMobileSidebarOpen(false);
						}}
						disabled={isLoading}
						className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-50"
					>
						<Plus className="h-4 w-4" />
						<span>Nova Conversa</span>
					</button>

					<button
						type="button"
						onClick={() => {
							setIsSidebarOpen(false);
							setIsMobileSidebarOpen(false);
						}}
						title="Recolher histórico de conversas"
						className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
					>
						<PanelLeftClose className="h-4 w-4" />
					</button>
				</div>

				{/* Indicador de Fila FIFO (Máximo 10 conversas) */}
				<div className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600 border border-slate-200/70">
					<span className="font-medium">Suas Conversas</span>
					<span
						className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
							isAtFifoLimit
								? 'bg-amber-100 text-amber-800'
								: 'bg-indigo-50 text-indigo-700'
						}`}
						title="Limite de 10 conversas por usuário (Fila FIFO: a mais antiga não fixada sai quando a 11ª entra)"
					>
						{conversations.length}/{maxConversations} FIFO
					</span>
				</div>
				{isAtFifoLimit && !activeConversationId && (
					<p className="mt-1.5 text-[10px] leading-tight text-amber-700 bg-amber-50/80 border border-amber-200/70 rounded-lg px-2 py-1">
						Limite de {maxConversations} atingido: ao enviar uma nova pergunta, a conversa mais antiga não fixada será substituída (FIFO).
					</p>
				)}
			</div>

			{/* Lista de Conversas */}
			<div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
				{conversations.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-10 px-4 text-center">
						<MessageSquare className="h-7 w-7 text-slate-300 mb-2" />
						<p className="text-xs font-medium text-slate-600">Nenhuma conversa salva ainda</p>
						<p className="mt-1 text-[11px] text-slate-400">
							Envie uma pergunta para iniciar seu histórico inteligente (até {maxConversations} conversas).
						</p>
					</div>
				) : (
					conversations.map((conv) => {
						const isSelected = conv.id === activeConversationId;
						const isEditing = editingConversationId === conv.id;
						const hasCompactedSummary = Boolean(conv.summary && conv.summary.trim().length > 0);

						return (
							<div
								key={conv.id}
								onClick={() => {
									if (!isEditing) {
										void selectConversation(conv.id);
										setIsMobileSidebarOpen(false);
									}
								}}
								className={`group relative flex cursor-pointer flex-col rounded-xl border px-2.5 py-2 transition ${
									isSelected
										? 'border-indigo-200 bg-indigo-50/75 text-indigo-950 shadow-xs'
										: 'border-transparent hover:border-slate-200 hover:bg-slate-50 text-slate-700'
								}`}
							>
								<div className="flex items-start justify-between gap-1.5">
									<div className="flex min-w-0 flex-1 items-center gap-2">
										{conv.isPinned ? (
											<Pin className="h-3.5 w-3.5 shrink-0 text-indigo-600 fill-indigo-600" />
										) : (
											<MessageSquare
												className={`h-3.5 w-3.5 shrink-0 ${
													isSelected ? 'text-indigo-600' : 'text-slate-400'
												}`}
											/>
										)}

										{isEditing ? (
											<div
												className="flex flex-1 items-center gap-1"
												onClick={(e) => e.stopPropagation()}
											>
												<input
													type="text"
													value={editingTitle}
													onChange={(e) => setEditingTitle(e.target.value)}
													onKeyDown={(e) => {
														if (e.key === 'Enter') {
															void handleConfirmRename(conv.id, e);
														} else if (e.key === 'Escape') {
															setEditingConversationId(null);
														}
													}}
													autoFocus
													className="w-full rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-indigo-200"
												/>
												<button
													type="button"
													onClick={(e) => void handleConfirmRename(conv.id, e)}
													className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
													title="Salvar título"
												>
													<Check className="h-3.5 w-3.5" />
												</button>
											</div>
										) : (
											<span className="truncate text-xs font-medium leading-snug">
												{conv.title}
											</span>
										)}
									</div>

									{/* Ações rápidas: Fixar, Renomear, Excluir */}
									{!isEditing && (
										<div className="hidden items-center gap-0.5 group-hover:flex shrink-0">
											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													void togglePinConversation(conv.id, !conv.isPinned);
												}}
												title={
													conv.isPinned
														? 'Desafixar conversa'
														: 'Fixar conversa (protege contra substituição FIFO)'
												}
												className={`rounded p-1 transition ${
													conv.isPinned
														? 'text-indigo-600 hover:bg-indigo-100'
														: 'text-slate-400 hover:bg-slate-200/70 hover:text-slate-700'
												}`}
											>
												<Pin className="h-3 w-3" />
											</button>
											<button
												type="button"
												onClick={(e) => handleStartRename(conv.id, conv.title, e)}
												title="Renomear conversa"
												className="rounded p-1 text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700"
											>
												<Pencil className="h-3 w-3" />
											</button>
											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													void deleteConversation(conv.id);
												}}
												title="Excluir conversa"
												className="rounded p-1 text-slate-400 transition hover:bg-rose-100 hover:text-rose-600"
											>
												<Trash2 className="h-3 w-3" />
											</button>
										</div>
									)}
								</div>

								{/* Metadados da conversa: Quantidade de mensagens, Compactação e Horário */}
								<div className="mt-1 flex items-center justify-between gap-2 pl-5 text-[10px] text-slate-400">
									<div className="flex items-center gap-1.5">
										<span>{conv.messageCount} msgs</span>
										{hasCompactedSummary && (
											<span
												className="inline-flex items-center gap-0.5 rounded bg-violet-100 px-1.5 py-0.2 text-[9px] font-semibold text-violet-700"
												title="Conversa longa compactada automaticamente mantendo os pontos principais"
											>
												<Archive className="h-2.5 w-2.5" />
												Compactada
											</span>
										)}
									</div>
									<span>{formatRelativeDate(conv.updatedAt)}</span>
								</div>
							</div>
						);
					})
				)}
			</div>

			{/* Rodapé da Sidebar: Memória Pessoal da Gideon */}
			<div className="border-t border-slate-200/80 p-3 bg-slate-50/60">
				<button
					type="button"
					onClick={() => setIsMemoryModalOpen(true)}
					className="flex w-full items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-2.5 text-left transition hover:bg-violet-100/70"
				>
					<div className="flex items-center gap-2.5 min-w-0">
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white shadow-xs">
							<Brain className="h-4 w-4" />
						</div>
						<div className="min-w-0">
							<div className="flex items-center gap-1.5">
								<span className="truncate text-xs font-semibold text-slate-900">
									Memória da Gideon
								</span>
								{recentMemoriesSavedCount > 0 && (
									<span className="rounded-full bg-emerald-500 px-1.5 py-0.2 text-[9px] font-bold text-white">
										+{recentMemoriesSavedCount} nova
									</span>
								)}
							</div>
							<p className="truncate text-[10px] text-slate-600">
								{memories.length === 0
									? 'Personalize como ela fala com você'
									: `${memories.length} preferência(s) aprendida(s)`}
							</p>
						</div>
					</div>
					<ChevronRight className="h-4 w-4 shrink-0 text-violet-600" />
				</button>
			</div>
		</div>
	);

	return (
		<main className="relative flex h-full max-h-full overflow-hidden bg-slate-50 text-slate-900">
			{/* Sidebar Desktop Colapsável */}
			{isSidebarOpen && (
				<aside
					aria-label="Histórico de conversas"
					className="hidden md:flex md:w-72 lg:w-80 shrink-0 flex-col border-r border-slate-200 bg-white"
				>
					{renderSidebarContent()}
				</aside>
			)}

			{/* Drawer Mobile para Histórico de Conversas */}
			{isMobileSidebarOpen && (
				<div className="fixed inset-0 z-40 flex md:hidden">
					<div
						className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
						onClick={() => setIsMobileSidebarOpen(false)}
					/>
					<aside className="relative z-50 flex w-80 max-w-[85vw] flex-col bg-white shadow-2xl">
						{renderSidebarContent()}
					</aside>
				</div>
			)}

			{/* Área Principal do Chat */}
			<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
				{/* Barra Superior Contextual da Conversa */}
				<header className="flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-3 py-2 sm:px-5 backdrop-blur-xs shrink-0">
					<div className="flex items-center gap-2 min-w-0">
						{/* Botão abrir sidebar no mobile ou quando fechada no desktop */}
						<button
							type="button"
							onClick={() => {
								if (window.innerWidth < 768) {
									setIsMobileSidebarOpen(true);
								} else {
									setIsSidebarOpen((prev) => !prev);
								}
							}}
							className={`inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 ${
								isSidebarOpen ? 'md:hidden' : ''
							}`}
							title="Abrir histórico de conversas"
						>
							<PanelLeftOpen className="h-4 w-4 text-indigo-600" />
							<span>Conversas ({conversations.length}/{maxConversations})</span>
						</button>

						<div className="min-w-0">
							<h2 className="truncate text-xs sm:text-sm font-semibold text-slate-800">
								{activeConversation ? activeConversation.title : 'Nova Conversa'}
							</h2>
						</div>

						{activeConversationSummary && (
							<button
								type="button"
								onClick={() => setShowCompactedSummaryDetail((prev) => !prev)}
								className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-medium text-violet-700 transition hover:bg-violet-100"
								title="Ver resumo executivo das mensagens compactadas desta conversa"
							>
								<Archive className="h-3 w-3" />
								<span className="hidden sm:inline">Contexto Compactado</span>
								{showCompactedSummaryDetail ? (
									<ChevronUp className="h-3 w-3" />
								) : (
									<ChevronDown className="h-3 w-3" />
								)}
							</button>
						)}
					</div>

					<div className="flex items-center gap-2 shrink-0">
						<button
							type="button"
							onClick={() => setIsMemoryModalOpen(true)}
							className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50/70 px-2.5 py-1 text-xs font-medium text-violet-800 transition hover:bg-violet-100"
							title="Gerenciar a memória pessoal da Gideon sobre você"
						>
							<Brain className="h-3.5 w-3.5 text-violet-600" />
							<span className="hidden sm:inline">Memória</span>
							<span className="rounded-full bg-violet-200/80 px-1.5 py-0.2 text-[10px] font-bold text-violet-900">
								{memories.length}
							</span>
						</button>

						{messages.length > 0 && (
							<button
								type="button"
								onClick={startNewConversation}
								disabled={isLoading}
								className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
							>
								<Plus className="h-3.5 w-3.5 text-indigo-600" />
								<span className="hidden sm:inline">Nova</span>
							</button>
						)}
					</div>
				</header>

				{/* Painel Expansível do Resumo Compactado (quando a conversa já foi compactada) */}
				{activeConversationSummary && showCompactedSummaryDetail && (
					<div className="border-b border-violet-200 bg-violet-50/80 px-4 py-3 text-xs text-slate-700">
						<div className="mx-auto max-w-4xl">
							<div className="mb-1 flex items-center justify-between">
								<span className="inline-flex items-center gap-1.5 font-semibold text-violet-900">
									<Archive className="h-3.5 w-3.5 text-violet-700" />
									Resumo Compactado da Conversa (Memória de Contexto)
								</span>
								<button
									type="button"
									onClick={() => setShowCompactedSummaryDetail(false)}
									className="text-violet-700 hover:underline text-[11px]"
								>
									Ocultar
								</button>
							</div>
							<p className="whitespace-pre-line text-[11px] leading-relaxed text-slate-700 bg-white/90 rounded-xl p-2.5 border border-violet-100">
								{activeConversationSummary}
							</p>
						</div>
					</div>
				)}

				<section className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-3 sm:px-6">
					<div
						className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4 sm:space-y-5 sm:py-6 custom-scrollbar"
						aria-live="polite"
					>
						{compactionBanner && (
							<div className="flex items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2 text-xs text-violet-900 shadow-xs">
								<div className="flex items-center gap-2">
									<Archive className="h-4 w-4 shrink-0 text-violet-600" />
									<span>{compactionBanner}</span>
								</div>
								<button
									type="button"
									onClick={() => setShowCompactedSummaryDetail(true)}
									className="shrink-0 font-semibold text-violet-700 hover:underline"
								>
									Ver resumo
								</button>
							</div>
						)}

						{messages.length === 0 && (
							<div className="mx-auto my-auto flex flex-col items-center justify-center py-4 sm:py-8">
								<div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-lg font-bold text-white shadow-md shadow-indigo-200">
									G
								</div>
								<h1 className="text-center text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
									Olá! Como posso ajudar na sua gestão hoje?
								</h1>
								<p className="mt-1.5 max-w-md text-center text-xs leading-5 text-slate-500 sm:text-sm">
									Toque em uma sugestão abaixo ou digite sua pergunta para consultar faturamento, clientes e estoque do Sankhya ERP em tempo real.
								</p>

								<div className="mt-6 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
									{SUGGESTED_CATEGORIES.map((category) => (
										<div
											key={category.id}
											className={`flex flex-col rounded-2xl border bg-white p-3.5 shadow-sm transition ${category.accentClass}`}
										>
											<div className="mb-2.5 flex items-center justify-between gap-2">
												<div className="flex items-center gap-2">
													<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-50">
														{category.icon}
													</div>
													<h2 className="text-xs font-semibold text-slate-800">{category.title}</h2>
												</div>
											</div>

											<div className="flex flex-1 flex-col gap-2">
												{category.prompts.map((prompt) => (
													<button
														key={prompt.label}
														type="button"
														disabled={isLoading}
														onClick={() => handleSelectSuggestion(prompt.query)}
														className="group flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50/60 hover:text-indigo-900 active:scale-[0.99] disabled:opacity-50"
													>
														<span className="line-clamp-2 leading-snug">{prompt.label}</span>
														<ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-indigo-600" />
													</button>
												))}
											</div>
										</div>
									))}
								</div>
							</div>
						)}

						{messages.map((message, index) => {
							const precedingUserPrompt =
								message.role === 'assistant'
									? [...messages.slice(0, index)]
											.reverse()
											.find((m) => m.role === 'user')?.content ?? ''
									: '';
							return (
								<ChatMessageItem
									key={message.id}
									message={message}
									isStreaming={isLoading && message.id === lastMessageId && message.role === 'assistant'}
									statusStep={
										isLoading && message.id === lastMessageId && message.role === 'assistant'
											? statusStep
											: null
									}
									userPrompt={precedingUserPrompt}
									conversationId={activeConversationId}
									fullConversationSnapshot={messages.slice(0, index + 1)}
								/>
							);
						})}
						<div ref={bottomRef} />
					</div>

					{/* Painel rápido de sugestões acionável durante a conversa */}
					{messages.length > 0 && showSuggestionsDrawer && (
						<div className="mb-2 rounded-2xl border border-indigo-100 bg-white p-3 shadow-lg">
							<div className="mb-2 flex items-center justify-between">
								<span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
									<Lightbulb className="h-3.5 w-3.5 text-amber-500" />
									Consultas Rápidas Sugeridas
								</span>
								<button
									type="button"
									onClick={() => setShowSuggestionsDrawer(false)}
									className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
									aria-label="Fechar sugestões"
								>
									<X className="h-4 w-4" />
								</button>
							</div>
							<div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar sm:grid sm:grid-cols-3">
								{SUGGESTED_CATEGORIES.flatMap((cat) =>
									cat.prompts.map((prompt) => (
										<button
											key={prompt.label}
											type="button"
											disabled={isLoading}
											onClick={() => handleSelectSuggestion(prompt.query)}
											className="flex min-h-[42px] shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50/60 hover:text-indigo-700"
										>
											<span className="max-w-[220px] truncate sm:max-w-none">{prompt.label}</span>
										</button>
									))
								)}
							</div>
						</div>
					)}

					{error && (
						<div
							className="mb-2.5 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs sm:text-sm text-rose-800 shadow-sm"
							role="alert"
						>
							<div className="flex items-center gap-2">
								<AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
								<span>{error}</span>
							</div>
						</div>
					)}

					<form
						className="sticky bottom-0 z-10 border-t border-slate-200/80 bg-slate-50/95 pb-3 pt-2.5 backdrop-blur-sm sm:py-3.5"
						onSubmit={handleSubmit}
					>
						{/* Barra de ações rápidas acima do input */}
						{messages.length > 0 && (
							<div className="mb-2 flex items-center justify-between gap-2">
								<button
									type="button"
									onClick={() => setShowSuggestionsDrawer((prev) => !prev)}
									className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-600 active:scale-95"
								>
									<Lightbulb className="h-3.5 w-3.5 text-amber-500" />
									<span>Sugestões</span>
								</button>

								<button
									type="button"
									onClick={startNewConversation}
									disabled={isLoading}
									className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-800 disabled:opacity-50"
								>
									<RotateCcw className="h-3 w-3" />
									<span>Nova conversa</span>
								</button>
							</div>
						)}

						<div className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white p-1.5 shadow-sm transition focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-100 sm:gap-2.5 sm:p-2">
							<textarea
								ref={textareaRef}
								aria-label="Mensagem"
								value={input}
								onChange={(event) => setInput(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Enter' && !event.shiftKey) {
										event.preventDefault();
										event.currentTarget.form?.requestSubmit();
									}
								}}
								placeholder="Pergunte sobre vendas, clientes ou produtos..."
								rows={1}
								disabled={isLoading}
								className="max-h-36 min-h-[44px] flex-1 resize-none border-0 bg-transparent px-2.5 py-2.5 text-sm leading-5 text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
							/>

							{isLoading ? (
								<button
									type="button"
									onClick={stopGeneration}
									aria-label="Parar resposta"
									className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 active:scale-95"
								>
									<Square className="h-3.5 w-3.5 fill-current" />
									<span className="hidden sm:inline">Parar</span>
								</button>
							) : (
								<button
									type="submit"
									disabled={!input.trim() || isLoading}
									aria-label="Enviar mensagem"
									className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
								>
									<Send className="h-4 w-4" />
									<span className="hidden sm:inline">Enviar</span>
								</button>
							)}
						</div>
					</form>
				</section>
			</div>

			{/* Modal de Memória Pessoal da Gideon */}
			{isMemoryModalOpen && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
					role="dialog"
					aria-modal="true"
					aria-labelledby="memory-modal-title"
				>
					<div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<div className="flex items-center justify-between border-b border-slate-200 bg-violet-50/60 px-5 py-4">
							<div className="flex items-center gap-2.5">
								<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
									<Brain className="h-5 w-5" />
								</div>
								<div>
									<h3 id="memory-modal-title" className="text-sm font-bold text-slate-900">
										Memória Pessoal da Gideon
									</h3>
									<p className="text-xs text-slate-600">
										O que a Gideon sabe sobre você para personalizar o atendimento em todas as conversas
									</p>
								</div>
							</div>
							<button
								type="button"
								onClick={() => setIsMemoryModalOpen(false)}
								className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700"
								aria-label="Fechar modal de memória"
							>
								<X className="h-4 w-4" />
							</button>
						</div>

						<div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
							{/* Formulário para adicionar uma memória manualmente */}
							<form
								onSubmit={handleAddMemorySubmit}
								className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 space-y-3"
							>
								<label className="block text-xs font-semibold text-slate-800">
									Ensinar uma nova preferência à Gideon
								</label>
								<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
									<select
										value={newMemoryCategory}
										onChange={(e) => setNewMemoryCategory(e.target.value)}
										className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-800 outline-none focus:border-violet-500"
									>
										<option value="PREFERENCIA_COMUNICACAO">Como me chamar / Estilo de resposta</option>
										<option value="PREFERENCIA_ANALISE">Preferência de análise e gráficos</option>
										<option value="CONTEXTO_CARGO_FOCO">Meu cargo / foco de atuação</option>
										<option value="PREFERENCIA_GERAL">Preferência geral</option>
									</select>
									<input
										type="text"
										value={newMemoryFact}
										onChange={(e) => setNewMemoryFact(e.target.value)}
										placeholder="Ex: Me chame de Matheus e seja sempre direto..."
										className="sm:col-span-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-violet-500"
									/>
								</div>
								<div className="flex items-center justify-between gap-2">
									<span className="text-[11px] text-slate-500">
										Dica: Você também pode dizer isso diretamente no chat que a Gideon aprende sozinha!
									</span>
									<button
										type="submit"
										disabled={!newMemoryFact.trim() || isSavingMemory}
										className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-violet-700 disabled:opacity-50"
									>
										<Plus className="h-3.5 w-3.5" />
										<span>Salvar Memória</span>
									</button>
								</div>
							</form>

							{/* Lista de memórias aprendidas */}
							<div>
								<div className="mb-2.5 flex items-center justify-between">
									<h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
										Memórias Ativas ({memories.length})
									</h4>
								</div>

								{memories.length === 0 ? (
									<div className="rounded-xl border border-dashed border-slate-200 py-8 px-4 text-center">
										<Brain className="mx-auto h-7 w-7 text-slate-300 mb-2" />
										<p className="text-xs font-medium text-slate-600">
											Nenhuma memória personalizada registrada ainda.
										</p>
										<p className="mt-1 text-[11px] text-slate-400">
											Experimente enviar no chat: &ldquo;Me chame de Sr. Matheus e prefiro respostas curtas em tabela&rdquo;.
										</p>
									</div>
								) : (
									<div className="space-y-2">
										{memories.map((mem: UserMemoryItem) => {
											const catInfo =
												MEMORY_CATEGORY_LABELS[mem.category] ?? MEMORY_CATEGORY_LABELS.geral;
											return (
												<div
													key={mem.id}
													className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-2xs"
												>
													<div className="min-w-0 flex-1">
														<div className="mb-1 flex flex-wrap items-center gap-1.5">
															<span
																className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${catInfo.colorClass}`}
															>
																{catInfo.label}
															</span>
															<span className="text-[10px] text-slate-400">
																{mem.source === 'AUTO' || mem.source === 'implicit'
																	? '✨ Aprendido no chat'
																	: '📌 Adicionado manualmente'}
															</span>
														</div>
														<p className="text-xs font-medium text-slate-800 break-words">
															{mem.fact}
														</p>
													</div>
													<button
														type="button"
														onClick={() => void deleteMemory(mem.id)}
														title="Esquecer esta memória"
														className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
													>
														<Trash2 className="h-4 w-4" />
													</button>
												</div>
											);
										})}
									</div>
								)}
							</div>
						</div>

						<div className="flex items-center justify-end border-t border-slate-200 bg-slate-50 px-5 py-3">
							<button
								type="button"
								onClick={() => setIsMemoryModalOpen(false)}
								className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
							>
								Concluído
							</button>
						</div>
					</div>
				</div>
			)}
		</main>
	);
}
