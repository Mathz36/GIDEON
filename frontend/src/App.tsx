import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';

import AdminAI from './pages/AdminAI';
import AdminERP from './pages/AdminERP';
import AdminUsers from './pages/AdminUsers';
import Chat from './pages/Chat';
import Login from './pages/Login';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/common/ErrorBoundary';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Bot, Database, LogOut, MessageSquare, Shield, User as UserIcon, Users as UsersIcon } from 'lucide-react';

const navigationClass = ({ isActive }: { isActive: boolean }) => (
	`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs sm:text-sm font-medium transition ${
		isActive
			? 'bg-indigo-50 text-indigo-700 font-semibold'
			: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
	}`
);

function NavigationHeader() {
	const { user, logout } = useAuth();

	if (!user) {
		return null;
	}

	return (
		<nav className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6 shrink-0 z-10" aria-label="Navegação principal">
			<div className="flex items-center gap-3 sm:gap-4">
				<div className="flex items-center gap-2.5">
					<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white shadow-sm">
						G
					</div>
					<div>
						<div className="flex items-center gap-2">
							<span className="font-semibold text-slate-800 text-sm tracking-tight">Gideon</span>
							{user.role === 'GERENTE' && (
								<span className="hidden sm:inline-block rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
									Assistente ERP
								</span>
							)}
						</div>
					</div>
				</div>

				{/* Menus de navegação apenas para Administradores. Gerentes apenas visualizam o Chat! */}
				{user.role === 'ADMIN' && (
					<div className="flex items-center gap-1 border-l border-slate-200 pl-3">
						<NavLink className={navigationClass} to="/">
							<MessageSquare className="h-4 w-4 text-indigo-600" />
							<span>Chat</span>
						</NavLink>
						<NavLink className={navigationClass} to="/admin/erp">
							<Database className="h-4 w-4 text-emerald-600" />
							<span className="hidden md:inline">Integrações</span> ERP
						</NavLink>
						<NavLink className={navigationClass} to="/admin/ai">
							<Bot className="h-4 w-4 text-violet-600" />
							<span className="hidden md:inline">Configurações</span> IA
						</NavLink>
						<NavLink className={navigationClass} to="/admin/users">
							<UsersIcon className="h-4 w-4 text-sky-600" />
							<span>Usuários</span>
						</NavLink>
					</div>
				)}
			</div>

			<div className="flex items-center gap-2.5 sm:gap-3">
				<div className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
					{user.role === 'ADMIN' ? (
						<>
							<Shield className="h-3.5 w-3.5 text-indigo-600" />
							<span className="text-indigo-700 font-semibold">Administrador</span>
						</>
					) : (
						<>
							<UserIcon className="h-3.5 w-3.5 text-emerald-600" />
							<span>Gerente: <strong className="text-slate-900">{user.apelido || user.email}</strong></span>
						</>
					)}
				</div>

				<button
					type="button"
					onClick={logout}
					title="Sair do sistema"
					className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
				>
					<LogOut className="h-3.5 w-3.5" />
					<span className="hidden sm:inline">Sair</span>
				</button>
			</div>
		</nav>
	);
}

export default function App() {
	return (
		<AuthProvider>
			<BrowserRouter>
				<div className="flex h-screen flex-col overflow-hidden bg-slate-50">
					<NavigationHeader />
					<div className="flex-1 min-h-0 overflow-y-auto">
						<ErrorBoundary>
							<Routes>
								<Route path="/login" element={<Login />} />
								<Route
									path="/"
									element={
										<ProtectedRoute>
											<Chat />
										</ProtectedRoute>
									}
								/>
								<Route
									path="/admin/erp"
									element={
										<ProtectedRoute requiredRole="ADMIN">
											<AdminERP />
										</ProtectedRoute>
									}
								/>
								<Route
									path="/admin/ai"
									element={
										<ProtectedRoute requiredRole="ADMIN">
											<AdminAI />
										</ProtectedRoute>
									}
								/>
								<Route
									path="/admin/users"
									element={
										<ProtectedRoute requiredRole="ADMIN">
											<AdminUsers />
										</ProtectedRoute>
									}
								/>
								<Route path="*" element={<Login />} />
							</Routes>
						</ErrorBoundary>
					</div>
				</div>
			</BrowserRouter>
		</AuthProvider>
	);
}
