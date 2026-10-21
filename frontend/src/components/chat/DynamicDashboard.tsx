import React, { useMemo, useState } from 'react';
import {
	ResponsiveContainer,
	BarChart,
	Bar,
	LineChart,
	Line,
	PieChart,
	Pie,
	Cell,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	Legend,
} from 'recharts';
import {
	BarChart3,
	Table as TableIcon,
	TrendingUp,
	PieChart as PieIcon,
	LayoutGrid,
	AlertCircle,
	ArrowLeftRight,
} from 'lucide-react';

export interface DashboardData {
	type: 'bar' | 'line' | 'pie' | 'table';
	title?: string;
	data: Array<Record<string, unknown>>;
}

interface DynamicDashboardProps {
	configString: string;
}

const PALETTE = [
	'#4f46e5', // indigo-600
	'#0ea5e9', // sky-500
	'#10b981', // emerald-500
	'#f59e0b', // amber-500
	'#8b5cf6', // violet-500
	'#ec4899', // pink-500
	'#06b6d4', // cyan-500
	'#f97316', // orange-500
];

const CURRENCY_KEY_REGEX = /(valor|vlr|faturamento|receita|total|preco|preço|limite|custo|ticket|saldo|lucro|desconto|r\$)/i;
const ID_OR_CODE_KEY_REGEX = /^(id|cod|codigo|código|num|nro|numero|número|nota|pedido|cpf|cnpj|cep|ano)/i;

function isCurrencyField(key: string, title?: string): boolean {
	if (ID_OR_CODE_KEY_REGEX.test(key.trim())) {
		return false;
	}
	if (CURRENCY_KEY_REGEX.test(key)) {
		return true;
	}
	if (title && CURRENCY_KEY_REGEX.test(title) && /^(value|val|y)$/i.test(key.trim())) {
		return true;
	}
	return false;
}

function parseNumericValue(val: unknown): number | null {
	if (typeof val === 'number') {
		return Number.isFinite(val) ? val : null;
	}
	if (typeof val === 'string') {
		const trimmed = val.trim();
		if (!trimmed) return null;
		// Formato numérico padrão "1234.56" ou "-1234.56"
		if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
			const parsed = Number(trimmed);
			return Number.isFinite(parsed) ? parsed : null;
		}
		// Formato PT-BR "R$ 1.234,56" ou "1.234,56"
		if (/^(R\$\s*)?-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(trimmed)) {
			const normalized = trimmed.replace(/R\$\s*/g, '').replace(/\./g, '').replace(',', '.');
			const parsed = Number(normalized);
			return Number.isFinite(parsed) ? parsed : null;
		}
	}
	return null;
}

