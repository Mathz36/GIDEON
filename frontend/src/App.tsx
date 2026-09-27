import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { LogOut, Shield, User as UserIcon } from 'lucide-react';

import AdminAI from './pages/AdminAI';
import AdminERP from './pages/AdminERP';
import Chat from './pages/Chat';
import Login from './pages/Login';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider, useAuth } from './context/AuthContext';

const navigationClass = ({ isActive }: { isActive: boolean }) => (
	`rounded-md px-3 py-1.5 text-sm font-medium transition ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`
);

function NavigationHeader() {
	const { user, logout } = useAuth();

	if (!user) {
		return null;
	}

	return (
		<nav className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 sm:px-6" aria-label="Navegação principal">
			<div className="flex items-center gap-4">
				<div className="flex items-center gap-2">
					<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">
						G
					</div>
					<span className="font-semibold text-slate-800 text-sm">Gideon</span>
				</div>

				<div className="flex items-center gap-1 border-l border-slate-200 pl-3">
					<NavLink className={navigationClass} to="/">Chat</NavLink>
					{user.role === 'ADMIN' && (
						<>
							<NavLink className={navigationClass} to="/admin/erp">ERP</NavLink>
							<NavLink className={navigationClass} to="/admin/ai">IA</NavLink>
						</>
					)}
				</div>
			</div>

			<div className="flex items-center gap-3">
				<div className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
					{user.role === 'ADMIN' ? (
						<>
							<Shield className="h-3.5 w-3.5 text-indigo-600" />
							<span className="text-indigo-700 font-semibold">Admin</span>
						</>
					) : (
						<>
							<UserIcon className="h-3.5 w-3.5 text-emerald-600" />
							<span>Gerente: <strong className="text-slate-900">{user.apelido}</strong></span>
						</>
					)}
				</div>

				<button
					type="button"
					onClick={logout}
					title="Sair do sistema"
					className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
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
				<NavigationHeader />
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
					<Route path="*" element={<Login />} />
				</Routes>
			</BrowserRouter>
		</AuthProvider>
	);
}
