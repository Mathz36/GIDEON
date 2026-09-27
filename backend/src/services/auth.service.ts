import jwt from 'jsonwebtoken';
import SankhyaService from './sankhya.service';
import emailService from './email.service';

export interface AuthUser {
	id: string;
	cod?: string | number;
	apelido: string;
	email: string;
	role: 'ADMIN' | 'GERENTE';
}

interface OtpEntry {
	code: string;
	expiresAt: number;
	user: {
		cod: string | number;
		apelido: string;
		email: string;
	};
}

export class AuthService {
	private readonly sankhyaService: SankhyaService;
	private readonly otpStore = new Map<string, OtpEntry>();
	private readonly jwtSecret: string;
	private readonly adminUsername: string;
	private readonly adminPassword: string;

	constructor() {
		this.sankhyaService = new SankhyaService();
		this.jwtSecret = process.env.JWT_SECRET ?? 'gideon-jwt-secret-key-2026';
		this.adminUsername = (process.env.ADMIN_USERNAME ?? 'admin').trim().toLowerCase();
		this.adminPassword = process.env.ADMIN_PASSWORD ?? 'admin123';

		// Limpa periodicamente OTPs expirados
		setInterval(() => this.cleanupExpiredOtps(), 60_000).unref();
	}

	async loginAdmin(login: string, pass: string): Promise<{ token: string; user: AuthUser }> {
		const normalizedLogin = login.trim().toLowerCase();

		const matchesUsername = normalizedLogin === this.adminUsername;
		const matchesAdminEmail = normalizedLogin === `${this.adminUsername}@gideon.com.br` || normalizedLogin === 'admin@admin.com';

		if ((!matchesUsername && !matchesAdminEmail) || pass !== this.adminPassword) {
			throw new Error('Credenciais de administrador inválidas.');
		}

		const user: AuthUser = {
			id: 'admin',
			apelido: 'Administrador',
			email: 'admin@gideon.com.br',
			role: 'ADMIN',
		};

		const token = this.generateToken(user);
		return { token, user };
	}

	async requestGerenteOtp(email: string): Promise<{ success: boolean; message: string; expiresIn: number; apelido: string }> {
		const normalizedEmail = email.trim().toLowerCase();

		if (!normalizedEmail || !normalizedEmail.includes('@')) {
			throw new Error('Informe um endereço de e-mail válido.');
		}

		// Consulta no DbExplorer da Sankhya
		// Exemplo de query configurável via .env ou padrão na tabela de usuários do Sankhya:
		const sanitizedEmail = normalizedEmail.replace(/'/g, "''");
		const customQuery = process.env.SANKHYA_LOGIN_QUERY;

		const query = customQuery
			? customQuery.replace(/:email/gi, `'${sanitizedEmail}'`).replace(/{email}/gi, sanitizedEmail)
			: `SELECT CODVEND AS COD, APELIDO AS APELIDO, EMAIL FROM TGFVEN WHERE LOWER(EMAIL) = '${sanitizedEmail}' AND TIPVEND ='G' AND ATIVO = 'S'`;

		const rows = await this.sankhyaService.executeQuery(query, ['COD', 'APELIDO', 'EMAIL']);

		if (!rows || rows.length === 0) {
			throw new Error('Nenhum usuário encontrado com este e-mail no Sankhya ERP.');
		}

		const row = rows[0];
		const rawCod = row.COD ?? row.cod ?? '0';
		const cod: string | number = (typeof rawCod === 'string' || typeof rawCod === 'number') ? rawCod : String(rawCod);
		const apelido = String(row.APELIDO ?? row.apelido ?? 'Gerente');
		const userEmail = String(row.EMAIL ?? row.email ?? normalizedEmail);

		// Gera código de 6 dígitos
		const code = Math.floor(100000 + Math.random() * 900000).toString();
		const expiresInSeconds = 120; // 2 minutos
		const expiresAt = Date.now() + expiresInSeconds * 1000;

		this.otpStore.set(normalizedEmail, {
			code,
			expiresAt,
			user: { cod, apelido, email: userEmail },
		});

		// Envia o e-mail (e registra no console)
		await emailService.sendOtpCode(userEmail, code, apelido);

		return {
			success: true,
			message: `Código enviado com sucesso para ${userEmail}. Você tem 2 minutos para inseri-lo.`,
			expiresIn: expiresInSeconds,
			apelido,
		};
	}

	async verifyGerenteOtp(email: string, code: string): Promise<{ token: string; user: AuthUser }> {
		const normalizedEmail = email.trim().toLowerCase();
		const trimmedCode = code.trim();

		const entry = this.otpStore.get(normalizedEmail);

		if (!entry) {
			throw new Error('Código de verificação não encontrado ou expirado. Por favor, solicite um novo código.');
		}

		if (Date.now() > entry.expiresAt) {
			this.otpStore.delete(normalizedEmail);
			throw new Error('O código de verificação expirou (limite de 2 minutos). Solicite um novo código.');
		}

		if (entry.code !== trimmedCode) {
			throw new Error('Código de verificação incorreto.');
		}

		// Código válido: consome e remove da memória
		this.otpStore.delete(normalizedEmail);

		const user: AuthUser = {
			id: String(entry.user.cod),
			cod: entry.user.cod,
			apelido: entry.user.apelido,
			email: entry.user.email,
			role: 'GERENTE',
		};

		const token = this.generateToken(user);
		return { token, user };
	}

	verifyToken(token: string): AuthUser {
		try {
			const decoded = jwt.verify(token, this.jwtSecret) as AuthUser;
			return decoded;
		} catch (error) {
			throw new Error('Sessão expirada ou token inválido. Por favor, faça login novamente.');
		}
	}

	private generateToken(user: AuthUser): string {
		return jwt.sign(
			{
				id: user.id,
				cod: user.cod,
				apelido: user.apelido,
				email: user.email,
				role: user.role,
			},
			this.jwtSecret,
			{ expiresIn: '7d' },
		);
	}

	private cleanupExpiredOtps(): void {
		const now = Date.now();
		for (const [email, entry] of this.otpStore.entries()) {
			if (now > entry.expiresAt) {
				this.otpStore.delete(email);
			}
		}
	}
}

export const authService = new AuthService();
export default authService;
