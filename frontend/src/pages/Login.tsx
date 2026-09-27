import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
	AlertCircle,
	ArrowLeft,
	ArrowRight,
	CheckCircle2,
	Clock,
	KeyRound,
	Lock,
	Mail,
	RefreshCw,
	ShieldCheck,
	User as UserIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type LoginTab = 'gerente' | 'admin';

export default function Login() {
	const navigate = useNavigate();
	const location = useLocation();
	const { user, loginAdmin, requestOtp, verifyOtp } = useAuth();

	// Se já estiver logado, redireciona
	useEffect(() => {
		if (user) {
			const from = (location.state as { from?: { pathname?: string } })?.from?.pathname ?? '/';
			navigate(from, { replace: true });
		}
	}, [user, navigate, location]);

	const [activeTab, setActiveTab] = useState<LoginTab>('gerente');

	// Gerente states
	const [gerenteEmail, setGerenteEmail] = useState('');
	const [otpStep, setOtpStep] = useState<'request' | 'verify'>('request');
	const [otpCode, setOtpCode] = useState('');
	const [timeLeft, setTimeLeft] = useState(120); // 2 minutos
	const [apelido, setApelido] = useState('');

	// Admin states
	const [adminLoginInput, setAdminLoginInput] = useState('');
	const [adminPasswordInput, setAdminPasswordInput] = useState('');
	const [showAdminPassword, setShowAdminPassword] = useState(false);

	// General states
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');
	const [successMsg, setSuccessMsg] = useState('');

	// Timer de 2 minutos para o código OTP
	useEffect(() => {
		if (otpStep !== 'verify' || timeLeft <= 0) return;

		const timer = setInterval(() => {
			setTimeLeft((prev) => prev - 1);
		}, 1000);

		return () => clearInterval(timer);
	}, [otpStep, timeLeft]);

	const formatTimer = (seconds: number) => {
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
	};

	const handleRequestOtp = async (e: FormEvent) => {
		e.preventDefault();
		setError('');
		setSuccessMsg('');

		const email = gerenteEmail.trim();
		if (!email) {
			setError('Informe o seu e-mail cadastrado no Sankhya ERP.');
			return;
		}

		setIsLoading(true);
		try {
			const res = await requestOtp(email);
			setApelido(res.apelido ?? '');
			setTimeLeft(res.expiresIn || 120);
			setOtpStep('verify');
			setOtpCode('');
			setSuccessMsg(res.message);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Falha ao solicitar código.');
		} finally {
			setIsLoading(false);
		}
	};

	const handleVerifyOtp = async (e: FormEvent) => {
		e.preventDefault();
		setError('');

		const code = otpCode.trim();
		if (!code || code.length !== 6) {
			setError('Por favor, informe o código de 6 dígitos.');
			return;
		}

		if (timeLeft <= 0) {
			setError('O código expirou. Clique em reenviar para receber um novo código.');
			return;
		}

		setIsLoading(true);
		try {
			await verifyOtp(gerenteEmail.trim(), code);
			const from = (location.state as { from?: { pathname?: string } })?.from?.pathname ?? '/';
			navigate(from, { replace: true });
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Código incorreto ou inválido.');
		} finally {
			setIsLoading(false);
		}
	};

	const handleResendOtp = async () => {
		if (isLoading) return;
		setError('');
		setSuccessMsg('');
		setIsLoading(true);
		try {
			const res = await requestOtp(gerenteEmail.trim());
			setTimeLeft(res.expiresIn || 120);
			setOtpCode('');
			setSuccessMsg('Novo código enviado com sucesso!');
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Falha ao reenviar código.');
		} finally {
			setIsLoading(false);
		}
	};

	const handleAdminLogin = async (e: FormEvent) => {
		e.preventDefault();
		setError('');

		if (!adminLoginInput.trim()) {
			setError('Informe o login de administrador.');
			return;
		}

		if (!adminPasswordInput) {
			setError('Informe a senha.');
			return;
		}

		setIsLoading(true);
		try {
			await loginAdmin(adminLoginInput.trim(), adminPasswordInput);
			const from = (location.state as { from?: { pathname?: string } })?.from?.pathname ?? '/';
			navigate(from, { replace: true });
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Falha no login.');
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
			<div className="w-full max-w-md">
				{/* Cabeçalho */}
				<div className="text-center">
					<div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-2xl font-black text-white shadow-lg shadow-indigo-200">
						G
					</div>
					<h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Gideon ERP</h1>
					<p className="mt-1 text-sm text-slate-500">Assistente Inteligente Integrado com Sankhya</p>
				</div>

				{/* Card Principal */}
				<div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
					{/* Seleção de Perfil / Abas */}
					<div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
						<button
							type="button"
							onClick={() => {
								setActiveTab('gerente');
								setError('');
							}}
							className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-semibold transition ${
								activeTab === 'gerente'
									? 'bg-white text-indigo-600 shadow-sm'
									: 'text-slate-600 hover:text-slate-900'
							}`}
						>
							<Mail className="h-4 w-4" />
							Acesso Gerente
						</button>
						<button
							type="button"
							onClick={() => {
								setActiveTab('admin');
								setError('');
							}}
							className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-semibold transition ${
								activeTab === 'admin'
									? 'bg-white text-indigo-600 shadow-sm'
									: 'text-slate-600 hover:text-slate-900'
							}`}
						>
							<ShieldCheck className="h-4 w-4" />
							Administrador
						</button>
					</div>

					{/* Alertas */}
					{error && (
						<div className="mt-4 flex items-start gap-2.5 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
							<AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
							<span>{error}</span>
						</div>
					)}

					{successMsg && (
						<div className="mt-4 flex items-start gap-2.5 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-700">
							<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
							<span>{successMsg}</span>
						</div>
					)}

					{/* ========================================= */}
					{/* ABA GERENTE (OTP) */}
					{/* ========================================= */}
					{activeTab === 'gerente' && (
						<div className="mt-6">
							{otpStep === 'request' ? (
								<form onSubmit={handleRequestOtp} className="space-y-4">
									<div>
										<label htmlFor="gerente-email" className="block text-xs font-medium text-slate-700">
											E-mail cadastrado no Sankhya ERP
										</label>
										<div className="relative mt-1.5 rounded-lg shadow-sm">
											<div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
												<Mail className="h-4 w-4 text-slate-400" />
											</div>
											<input
												id="gerente-email"
												type="email"
												required
												value={gerenteEmail}
												onChange={(e) => setGerenteEmail(e.target.value)}
												placeholder="seu.email@empresa.com.br"
												className="block w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100"
											/>
										</div>
										<p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
											Faremos uma validação em tempo real com o banco de dados do ERP e enviaremos um código de acesso para seu e-mail.
										</p>
									</div>

									<button
										type="submit"
										disabled={isLoading || !gerenteEmail.trim()}
										className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-300"
									>
										{isLoading ? (
											<RefreshCw className="h-4 w-4 animate-spin" />
										) : (
											<>
												Receber Código de Acesso
												<ArrowRight className="h-4 w-4" />
											</>
										)}
									</button>
								</form>
							) : (
								<form onSubmit={handleVerifyOtp} className="space-y-5">
									<div className="text-center">
										<div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
											<KeyRound className="h-5 w-5" />
										</div>
										<h2 className="mt-2 text-sm font-semibold text-slate-900">
											{apelido ? `Olá, ${apelido}!` : 'Digite o código recebido'}
										</h2>
										<p className="mt-1 text-xs text-slate-500">
											Enviado para <strong className="text-slate-700">{gerenteEmail}</strong>
										</p>
									</div>

									<div>
										<label htmlFor="otp-input" className="block text-center text-xs font-medium text-slate-600">
											Código de 6 dígitos
										</label>
										<input
											id="otp-input"
											type="text"
											inputMode="numeric"
											pattern="[0-9]*"
											maxLength={6}
											autoFocus
											value={otpCode}
											onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
											placeholder="123456"
											className="mt-1.5 block w-full rounded-lg border border-slate-300 py-3 text-center font-mono text-2xl font-bold tracking-[0.5em] text-slate-900 placeholder:tracking-normal placeholder:text-slate-300 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100"
										/>
									</div>

									{/* Timer de 2 minutos */}
									<div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
										<div className="flex items-center gap-1.5 text-slate-600">
											<Clock className="h-3.5 w-3.5 text-slate-400" />
											<span>Tempo restante:</span>
										</div>
										<span className={`font-mono font-bold ${timeLeft < 30 ? 'text-rose-600' : 'text-indigo-600'}`}>
											{formatTimer(timeLeft)}
										</span>
									</div>

									<button
										type="submit"
										disabled={isLoading || otpCode.length !== 6 || timeLeft <= 0}
										className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-300"
									>
										{isLoading ? (
											<RefreshCw className="h-4 w-4 animate-spin" />
										) : (
											<>
												Confirmar e Entrar
												<ArrowRight className="h-4 w-4" />
											</>
										)}
									</button>

									<div className="flex items-center justify-between pt-1 text-xs">
										<button
											type="button"
											onClick={() => {
												setOtpStep('request');
												setError('');
												setSuccessMsg('');
											}}
											className="flex items-center gap-1 text-slate-500 hover:text-slate-700"
										>
											<ArrowLeft className="h-3.5 w-3.5" />
											Trocar e-mail
										</button>

										<button
											type="button"
											onClick={handleResendOtp}
											disabled={isLoading}
											className="font-medium text-indigo-600 hover:text-indigo-700 disabled:text-slate-400"
										>
											Reenviar código
										</button>
									</div>
								</form>
							)}
						</div>
					)}

					{/* ========================================= */}
					{/* ABA ADMINISTRADOR (USUÁRIO + SENHA) */}
					{/* ========================================= */}
					{activeTab === 'admin' && (
						<form onSubmit={handleAdminLogin} className="mt-6 space-y-4">
							<div>
								<label htmlFor="admin-login" className="block text-xs font-medium text-slate-700">
									Usuário ou E-mail
								</label>
								<div className="relative mt-1.5 rounded-lg shadow-sm">
									<div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
										<UserIcon className="h-4 w-4 text-slate-400" />
									</div>
									<input
										id="admin-login"
										type="text"
										required
										value={adminLoginInput}
										onChange={(e) => setAdminLoginInput(e.target.value)}
										placeholder="admin"
										className="block w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100"
									/>
								</div>
							</div>

							<div>
								<label htmlFor="admin-pass" className="block text-xs font-medium text-slate-700">
									Senha
								</label>
								<div className="relative mt-1.5 rounded-lg shadow-sm">
									<div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
										<Lock className="h-4 w-4 text-slate-400" />
									</div>
									<input
										id="admin-pass"
										type={showAdminPassword ? 'text' : 'password'}
										required
										value={adminPasswordInput}
										onChange={(e) => setAdminPasswordInput(e.target.value)}
										placeholder="••••••••"
										className="block w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-12 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100"
									/>
									<button
										type="button"
										onClick={() => setShowAdminPassword(!showAdminPassword)}
										className="absolute inset-y-0 right-0 flex items-center pr-3 text-xs text-slate-400 hover:text-slate-600"
									>
										{showAdminPassword ? 'Ocultar' : 'Ver'}
									</button>
								</div>
							</div>

							<button
								type="submit"
								disabled={isLoading || !adminLoginInput.trim() || !adminPasswordInput}
								className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-300"
							>
								{isLoading ? (
									<RefreshCw className="h-4 w-4 animate-spin" />
								) : (
									<>
										Entrar como Administrador
										<ArrowRight className="h-4 w-4" />
									</>
								)}
							</button>
						</form>
					)}
				</div>

				{/* Rodapé informativo */}
				<p className="mt-8 text-center text-xs text-slate-400">
					Acesso restrito a colaboradores autorizados da empresa.
				</p>
			</div>
		</div>
	);
}

