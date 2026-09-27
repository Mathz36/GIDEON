import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types/auth';

interface ProtectedRouteProps {
	children: ReactNode;
	requiredRole?: UserRole;
}

export default function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
	const { user, isLoading } = useAuth();
	const location = useLocation();

	if (isLoading) {
		return (
			<div className="flex h-screen w-screen items-center justify-center bg-slate-50">
				<div className="flex flex-col items-center gap-3">
					<div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
					<p className="text-sm font-medium text-slate-500">Carregando Gideon...</p>
				</div>
			</div>
		);
	}

	if (!user) {
		return <Navigate to="/login" state={{ from: location }} replace />;
	}

	if (requiredRole && user.role !== requiredRole) {
		return <Navigate to="/" replace />;
	}

	return <>{children}</>;
}

