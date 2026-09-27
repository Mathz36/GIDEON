import { Fragment, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import {
	AlertCircle,
	Calendar,
	CheckCircle2,
	Clock,
	Code2,
	Copy,
	Database,
	Edit2,
	KeyRound,
	Play,
	Plus,
	RefreshCw,
	Table as TableIcon,
	Trash2,
	X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export type SyncFrequency = 'MINUTES' | 'HOURS' | 'DAILY' | 'MONTHLY' | 'MANUAL';

export interface ErpConfigurationPayload {
	id?: string;
	context: string;
	description: string;
	query: string;
	expectedFields: string[];
	primaryKey?: string;
	tableName?: string;
	syncFrequency?: SyncFrequency;
	syncInterval?: number;
	syncTime?: string;
	syncDayOfMonth?: number;
	syncActive?: boolean;
	lastSyncAt?: string;
	nextSyncAt?: string;
	lastSyncStatus?: string;
	lastSyncMessage?: string;
	createdAt?: string;
	updatedAt?: string;
}

interface SqlEditorProps {
	id: string;
	value: string;
	onChange: (value: string) => void;
}

const SQL_TOKENS = /(--.*$|'(?:''|[^'])*'|\b(?:SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|AND|OR|NOT|IN|LIKE|IS|NULL|ORDER|BY|GROUP|HAVING|LIMIT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|VIEW|CASE|WHEN|THEN|ELSE|END|DISTINCT|WITH|UNION|ALL)\b|\b\d+(?:\.\d+)?\b)/gim;

const createEmptyField = () => '';

function highlightSql(value: string) {
	return value.split(SQL_TOKENS).map((token, index) => {
		if (/^--/.test(token)) return <span className="text-emerald-400" key={index}>{token}</span>;
		if (/^'/.test(token)) return <span className="text-amber-300" key={index}>{token}</span>;
		if (/^\d/.test(token)) return <span className="text-cyan-300" key={index}>{token}</span>;
		if (/^[a-z]+$/i.test(token)) return <span className="font-semibold text-fuchsia-300" key={index}>{token}</span>;
		return <Fragment key={index}>{token}</Fragment>;
	});
}

function SqlEditor({ id, value, onChange }: SqlEditorProps) {
	const previewRef = useRef<HTMLPreElement>(null);

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== 'Tab') return;

		event.preventDefault();
		const target = event.currentTarget;
		const selectionStart = target.selectionStart;
		const selectionEnd = target.selectionEnd;

		const nextValue = `${value.slice(0, selectionStart)}\t${value.slice(selectionEnd)}`;
		onChange(nextValue);

		queueMicrotask(() => {
			target.selectionStart = selectionStart + 1;
			target.selectionEnd = selectionStart + 1;
		});
	};

	return (
		<div className="relative h-56 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-inner">
			<pre
				ref={previewRef}
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 m-0 overflow-auto p-4 font-mono text-sm leading-6 whitespace-pre-wrap break-words text-slate-100 selection:bg-transparent"
			>
				{highlightSql(value || ' ')}
			</pre>
			<textarea
				id={id}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={handleKeyDown}
				onScroll={(event) => {
					if (!previewRef.current) return;
					previewRef.current.scrollTop = event.currentTarget.scrollTop;
					previewRef.current.scrollLeft = event.currentTarget.scrollLeft;
				}}
				spellCheck={false}
				placeholder="SELECT CODPROD AS COD, DESCRPROD AS DESCRICAO FROM TGFPRO..."
				className="relative z-10 h-full w-full resize-none overflow-auto bg-transparent p-4 font-mono text-sm leading-6 text-transparent caret-white outline-none selection:bg-indigo-500/50"
			/>
		</div>
	);
}

