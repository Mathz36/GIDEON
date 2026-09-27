import nodemailer, { Transporter } from 'nodemailer';

export class EmailService {
	private transporter: Transporter | null = null;

	constructor() {
		const host = process.env.SMTP_HOST;
		const port = Number(process.env.SMTP_PORT ?? 587);
		const user = process.env.SMTP_USER;
		const pass = process.env.SMTP_PASS;

		if (host && user && pass) {
			this.transporter = nodemailer.createTransport({
				host,
				port,
				secure: port === 465,
				auth: { user, pass },
			});
		}
	}

	async sendOtpCode(email: string, code: string, apelido?: string): Promise<void> {
		const greeting = apelido ? `Olá, ${apelido}!` : 'Olá!';

		// Sempre exibe no log do console para facilitar testes imediatos
		console.log('\n======================================================');
		console.log(`🔑 [GIDEON AUTH] CÓDIGO DE ACESSO PARA: ${email}`);
		console.log(`👉 CÓDIGO: ${code}`);
		console.log('⏰ VALIDADE: 2 minutos');
		console.log('======================================================\n');

		if (!this.transporter) {
			return;
		}

		const from = process.env.SMTP_FROM ?? '"Gideon ERP" <no-reply@gideon.com.br>';

		const html = `
			<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
				<div style="text-align: center; margin-bottom: 24px;">
					<h1 style="color: #4f46e5; margin: 0; font-size: 24px;">Gideon ERP</h1>
					<p style="color: #64748b; font-size: 14px; margin-top: 4px;">Autenticação de Gerente</p>
				</div>
				<p style="font-size: 16px; color: #1e293b; margin-bottom: 16px;">${greeting}</p>
				<p style="font-size: 14px; color: #475569; line-height: 1.5; margin-bottom: 24px;">
					Você solicitou acesso ao sistema Gideon. Use o código de verificação abaixo para confirmar sua identidade:
				</p>
				<div style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; text-align: center; margin-bottom: 24px;">
					<span style="font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #4f46e5;">${code}</span>
				</div>
				<p style="font-size: 13px; color: #ef4444; font-weight: 500; margin-bottom: 24px; text-align: center;">
					⏳ Este código expira em <strong>2 minutos</strong>.
				</p>
				<hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
				<p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
					Se você não solicitou este acesso, ignore esta mensagem.
				</p>
			</div>
		`;

		try {
			await this.transporter.sendMail({
				from,
				to: email,
				subject: `${code} é o seu código de acesso ao Gideon`,
				text: `${greeting} Seu código de acesso ao Gideon é: ${code}. Válido por 2 minutos.`,
				html,
			});
		} catch (error) {
			console.error(`[EmailService] Falha ao enviar e-mail via SMTP para ${email}:`, error);
		}
	}
}

export const emailService = new EmailService();
export default emailService;
