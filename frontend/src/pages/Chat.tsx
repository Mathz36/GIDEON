import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';

import { useChat } from '../hooks/useChat';

export default function Chat() {
	const [input, setInput] = useState('');
	const bottomRef = useRef<HTMLDivElement>(null);
	const { messages, isLoading, error, sendMessage } = useChat();

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
	}, [messages, isLoading]);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const text = input.trim();
		if (!text || isLoading) {
			return;
		}

		setInput('');
		await sendMessage(text);
	};

	return (
		<main className="flex h-full flex-col overflow-hidden bg-slate-50 text-slate-900">
			<section className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-4 sm:px-6">
				<div className="min-h-0 flex-1 space-y-5 overflow-y-auto py-6" aria-live="polite">
					{messages.length === 0 && (
						<div className="mx-auto mt-14 max-w-md text-center">
							<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-lg font-bold text-white shadow-md">
								G
							</div>
							<h2 className="text-xl font-semibold text-slate-800">Como posso ajudar hoje?</h2>
							<p className="mt-2 text-sm leading-6 text-slate-500">
								Envie sua pergunta para consultar clientes, vendas e dados do ERP em tempo real com o Gideon.
							</p>
						</div>
					)}

					{messages.map((message) => (
						<div className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`} key={message.id}>
							{message.role === 'assistant' && <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">G</div>}
							<div className={message.role === 'user'
								? 'max-w-[85%] rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-3 text-sm leading-6 text-white shadow-sm'
								: 'max-w-[85%] rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-800 shadow-sm'}
							>
								{message.role === 'assistant' ? (
									message.content ? <ReactMarkdown>{message.content}</ReactMarkdown> : <span className="animate-pulse text-slate-400">Pensando...</span>
								) : message.content}
							</div>
						</div>
					))}
					<div ref={bottomRef} />
				</div>

				{error && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

				<form className="sticky bottom-0 border-t border-slate-200 bg-slate-50 py-4" onSubmit={handleSubmit}>
					<div className="flex items-end gap-3 rounded-xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-100">
						<textarea
							aria-label="Mensagem"
							value={input}
							onChange={(event) => setInput(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === 'Enter' && !event.shiftKey) {
									event.preventDefault();
									event.currentTarget.form?.requestSubmit();
								}
							}}
							placeholder="Envie uma mensagem..."
							rows={1}
							disabled={isLoading}
							className="max-h-40 min-h-10 flex-1 resize-y border-0 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
						/>
						<button
							type="submit"
							disabled={!input.trim() || isLoading}
							className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-300"
						>
							{isLoading ? 'Enviando...' : 'Enviar'}
						</button>
					</div>
				</form>
			</section>
		</main>
	);
}
