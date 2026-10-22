import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
	children: ReactNode;
	fallbackTitle?: string;
	fallbackMessage?: string;
	onReset?: () => void;
	compact?: boolean;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = {
			hasError: false,
			error: null,
		};
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return {
			hasError: true,
			error,
		};
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		console.error('[ErrorBoundary] Erro de renderização capturado com sucesso:', error, errorInfo);
	}

	handleReset = (): void => {
		this.setState({ hasError: false, error: null });
		if (this.props.onReset) {
			this.props.onReset();
		}
	};

	render(): ReactNode {
		if (this.state.hasError) {
			if (this.props.compact) {
				return (
					<div className="my-2 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/90 p-3 text-xs text-amber-900 shadow-sm">
						<div className="flex items-center gap-2">
							<AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
							<span>{this.props.fallbackMessage || 'Ocorreu uma falha ao exibir este elemento visual.'}</span>
						</div>
						<button
							type="button"
							onClick={this.handleReset}
							className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white px-2 py-1 font-medium text-amber-800 shadow-sm transition hover:bg-amber-100/60"
						>
							<RefreshCw className="h-3 w-3" />
							<span>Tentar de novo</span>
						</button>
					</div>
				);
			}

			return (
				<div className="flex min-h-[16rem] w-full flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
					<div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
						<AlertTriangle className="h-6 w-6" />
					</div>
					<h3 className="text-sm font-semibold text-slate-900">
						{this.props.fallbackTitle || 'Não foi possível carregar este conteúdo'}
					</h3>
					<p className="mt-1 max-w-md text-xs text-slate-500">
						{this.props.fallbackMessage ||
							'Ocorreu uma falha inesperada durante a exibição visual. Suas mensagens e dados continuam seguros.'}
					</p>
					{this.state.error && (
						<pre className="mt-3 max-h-24 max-w-full overflow-x-auto rounded-lg bg-slate-50 p-2 font-mono text-[10px] text-slate-600">
							{this.state.error.message}
						</pre>
					)}
					<button
						type="button"
						onClick={this.handleReset}
						className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95"
					>
						<RefreshCw className="h-3.5 w-3.5" />
						<span>Recarregar visualização</span>
					</button>
				</div>
			);
		}

		return this.props.children;
	}
}

export default ErrorBoundary;
