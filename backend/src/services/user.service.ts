import bcrypt from 'bcryptjs';
import prismaClient from '../config/prisma';
import { validatePassword } from '../utils/password.validator';

export interface UserSafe {
	id: string;
	nome: string;
	email: string;
	usuario_erp: string;
	cod_gerente_erp: string;
	tipo_acesso: 'ADMIN' | 'GERENTE';
	criado_em: Date;
	atualizado_em: Date;
}

export interface CreateUserInput {
	nome: string;
	email: string;
	usuario_erp: string;
	cod_gerente_erp: string | number;
	tipo_acesso: 'ADMIN' | 'GERENTE';
	senha: string;
	confirmacao_senha: string;
}

export interface UpdateUserInput {
	nome?: string;
	email?: string;
	usuario_erp?: string;
	cod_gerente_erp?: string | number;
	tipo_acesso?: 'ADMIN' | 'GERENTE';
	senha?: string;
	confirmacao_senha?: string;
}

const safeUserSelect = {
	id: true,
	nome: true,
	email: true,
	usuario_erp: true,
	cod_gerente_erp: true,
	tipo_acesso: true,
	criado_em: true,
	atualizado_em: true,
};

export class UserService {
	async list(): Promise<UserSafe[]> {
		const users = await prismaClient.usuario.findMany({
			select: safeUserSelect,
			orderBy: { criado_em: 'desc' },
		});

		return users.map((u) => ({
			...u,
			tipo_acesso: u.tipo_acesso as 'ADMIN' | 'GERENTE',
		}));
	}

	async getById(id: string): Promise<UserSafe | null> {
		const user = await prismaClient.usuario.findUnique({
			where: { id },
			select: safeUserSelect,
		});

		if (!user) return null;

		return {
			...user,
			tipo_acesso: user.tipo_acesso as 'ADMIN' | 'GERENTE',
		};
	}

	async create(input: CreateUserInput): Promise<UserSafe> {
		const nome = input.nome?.trim();
		const email = input.email?.trim().toLowerCase();
		const usuario_erp = input.usuario_erp?.trim();
		const cod_gerente_erp = String(input.cod_gerente_erp ?? '').trim();
		const tipo_acesso = input.tipo_acesso;
		const senha = input.senha ?? '';
		const confirmacao_senha = input.confirmacao_senha ?? '';

		if (!nome) {
			throw new Error('O campo Nome é obrigatório.');
		}

		if (!email || !email.includes('@')) {
			throw new Error('Informe um e-mail válido.');
		}

		if (!usuario_erp) {
			throw new Error('O campo Usuário ERP é obrigatório.');
		}

		if (!cod_gerente_erp) {
			throw new Error('O campo Código de Gerente ERP é obrigatório.');
		}

		if (tipo_acesso !== 'ADMIN' && tipo_acesso !== 'GERENTE') {
			throw new Error('O Tipo de Acesso deve ser ADMIN ou GERENTE.');
		}

		// Validação estrita da política de senha
		const passwordCheck = validatePassword(senha);
		if (!passwordCheck.isValid) {
			throw new Error(passwordCheck.message);
		}

		// Validação estrita de confirmação
		if (senha !== confirmacao_senha) {
			throw new Error('A confirmação de senha não confere com a senha digitada.');
		}

		// Verifica duplicidade de e-mail
		const existing = await prismaClient.usuario.findUnique({
			where: { email },
		});
		if (existing) {
			throw new Error('Já existe um usuário cadastrado com este e-mail.');
		}

		// Hash com bcrypt
		const senha_hash = await bcrypt.hash(senha, 10);

		const created = await prismaClient.usuario.create({
			data: {
				nome,
				email,
				senha_hash,
				usuario_erp,
				cod_gerente_erp,
				tipo_acesso,
			},
			select: safeUserSelect,
		});

		return {
			...created,
			tipo_acesso: created.tipo_acesso as 'ADMIN' | 'GERENTE',
		};
	}

	async update(id: string, input: UpdateUserInput): Promise<UserSafe> {
		const existing = await prismaClient.usuario.findUnique({
			where: { id },
		});

		if (!existing) {
			throw new Error('Usuário não encontrado.');
		}

		const dataToUpdate: {
			nome?: string;
			email?: string;
			usuario_erp?: string;
			cod_gerente_erp?: string;
			tipo_acesso?: string;
			senha_hash?: string;
		} = {};

		if (input.nome !== undefined) {
			const nome = input.nome.trim();
			if (!nome) throw new Error('O campo Nome não pode ser vazio.');
			dataToUpdate.nome = nome;
		}

		if (input.email !== undefined) {
			const email = input.email.trim().toLowerCase();
			if (!email || !email.includes('@')) throw new Error('Informe um e-mail válido.');

			if (email !== existing.email) {
				const emailTaken = await prismaClient.usuario.findUnique({ where: { email } });
				if (emailTaken) {
					throw new Error('Já existe outro usuário cadastrado com este e-mail.');
				}
			}
			dataToUpdate.email = email;
		}

		if (input.usuario_erp !== undefined) {
			const usuario_erp = input.usuario_erp.trim();
			if (!usuario_erp) throw new Error('O campo Usuário ERP não pode ser vazio.');
			dataToUpdate.usuario_erp = usuario_erp;
		}

		if (input.cod_gerente_erp !== undefined) {
			const cod_gerente_erp = String(input.cod_gerente_erp).trim();
			if (!cod_gerente_erp) throw new Error('O campo Código de Gerente ERP não pode ser vazio.');
			dataToUpdate.cod_gerente_erp = cod_gerente_erp;
		}

		if (input.tipo_acesso !== undefined) {
			if (input.tipo_acesso !== 'ADMIN' && input.tipo_acesso !== 'GERENTE') {
				throw new Error('O Tipo de Acesso deve ser ADMIN ou GERENTE.');
			}
			dataToUpdate.tipo_acesso = input.tipo_acesso;
		}

		// Se a senha foi preenchida para atualização
		if (input.senha && input.senha.trim()) {
			const passwordCheck = validatePassword(input.senha);
			if (!passwordCheck.isValid) {
				throw new Error(passwordCheck.message);
			}

			if (input.senha !== input.confirmacao_senha) {
				throw new Error('A confirmação de senha não confere com a nova senha digitada.');
			}

			dataToUpdate.senha_hash = await bcrypt.hash(input.senha, 10);
		}

		const updated = await prismaClient.usuario.update({
			where: { id },
			data: dataToUpdate,
			select: safeUserSelect,
		});

		return {
			...updated,
			tipo_acesso: updated.tipo_acesso as 'ADMIN' | 'GERENTE',
		};
	}

	async delete(id: string, requesterId: string): Promise<boolean> {
		if (id === requesterId) {
			throw new Error('Você não pode excluir sua própria conta de administrador.');
		}

		const existing = await prismaClient.usuario.findUnique({ where: { id } });
		if (!existing) {
			throw new Error('Usuário não encontrado.');
		}

		await prismaClient.usuario.delete({ where: { id } });
		return true;
	}
}

export const userService = new UserService();
export default userService;