export default function AdminERP() {
	const { token } = useAuth();
	const [configurations, setConfigurations] = useState<ErpConfigurationPayload[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [syncingId, setSyncingId] = useState<string | null>(null);
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingConfig, setEditingConfig] = useState<ErpConfigurationPayload | null>(null);
	const [visibleQueryId, setVisibleQueryId] = useState<string | null>(null);

	const [context, setContext] = useState('');
	const [description, setDescription] = useState('');
	const [query, setQuery] = useState('');
	const [expectedFields, setExpectedFields] = useState<string[]>([createEmptyField()]);
	const [primaryKey, setPrimaryKey] = useState<string>('');

	// Estados do Agendamento
	const [syncFrequency, setSyncFrequency] = useState<SyncFrequency>('HOURS');
	const [syncInterval, setSyncInterval] = useState<number>(1);
	const [syncTime, setSyncTime] = useState<string>('08:00');
	const [syncDayOfMonth, setSyncDayOfMonth] = useState<number>(1);
	const [syncActive, setSyncActive] = useState<boolean>(true);

	const [error, setError] = useState('');
	const [successMsg, setSuccessMsg] = useState('');

	const loadConfigurations = async () => {
		setIsLoading(true);
		setError('');
		try {
			const res = await fetch('/api/erp/configurations', {
				headers: {
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
			});

			if (!res.ok) {
				throw new Error('Falha ao carregar integrações do banco de dados.');
			}

			const json = (await res.json()) as { data?: ErpConfigurationPayload[] };
			setConfigurations(json.data ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao carregar dados.');
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		void loadConfigurations();
	}, [token]);

	const resetForm = () => {
		setContext('');
		setDescription('');
		setQuery('');
		setExpectedFields([createEmptyField()]);
		setPrimaryKey('');
		setSyncFrequency('HOURS');
		setSyncInterval(1);
		setSyncTime('08:00');
		setSyncDayOfMonth(1);
		setSyncActive(true);
		setError('');
		setEditingConfig(null);
	};

	const openNewConfiguration = () => {
		resetForm();
		setIsModalOpen(true);
	};

	const openEditConfiguration = (config: ErpConfigurationPayload) => {
		setContext(config.context);
		setDescription(config.description);
		setQuery(config.query);
		setExpectedFields([...config.expectedFields]);
		setPrimaryKey(config.primaryKey ?? (config.expectedFields[0] || ''));
		setSyncFrequency(config.syncFrequency ?? 'HOURS');
		setSyncInterval(config.syncInterval ?? 1);
		setSyncTime(config.syncTime ?? '08:00');
		setSyncDayOfMonth(config.syncDayOfMonth ?? 1);
		setSyncActive(config.syncActive ?? true);
		setEditingConfig(config);
		setError('');
		setIsModalOpen(true);
	};

	const closeModal = () => {
		setIsModalOpen(false);
		resetForm();
	};

	const saveConfiguration = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError('');
		setSuccessMsg('');

		const cleanFields = [...new Set(expectedFields.map((field) => field.trim()).filter(Boolean))];

		if (!context.trim() || !query.trim() || cleanFields.length === 0) {
			setError('Informe o contexto, a query SQL e ao menos um campo esperado.');
			return;
		}

		if (!primaryKey.trim()) {
			setError('Selecione qual campo é a Chave Primária (PK) da tabela.');
			return;
		}

		const cleanPk = primaryKey.trim();
		const pkExists = cleanFields.some((f) => f.toUpperCase() === cleanPk.toUpperCase());
		if (!pkExists) {
			setError(`A Chave Primária "${cleanPk}" informada deve constar na lista de colunas esperadas.`);
			return;
		}

		setIsSaving(true);
		try {
			const payload = {
				context: context.trim(),
				description: description.trim(),
				query: query.trim(),
				expectedFields: cleanFields,
				primaryKey: cleanPk,
				syncFrequency,
				syncInterval: Number(syncInterval) || 1,
				syncTime,
				syncDayOfMonth: Number(syncDayOfMonth) || 1,
				syncActive,
			};

			const isEdit = Boolean(editingConfig?.id);
			const url = isEdit ? `/api/erp/configurations/${editingConfig?.id}` : '/api/erp/configurations';
			const method = isEdit ? 'PUT' : 'POST';

			const res = await fetch(url, {
				method,
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify(payload),
			});

			const json = (await res.json()) as { data?: ErpConfigurationPayload; error?: string };

			if (!res.ok) {
				throw new Error(json.error ?? 'Falha ao salvar integração no banco.');
			}

			setSuccessMsg(
				isEdit
					? `Integração e tabela "${json.data?.tableName}" atualizadas com sucesso no banco!`
					: `Integração e tabela "${json.data?.tableName}" criadas com sucesso no banco!`,
			);

			closeModal();
			await loadConfigurations();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao salvar integração.');
		} finally {
			setIsSaving(false);
		}
	};

	const updateField = (index: number, value: string) => {
		const oldValue = expectedFields[index];
		setExpectedFields((fields) => fields.map((field, fieldIndex) => (fieldIndex === index ? value : field)));

		// Se o campo alterado for a PK atual, atualiza o nome da PK
		if (primaryKey && primaryKey.toUpperCase() === oldValue?.toUpperCase()) {
			setPrimaryKey(value.trim());
		}
	};

	const removeField = (index: number) => {
		if (expectedFields.length <= 1) return;
		const removedValue = expectedFields[index];
		const nextFields = expectedFields.filter((_, fieldIndex) => fieldIndex !== index);
		setExpectedFields(nextFields);

		// Se removeu a coluna que era a PK, seleciona o próximo campo válido
		if (primaryKey && primaryKey.toUpperCase() === removedValue?.toUpperCase()) {
			const fallback = nextFields.find((f) => f.trim().length > 0) || '';
			setPrimaryKey(fallback.trim());
		}
	};

	const removeConfiguration = async (id?: string) => {
		if (!id) return;
		if (!window.confirm('Tem certeza que deseja excluir esta integração? A tabela dinâmica no banco também será removida.')) {
			return;
		}

		setError('');
		setSuccessMsg('');
		try {
			const res = await fetch(`/api/erp/configurations/${id}`, {
				method: 'DELETE',
				headers: {
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
			});

			if (!res.ok) {
				throw new Error('Falha ao excluir integração do banco.');
			}

			setSuccessMsg('Integração e tabela excluídas com sucesso do banco.');
			await loadConfigurations();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao excluir.');
		}
	};

	const handleSyncNow = async (id?: string) => {
		if (!id) return;
		setSyncingId(id);
		setError('');
		setSuccessMsg('');
		try {
			const res = await fetch(`/api/erp/configurations/${id}/sync`, {
				method: 'POST',
				headers: {
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
			});

			const json = await res.json();
			if (!res.ok) {
				throw new Error(json.error ?? 'Falha ao sincronizar com o Sankhya.');
			}

			if (json.data?.success) {
				setSuccessMsg(json.data.message ?? 'Sincronização concluída com sucesso!');
			} else {
				setError(json.data?.message ?? 'Falha ao sincronizar.');
			}

			await loadConfigurations();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao executar sincronização.');
		} finally {
			setSyncingId(null);
		}
	};

	const duplicateConfiguration = async (source: ErpConfigurationPayload) => {
		setContext(`${source.context} (Cópia)`);
		setDescription(source.description);
		setQuery(source.query);
		setExpectedFields([...source.expectedFields]);
		setPrimaryKey(source.primaryKey ?? (source.expectedFields[0] || ''));
		setSyncFrequency(source.syncFrequency ?? 'HOURS');
		setSyncInterval(source.syncInterval ?? 1);
		setSyncTime(source.syncTime ?? '08:00');
		setSyncDayOfMonth(source.syncDayOfMonth ?? 1);
		setSyncActive(source.syncActive ?? true);
		setEditingConfig(null);
		setIsModalOpen(true);
	};

	const formatDateTime = (dateStr?: string | null) => {
		if (!dateStr) return null;
		const d = new Date(dateStr);
		if (Number.isNaN(d.getTime())) return null;
		return d.toLocaleString('pt-BR', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	};

	const getScheduleBadge = (config: ErpConfigurationPayload) => {
		if (config.syncActive === false) {
			return {
				text: 'Agendamento pausado',
				bg: 'bg-slate-100 text-slate-600 border-slate-200',
			};
		}

		switch (config.syncFrequency) {
			case 'MINUTES':
				return {
					text: `A cada ${config.syncInterval ?? 15} min`,
					bg: 'bg-sky-50 text-sky-700 border-sky-200',
				};
			case 'HOURS':
				return {
					text: `A cada ${config.syncInterval ?? 1}h`,
					bg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
				};
			case 'DAILY':
				return {
					text: `Diário às ${config.syncTime ?? '08:00'}`,
					bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
				};
			case 'MONTHLY':
				return {
					text: `Dia ${config.syncDayOfMonth ?? 1} às ${config.syncTime ?? '08:00'}`,
					bg: 'bg-purple-50 text-purple-700 border-purple-200',
				};
			default:
				return {
					text: 'Manual',
					bg: 'bg-slate-100 text-slate-600 border-slate-200',
				};
		}
	};

	const availableValidFields = expectedFields.map((f) => f.trim()).filter(Boolean);

	return (
		<main className="min-h-[calc(100vh-60px)] bg-slate-50 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
			<section className="mx-auto max-w-7xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
				<div className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<div className="flex items-center gap-2 text-indigo-600 font-semibold text-xs uppercase tracking-wider">
							<Database className="h-4 w-4" />
							<span>Integração ERP Sankhya & PostgreSQL</span>
						</div>
						<h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
							Consultas SQL, Tabelas & Agendamentos
						</h1>
						<p className="mt-1 text-sm text-slate-500">
							Configure consultas no Sankhya, tabelas dinâmicas, Chave Primária (PK) e a frequência de sincronização automática.
						</p>
					</div>

					<button
						type="button"
						onClick={openNewConfiguration}
						className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-100"
					>
						<Plus className="h-4 w-4" />
						Nova Consulta SQL
					</button>
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

				{isLoading ? (
					<div className="flex flex-col items-center justify-center py-20">
						<RefreshCw className="h-8 w-8 animate-spin text-indigo-600" />
						<p className="mt-3 text-sm font-medium text-slate-500">Carregando integrações do banco de dados...</p>
					</div>
				) : configurations.length === 0 ? (
					<div className="mt-8 rounded-2xl border border-dashed border-slate-300 p-12 text-center">
						<TableIcon className="mx-auto h-12 w-12 text-slate-400" />
						<h3 className="mt-3 text-base font-semibold text-slate-900">Nenhuma consulta cadastrada no banco</h3>
						<p className="mt-1 text-sm text-slate-500">
							Cadastre sua primeira consulta SQL do Sankhya para gerar a tabela correspondente no banco de dados.
						</p>
						<button
							type="button"
							onClick={openNewConfiguration}
							className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
						>
							<Plus className="h-4 w-4" />
							Criar Primeira Consulta
						</button>
					</div>
				) : (
					<div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
						{configurations.map((config) => {
							const isQueryOpen = visibleQueryId === config.id;
							const scheduleBadge = getScheduleBadge(config);
							const isThisSyncing = syncingId === config.id || config.lastSyncStatus === 'RUNNING';

							return (
								<article
									key={config.id}
									className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
								>
									<div>
										<div className="flex items-start justify-between gap-2">
											<h2 className="text-base font-bold text-slate-900">{config.context}</h2>
											{config.tableName && (
												<span className="flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-indigo-700 border border-indigo-100">
													<TableIcon className="h-3 w-3" />
													{config.tableName}
												</span>
											)}
										</div>

										<p className="mt-2 text-xs leading-relaxed text-slate-600 line-clamp-2">
											{config.description || 'Sem descrição.'}
										</p>

										{/* Badges de Agendamento e Chave Primária (PK) */}
										<div className="mt-3 flex flex-wrap items-center gap-2">
											<span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${scheduleBadge.bg}`}>
												<Clock className="h-3 w-3" />
												{scheduleBadge.text}
											</span>

											{config.primaryKey && (
												<span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
													<KeyRound className="h-3 w-3 text-amber-600" />
													PK: {config.primaryKey}
												</span>
											)}
										</div>

										{/* Status e Datas de Sincronização */}
										<div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-[11px] text-slate-600 space-y-1">
											<div className="flex items-center justify-between">
												<span className="text-slate-400 font-medium">Último Sync:</span>
												<span className="font-semibold text-slate-700">
													{formatDateTime(config.lastSyncAt) ?? 'Nunca sincronizado'}
												</span>
											</div>

											{config.nextSyncAt && config.syncActive && (
												<div className="flex items-center justify-between">
													<span className="text-slate-400 font-medium">Próximo:</span>
													<span className="font-medium text-indigo-600">
														{formatDateTime(config.nextSyncAt)}
													</span>
												</div>
											)}

											{config.lastSyncStatus && (
												<div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
													<span className="text-slate-400 font-medium">Status:</span>
													<span className={`font-semibold flex items-center gap-1 ${
														config.lastSyncStatus === 'SUCCESS'
															? 'text-emerald-600'
															: config.lastSyncStatus === 'ERROR'
															? 'text-rose-600'
															: 'text-amber-600'
													}`}>
														{config.lastSyncStatus === 'SUCCESS' && <CheckCircle2 className="h-3 w-3" />}
														{config.lastSyncStatus === 'ERROR' && <AlertCircle className="h-3 w-3" />}
														{config.lastSyncStatus === 'RUNNING' && <RefreshCw className="h-3 w-3 animate-spin" />}
														{config.lastSyncStatus}
													</span>
												</div>
											)}

											{config.lastSyncMessage && (
												<p className="text-[10px] text-slate-500 pt-0.5 line-clamp-1" title={config.lastSyncMessage}>
													{config.lastSyncMessage}
												</p>
											)}
										</div>

										{/* Colunas com destaque para PK */}
										<div className="mt-3">
											<span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
												Colunas:
											</span>
											<div className="mt-1 flex flex-wrap gap-1">
												{config.expectedFields.map((field) => {
													const isPk = config.primaryKey && field.toUpperCase() === config.primaryKey.toUpperCase();
													return (
														<span
															key={field}
															className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[10px] font-medium ${
																isPk
																	? 'bg-amber-100 text-amber-900 border border-amber-300 font-bold'
																	: 'bg-slate-100 text-slate-700'
															}`}
														>
															{isPk && <KeyRound className="h-2.5 w-2.5 text-amber-600" />}
															{field}
														</span>
													);
												})}
											</div>
										</div>

										{/* Toggle Visualização Query */}
										<div className="mt-3">
											<button
												type="button"
												onClick={() => setVisibleQueryId(isQueryOpen ? null : (config.id ?? null))}
												className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
											>
												<Code2 className="h-3.5 w-3.5" />
												<span>{isQueryOpen ? 'Ocultar SQL' : 'Visualizar SQL'}</span>
											</button>

											{isQueryOpen && (
												<pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-200">
													{config.query}
												</pre>
											)}
										</div>
									</div>

									{/* Ações */}
									<div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3">
										<button
											type="button"
											onClick={() => handleSyncNow(config.id)}
											disabled={isThisSyncing}
											title="Sincronizar agora com o Sankhya"
											className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 transition"
										>
											<RefreshCw className={`h-3.5 w-3.5 ${isThisSyncing ? 'animate-spin' : ''}`} />
											<span>{isThisSyncing ? 'Sincronizando...' : 'Sincronizar Agora'}</span>
										</button>

										<div className="flex items-center gap-1">
											<button
												type="button"
												onClick={() => duplicateConfiguration(config)}
												title="Duplicar configuração"
												className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
											>
												<Copy className="h-4 w-4" />
											</button>
											<button
												type="button"
												onClick={() => openEditConfiguration(config)}
												title="Editar consulta"
												className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
											>
												<Edit2 className="h-4 w-4" />
											</button>
											<button
												type="button"
												onClick={() => removeConfiguration(config.id)}
												title="Excluir integração"
												className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
											>
												<Trash2 className="h-4 w-4" />
											</button>
										</div>
									</div>
								</article>
							);
						})}
					</div>
				)}

				{/* Modal de Criação / Edição */}
				{isModalOpen && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
						<div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
							<div className="flex items-center justify-between border-b border-slate-200 pb-4">
								<div>
									<h2 className="text-lg font-bold text-slate-900">
										{editingConfig ? 'Editar Consulta SQL do ERP' : 'Nova Consulta SQL do ERP'}
									</h2>
									<p className="text-xs text-slate-500">
										Defina a consulta SQL, as colunas, a Chave Primária (PK) e o agendamento de atualização.
									</p>
								</div>
								<button
									type="button"
									onClick={closeModal}
									className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
								>
									<X className="h-5 w-5" />
								</button>
							</div>

							<form onSubmit={saveConfiguration} className="mt-5 space-y-5">
								<div className="grid gap-4 sm:grid-cols-2">
									<div>
										<label className="block text-xs font-semibold text-slate-700" htmlFor="context">
											Contexto da Integração (Nome da Tabela)
										</label>
										<input
											id="context"
											type="text"
											required
											value={context}
											onChange={(e) => setContext(e.target.value)}
											placeholder="Ex: Pedidos de Compra, Clientes"
											className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none"
										/>
									</div>

									<div>
										<label className="block text-xs font-semibold text-slate-700" htmlFor="description">
											Descrição para a IA
										</label>
										<input
											id="description"
											type="text"
											value={description}
											onChange={(e) => setDescription(e.target.value)}
											placeholder="Ex: Dados de clientes e limites para o Gideon consultar"
											className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none"
										/>
									</div>
								</div>

								{/* Seção de Agendamento da Atualização */}
								<div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
									<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-indigo-100 pb-3">
										<div className="flex items-center gap-2 text-indigo-900 font-semibold text-sm">
											<Clock className="h-4 w-4 text-indigo-600" />
											<span>Agendamento da Atualização Automática</span>
										</div>

										<label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
											<input
												type="checkbox"
												checked={syncActive}
												onChange={(e) => setSyncActive(e.target.checked)}
												className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
											/>
											<span>Ativar sincronização automática</span>
										</label>
									</div>

									{syncActive && (
										<div className="mt-3.5 space-y-3.5">
											{/* Seleção de Frequência */}
											<div>
												<span className="block text-xs font-semibold text-slate-700 mb-1.5">
													Frequência da Atualização:
												</span>
												<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
													{[
														{ value: 'MINUTES', label: 'Minutos', desc: 'A cada X min' },
														{ value: 'HOURS', label: 'Horas', desc: 'A cada X horas' },
														{ value: 'DAILY', label: 'Diário', desc: '1x ao dia no horário' },
														{ value: 'MONTHLY', label: 'Mensal', desc: 'Dia do mês e hora' },
													].map((opt) => (
														<button
															type="button"
															key={opt.value}
															onClick={() => setSyncFrequency(opt.value as SyncFrequency)}
															className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-xs font-medium transition ${
																syncFrequency === opt.value
																	? 'border-indigo-600 bg-indigo-600 text-white shadow-xs'
																	: 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
															}`}
														>
															<span className="font-bold">{opt.label}</span>
															<span className={`text-[10px] ${syncFrequency === opt.value ? 'text-indigo-100' : 'text-slate-400'}`}>
																{opt.desc}
															</span>
														</button>
													))}
												</div>
											</div>

											{/* Parâmetros Específicos por Frequência */}
											<div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-indigo-100/60">
												{syncFrequency === 'MINUTES' && (
													<div className="sm:col-span-2">
														<label className="block text-xs font-semibold text-slate-700">
															Intervalo em Minutos
														</label>
														<div className="mt-1 flex items-center gap-2">
															<input
																type="number"
																min="1"
																max="1440"
																required
																value={syncInterval}
																onChange={(e) => setSyncInterval(Math.max(1, parseInt(e.target.value, 10) || 1))}
																className="block w-32 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 bg-white outline-none focus:border-indigo-500"
															/>
															<span className="text-xs text-slate-500">minutos entre cada consulta (ex: 15, 30)</span>
														</div>
													</div>
												)}

												{syncFrequency === 'HOURS' && (
													<div className="sm:col-span-2">
														<label className="block text-xs font-semibold text-slate-700">
															Intervalo em Horas
														</label>
														<div className="mt-1 flex items-center gap-2">
															<input
																type="number"
																min="1"
																max="720"
																required
																value={syncInterval}
																onChange={(e) => setSyncInterval(Math.max(1, parseInt(e.target.value, 10) || 1))}
																className="block w-32 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 bg-white outline-none focus:border-indigo-500"
															/>
															<span className="text-xs text-slate-500">hora(s) entre cada consulta (ex: 1, 2, 6, 12)</span>
														</div>
													</div>
												)}

												{syncFrequency === 'DAILY' && (
													<div className="sm:col-span-2">
														<label className="block text-xs font-semibold text-slate-700">
															Horário da Atualização Diária (uma vez ao dia)
														</label>
														<div className="mt-1 flex items-center gap-2">
															<input
																type="time"
																required
																value={syncTime}
																onChange={(e) => setSyncTime(e.target.value)}
																className="block w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 bg-white outline-none focus:border-indigo-500"
															/>
															<span className="text-xs text-slate-500">Horário fixo para execução diária</span>
														</div>
													</div>
												)}

												{syncFrequency === 'MONTHLY' && (
													<>
														<div>
															<label className="block text-xs font-semibold text-slate-700">
																Dia do Mês (1 a 31)
															</label>
															<input
																type="number"
																min="1"
																max="31"
																required
																value={syncDayOfMonth}
																onChange={(e) => setSyncDayOfMonth(Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)))}
																className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 bg-white outline-none focus:border-indigo-500"
															/>
														</div>
														<div>
															<label className="block text-xs font-semibold text-slate-700">
																Horário da Atualização Mensal
															</label>
															<input
																type="time"
																required
																value={syncTime}
																onChange={(e) => setSyncTime(e.target.value)}
																className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 bg-white outline-none focus:border-indigo-500"
															/>
														</div>
													</>
												)}
											</div>
										</div>
									)}
								</div>

								<div>
									<div className="flex items-center justify-between">
										<label className="block text-xs font-semibold text-slate-700" htmlFor="query">
											Consulta SQL no Sankhya (DbExplorer)
										</label>
										<span className="text-[11px] text-slate-400">Suporte a syntax highlight</span>
									</div>
									<div className="mt-1.5">
										<SqlEditor id="query" value={query} onChange={setQuery} />
									</div>
								</div>

								{/* Seção de Colunas e Definição da Chave Primária (PK) */}
								<div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
									<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
										<div>
											<div className="flex items-center gap-1.5 text-slate-800 font-semibold text-xs">
												<KeyRound className="h-4 w-4 text-amber-500" />
												<span>Colunas e Definição da Chave Primária (PK)</span>
											</div>
											<p className="text-[11px] text-slate-500 mt-0.5">
												Adicione os campos retornados pela query e selecione exatamente uma coluna como Chave Primária.
											</p>
										</div>

										<button
											type="button"
											onClick={() => setExpectedFields([...expectedFields, createEmptyField()])}
											className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 self-start sm:self-center"
										>
											<Plus className="h-3.5 w-3.5" />
											Adicionar Coluna
										</button>
									</div>

									{/* Seletor explícito de Chave Primária */}
									<div className="rounded-lg bg-amber-50/70 border border-amber-200 p-3">
										<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
											<div className="flex items-center gap-2">
												<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500 text-white shadow-xs">
													<KeyRound className="h-4 w-4" />
												</div>
												<div>
													<label htmlFor="primaryKeySelect" className="block text-xs font-bold text-amber-950">
														Chave Primária (PK) Obrigatória:
													</label>
													<span className="text-[11px] text-amber-800">
														Necessária para que a IA realize joins e agregações sem duplicar linhas.
													</span>
												</div>
											</div>

											<div className="w-full sm:w-64">
												<select
													id="primaryKeySelect"
													value={primaryKey}
													onChange={(e) => setPrimaryKey(e.target.value)}
													required
													className="block w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-mono text-xs font-semibold text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
												>
													<option value="">-- Selecione a coluna PK --</option>
													{availableValidFields.map((field) => (
														<option key={field} value={field}>
															🔑 {field}
														</option>
													))}
												</select>
											</div>
										</div>

										{!primaryKey && (
											<p className="mt-2 text-[11px] font-medium text-amber-700 flex items-center gap-1">
												<AlertCircle className="h-3.5 w-3.5 shrink-0" />
												Você precisa marcar ou selecionar uma coluna como PK abaixo ou no seletor acima.
											</p>
										)}
									</div>

									{/* Grid de Inputs de Colunas com Botão Rápido de PK */}
									<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
										{expectedFields.map((field, index) => {
											const isThisPk = primaryKey && field.trim() && primaryKey.toUpperCase() === field.trim().toUpperCase();

											return (
												<div
													key={index}
													className={`flex items-center gap-1.5 rounded-lg border p-1.5 transition ${
														isThisPk
															? 'border-amber-400 bg-amber-50/90 shadow-xs ring-1 ring-amber-300'
															: 'border-slate-300 bg-white hover:border-slate-400'
													}`}
												>
													<button
														type="button"
														onClick={() => field.trim() && setPrimaryKey(field.trim())}
														disabled={!field.trim()}
														title={isThisPk ? 'Coluna atual é a Chave Primária' : 'Clique para definir esta coluna como PK'}
														className={`flex items-center justify-center rounded-md px-1.5 py-1 text-[10px] font-bold transition ${
															isThisPk
																? 'bg-amber-500 text-white shadow-xs'
																: field.trim()
																? 'bg-slate-100 text-slate-400 hover:bg-amber-100 hover:text-amber-700'
																: 'bg-slate-100 text-slate-300 cursor-not-allowed'
														}`}
													>
														<KeyRound className="h-3 w-3 mr-0.5" />
														{isThisPk ? 'PK' : 'Definir PK'}
													</button>

													<input
														type="text"
														value={field}
														onChange={(e) => updateField(index, e.target.value)}
														placeholder={`Coluna ${index + 1}`}
														className={`w-full bg-transparent px-1.5 py-0.5 font-mono text-xs uppercase outline-none ${
															isThisPk ? 'font-bold text-amber-950' : 'text-slate-800'
														}`}
													/>

													{expectedFields.length > 1 && (
														<button
															type="button"
															onClick={() => removeField(index)}
															className="text-slate-400 hover:text-rose-500 p-0.5"
														>
															<X className="h-3.5 w-3.5" />
														</button>
													)}
												</div>
											);
										})}
									</div>
								</div>

								<div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
									<button
										type="button"
										onClick={closeModal}
										className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
									>
										Cancelar
									</button>
									<button
										type="submit"
										disabled={isSaving}
										className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:bg-slate-300"
									>
										{isSaving && <RefreshCw className="h-4 w-4 animate-spin" />}
										{editingConfig ? 'Salvar Alterações' : 'Criar Tabela e Integração'}
									</button>
								</div>
							</form>
						</div>
					</div>
				)}
			</section>
		</main>
	);
}
