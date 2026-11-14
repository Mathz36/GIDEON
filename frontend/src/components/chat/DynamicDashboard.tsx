import React, { useId, useMemo, useState } from 'react';
import {
	ResponsiveContainer,
	BarChart,
	Bar,
	LineChart,
	Line,
	AreaChart,
	Area,
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
	BarChartHorizontal,
	AreaChart as LucideAreaChart,
	Table as TableIcon,
	TrendingUp,
	PieChart as PieIcon,
	LayoutGrid,
	AlertCircle,
	ArrowLeftRight,
} from 'lucide-react';

export interface DashboardData {
	type: 'bar' | 'horizontal-bar' | 'line' | 'area' | 'pie' | 'table';
	title?: string;
	data: Array<Record<string, unknown>>;
}

export interface DynamicDashboardProps {
	configString: string;
	hideHeader?: boolean;
	className?: string;
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

const CURRENCY_KEY_REGEX = /(valor|vlr|faturamento|receita|liquido|líquido|bruto|preco|preço|limite|custo|ticket|saldo|lucro|desconto|r\$)/i;
const QUANTITY_KEY_REGEX = /(quantidade|qtd|volume|peso|itens|unidades|contagem|count)/i;
const ID_OR_CODE_KEY_REGEX = /^(id|_id|cod|cod_.*|.*_id|codigo|código|num|nro|numero|número|nota|nota_fiscal|numero_nota|pedido|pedido_origem|num_pedido|cpf|cnpj|cep)$/i;
const TIME_KEY_REGEX = /(^|_)(dia|data|data_emissao|dt|mes|mês|ano|periodo|período|semana|trimestre|date|month|year|day)($|_)/i;
const DESCRIPTIVE_LABEL_KEY_REGEX = /(^|_)(name|nome|label|categoria|razaosocial|razao_social|descricao|descrição|apelido|cliente|parceiro|produto|vendedor|representante|gerente|grupo|subgrupo|operacao|operação|cidade|bairro|uf|rede|ramo|classificacao|tipo|status)($|_)/i;

function isCurrencyField(key?: unknown, title?: string): boolean {
	if (!key) return false;
	const str = String(key).trim();
	if (ID_OR_CODE_KEY_REGEX.test(str) || QUANTITY_KEY_REGEX.test(str)) {
		return false;
	}
	if (CURRENCY_KEY_REGEX.test(str)) {
		return true;
	}
	if (title && !QUANTITY_KEY_REGEX.test(title) && CURRENCY_KEY_REGEX.test(title) && /^(value|val|y|total)$/i.test(str)) {
		return true;
	}
	return false;
}

export function parseNumericValue(val: unknown): number | null {
	if (typeof val === 'number') {
		return Number.isFinite(val) ? val : null;
	}
	if (typeof val === 'bigint') {
		const num = Number(val);
		return Number.isSafeInteger(num) ? num : null;
	}
	if (val && typeof val === 'object') {
		// Prisma.Decimal ou Decimal.js
		if (typeof (val as any).toNumber === 'function') {
			const n = (val as any).toNumber();
			return typeof n === 'number' && Number.isFinite(n) ? n : null;
		}
		if ('d' in val && 's' in val) {
			const dArr = Array.isArray((val as any).d) ? (val as any).d : [];
			const sign = typeof (val as any).s === 'number' ? (val as any).s : 1;
			const exp = typeof (val as any).e === 'number' ? (val as any).e : null;
			const digits = dArr.map(String).join('');
			if (digits) {
				if (exp !== null) {
					const first = digits[0];
					const rest = digits.slice(1);
					const mantissa = rest ? Number(`${first}.${rest}`) : Number(first);
					const n = sign * mantissa * Math.pow(10, exp);
					if (Number.isFinite(n)) return n;
				}
				const n = Number(digits) * sign;
				if (Number.isFinite(n)) return n;
			}
		}
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

function formatFullValuePtBr(val: unknown, key?: unknown, title?: string): string {
	if (val === null || val === undefined || val === '') {
		return '-';
	}

	const strKey = String(key ?? '').trim();

	// Evita formatar códigos/IDs como número com separador de milhar ou moeda
	if (strKey && ID_OR_CODE_KEY_REGEX.test(strKey) && (typeof val === 'number' || typeof val === 'string')) {
		return String(val);
	}

	const num = parseNumericValue(val);
	if (num !== null) {
		if (isCurrencyField(strKey, title)) {
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

function formatColumnLabel(key?: unknown): string {
	if (!key) return '';
	return String(key)
		.replace(/_/g, ' ')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.trim();
}

function truncateLabel(label: unknown, maxLength = 16): string {
	const raw = String(label ?? '').trim();
	// Formata automaticamente datas ISO 'YYYY-MM-DD HH:mm:ss' ou 'YYYY-MM-DD' para 'DD/MM' no eixo
	const isoMatch = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]\d{2}:\d{2}(?::\d{2})?.*)?$/.exec(raw);
	if (isoMatch) {
		return `${isoMatch[3]}/${isoMatch[2]}`;
	}
	const ymMatch = /^(\d{4})-(\d{2})$/.exec(raw);
	if (ymMatch) {
		return `${ymMatch[2]}/${ymMatch[1]}`;
	}
	if (raw.length <= maxLength) return raw;
	return `${raw.slice(0, maxLength - 1)}…`;
}

export function parseDashboardConfig(configString: string): {
	status: 'empty' | 'streaming' | 'invalid' | 'ready';
	config: DashboardData | null;
} {
	let rawContent = String(configString ?? '').trim();

	// Remove cercas markdown ```dashboard ou ```json residuais
	rawContent = rawContent
		.replace(/^```(?:dashboard|json)?\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();

	if (!rawContent) {
		return { status: 'empty', config: null };
	}

	// Extrai com precisão o bloco JSON delimitado por chaves {}
	const firstBrace = rawContent.indexOf('{');
	const lastBrace = rawContent.lastIndexOf('}');

	if (firstBrace === -1) {
		return { status: 'streaming', config: null };
	}

	const isLikelyStreaming = lastBrace === -1 || lastBrace <= firstBrace;
	const jsonCandidate = !isLikelyStreaming ? rawContent.slice(firstBrace, lastBrace + 1) : rawContent.slice(firstBrace);

	try {
		const raw = JSON.parse(jsonCandidate) as Partial<DashboardData>;
		if (!raw || typeof raw !== 'object') {
			return { status: 'invalid', config: null };
		}

		const rawData = Array.isArray(raw.data) ? raw.data : [];
		const validRows = rawData
			.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
			.map((row) => {
				const normalizedRow: Record<string, unknown> = {};
				for (const [k, v] of Object.entries(row)) {
					const parsedNum = parseNumericValue(v);
					if (!ID_OR_CODE_KEY_REGEX.test(String(k).trim()) && parsedNum !== null) {
						normalizedRow[k] = parsedNum;
					} else {
						normalizedRow[k] = v;
					}
				}
				return normalizedRow;
			});

		const validType: DashboardData['type'] =
			raw.type === 'bar' ||
			raw.type === 'horizontal-bar' ||
			raw.type === 'line' ||
			raw.type === 'area' ||
			raw.type === 'pie' ||
			raw.type === 'table'
				? raw.type
				: 'table';

		return {
			status: 'ready',
			config: {
				type: validType,
				title: typeof raw.title === 'string' ? raw.title : undefined,
				data: validRows,
			},
		};
	} catch {
		return {
			status: isLikelyStreaming ? 'streaming' : 'invalid',
			config: null,
		};
	}
}

class SafeChartContainer extends React.Component<
	{ children: React.ReactNode; fallback: React.ReactNode },
	{ hasError: boolean }
> {
	state = { hasError: false };

	static getDerivedStateFromError() {
		return { hasError: true };
	}

	componentDidCatch(error: Error) {
		console.warn('[DynamicDashboard] Falha ao renderizar com Recharts, aplicando fallback tabular seguro:', error);
	}

	componentDidUpdate(prevProps: { children: React.ReactNode }) {
		if (this.state.hasError && prevProps.children !== this.props.children) {
			this.setState({ hasError: false });
		}
	}

	render() {
		if (this.state.hasError) {
			return this.props.fallback;
		}
		return this.props.children;
	}
}

export const DynamicDashboard: React.FC<DynamicDashboardProps> = React.memo(({
	configString,
	hideHeader = false,
	className,
}) => {
	const rawId = useId();
	const gradientId = useMemo(() => `grad-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [rawId]);
	// 'auto' usa Cards no mobile (< sm) e Tabela no desktop (>= sm) para type === 'table'
	const [tableLayout, setTableLayout] = useState<'auto' | 'cards' | 'table'>('auto');

	const parsedResult = useMemo(() => parseDashboardConfig(configString), [configString]);

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
			if (row && typeof row === 'object') {
				Object.keys(row).forEach((k) => acc.add(k));
			}
			return acc;
		}, new Set<string>())
	);

	if (allKeys.length === 0) {
		return null;
	}

	const sample = data[0] || {};

	// Detecta a chave numérica principal para os eixos Y / fatias (bloqueando IDs/códigos e datas)
	const valueKey =
		allKeys.find(
			(k) =>
				!ID_OR_CODE_KEY_REGEX.test(k) &&
				!TIME_KEY_REGEX.test(k) &&
				/(value|valor|vlr|total|faturamento|receita|liquido|líquido|bruto|quantidade|qtd|peso|volume|limite|saldo|lucro|preco|preço|ticket)/i.test(k),
		) ||
		allKeys.find((k) => !ID_OR_CODE_KEY_REGEX.test(k) && !TIME_KEY_REGEX.test(k) && typeof sample[k] === 'number') ||
		allKeys.find((k) => typeof sample[k] === 'number') ||
		allKeys[1] ||
		allKeys[0] ||
		'value';

	// Detecta a chave de rótulo/categoria/tempo para o eixo X conforme o tipo do gráfico
	const xCandidates = allKeys.filter((k) => k !== valueKey);
	const nameKey =
		(type === 'line' || type === 'area'
			? xCandidates.find((k) => TIME_KEY_REGEX.test(k) || k === 'name') ||
				xCandidates.find((k) => DESCRIPTIVE_LABEL_KEY_REGEX.test(k))
			: xCandidates.find((k) => DESCRIPTIVE_LABEL_KEY_REGEX.test(k)) ||
				xCandidates.find((k) => TIME_KEY_REGEX.test(k))) ||
		xCandidates.find((k) => !ID_OR_CODE_KEY_REGEX.test(k) && typeof sample[k] === 'string') ||
		xCandidates.find((k) => typeof sample[k] === 'string') ||
		xCandidates[0] ||
		allKeys[0] ||
		'name';

	const isPrimaryValueCurrency = isCurrencyField(valueKey, title);

	const validPieData = useMemo(() => {
		if (type !== 'pie') return [];
		return data.filter((item) => {
			if (!item || typeof item !== 'object') return false;
			const num = parseNumericValue(item[valueKey]);
			return num !== null && num > 0;
		});
	}, [data, type, valueKey]);

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
		<div
			className={
				className
					? className
					: 'my-3.5 w-full overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm transition hover:shadow-md sm:p-4'
			}
		>
			{!hideHeader ? (
				<div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
					<div className="flex min-w-0 items-center gap-2">
						{type === 'bar' && <BarChart3 className="h-4 w-4 shrink-0 text-indigo-600" />}
						{type === 'horizontal-bar' && <BarChartHorizontal className="h-4 w-4 shrink-0 text-indigo-600" />}
						{type === 'line' && <TrendingUp className="h-4 w-4 shrink-0 text-emerald-600" />}
						{type === 'area' && <LucideAreaChart className="h-4 w-4 shrink-0 text-indigo-600" />}
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
			) : type === 'table' ? (
				<div className="mb-2 flex items-center justify-end">
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
				</div>
			) : null}

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

			{type !== 'table' && (
				<SafeChartContainer fallback={renderDesktopScrollableTable()}>
					{type === 'bar' && (
						<div className="h-64 w-full pt-2 sm:h-72">
							<ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={220}>
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

					{type === 'horizontal-bar' && (
						<div
							className="w-full pt-2"
							style={{ height: `${Math.max(260, Math.min(560, data.length * 38 + 36))}px` }}
						>
							<ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={220}>
								<BarChart
									layout="vertical"
									data={data}
									margin={{ top: 8, right: 16, left: 4, bottom: 8 }}
								>
									<CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
									<XAxis
										type="number"
										stroke="#64748b"
										fontSize={11}
										tickLine={false}
										axisLine={false}
										tickFormatter={(val) => formatAxisCompactPtBr(val, isPrimaryValueCurrency)}
									/>
									<YAxis
										type="category"
										dataKey={nameKey}
										stroke="#64748b"
										fontSize={11}
										tickLine={false}
										axisLine={{ stroke: '#cbd5e1' }}
										width={104}
										interval={0}
										tickFormatter={(val) => truncateLabel(val, 16)}
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
									<Bar dataKey={valueKey} fill="#4f46e5" radius={[0, 6, 6, 0]} maxBarSize={28} />
								</BarChart>
							</ResponsiveContainer>
						</div>
					)}

					{type === 'line' && (
						<div className="h-64 w-full pt-2 sm:h-72">
							<ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={220}>
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

					{type === 'area' && (
						<div className="h-64 w-full pt-2 sm:h-72">
							<ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={220}>
								<AreaChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: data.length > 4 ? 28 : 12 }}>
									<defs>
										<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
											<stop offset="5%" stopColor="#4f46e5" stopOpacity={0.4} />
											<stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0} />
										</linearGradient>
									</defs>
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
									<Area
										type="monotone"
										dataKey={valueKey}
										stroke="#4f46e5"
										strokeWidth={2.5}
										fillOpacity={1}
										fill={`url(#${gradientId})`}
										activeDot={{ r: 5, stroke: '#4f46e5', strokeWidth: 2, fill: '#ffffff' }}
									/>
								</AreaChart>
							</ResponsiveContainer>
						</div>
					)}

					{type === 'pie' && validPieData.length === 0 && (
						<div className="my-4 flex h-48 w-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center text-xs text-slate-500">
							<AlertCircle className="mb-1.5 h-5 w-5 text-slate-400" />
							<p className="font-medium text-slate-600">Nenhum valor positivo para exibir no gráfico</p>
							<p className="mt-0.5 text-[11px] text-slate-400">Todos os valores deste conjunto de dados são zero ou nulos.</p>
						</div>
					)}

					{type === 'pie' && validPieData.length > 0 && (
						<div className="h-64 w-full pt-2 sm:h-72">
							<ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={220}>
								<PieChart>
									<Pie
										data={validPieData}
										dataKey={valueKey}
										nameKey={nameKey}
										cx="50%"
										cy="44%"
										outerRadius={80}
										innerRadius={46}
										paddingAngle={2}
										label={({ name, percent }: { name?: unknown; percent?: number }) => {
											const pct = (percent ?? 0) * 100;
											return pct >= 5 ? `${truncateLabel(name, 12)} (${pct.toFixed(0)}%)` : '';
										}}
										labelLine={false}
									>
										{validPieData.map((_, index) => (
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
											boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.25)',
										}}
										formatter={(val: unknown) => [
											formatFullValuePtBr(val, valueKey, title),
											formatColumnLabel(valueKey),
										]}
									/>
									<Legend
										verticalAlign="bottom"
										height={40}
										iconType="circle"
										wrapperStyle={{ fontSize: '0.72rem', paddingTop: '8px' }}
										formatter={(val: unknown) => (
											<span className="font-medium text-slate-600">{truncateLabel(val, 18)}</span>
										)}
									/>
								</PieChart>
							</ResponsiveContainer>
						</div>
					)}
				</SafeChartContainer>
			)}
		</div>
	);
});

DynamicDashboard.displayName = 'DynamicDashboard';

export default DynamicDashboard;
