import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, Lock, LogIn, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
	const navigate = useNavigate();
	const location = useLocation();
	const { user, login } = useAuth();

	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [showPassword, setShowPassword] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');

	// Redireciona se o usuário já estiver autenticado
	useEffect(() => {
		if (user) {
			if (user.role === 'GERENTE') {
				navigate('/', { replace: true });
			} else {
				const from = (location.state as { from?: { pathname?: string } })?.from?.pathname ?? '/';
				navigate(from, { replace: true });
			}
		}
	}, [user, navigate, location]);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError('');

		const cleanEmail = email.trim();
		const cleanPassword = password;

		if (!cleanEmail || !cleanPassword) {
			setError('Informe seu e-mail e sua senha de acesso.');
			return;
		}

		setIsLoading(true);
		try {
			await login(cleanEmail, cleanPassword);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Falha na autenticação.');
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="flex min-h-screen flex-col justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 px-4 py-12 sm:px-6 lg:px-8">
			<div className="sm:mx-auto sm:w-full sm:max-w-md">
				{/* Logotipo e Apresentação */}
				<div className="flex justify-center">
					<div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-2xl font-black text-white shadow-xl shadow-indigo-600/30">
						G
					</div>
				</div>
				<h1 className="mt-6 text-center text-3xl font-extrabold tracking-tight text-white">
					Gideon
				</h1>
				<p className="mt-2 text-center text-sm text-slate-400">
					Assistente Inteligente integrado ao ERP
				</p>
			</div>

			<div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
				<div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl shadow-2xl sm:p-8">
					<h2 className="mb-6 text-lg font-semibold text-white">
						Acesse sua conta
					</h2>

					{error && (
						<div className="mb-5 flex items-start gap-2.5 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-xs leading-relaxed text-rose-300">
							<AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
							<span>{error}</span>
						</div>
					)}

					<form onSubmit={handleSubmit} className="space-y-5">
						{/* Campo de E-mail */}
						<div>
							<label htmlFor="email" className="block text-xs font-medium uppercase tracking-wider text-slate-300">
								E-mail
							</label>
							<div className="relative mt-2">
								<div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
									<Mail className="h-4 w-4 text-slate-400" />
								</div>
								<input
									id="email"
									type="email"
									autoComplete="email"
									required
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									placeholder="seu.email@empresa.com.br"
									className="block w-full rounded-xl border border-slate-700 bg-slate-800/80 py-2.5 pl-10 pr-3 text-sm text-white placeholder-slate-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
								/>
							</div>
						</div>

						{/* Campo de Senha */}
						<div>
							<label htmlFor="password" className="block text-xs font-medium uppercase tracking-wider text-slate-300">
								Senha
							</label>
							<div className="relative mt-2">
								<div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
									<Lock className="h-4 w-4 text-slate-400" />
								</div>
								<input
									id="password"
									type={showPassword ? 'text' : 'password'}
									autoComplete="current-password"
									required
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder="••••••••"
									className="block w-full rounded-xl border border-slate-700 bg-slate-800/80 py-2.5 pl-10 pr-10 text-sm text-white placeholder-slate-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
								/>
								<button
									type="button"
									onClick={() => setShowPassword(!showPassword)}
									className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 hover:text-slate-200"
									title={showPassword ? 'Ocultar senha' : 'Exibir senha'}
								>
									{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
								</button>
							</div>
						</div>

						{/* Botão de Entrar */}
						<button
							type="submit"
							disabled={isLoading}
							className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{isLoading ? (
								<div className="flex items-center gap-2">
									<div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
									<span>Autenticando...</span>
								</div>
							) : (
								<>
									<LogIn className="h-4 w-4" />
									<span>Entrar no Gideon</span>
								</>
							)}
						</button>
					</form>
				</div>

				<p className="mt-6 text-center text-xs text-slate-500">
					Gideon Enterprise AI &copy; 2026. Acesso restrito a usuários autorizados.
				</p>
			</div>
		</div>
	);
}
