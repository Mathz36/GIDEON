import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, Bot, CheckCircle2, RefreshCw, Save, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export interface AIConfigurationPayload {
	id?: string;
	systemPrompt: string;
	temperature: number;
	topP: number;
	memorySize: number;
	updatedAt?: string;
}

export default function AdminAI() {
	const { token } = useAuth();
	const [systemPrompt, setSystemPrompt] = useState('');
	const [temperature, setTemperature] = useState(0.7);
	const [topP, setTopP] = useState(0.9);
	const [memorySize, setMemorySize] = useState(10);
	const [lastUpdated, setLastUpdated] = useState<string | null>(null);

	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState('');
	const [successMsg, setSuccessMsg] = useState('');

	useEffect(() => {
		const loadConfig = async () => {
			setIsLoading(true);
			setError('');
			try {
				const response = await fetch('/api/ai/configurations', {
					headers: {
						...(token ? { Authorization: `Bearer ${token}` } : {}),
					},
				});

				if (!response.ok) {
					throw new Error('Falha ao carregar configurações do banco de dados.');
				}

				const json = (await response.json()) as { data?: AIConfigurationPayload };
				if (json.data) {
					setSystemPrompt(json.data.systemPrompt ?? '');
					setTemperature(json.data.temperature ?? 0.7);
					setTopP(json.data.topP ?? 0.9);
					setMemorySize(json.data.memorySize ?? 10);
					if (json.data.updatedAt) {
						setLastUpdated(new Date(json.data.updatedAt).toLocaleString('pt-BR'));
					}
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Erro ao carregar configurações.');
			} finally {
				setIsLoading(false);
			}
		};

		void loadConfig();
	}, [token]);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError('');
		setSuccessMsg('');

		const trimmedPrompt = systemPrompt.trim();
		if (!trimmedPrompt) {
			setError('O System Prompt / Regras de Negócio não pode ser vazio.');
			return;
		}

		setIsSaving(true);
		try {
			const payload: AIConfigurationPayload = {
				systemPrompt: trimmedPrompt,
				temperature,
				topP,
				memorySize,
			};

			const response = await fetch('/api/ai/configurations', {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify(payload),
			});

			const json = (await response.json()) as { data?: AIConfigurationPayload; error?: string };

			if (!response.ok) {
				throw new Error(json.error ?? 'Falha ao salvar configurações da IA.');
			}

			if (json.data?.updatedAt) {
				setLastUpdated(new Date(json.data.updatedAt).toLocaleString('pt-BR'));
			}
			setSuccessMsg('Configurações da IA salvas com sucesso no banco de dados!');
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao salvar alterações.');
		} finally {
			setIsSaving(false);
		}
	};

	if (isLoading) {
		return (
			<main className="flex min-h-[calc(100vh-60px)] items-center justify-center bg-slate-50">
				<div className="flex flex-col items-center gap-3">
					<RefreshCw className="h-8 w-8 animate-spin text-indigo-600" />
					<p className="text-sm font-medium text-slate-500">Carregando configurações do banco de dados...</p>
				</div>
			</main>
		);
	}

	return (
		<main className="min-h-[calc(100vh-60px)] bg-slate-50 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
			<section className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
				<div className="flex flex-col gap-2 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<div className="flex items-center gap-2 text-indigo-600 font-semibold text-xs uppercase tracking-wider">
							<Bot className="h-4 w-4" />
							<span>Administração & Governança</span>
						</div>
						<h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Controle do Gemini</h1>
						<p className="mt-1 text-sm text-slate-500">
							As regras e parâmetros definidos aqui são armazenados no banco e aplicados a todas as conversas do assistente.
						</p>
					</div>

					{lastUpdated && (
						<div className="text-xs text-slate-400 sm:text-right">
							<span>Última atualização:</span>
							<p className="font-medium text-slate-600">{lastUpdated}</p>
						</div>
					)}
				</div>

				{/* Alertas */}
				{error && (
					<div className="mt-6 flex items-start gap-2.5 rounded-lg bg-rose-50 p-3.5 text-xs text-rose-700">
						<AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
						<span>{error}</span>
					</div>
				)}

				{successMsg && (
					<div className="mt-6 flex items-start gap-2.5 rounded-lg bg-emerald-50 p-3.5 text-xs text-emerald-700">
						<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
						<span>{successMsg}</span>
					</div>
				)}

				<form className="mt-6 space-y-6" onSubmit={handleSubmit}>
					<div>
						<div className="flex items-center justify-between">
							<label className="block text-sm font-semibold text-slate-800" htmlFor="system-prompt">
								System Prompt / Regras de Negócio
							</label>
							<span className="text-xs text-slate-400">Instruções mestras para a IA</span>
						</div>
						<textarea
							id="system-prompt"
							value={systemPrompt}
							onChange={(event) => setSystemPrompt(event.target.value)}
							placeholder="Você é o assistente inteligente Gideon. Siga estritamente as regras de negócio..."
							rows={8}
							className="mt-2 block w-full resize-y rounded-xl border border-slate-300 p-3.5 font-mono text-sm leading-6 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
						/>
						<p className="mt-2 text-xs text-slate-500">
							Defina o tom de voz, regras de segurança, restrições e diretrizes de resposta.
						</p>
					</div>

					<div className="grid gap-6 rounded-xl border border-slate-200 bg-slate-50 p-5 sm:grid-cols-2">
						<div>
							<div className="flex items-center justify-between gap-4">
								<label className="text-sm font-medium text-slate-700" htmlFor="temperature">
									Temperatura (Criatividade)
								</label>
								<output className="rounded-md bg-white px-2.5 py-1 font-mono text-sm font-bold text-indigo-700 shadow-sm border border-slate-200">
									{temperature.toFixed(1)}
								</output>
							</div>
							<input
								id="temperature"
								type="range"
								min="0"
								max="2"
								step="0.1"
								value={temperature}
								onChange={(event) => setTemperature(Number(event.target.value))}
								className="mt-4 w-full accent-indigo-600 cursor-pointer"
							/>
							<div className="mt-1 flex justify-between text-[11px] text-slate-400">
								<span>Mais analítico e determinístico</span>
								<span>Mais criativo e variado</span>
							</div>
						</div>

						<div>
							<div className="flex items-center justify-between gap-4">
								<label className="text-sm font-medium text-slate-700" htmlFor="top-p">
									Top-P (Amostragem de Tokens)
								</label>
								<output className="rounded-md bg-white px-2.5 py-1 font-mono text-sm font-bold text-indigo-700 shadow-sm border border-slate-200">
									{topP.toFixed(2)}
								</output>
							</div>
							<input
								id="top-p"
								type="range"
								min="0"
								max="1"
								step="0.05"
								value={topP}
								onChange={(event) => setTopP(Number(event.target.value))}
								className="mt-4 w-full accent-indigo-600 cursor-pointer"
							/>
							<div className="mt-1 flex justify-between text-[11px] text-slate-400">
								<span>Vocabulário mais focado</span>
								<span>Vocabulário mais amplo</span>
							</div>
						</div>

						<div className="sm:col-span-2">
							<div className="flex items-center justify-between gap-4">
								<label className="text-sm font-medium text-slate-700" htmlFor="memory-size">
									Janela de Memória (Mensagens no Histórico)
								</label>
								<output className="rounded-md bg-white px-2.5 py-1 font-mono text-sm font-bold text-indigo-700 shadow-sm border border-slate-200">
									{memorySize} mensagens
								</output>
							</div>
							<input
								id="memory-size"
								type="range"
								min="2"
								max="30"
								step="2"
								value={memorySize}
								onChange={(event) => setMemorySize(Number(event.target.value))}
								className="mt-4 w-full accent-indigo-600 cursor-pointer"
							/>
							<div className="mt-1 flex justify-between text-[11px] text-slate-400">
								<span>Respostas mais rápidas</span>
								<span>Histórico de contexto mais longo</span>
							</div>
						</div>
					</div>

					<div className="flex justify-end pt-2">
						<button
							type="submit"
							disabled={isSaving}
							className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-300"
						>
							{isSaving ? (
								<>
									<RefreshCw className="h-4 w-4 animate-spin" />
									<span>Salvando no Banco...</span>
								</>
							) : (
								<>
									<Save className="h-4 w-4" />
									<span>Salvar Configurações no Banco</span>
								</>
							)}
						</button>
					</div>
				</form>
			</section>
		</main>
	);
}
