export type UserRole = 'ADMIN' | 'GERENTE';

export interface User {
	id: string;
	nome: string;
	email: string;
	usuario_erp: string;
	cod_gerente_erp: string;
	tipo_acesso: UserRole;
	role: UserRole;
	apelido: string;
	criado_em?: string;
	atualizado_em?: string;
}

export interface UsuarioItem {
	id: string;
	nome: string;
	email: string;
	usuario_erp: string;
	cod_gerente_erp: string;
	tipo_acesso: UserRole;
	criado_em: string;
	atualizado_em: string;
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
