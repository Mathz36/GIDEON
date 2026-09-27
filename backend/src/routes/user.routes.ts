import { Router, Response } from 'express';
import userService from '../services/user.service';
import { AuthenticatedRequest, requireAdmin } from '../middlewares/auth.middleware';

const userRouter = Router();

// Todas as rotas de usuários requerem privilégio de ADMINISTRADOR
userRouter.use(requireAdmin);

userRouter.get('/', async (_req: AuthenticatedRequest, res: Response, next) => {
	try {
		const users = await userService.list();
		res.status(200).json({ data: users });
	} catch (error) {
		next(error);
	}
});

userRouter.get('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
	try {
		const user = await userService.getById(req.params.id);
		if (!user) {
			res.status(404).json({ error: 'Usuário não encontrado.' });
			return;
		}

		res.status(200).json({ data: user });
	} catch (error) {
		next(error);
	}
});

userRouter.post('/', async (req: AuthenticatedRequest, res: Response, next) => {
	try {
		const created = await userService.create(req.body);
		res.status(201).json({ data: created, message: 'Usuário cadastrado com sucesso.' });
	} catch (error) {
		res.status(400).json({ error: error instanceof Error ? error.message : 'Erro ao cadastrar usuário.' });
	}
});

userRouter.put('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
	try {
		const updated = await userService.update(req.params.id, req.body);
		res.status(200).json({ data: updated, message: 'Usuário atualizado com sucesso.' });
	} catch (error) {
		res.status(400).json({ error: error instanceof Error ? error.message : 'Erro ao atualizar usuário.' });
	}
});

userRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
	try {
		await userService.delete(req.params.id, req.user!.id);
		res.status(200).json({ success: true, message: 'Usuário excluído com sucesso.' });
	} catch (error) {
		res.status(400).json({ error: error instanceof Error ? error.message : 'Erro ao excluir usuário.' });
	}
});

export default userRouter;
