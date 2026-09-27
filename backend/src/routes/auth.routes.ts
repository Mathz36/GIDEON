import { Router } from 'express';
import authService from '../services/auth.service';
import { AuthenticatedRequest, requireAuth } from '../middlewares/auth.middleware';

const authRouter = Router();

authRouter.post('/login/admin', async (req, res, next) => {
	try {
		const { login, password } = req.body ?? {};

		if (typeof login !== 'string' || !login.trim()) {
			res.status(400).json({ error: 'Informe o usuário ou e-mail de administrador.' });
			return;
		}

		if (typeof password !== 'string' || !password) {
			res.status(400).json({ error: 'Informe a senha de administrador.' });
			return;
		}

		const result = await authService.loginAdmin(login, password);
		res.status(200).json(result);
	} catch (error) {
		res.status(401).json({ error: error instanceof Error ? error.message : 'Falha na autenticação.' });
	}
});

authRouter.post('/otp/request', async (req, res, next) => {
	try {
		const { email } = req.body ?? {};

		if (typeof email !== 'string' || !email.trim()) {
			res.status(400).json({ error: 'Informe o e-mail cadastrado no ERP.' });
			return;
		}

		const result = await authService.requestGerenteOtp(email);
		res.status(200).json(result);
	} catch (error) {
		res.status(400).json({ error: error instanceof Error ? error.message : 'Falha ao solicitar código.' });
	}
});

authRouter.post('/otp/verify', async (req, res, next) => {
	try {
		const { email, code } = req.body ?? {};

		if (typeof email !== 'string' || !email.trim()) {
			res.status(400).json({ error: 'Informe o e-mail.' });
			return;
		}

		if (typeof code !== 'string' || !code.trim()) {
			res.status(400).json({ error: 'Informe o código de 6 dígitos recebido por e-mail.' });
			return;
		}

		const result = await authService.verifyGerenteOtp(email, code);
		res.status(200).json(result);
	} catch (error) {
		res.status(400).json({ error: error instanceof Error ? error.message : 'Código inválido ou expirado.' });
	}
});

authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
	res.status(200).json({ user: req.user });
});

export default authRouter;

