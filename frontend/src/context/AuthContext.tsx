import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthResponse, OtpRequestResponse, User } from '../types/auth';

interface AuthContextType {
	user: User | null;
	token: string | null;
	isLoading: boolean;
	loginAdmin: (login: string, pass: string) => Promise<void>;
	requestOtp: (email: string) => Promise<OtpRequestResponse>;
	verifyOtp: (email: string, code: string) => Promise<void>;
	logout: () => void;
	getAuthHeaders: () => Record<string, string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'gideon.auth.token';

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null);
	const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
	const [isLoading, setIsLoading] = useState<boolean>(true);

	useEffect(() => {
		const checkSession = async () => {
			const savedToken = localStorage.getItem(TOKEN_KEY);
			if (!savedToken) {
				setIsLoading(false);
				return;
			}

			try {
				const response = await fetch('/api/auth/me', {
					headers: { Authorization: `Bearer ${savedToken}` },
				});

				if (response.ok) {
					const data = await response.json() as { user: User };
					setUser(data.user);
					setToken(savedToken);
				} else {
					localStorage.removeItem(TOKEN_KEY);
					setToken(null);
					setUser(null);
				}
			} catch {
				localStorage.removeItem(TOKEN_KEY);
				setToken(null);
				setUser(null);
			} finally {
				setIsLoading(false);
			}
		};

		void checkSession();
	}, []);

	const loginAdmin = async (login: string, pass: string): Promise<void> => {
		const response = await fetch('/api/auth/login/admin', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ login, password: pass }),
		});

		const data = await response.json() as AuthResponse & { error?: string };

		if (!response.ok) {
			throw new Error(data.error ?? 'Falha no login de administrador.');
		}

		localStorage.setItem(TOKEN_KEY, data.token);
		setToken(data.token);
		setUser(data.user);
	};

	const requestOtp = async (email: string): Promise<OtpRequestResponse> => {
		const response = await fetch('/api/auth/otp/request', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email }),
		});

		const data = await response.json() as OtpRequestResponse & { error?: string };

		if (!response.ok) {
			throw new Error(data.error ?? 'Falha ao solicitar código de verificação.');
		}

		return data;
	};

	const verifyOtp = async (email: string, code: string): Promise<void> => {
		const response = await fetch('/api/auth/otp/verify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, code }),
		});

		const data = await response.json() as AuthResponse & { error?: string };

		if (!response.ok) {
			throw new Error(data.error ?? 'Código de verificação incorreto ou expirado.');
		}

		localStorage.setItem(TOKEN_KEY, data.token);
		setToken(data.token);
		setUser(data.user);
	};

	const logout = () => {
		localStorage.removeItem(TOKEN_KEY);
		setToken(null);
		setUser(null);
	};

	const getAuthHeaders = (): Record<string, string> => {
		return token ? { Authorization: `Bearer ${token}` } : {};
	};

	return (
		<AuthContext.Provider
			value={{
				user,
				token,
				isLoading,
				loginAdmin,
				requestOtp,
				verifyOtp,
				logout,
				getAuthHeaders,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error('useAuth deve ser utilizado dentro de um AuthProvider.');
	}
	return context;
}

