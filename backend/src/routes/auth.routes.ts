import { Router, Response } from 'express';
import authService from '../services/auth.service';
import { AuthenticatedRequest, requireAuth } from '../middlewares/auth.middleware';

const authRouter = Router();

/**
 * Login unificado de usuários (Admin e Gerente) com e-mail e senha.
 */
authRouter.post('/login', async (req, res: Response) => {
	try {
		const { email, login, password } = req.body ?? {};
		const emailToUse = (typeof email === 'string' && email.trim()) ? email : login;

		if (typeof emailToUse !== 'string' || !emailToUse.trim()) {
			res.status(400).json({ error: 'Informe o e-mail de acesso.' });
			return;
		}

		if (typeof password !== 'string' || !password) {
			res.status(400).json({ error: 'Informe a senha de acesso.' });
			return;
		}

		const result = await authService.login(emailToUse, password);
		res.status(200).json(result);
	} catch (error) {
		res.status(401).json({ error: error instanceof Error ? error.message : 'Falha na autenticação.' });
	}
});

// Alias para compatibilidade
authRouter.post('/login/admin', async (req, res: Response) => {
	try {
		const { email, login, password } = req.body ?? {};
		const emailToUse = (typeof email === 'string' && email.trim()) ? email : login;

		if (typeof emailToUse !== 'string' || !emailToUse.trim()) {
			res.status(400).json({ error: 'Informe o e-mail ou usuário de acesso.' });
			return;
		}

		if (typeof password !== 'string' || !password) {
			res.status(400).json({ error: 'Informe a senha.' });
			return;
		}

		const result = await authService.login(emailToUse, password);
		res.status(200).json(result);
	} catch (error) {
		res.status(401).json({ error: error instanceof Error ? error.message : 'Falha na autenticação.' });
	}
});

/**
 * Retorna dados da sessão do usuário autenticado.
 */
authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
	res.status(200).json({ user: req.user });
});

export default authRouter;
