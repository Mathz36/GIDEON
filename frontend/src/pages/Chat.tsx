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
} from 'lucide-react';
import { DynamicDashboard } from '../components/chat/DynamicDashboard';
import { useChat } from '../hooks/useChat';
import type { ChatMessage } from '../hooks/useChat';

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
		title: 'Analisando pergunta...',
		subtitle: 'Identificando intenção, filtros e métricas solicitadas',
	},
	{
		title: 'Consultando dados sincronizados do Sankhya ERP...',
		subtitle: 'Executando leitura segura nas tabelas espelhadas do ERP',
	},
	{
		title: 'Processando indicadores...',
		subtitle: 'Consolidando números e formatando visualização inteligente',
	},
];

const DidacticProgressIndicator: React.FC = React.memo(() => {
	const [activeStep, setActiveStep] = useState(0);

	useEffect(() => {
		const timer1 = window.setTimeout(() => setActiveStep(1), 1300);
		const timer2 = window.setTimeout(() => setActiveStep(2), 3000);
		return () => {
			window.clearTimeout(timer1);
			window.clearTimeout(timer2);
		};
	}, []);

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
									{step.title}
								</p>
								{isCurrent && (
									<p className="mt-0.5 text-[11px] text-slate-500">{step.subtitle}</p>
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
			return <DynamicDashboard configString={String(children)} />;
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
}

const ChatMessageItem: React.FC<ChatMessageItemProps> = React.memo(
	({ message, isStreaming }) => {
		const isUser = message.role === 'user';

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
							<div className="prose prose-sm prose-slate max-w-none break-words">
								<ReactMarkdown components={markdownComponents}>{message.content}</ReactMarkdown>
								{isStreaming && (
									<span
										className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-indigo-600 align-middle"
										aria-label="Gerando resposta"
									/>
								)}
							</div>
						) : (
							<DidacticProgressIndicator />
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
		prevProps.isStreaming === nextProps.isStreaming
);

ChatMessageItem.displayName = 'ChatMessageItem';

export default function Chat() {
	const [input, setInput] = useState('');
	const [showSuggestionsDrawer, setShowSuggestionsDrawer] = useState(false);
	const bottomRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const { messages, isLoading, error, sendMessage, stopGeneration, clearMessages } = useChat();

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

	const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;

	return (
		<main className="flex h-[100dvh] max-h-full flex-col overflow-hidden bg-slate-50 text-slate-900">
			<section className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-3 sm:px-6">
				<div
					className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4 sm:space-y-5 sm:py-6 custom-scrollbar"
					aria-live="polite"
				>
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

					{messages.map((message) => (
						<ChatMessageItem
							key={message.id}
							message={message}
							isStreaming={isLoading && message.id === lastMessageId && message.role === 'assistant'}
						/>
					))}
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
								onClick={clearMessages}
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
		</main>
	);
}
