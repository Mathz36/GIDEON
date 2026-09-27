import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
	AlertCircle,
	Check,
	CheckCircle2,
	Eye,
	EyeOff,
	MoreVertical,
	Pencil,
	Plus,
	RefreshCw,
	Search,
	Shield,
	Trash2,
	User as UserIcon,
	Users,
	X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { UserRole, UsuarioItem } from '../types/auth';

// Regex obrigatório para a política de senha
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;

interface PasswordValidationState {
	minLength: boolean;
	hasUpper: boolean;
	hasLower: boolean;
	hasNumber: boolean;
	hasSpecial: boolean;
	matchesConfirm: boolean;
	isValid: boolean;
}

export default function AdminUsers() {
	const { token, user: currentUser } = useAuth();

	const [users, setUsers] = useState<UsuarioItem[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [searchTerm, setSearchTerm] = useState('');
	const [error, setError] = useState('');
	const [successMsg, setSuccessMsg] = useState('');

	// Modais
	const [isFormModalOpen, setIsFormModalOpen] = useState(false);
	const [isViewModalOpen, setIsViewModalOpen] = useState(false);
	const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

	// Estado do formulário (Criação / Edição)
	const [editingUser, setEditingUser] = useState<UsuarioItem | null>(null);
	const [viewingUser, setViewingUser] = useState<UsuarioItem | null>(null);
	const [userToDelete, setUserToDelete] = useState<UsuarioItem | null>(null);

	const [nome, setNome] = useState('');
	const [email, setEmail] = useState('');
	const [usuarioErp, setUsuarioErp] = useState('');
	const [codGerenteErp, setCodGerenteErp] = useState('');
	const [tipoAcesso, setTipoAcesso] = useState<UserRole>('GERENTE');
	const [senha, setSenha] = useState('');
	const [confirmacaoSenha, setConfirmacaoSenha] = useState('');
	const [showPassword, setShowPassword] = useState(false);
	const [showConfirmPassword, setShowConfirmPassword] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);

	// Menu dropdown aberto por linha
	const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

	// Carrega lista de usuários
	const loadUsers = async () => {
		setIsLoading(true);
		setError('');
		try {
			const res = await fetch('/api/users', {
				headers: {
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
			});

			if (!res.ok) {
				const errData = await res.json() as { error?: string };
				throw new Error(errData.error ?? 'Falha ao carregar usuários.');
			}

			const json = await res.json() as { data: UsuarioItem[] };
			setUsers(json.data ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao carregar lista de usuários.');
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		void loadUsers();
	}, [token]);

	// Validação em tempo real dos requisitos de senha
	const validatePasswordRules = (pwd: string, confirm: string, isEditing: boolean): PasswordValidationState => {
		const minLength = pwd.length >= 8;
		const hasUpper = /[A-Z]/.test(pwd);
		const hasLower = /[a-z]/.test(pwd);
		const hasNumber = /\d/.test(pwd);
		const hasSpecial = /[\W_]/.test(pwd);
		const matchesConfirm = pwd.length > 0 && pwd === confirm;

		const isPasswordValid = isEditing && !pwd.trim()
			? true
			: (minLength && hasUpper && hasLower && hasNumber && hasSpecial && matchesConfirm);

		return {
			minLength,
			hasUpper,
			hasLower,
			hasNumber,
			hasSpecial,
			matchesConfirm,
			isValid: isPasswordValid,
		};
	};

	const pwdValidation = validatePasswordRules(senha, confirmacaoSenha, Boolean(editingUser));

	const openCreateModal = () => {
		setEditingUser(null);
		setNome('');
		setEmail('');
		setUsuarioErp('');
		setCodGerenteErp('');
		setTipoAcesso('GERENTE');
		setSenha('');
		setConfirmacaoSenha('');
		setShowPassword(false);
		setShowConfirmPassword(false);
		setError('');
		setIsFormModalOpen(true);
	};

	const openEditModal = (target: UsuarioItem) => {
		setOpenActionMenuId(null);
		setEditingUser(target);
		setNome(target.nome);
		setEmail(target.email);
		setUsuarioErp(target.usuario_erp);
		setCodGerenteErp(target.cod_gerente_erp);
		setTipoAcesso(target.tipo_acesso);
		setSenha('');
		setConfirmacaoSenha('');
		setShowPassword(false);
		setShowConfirmPassword(false);
		setError('');
		setIsFormModalOpen(true);
	};

	const openViewModal = (target: UsuarioItem) => {
		setOpenActionMenuId(null);
		setViewingUser(target);
		setIsViewModalOpen(true);
	};

	const openDeleteModal = (target: UsuarioItem) => {
		setOpenActionMenuId(null);
		if (target.id === currentUser?.id) {
			setError('Você não pode excluir sua própria conta de administrador.');
			return;
		}
		setUserToDelete(target);
		setIsDeleteModalOpen(true);
	};

	const handleFormSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError('');
		setSuccessMsg('');

		const cleanNome = nome.trim();
		const cleanEmail = email.trim().toLowerCase();
		const cleanUsuarioErp = usuarioErp.trim();
		const cleanCodGerenteErp = codGerenteErp.trim();

		if (!cleanNome || !cleanEmail || !cleanUsuarioErp || !cleanCodGerenteErp) {
			setError('Por favor, preencha todos os campos obrigatórios.');
			return;
		}

		// Se for criação, a senha é estritamente obrigatória
		if (!editingUser) {
			if (!senha) {
				setError('A senha é obrigatória para o cadastro de novos usuários.');
				return;
			}

			if (!PASSWORD_REGEX.test(senha)) {
				setError('A senha deve ter no mínimo 8 caracteres, contendo pelo menos 1 letra maiúscula, 1 letra minúscula, 1 número e 1 caractere especial.');
				return;
			}

			if (senha !== confirmacaoSenha) {
				setError('A confirmação de senha não confere com a senha digitada.');
				return;
			}
		} else {
			// Se for edição e o usuário digitou senha
			if (senha.trim()) {
				if (!PASSWORD_REGEX.test(senha)) {
					setError('A nova senha deve ter no mínimo 8 caracteres, contendo pelo menos 1 letra maiúscula, 1 letra minúscula, 1 número e 1 caractere especial.');
					return;
				}

				if (senha !== confirmacaoSenha) {
					setError('A confirmação de senha não confere com a nova senha digitada.');
					return;
				}
			}
		}

		setIsSubmitting(true);
		try {
			const payload: Record<string, unknown> = {
				nome: cleanNome,
				email: cleanEmail,
				usuario_erp: cleanUsuarioErp,
				cod_gerente_erp: cleanCodGerenteErp,
				tipo_acesso: tipoAcesso,
			};

			if (senha.trim()) {
				payload.senha = senha;
				payload.confirmacao_senha = confirmacaoSenha;
			}

			const url = editingUser ? `/api/users/${editingUser.id}` : '/api/users';
			const method = editingUser ? 'PUT' : 'POST';

			const res = await fetch(url, {
				method,
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify(payload),
			});

			const json = await res.json() as { message?: string; error?: string };

			if (!res.ok) {
				throw new Error(json.error ?? 'Falha ao salvar usuário.');
			}

			setSuccessMsg(editingUser ? 'Usuário atualizado com sucesso!' : 'Usuário cadastrado com sucesso!');
			setIsFormModalOpen(false);
			await loadUsers();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao processar formulário.');
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleDeleteUser = async () => {
		if (!userToDelete) return;
		setError('');
		setSuccessMsg('');
		setIsSubmitting(true);

		try {
			const res = await fetch(`/api/users/${userToDelete.id}`, {
				method: 'DELETE',
				headers: {
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
			});

			const json = await res.json() as { message?: string; error?: string };

			if (!res.ok) {
				throw new Error(json.error ?? 'Falha ao excluir usuário.');
			}

			setSuccessMsg('Usuário excluído com sucesso.');
			setIsDeleteModalOpen(false);
			setUserToDelete(null);
			await loadUsers();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao excluir usuário.');
		} finally {
			setIsSubmitting(false);
		}
	};

	// Filtragem
	const filteredUsers = users.filter((u) => {
		const term = searchTerm.toLowerCase();
		return (
			u.nome.toLowerCase().includes(term) ||
			u.email.toLowerCase().includes(term) ||
			u.usuario_erp.toLowerCase().includes(term) ||
			u.cod_gerente_erp.toLowerCase().includes(term) ||
			u.tipo_acesso.toLowerCase().includes(term)
		);
	});

	return (
		<div className="min-h-full bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
			<div className="mx-auto max-w-7xl">
				{/* Cabeçalho da Página */}
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<div className="flex items-center gap-2.5">
							<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
								<Users className="h-5 w-5" />
							</div>
							<div>
								<h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Gestão de Usuários</h1>
								<p className="text-xs text-slate-500 sm:text-sm">
									Cadastre e gerencie os acessos de Gerentes e Administradores ao sistema Gideon.
								</p>
							</div>
						</div>
					</div>

					<button
						type="button"
						onClick={openCreateModal}
						className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-100"
					>
						<Plus className="h-4 w-4" />
						Criar Novo Usuário
					</button>
				</div>

				{/* Alertas */}
				{error && (
					<div className="mt-6 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
						<AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
						<div className="flex-1">{error}</div>
						<button type="button" onClick={() => setError('')} className="text-rose-400 hover:text-rose-600">
							<X className="h-4 w-4" />
						</button>
					</div>
				)}

				{successMsg && (
					<div className="mt-6 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-700">
						<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
						<div className="flex-1">{successMsg}</div>
						<button type="button" onClick={() => setSuccessMsg('')} className="text-emerald-400 hover:text-emerald-600">
							<X className="h-4 w-4" />
						</button>
					</div>
				)}

				{/* Barra de Busca e Filtro */}
				<div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="relative flex-1 max-w-md">
						<Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
						<input
							type="text"
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							placeholder="Buscar por nome, e-mail, usuário ou cód. ERP..."
							className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm text-slate-800 placeholder-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
						/>
					</div>

					<div className="text-xs text-slate-500">
						Total: <strong className="text-slate-800">{filteredUsers.length}</strong> usuário(s) encontrado(s)
					</div>
				</div>

				{/* Tabela de Listagem */}
				<div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
					{isLoading ? (
						<div className="flex flex-col items-center justify-center py-20">
							<RefreshCw className="h-8 w-8 animate-spin text-indigo-600" />
							<p className="mt-3 text-sm font-medium text-slate-500">Carregando lista de usuários...</p>
						</div>
					) : filteredUsers.length === 0 ? (
						<div className="py-16 text-center">
							<Users className="mx-auto h-12 w-12 text-slate-300" />
							<h3 className="mt-3 text-base font-semibold text-slate-800">Nenhum usuário encontrado</h3>
							<p className="mt-1 text-sm text-slate-500">
								{searchTerm ? 'Tente ajustar os termos da sua pesquisa.' : 'Cadastre seu primeiro usuário utilizando o botão acima.'}
							</p>
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="min-w-full divide-y divide-slate-200 text-left text-sm">
								<thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
									<tr>
										<th scope="col" className="px-6 py-4">Nome</th>
										<th scope="col" className="px-6 py-4">E-mail</th>
										<th scope="col" className="px-6 py-4">Tipo de Acesso</th>
										<th scope="col" className="px-6 py-4">Cód. Gerente ERP</th>
										<th scope="col" className="px-6 py-4">Usuário ERP</th>
										<th scope="col" className="px-6 py-4 text-right">Ações</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100 text-slate-700">
									{filteredUsers.map((item) => (
										<tr key={item.id} className="transition hover:bg-slate-50/80">
											{/* Nome com avatar */}
											<td className="whitespace-nowrap px-6 py-4">
												<div className="flex items-center gap-3">
													<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-xs font-bold text-indigo-700">
														{item.nome.charAt(0).toUpperCase()}
													</div>
													<div>
														<div className="font-semibold text-slate-900">{item.nome}</div>
														{item.id === currentUser?.id && (
															<span className="text-[10px] text-indigo-600 font-medium">(Sua conta)</span>
														)}
													</div>
												</div>
											</td>

											{/* E-mail */}
											<td className="whitespace-nowrap px-6 py-4 text-slate-600 font-mono text-xs">
												{item.email}
											</td>

											{/* Tipo de Acesso */}
											<td className="whitespace-nowrap px-6 py-4">
												{item.tipo_acesso === 'ADMIN' ? (
													<span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 border border-indigo-200">
														<Shield className="h-3 w-3" />
														ADMIN
													</span>
												) : (
													<span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
														<UserIcon className="h-3 w-3" />
														GERENTE
													</span>
												)}
											</td>

											{/* Cód Gerente ERP */}
											<td className="whitespace-nowrap px-6 py-4 text-slate-600 font-medium">
												{item.cod_gerente_erp || '-'}
											</td>

											{/* Usuário ERP */}
											<td className="whitespace-nowrap px-6 py-4 text-slate-600">
												<span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-800">
													{item.usuario_erp || '-'}
												</span>
											</td>

											{/* Ações (Menu com as 3 opções obrigatórias) */}
											<td className="whitespace-nowrap px-6 py-4 text-right">
												<div className="relative inline-block text-left">
													<div className="flex items-center justify-end gap-1">
														<button
															type="button"
															onClick={() => openViewModal(item)}
															title="Visualizar Dados"
															className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
														>
															<Eye className="h-4 w-4" />
														</button>
														<button
															type="button"
															onClick={() => openEditModal(item)}
															title="Editar Usuário"
															className="rounded-lg p-1.5 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
														>
															<Pencil className="h-4 w-4" />
														</button>
														<button
															type="button"
															onClick={() => openDeleteModal(item)}
															disabled={item.id === currentUser?.id}
															title={item.id === currentUser?.id ? 'Você não pode excluir sua própria conta' : 'Excluir Usuário'}
															className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30"
														>
															<Trash2 className="h-4 w-4" />
														</button>
													</div>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			</div>

			{/* ======================================================== */}
			{/* MODAL DE CRIAÇÃO / EDIÇÃO DE USUÁRIO                     */}
			{/* ======================================================== */}
			{isFormModalOpen && (
				<div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
					<div className="relative w-full max-w-xl rounded-2xl bg-white shadow-2xl">
						{/* Header do Modal */}
						<div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div className="flex items-center gap-2.5">
								<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
									{editingUser ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
								</div>
								<div>
									<h2 className="text-base font-bold text-slate-900">
										{editingUser ? 'Editar Usuário' : 'Criar Novo Usuário'}
									</h2>
									<p className="text-xs text-slate-500">
										{editingUser ? `Atualizando dados de ${editingUser.nome}` : 'Cadastre um novo gerente ou administrador'}
									</p>
								</div>
							</div>
							<button
								type="button"
								onClick={() => setIsFormModalOpen(false)}
								className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
							>
								<X className="h-5 w-5" />
							</button>
						</div>

						{/* Formulário */}
						<form onSubmit={handleFormSubmit} className="p-6 space-y-4">
							<div className="grid gap-4 sm:grid-cols-2">
								{/* Nome */}
								<div className="sm:col-span-2">
									<label className="block text-xs font-semibold text-slate-700">
										Nome Completo <span className="text-rose-500">*</span>
									</label>
									<input
										type="text"
										required
										value={nome}
										onChange={(e) => setNome(e.target.value)}
										placeholder="Ex: Matheus Silva"
										className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
									/>
								</div>

								{/* E-mail */}
								<div className="sm:col-span-2">
									<label className="block text-xs font-semibold text-slate-700">
										E-mail <span className="text-rose-500">*</span>
									</label>
									<input
										type="email"
										required
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										placeholder="usuario@empresa.com.br"
										className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
									/>
								</div>

								{/* Usuário ERP */}
								<div>
									<label className="block text-xs font-semibold text-slate-700">
										Usuário ERP <span className="text-rose-500">*</span>
									</label>
									<input
										type="text"
										required
										value={usuarioErp}
										onChange={(e) => setUsuarioErp(e.target.value)}
										placeholder="Ex: MSILVA"
										className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
									/>
								</div>

								{/* Cód Gerente ERP (referente à TGFVEN) */}
								<div>
									<label className="block text-xs font-semibold text-slate-700">
										Cód. Gerente ERP (TGFVEN) <span className="text-rose-500">*</span>
									</label>
									<input
										type="text"
										required
										value={codGerenteErp}
										onChange={(e) => setCodGerenteErp(e.target.value)}
										placeholder="Ex: 105"
										className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
									/>
								</div>

								{/* Tipo de Acesso */}
								<div className="sm:col-span-2">
									<label className="block text-xs font-semibold text-slate-700">
										Tipo de Acesso <span className="text-rose-500">*</span>
									</label>
									<select
										value={tipoAcesso}
										onChange={(e) => setTipoAcesso(e.target.value as UserRole)}
										className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
									>
										<option value="GERENTE">GERENTE (Acesso exclusivo ao Chat com dados do ERP)</option>
										<option value="ADMIN">ADMIN (Acesso total: Chat, Integrações ERP, IA e Gestão de Usuários)</option>
									</select>
								</div>

								{/* Senha */}
								<div>
									<label className="block text-xs font-semibold text-slate-700">
										{editingUser ? 'Nova Senha (opcional)' : 'Senha'} {!editingUser && <span className="text-rose-500">*</span>}
									</label>
									<div className="relative mt-1.5">
										<input
											type={showPassword ? 'text' : 'password'}
											required={!editingUser}
											value={senha}
											onChange={(e) => setSenha(e.target.value)}
											placeholder={editingUser ? 'Deixe em branco para manter' : '••••••••'}
											className="w-full rounded-xl border border-slate-300 py-2 pl-3.5 pr-10 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
										/>
										<button
											type="button"
											onClick={() => setShowPassword(!showPassword)}
											className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
										>
											{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
										</button>
									</div>
								</div>

								{/* Confirmação de Senha */}
								<div>
									<label className="block text-xs font-semibold text-slate-700">
										{editingUser ? 'Confirmar Nova Senha' : 'Confirmação de Senha'} {!editingUser && <span className="text-rose-500">*</span>}
									</label>
									<div className="relative mt-1.5">
										<input
											type={showConfirmPassword ? 'text' : 'password'}
											required={!editingUser || Boolean(senha)}
											value={confirmacaoSenha}
											onChange={(e) => setConfirmacaoSenha(e.target.value)}
											placeholder={editingUser ? 'Repita a nova senha' : '••••••••'}
											className="w-full rounded-xl border border-slate-300 py-2 pl-3.5 pr-10 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
										/>
										<button
											type="button"
											onClick={() => setShowConfirmPassword(!showConfirmPassword)}
											className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
										>
											{showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
										</button>
									</div>
								</div>
							</div>

							{/* Checklist visual da Política de Senha */}
							{(Boolean(senha) || !editingUser) && (
								<div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
									<div className="font-semibold text-slate-700 mb-2">Requisitos de Segurança da Senha:</div>
									<div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-slate-600">
										<div className={`flex items-center gap-1.5 ${pwdValidation.minLength ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
											<Check className={`h-3.5 w-3.5 ${pwdValidation.minLength ? 'text-emerald-600' : 'text-slate-300'}`} />
											<span>Mínimo de 8 caracteres</span>
										</div>
										<div className={`flex items-center gap-1.5 ${pwdValidation.hasUpper ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
											<Check className={`h-3.5 w-3.5 ${pwdValidation.hasUpper ? 'text-emerald-600' : 'text-slate-300'}`} />
											<span>1 letra maiúscula (A-Z)</span>
										</div>
										<div className={`flex items-center gap-1.5 ${pwdValidation.hasLower ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
											<Check className={`h-3.5 w-3.5 ${pwdValidation.hasLower ? 'text-emerald-600' : 'text-slate-300'}`} />
											<span>1 letra minúscula (a-z)</span>
										</div>
										<div className={`flex items-center gap-1.5 ${pwdValidation.hasNumber ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
											<Check className={`h-3.5 w-3.5 ${pwdValidation.hasNumber ? 'text-emerald-600' : 'text-slate-300'}`} />
											<span>1 número (0-9)</span>
										</div>
										<div className={`flex items-center gap-1.5 ${pwdValidation.hasSpecial ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
											<Check className={`h-3.5 w-3.5 ${pwdValidation.hasSpecial ? 'text-emerald-600' : 'text-slate-300'}`} />
											<span>1 caractere especial (!@#$...)</span>
										</div>
										<div className={`flex items-center gap-1.5 ${pwdValidation.matchesConfirm ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
											<Check className={`h-3.5 w-3.5 ${pwdValidation.matchesConfirm ? 'text-emerald-600' : 'text-slate-300'}`} />
											<span>Senhas conferem</span>
										</div>
									</div>
								</div>
							)}

							{/* Rodapé do Modal */}
							<div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
								<button
									type="button"
									onClick={() => setIsFormModalOpen(false)}
									className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
								>
									Cancelar
								</button>
								<button
									type="submit"
									disabled={isSubmitting || !pwdValidation.isValid}
									className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-300"
								>
									{isSubmitting ? (
										<RefreshCw className="h-4 w-4 animate-spin" />
									) : editingUser ? (
										'Salvar Alterações'
									) : (
										'Cadastrar Usuário'
									)}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{/* ======================================================== */}
			{/* MODAL DE VISUALIZAÇÃO DE DADOS                           */}
			{/* ======================================================== */}
			{isViewModalOpen && viewingUser && (
				<div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
					<div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl">
						<div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div className="flex items-center gap-2.5">
								<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
									<Eye className="h-4 w-4" />
								</div>
								<div>
									<h2 className="text-base font-bold text-slate-900">Dados do Usuário</h2>
									<p className="text-xs text-slate-500">Detalhes do cadastro no Gideon</p>
								</div>
							</div>
							<button
								type="button"
								onClick={() => setIsViewModalOpen(false)}
								className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
							>
								<X className="h-5 w-5" />
							</button>
						</div>

						<div className="p-6 space-y-4">
							<div className="flex items-center gap-3 rounded-xl bg-slate-50 p-4">
								<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white shadow-sm">
									{viewingUser.nome.charAt(0).toUpperCase()}
								</div>
								<div>
									<div className="text-base font-bold text-slate-900">{viewingUser.nome}</div>
									<div className="text-xs text-slate-500">{viewingUser.email}</div>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-4 text-xs">
								<div className="rounded-xl border border-slate-200 p-3">
									<div className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Tipo de Acesso</div>
									<div className="mt-1 font-bold text-slate-900">
										{viewingUser.tipo_acesso === 'ADMIN' ? (
											<span className="text-indigo-600">ADMINISTRADOR</span>
										) : (
											<span className="text-emerald-600">GERENTE</span>
										)}
									</div>
								</div>

								<div className="rounded-xl border border-slate-200 p-3">
									<div className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Cód. Gerente ERP (TGFVEN)</div>
									<div className="mt-1 font-bold text-slate-900">{viewingUser.cod_gerente_erp || '-'}</div>
								</div>

								<div className="rounded-xl border border-slate-200 p-3">
									<div className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Usuário ERP</div>
									<div className="mt-1 font-bold text-slate-900">{viewingUser.usuario_erp || '-'}</div>
								</div>

								<div className="rounded-xl border border-slate-200 p-3">
									<div className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Identificador (ID)</div>
									<div className="mt-1 font-mono text-slate-600 truncate" title={viewingUser.id}>{viewingUser.id}</div>
								</div>

								<div className="rounded-xl border border-slate-200 p-3">
									<div className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Data de Cadastro</div>
									<div className="mt-1 text-slate-700">
										{viewingUser.criado_em ? new Date(viewingUser.criado_em).toLocaleString('pt-BR') : '-'}
									</div>
								</div>

								<div className="rounded-xl border border-slate-200 p-3">
									<div className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Última Atualização</div>
									<div className="mt-1 text-slate-700">
										{viewingUser.atualizado_em ? new Date(viewingUser.atualizado_em).toLocaleString('pt-BR') : '-'}
									</div>
								</div>
							</div>
						</div>

						<div className="flex items-center justify-end border-t border-slate-200 px-6 py-4">
							<button
								type="button"
								onClick={() => setIsViewModalOpen(false)}
								className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
							>
								Fechar
							</button>
						</div>
					</div>
				</div>
			)}

			{/* ======================================================== */}
			{/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO                         */}
			{/* ======================================================== */}
			{isDeleteModalOpen && userToDelete && (
				<div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
					<div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
						<div className="flex items-center gap-3">
							<div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
								<Trash2 className="h-5 w-5" />
							</div>
							<div>
								<h3 className="text-base font-bold text-slate-900">Excluir Usuário</h3>
								<p className="text-xs text-slate-500">Esta ação não poderá ser desfeita.</p>
							</div>
						</div>

						<p className="mt-4 text-sm text-slate-600">
							Tem certeza de que deseja remover permanentemente o usuário <strong className="text-slate-900">{userToDelete.nome}</strong> (<span className="font-mono text-xs">{userToDelete.email}</span>)?
						</p>

						<div className="mt-6 flex items-center justify-end gap-3">
							<button
								type="button"
								onClick={() => setIsDeleteModalOpen(false)}
								className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
							>
								Cancelar
							</button>
							<button
								type="button"
								onClick={handleDeleteUser}
								disabled={isSubmitting}
								className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-50"
							>
								{isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Confirmar Exclusão'}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
