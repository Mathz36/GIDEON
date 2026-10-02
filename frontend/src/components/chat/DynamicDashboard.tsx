import React from 'react';
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
import { BarChart3, Table as TableIcon, TrendingUp, PieChart as PieIcon } from 'lucide-react';

export interface DashboardData {
	type: 'bar' | 'line' | 'pie' | 'table';
	title?: string;
	data: Array<Record<string, any>>;
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

export const DynamicDashboard: React.FC<DynamicDashboardProps> = ({ configString }) => {
	let parsedConfig: DashboardData | null = null;

	try {
		const cleaned = configString.trim();
		if (!cleaned) return null;
		parsedConfig = JSON.parse(cleaned);
	} catch {
		// Enquanto os dados chegam via streaming SSE, o JSON estará incompleto.
		// Retornamos um skeleton de loading sutil sem quebrar a UI nem poluir o console.
		return (
			<div className="my-4 flex h-64 w-full animate-pulse flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400">
				<div className="flex items-center gap-2 text-xs font-medium text-slate-500">
					<div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
					<span>Gerando visualização gráfica...</span>
				</div>
			</div>
		);
	}

	if (!parsedConfig || !Array.isArray(parsedConfig.data) || parsedConfig.data.length === 0) {
		return null;
	}

	const { type, title, data } = parsedConfig;

	// Detecta a chave numérica usada como valor para os eixos do gráfico (ex: "value", "total", etc.)
	const sample = data[0] || {};
	const valueKey =
		Object.keys(sample).find((k) => k.toLowerCase() === 'value' || k.toLowerCase() === 'total') ||
		Object.keys(sample).find((k) => typeof sample[k] === 'number') ||
		'value';

	const nameKey =
		Object.keys(sample).find((k) => k.toLowerCase() === 'name' || k.toLowerCase() === 'label' || k.toLowerCase() === 'categoria') ||
		'name';

	return (
		<div className="my-4 w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
			{title && (
				<div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-2.5">
					{type === 'bar' && <BarChart3 className="h-4 w-4 text-indigo-600" />}
					{type === 'line' && <TrendingUp className="h-4 w-4 text-emerald-600" />}
					{type === 'pie' && <PieIcon className="h-4 w-4 text-amber-600" />}
					{type === 'table' && <TableIcon className="h-4 w-4 text-sky-600" />}
					<h3 className="text-sm font-semibold text-slate-800">{title}</h3>
				</div>
			)}

			{type === 'table' && (
				<div className="max-h-96 overflow-x-auto overflow-y-auto rounded-lg border border-slate-200">
					<table className="min-w-full divide-y divide-slate-200 text-left text-xs text-slate-700">
						<thead className="sticky top-0 bg-slate-100 font-semibold text-slate-800">
							<tr>
								{Object.keys(sample).map((key) => (
									<th key={key} className="px-3 py-2.5 uppercase tracking-wider">
										{key.replace(/_/g, ' ')}
									</th>
								))}
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100 bg-white">
							{data.map((row, index) => (
								<tr key={index} className="transition hover:bg-indigo-50/40">
									{Object.keys(sample).map((key) => {
										const val = row[key];
										const isNum = typeof val === 'number';
										return (
											<td key={key} className={`px-3 py-2 whitespace-nowrap ${isNum ? 'font-mono text-slate-900' : ''}`}>
												{val !== null && val !== undefined ? String(val) : '-'}
											</td>
										);
									})}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{type === 'bar' && (
				<div className="h-72 w-full pt-2">
					<ResponsiveContainer width="100%" height="100%">
						<BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 20 }}>
							<CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
							<XAxis
								dataKey={nameKey}
								stroke="#64748b"
								fontSize={11}
								tickLine={false}
								axisLine={{ stroke: '#cbd5e1' }}
								angle={data.length > 5 ? -25 : 0}
								textAnchor={data.length > 5 ? 'end' : 'middle'}
							/>
							<YAxis
								stroke="#64748b"
								fontSize={11}
								tickLine={false}
								axisLine={false}
								tickFormatter={(val) => (typeof val === 'number' ? val.toLocaleString('pt-BR') : val)}
							/>
							<Tooltip
								contentStyle={{
									backgroundColor: '#1e293b',
									borderRadius: '0.5rem',
									border: 'none',
									color: '#fff',
									fontSize: '0.75rem',
									boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
								}}
								formatter={(val: any) => [typeof val === 'number' ? val.toLocaleString('pt-BR') : val, 'Total']}
							/>
							<Bar dataKey={valueKey} fill="#4f46e5" radius={[6, 6, 0, 0]} />
						</BarChart>
					</ResponsiveContainer>
				</div>
			)}

			{type === 'line' && (
				<div className="h-72 w-full pt-2">
					<ResponsiveContainer width="100%" height="100%">
						<LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 20 }}>
							<CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
							<XAxis
								dataKey={nameKey}
								stroke="#64748b"
								fontSize={11}
								tickLine={false}
								axisLine={{ stroke: '#cbd5e1' }}
							/>
							<YAxis
								stroke="#64748b"
								fontSize={11}
								tickLine={false}
								axisLine={false}
								tickFormatter={(val) => (typeof val === 'number' ? val.toLocaleString('pt-BR') : val)}
							/>
							<Tooltip
								contentStyle={{
									backgroundColor: '#1e293b',
									borderRadius: '0.5rem',
									border: 'none',
									color: '#fff',
									fontSize: '0.75rem',
								}}
								formatter={(val: any) => [typeof val === 'number' ? val.toLocaleString('pt-BR') : val, 'Valor']}
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
				<div className="h-72 w-full pt-2">
					<ResponsiveContainer width="100%" height="100%">
						<PieChart>
							<Pie
								data={data}
								dataKey={valueKey}
								nameKey={nameKey}
								cx="50%"
								cy="50%"
								outerRadius={85}
								innerRadius={40}
								paddingAngle={3}
								label={({ name, percent }: any) =>
									`${name || ''} (${(((percent as number) || 0) * 100).toFixed(0)}%)`
								}
								labelLine={false}
							>
								{data.map((_, index) => (
									<Cell key={`cell-${index}`} fill={PALETTE[index % PALETTE.length]} />
								))}
							</Pie>
							<Tooltip
								contentStyle={{
									backgroundColor: '#1e293b',
									borderRadius: '0.5rem',
									border: 'none',
									color: '#fff',
									fontSize: '0.75rem',
								}}
								formatter={(val: any) => [typeof val === 'number' ? val.toLocaleString('pt-BR') : val, 'Valor']}
							/>
							<Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '0.75rem' }} />
						</PieChart>
					</ResponsiveContainer>
				</div>
			)}
		</div>
	);
};

export default DynamicDashboard;
