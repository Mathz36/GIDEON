import 'dotenv/config';

import cors from 'cors';
import express from 'express';

import apiRouter, { apiErrorHandler } from './routes/api';
import erpSyncScheduler from './services/erp-sync.scheduler';
import authService from './services/auth.service';
import databaseBootstrapService from './services/database-bootstrap.service';

const app = express();
const port = Number(process.env.PORT ?? 3080);
const host = process.env.HOST ?? '0.0.0.0';

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
	throw new Error('PORT deve ser um numero inteiro entre 1 e 65535.');
}

// Validador flexível de CORS: permite localhost, 127.0.0.1, IPs da rede local (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
const isOriginAllowed = (origin?: string): boolean => {
	if (!origin) return true;
	const configured = process.env.CORS_ORIGIN;
	if (configured === '*') return true;
	if (configured && configured.split(',').map((s) => s.trim()).includes(origin)) {
		return true;
	}
	const isLocalOrPrivateNetwork =
		/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(
			origin,
		);
	return isLocalOrPrivateNetwork;
};

app.use(
	cors({
		origin: (origin, callback) => {
			if (isOriginAllowed(origin)) {
				callback(null, true);
			} else {
				callback(null, false);
			}
		},
		credentials: true,
	}),
);
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiRouter);
app.use(apiErrorHandler);

const server = app.listen(port, host, async () => {
	console.info(`Servidor do Gideon escutando em http://${host === '0.0.0.0' ? 'localhost' : host}:${port} (disponível na rede local em http://0.0.0.0:${port}).`);
	await databaseBootstrapService.bootstrap();
	erpSyncScheduler.start();
	void authService.ensureInitialAdmin();
});

server.on('error', (err: NodeJS.ErrnoException) => {
	if (err.code === 'EADDRINUSE') {
		console.error(
			`[Servidor] A porta ${port} já está ocupada por outra instância do backend. Feche o terminal anterior ou rode: fuser -k ${port}/tcp`,
		);
		process.exit(1);
	}
	throw err;
});

export default app;
