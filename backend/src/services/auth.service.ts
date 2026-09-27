import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prismaClient from '../config/prisma';

export interface AuthUser {
	id: string;
	nome: string;
	email: string;
	usuario_erp: string;
	cod_gerente_erp: string;
	tipo_acesso: 'ADMIN' | 'GERENTE';
	// Aliases para compatibilidade de rotas e frontend
	role: 'ADMIN' | 'GERENTE';
	apelido: string;
}

export class AuthService {
	private readonly jwtSecret: string;

	constructor() {
		this.jwtSecret = process.env.JWT_SECRET ?? 'gideon-jwt-secret-key-2026';
	}

	/**
	 * Autenticação de usuários (Admin e Gerente) baseada exclusivamente na tabela interna de usuários.
	 */
	async login(email: string, pass: string): Promise<{ token: string; user: AuthUser }> {
		const normalizedEmail = email?.trim().toLowerCase();
		const password = pass ?? '';

		if (!normalizedEmail || !password) {
			throw new Error('Informe o e-mail e a senha.');
		}

		const user = await prismaClient.usuario.findUnique({
			where: { email: normalizedEmail },
		});

		if (!user) {
			throw new Error('E-mail ou senha incorretos.');
		}

		const passwordMatch = await bcrypt.compare(password, user.senha_hash);
		if (!passwordMatch) {
			throw new Error('E-mail ou senha incorretos.');
		}

		const authUser: AuthUser = {
			id: user.id,
			nome: user.nome,
			email: user.email,
			usuario_erp: user.usuario_erp,
			cod_gerente_erp: user.cod_gerente_erp,
			tipo_acesso: user.tipo_acesso as 'ADMIN' | 'GERENTE',
			role: user.tipo_acesso as 'ADMIN' | 'GERENTE',
			apelido: user.nome,
		};

		const token = this.generateToken(authUser);
		return { token, user: authUser };
	}

	verifyToken(token: string): AuthUser {
		try {
			const decoded = jwt.verify(token, this.jwtSecret) as AuthUser;
			return decoded;
		} catch (error) {
			throw new Error('Sessão expirada ou token inválido. Por favor, faça login novamente.');
		}
	}

	generateToken(user: AuthUser): string {
		return jwt.sign(
			{
				id: user.id,
				nome: user.nome,
				email: user.email,
				usuario_erp: user.usuario_erp,
				cod_gerente_erp: user.cod_gerente_erp,
				tipo_acesso: user.tipo_acesso,
				role: user.role,
				apelido: user.apelido,
			},
			this.jwtSecret,
			{ expiresIn: '7d' },
		);
	}

	/**
	 * Garante a criação de um Administrador padrão no banco de dados na inicialização do sistema,
	 * caso nenhum Administrador exista.
	 */
	async ensureInitialAdmin(): Promise<void> {
		try {
			const adminCount = await prismaClient.usuario.count({
				where: { tipo_acesso: 'ADMIN' },
			});

			if (adminCount === 0) {
				const defaultEmail = (process.env.ADMIN_EMAIL ?? 'admin@gideon.local').trim().toLowerCase();
				const defaultPassword = process.env.ADMIN_PASSWORD ?? 'Admin@123';
				const hash = await bcrypt.hash(defaultPassword, 10);

				await prismaClient.usuario.create({
					data: {
						nome: 'Administrador Gideon',
						email: defaultEmail,
						senha_hash: hash,
						usuario_erp: 'ADMIN',
						cod_gerente_erp: '0',
						tipo_acesso: 'ADMIN',
					},
				});

				console.info(`[AuthService] Usuário Administrador inicial criado com sucesso: ${defaultEmail} (senha padrão: ${defaultPassword})`);
			}
		} catch (error) {
			console.warn('[AuthService] Aviso ao verificar/criar administrador inicial:', error);
		}
	}
}

export const authService = new AuthService();
export default authService;
