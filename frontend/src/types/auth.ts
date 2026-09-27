export type UserRole = 'ADMIN' | 'GERENTE';

export interface User {
	id: string;
	cod?: string | number;
	apelido: string;
	email: string;
	role: UserRole;
}

export interface AuthResponse {
	token: string;
	user: User;
}

export interface OtpRequestResponse {
	success: boolean;
	message: string;
	expiresIn: number;
	apelido?: string;
}

