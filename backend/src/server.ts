import 'dotenv/config';

import cors from 'cors';
import express from 'express';

import apiRouter, { apiErrorHandler } from './routes/api';
import erpSyncScheduler from './services/erp-sync.scheduler';
import authService from './services/auth.service';

const app = express();
const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
	throw new Error('PORT deve ser um numero inteiro entre 1 e 65535.');
}

app.use(
	cors({
		origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
	}),
);
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiRouter);
app.use(apiErrorHandler);

app.listen(port, () => {
	console.info(`Servidor do Gideon escutando na porta ${port}.`);
	erpSyncScheduler.start();
	void authService.ensureInitialAdmin();
});

export default app;
