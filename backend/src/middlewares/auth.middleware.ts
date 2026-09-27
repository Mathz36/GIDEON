import { NextFunction, Request, Response } from 'express';
import authService, { AuthUser } from '../services/auth.service';

export interface AuthenticatedRequest extends Request {
	user?: AuthUser;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
	const authHeader = req.headers.authorization;

	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		res.status(401).json({ error: 'Acesso não autorizado. Token não informado.' });
		return;
	}

	const token = authHeader.slice(7).trim();

	try {
		req.user = authService.verifyToken(token);
		next();
	} catch (error) {
		res.status(401).json({ error: error instanceof Error ? error.message : 'Sessão inválida.' });
	}
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
	requireAuth(req, res, () => {
		if (req.user?.role !== 'ADMIN') {
			res.status(403).json({ error: 'Acesso negado. Esta operação é restrita a administradores.' });
			return;
		}

		next();
	});
}