function formatAxisCompactPtBr(val: unknown, isCurrency: boolean): string {
	const num = typeof val === 'number' ? val : parseNumericValue(val);
	if (num === null) {
		return String(val ?? '');
	}

	const abs = Math.abs(num);
	const prefix = isCurrency ? 'R$ ' : '';

	if (abs >= 1_000_000_000) {
		return `${prefix}${(num / 1_000_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`;
	}
	if (abs >= 1_000_000) {
		return `${prefix}${(num / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
	}
	if (abs >= 1_000) {
		return `${prefix}${(num / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
	}

	return `${prefix}${num.toLocaleString('pt-BR', { maximumFractionDigits: isCurrency ? 0 : 2 })}`;
}

function formatFullValuePtBr(val: unknown, key: string, title?: string): string {
	if (val === null || val === undefined || val === '') {
		return '-';
	}

	// Evita formatar códigos/IDs como número com separador de milhar ou moeda
	if (ID_OR_CODE_KEY_REGEX.test(key.trim()) && (typeof val === 'number' || typeof val === 'string')) {
		return String(val);
	}

	const num = parseNumericValue(val);
	if (num !== null) {
		if (isCurrencyField(key, title)) {
			return num.toLocaleString('pt-BR', {
				style: 'currency',
				currency: 'BRL',
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			});
		}
		const hasDecimals = num % 1 !== 0;
		return num.toLocaleString('pt-BR', {
			minimumFractionDigits: hasDecimals ? 2 : 0,
			maximumFractionDigits: 2,
		});
	}

	return String(val);
}

function formatColumnLabel(key: string): string {
	return key
		.replace(/_/g, ' ')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.trim();
}

function truncateLabel(label: unknown, maxLength = 16): string {
	const str = String(label ?? '');
	if (str.length <= maxLength) return str;
	return `${str.slice(0, maxLength - 1)}…`;
}

export const DynamicDashboard: React.FC<DynamicDashboardProps> = React.memo(({ configString }) => {
	// 'auto' usa Cards no mobile (< sm) e Tabela no desktop (>= sm) para type === 'table'
	const [tableLayout, setTableLayout] = useState<'auto' | 'cards' | 'table'>('auto');

	const parsedResult = useMemo(() => {
		const cleaned = configString
			.trim()
			.replace(/^```(?:dashboard|json)?\s*/i, '')
			.replace(/\s*```$/i, '')
			.trim();

		if (!cleaned) {
			return { status: 'empty' as const, config: null };
		}

		try {
			const raw = JSON.parse(cleaned) as Partial<DashboardData>;
			if (!raw || typeof raw !== 'object') {
				return { status: 'invalid' as const, config: null };
			}

			const rawData = Array.isArray(raw.data) ? raw.data : [];
			const validRows = rawData
				.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
				.map((row) => {
					const normalizedRow: Record<string, unknown> = {};
					for (const [k, v] of Object.entries(row)) {
						// Converte strings numéricas para number se não for campo de código/ID
						if (!ID_OR_CODE_KEY_REGEX.test(k.trim()) && typeof v === 'string') {
							const parsedNum = parseNumericValue(v);
							normalizedRow[k] = parsedNum !== null ? parsedNum : v;
						} else {
							normalizedRow[k] = v;
						}
					}
					return normalizedRow;
				});

			const validType: DashboardData['type'] =
				raw.type === 'bar' || raw.type === 'line' || raw.type === 'pie' || raw.type === 'table'
					? raw.type
					: 'table';

			return {
				status: 'ready' as const,
				config: {
					type: validType,
					title: typeof raw.title === 'string' ? raw.title : undefined,
					data: validRows,
				},
			};
		} catch {
			// Se parece que o JSON ainda está chegando via stream SSE (não fechou chaves/colchetes)
			const isLikelyStreaming = !cleaned.endsWith('}');
			return {
				status: isLikelyStreaming ? ('streaming' as const) : ('invalid' as const),
				config: null,
			};
		}
	}, [configString]);

	if (parsedResult.status === 'empty') {
		return null;
	}

	if (parsedResult.status === 'streaming') {
		return (
			<div className="my-3 flex h-56 w-full animate-pulse flex-col items-center justify-center rounded-2xl border border-indigo-100 bg-slate-50/90 p-4 text-slate-500">
				<div className="flex items-center gap-2.5 text-xs font-medium text-indigo-700">
					<div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
					<span>Montando visualização interativa...</span>
				</div>
				<p className="mt-1.5 text-[11px] text-slate-400">Processando indicadores do Sankhya ERP em tempo real</p>
			</div>
		);
	}

	if (parsedResult.status === 'invalid' || !parsedResult.config) {
		return (
			<div className="my-3 flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-800">
				<AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
				<span>Não foi possível renderizar o gráfico para este bloco de dados.</span>
			</div>
		);
	}

	const { type, title, data } = parsedResult.config;

	if (data.length === 0) {
		return (
			<div className="my-3 flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
				<AlertCircle className="h-4 w-4 shrink-0 text-slate-400" />
				<span>Nenhum registro retornado para exibir em {title ? `"${title}"` : 'visualização'}.</span>
			</div>
		);
	}

	// Coleta todas as chaves presentes nas linhas para evitar omissão se a primeira linha tiver campos ausentes
	const allKeys = Array.from(
		data.reduce((acc, row) => {
			Object.keys(row).forEach((k) => acc.add(k));
			return acc;
		}, new Set<string>())
	);

	const sample = data[0] || {};

	// Detecta a chave numérica principal para os eixos Y / fatias
	const valueKey =
		allKeys.find((k) => /^(value|valor|total|faturamento|quantidade|qtd|limite|saldo)$/i.test(k)) ||
		allKeys.find((k) => !ID_OR_CODE_KEY_REGEX.test(k) && typeof sample[k] === 'number') ||
		allKeys.find((k) => typeof sample[k] === 'number') ||
		allKeys[1] ||
		allKeys[0] ||
		'value';

	// Detecta a chave de rótulo/categoria para o eixo X
	const nameKey =
		allKeys.find((k) => /^(name|nome|label|categoria|cliente|parceiro|produto|mes|mês|periodo|período|vendedor|grupo|uf)$/i.test(k)) ||
		allKeys.find((k) => k !== valueKey && typeof sample[k] === 'string') ||
		allKeys.find((k) => k !== valueKey) ||
		allKeys[0] ||
		'name';

	const isPrimaryValueCurrency = isCurrencyField(valueKey, title);

	const renderTableCards = () => (
		<div className="grid max-h-[26rem] grid-cols-1 gap-2.5 overflow-y-auto pr-1 custom-scrollbar sm:grid-cols-2">
			{data.map((row, idx) => {
				const primaryTitleKey = nameKey && row[nameKey] !== undefined ? nameKey : allKeys[0];
				const primaryTitleVal = primaryTitleKey ? formatFullValuePtBr(row[primaryTitleKey], primaryTitleKey, title) : `Item #${idx + 1}`;
				const secondaryKeys = allKeys.filter((k) => k !== primaryTitleKey);

				return (
					<div
						key={idx}
						className="rounded-xl border border-slate-200/90 bg-slate-50/60 p-3 transition hover:border-indigo-200 hover:bg-white"
					>
						<div className="mb-2 flex items-start justify-between gap-2 border-b border-slate-200/70 pb-1.5">
							<div className="min-w-0 flex-1">
								{primaryTitleKey && (
									<span className="block text-[10px] font-medium uppercase tracking-wider text-slate-400">
										{formatColumnLabel(primaryTitleKey)}
									</span>
								)}
								<p className="truncate text-xs font-semibold text-slate-900" title={String(primaryTitleVal)}>
									{primaryTitleVal}
								</p>
							</div>
							<span className="shrink-0 rounded-md bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-600">
								#{idx + 1}
							</span>
						</div>

						<dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
							{secondaryKeys.map((key) => {
								const rawVal = row[key];
								const isNum = parseNumericValue(rawVal) !== null && !ID_OR_CODE_KEY_REGEX.test(key);
								const formatted = formatFullValuePtBr(rawVal, key, title);
								return (
									<div key={key} className="min-w-0">
										<dt className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">
											{formatColumnLabel(key)}
										</dt>
										<dd
											className={`truncate ${
												isNum ? 'font-mono font-semibold text-slate-900' : 'text-slate-700'
											}`}
											title={formatted}
										>
											{formatted}
										</dd>
									</div>
								);
							})}
						</dl>
					</div>
				);
			})}
		</div>
	);

	const renderDesktopScrollableTable = () => (
		<div className="space-y-1.5">
			{allKeys.length > 3 && (
				<div className="flex items-center justify-end gap-1 text-[11px] text-slate-400 sm:hidden">
					<ArrowLeftRight className="h-3 w-3" />
					<span>Deslize horizontalmente para ver todas as colunas</span>
				</div>
			)}
			<div className="max-h-96 overflow-x-auto overflow-y-auto rounded-xl border border-slate-200 custom-scrollbar">
				<table className="min-w-full divide-y divide-slate-200 text-left text-xs text-slate-700">
					<thead className="sticky top-0 z-10 bg-slate-100/95 font-semibold text-slate-800 backdrop-blur-sm">
						<tr>
							{allKeys.map((key, colIdx) => {
								const sampleVal = sample[key];
								const isRightAligned =
									parseNumericValue(sampleVal) !== null && !ID_OR_CODE_KEY_REGEX.test(key);
								return (
									<th
										key={key}
										className={`whitespace-nowrap px-3 py-2.5 text-[11px] uppercase tracking-wider ${
											colIdx === 0
												? 'sticky left-0 z-20 bg-slate-100/95 shadow-[1px_0_0_0_rgba(226,232,240,1)]'
												: ''
										} ${isRightAligned ? 'text-right' : 'text-left'}`}
									>
										{formatColumnLabel(key)}
									</th>
								);
							})}
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100 bg-white">
						{data.map((row, index) => (
							<tr key={index} className="group transition hover:bg-indigo-50/40">
								{allKeys.map((key, colIdx) => {
									const val = row[key];
									const isNum = parseNumericValue(val) !== null && !ID_OR_CODE_KEY_REGEX.test(key);
									const formatted = formatFullValuePtBr(val, key, title);
									return (
										<td
											key={key}
											className={`whitespace-nowrap px-3 py-2 ${
												colIdx === 0
													? 'sticky left-0 z-10 bg-white font-medium text-slate-900 group-hover:bg-indigo-50/60 shadow-[1px_0_0_0_rgba(241,245,249,1)]'
													: ''
											} ${isNum ? 'text-right font-mono font-medium text-slate-900' : 'text-left'}`}
										>
											{formatted}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);

	return (
		<div className="my-3.5 w-full overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm transition hover:shadow-md sm:p-4">
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
				<div className="flex min-w-0 items-center gap-2">
					{type === 'bar' && <BarChart3 className="h-4 w-4 shrink-0 text-indigo-600" />}
					{type === 'line' && <TrendingUp className="h-4 w-4 shrink-0 text-emerald-600" />}
					{type === 'pie' && <PieIcon className="h-4 w-4 shrink-0 text-amber-600" />}
					{type === 'table' && <TableIcon className="h-4 w-4 shrink-0 text-sky-600" />}
					<h3 className="truncate text-xs font-semibold text-slate-800 sm:text-sm">
						{title || 'Indicadores Sankhya ERP'}
					</h3>
					<span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
						{data.length} {data.length === 1 ? 'item' : 'itens'}
					</span>
				</div>

				{type === 'table' && (
					<div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px]">
						<button
							type="button"
							onClick={() => setTableLayout('cards')}
							className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
								tableLayout === 'cards'
									? 'bg-white text-indigo-600 shadow-sm'
									: tableLayout === 'auto'
										? 'bg-white text-indigo-600 shadow-sm sm:bg-transparent sm:text-slate-600 sm:shadow-none'
										: 'text-slate-600 hover:text-slate-900'
							}`}
							title="Visualização em Cartões Compactos (ideal para celular)"
						>
							<LayoutGrid className="h-3 w-3" />
							<span>Cards</span>
						</button>
						<button
							type="button"
							onClick={() => setTableLayout('table')}
							className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
								tableLayout === 'table'
									? 'bg-white text-indigo-600 shadow-sm'
									: tableLayout === 'auto'
										? 'text-slate-600 sm:bg-white sm:text-indigo-600 sm:shadow-sm'
										: 'text-slate-600 hover:text-slate-900'
							}`}
							title="Visualização em Tabela com colunas completas"
						>
							<TableIcon className="h-3 w-3" />
							<span>Tabela</span>
						</button>
					</div>
				)}
			</div>

			{type === 'table' && (
				<>
					{tableLayout === 'cards' && renderTableCards()}
					{tableLayout === 'table' && renderDesktopScrollableTable()}
					{tableLayout === 'auto' && (
						<>
							<div className="block sm:hidden">{renderTableCards()}</div>
							<div className="hidden sm:block">{renderDesktopScrollableTable()}</div>
						</>
					)}
				</>
			)}

			{type === 'bar' && (
				<div className="h-64 w-full pt-2 sm:h-72">
					<ResponsiveContainer width="100%" height="100%">
						<BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: data.length > 4 ? 28 : 12 }}>
							<CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
							<XAxis
								dataKey={nameKey}
								stroke="#64748b"
								fontSize={11}
								tickLine={false}
								axisLine={{ stroke: '#cbd5e1' }}
								angle={data.length > 4 ? -25 : 0}
								textAnchor={data.length > 4 ? 'end' : 'middle'}
								interval="preserveStartEnd"
								tickFormatter={(val) => truncateLabel(val, 14)}
							/>
							<YAxis
								stroke="#64748b"
								fontSize={11}
								tickLine={false}
								axisLine={false}
								width={isPrimaryValueCurrency ? 66 : 52}
								tickFormatter={(val) => formatAxisCompactPtBr(val, isPrimaryValueCurrency)}
							/>
							<Tooltip
								contentStyle={{
									backgroundColor: '#0f172a',
									borderRadius: '0.75rem',
									border: '1px solid #334155',
									color: '#fff',
									fontSize: '0.75rem',
									boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.25)',
								}}
								formatter={(val: unknown) => [
									formatFullValuePtBr(val, valueKey, title),
									formatColumnLabel(valueKey),
								]}
							/>
							<Bar dataKey={valueKey} fill="#4f46e5" radius={[6, 6, 0, 0]} maxBarSize={56} />
						</BarChart>
					</ResponsiveContainer>
				</div>
			)}

			{type === 'line' && (
				<div className="h-64 w-full pt-2 sm:h-72">
					<ResponsiveContainer width="100%" height="100%">
						<LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
							<CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
							<XAxis
								dataKey={nameKey}
								stroke="#64748b"
								fontSize={11}
								tickLine={false}
								axisLine={{ stroke: '#cbd5e1' }}
								interval="preserveStartEnd"
								tickFormatter={(val) => truncateLabel(val, 14)}
							/>
							<YAxis
								stroke="#64748b"
								fontSize={11}
								tickLine={false}
								axisLine={false}
								width={isPrimaryValueCurrency ? 66 : 52}
								tickFormatter={(val) => formatAxisCompactPtBr(val, isPrimaryValueCurrency)}
							/>
							<Tooltip
								contentStyle={{
									backgroundColor: '#0f172a',
									borderRadius: '0.75rem',
									border: '1px solid #334155',
									color: '#fff',
									fontSize: '0.75rem',
									boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.25)',
								}}
								formatter={(val: unknown) => [
									formatFullValuePtBr(val, valueKey, title),
									formatColumnLabel(valueKey),
								]}
							/>
							<Line
								type="monotone"
								dataKey={valueKey}
								stroke="#10b981"
								strokeWidth={3}
								dot={{ r: 4, fill: '#10b981' }}
								activeDot={{ r: 6 }}
							/>
						</LineChart>
					</ResponsiveContainer>
				</div>
			)}

			{type === 'pie' && (
				<div className="h-64 w-full pt-2 sm:h-72">
					<ResponsiveContainer width="100%" height="100%">
						<PieChart>
							<Pie
								data={data}
								dataKey={valueKey}
								nameKey={nameKey}
								cx="50%"
								cy="46%"
								outerRadius={78}
								innerRadius={36}
								paddingAngle={3}
								label={({ name, percent }: { name?: unknown; percent?: number }) =>
									`${truncateLabel(name, 12)} (${(((percent as number) || 0) * 100).toFixed(0)}%)`
								}
								labelLine={false}
							>
								{data.map((_, index) => (
									<Cell key={`cell-${index}`} fill={PALETTE[index % PALETTE.length]} />
								))}
							</Pie>
							<Tooltip
								contentStyle={{
									backgroundColor: '#0f172a',
									borderRadius: '0.75rem',
									border: '1px solid #334155',
									color: '#fff',
									fontSize: '0.75rem',
								}}
								formatter={(val: unknown) => [
									formatFullValuePtBr(val, valueKey, title),
									formatColumnLabel(valueKey),
								]}
							/>
							<Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '0.72rem' }} />
						</PieChart>
					</ResponsiveContainer>
				</div>
			)}
		</div>
	);
});

DynamicDashboard.displayName = 'DynamicDashboard';

export default DynamicDashboard;
