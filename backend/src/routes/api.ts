import { NextFunction, Request, Response, Router } from 'express';

import GeminiService, { GeminiMessage, GeminiParameters } from '../services/gemini.service';
import erpConfigurationService, { ErpConfigurationInput } from '../services/erp-configuration.service';
import aiConfigurationService, { AiConfigurationInput } from '../services/ai-configuration.service';
import chatRagService from '../services/chat-rag.service';
import SankhyaService from '../services/sankhya.service';
import authRouter from './auth.routes';
import userRouter from './user.routes';
import { requireAuth, requireAdmin } from '../middlewares/auth.middleware';
import prismaClient from '../config/prisma';
import erpSyncScheduler from '../services/erp-sync.scheduler';
import syncQueueManager from '../services/sync-queue.manager';

interface ErpQueryBody {
	query?: unknown;
	expectedFields?: unknown;
}

interface ChatBody {
	history?: unknown;
	systemPrompt?: unknown;
	parameters?: unknown;
}

interface ErpConfigurationBody {
	context?: unknown;
	description?: unknown;
	query?: unknown;
	expectedFields?: unknown;
	primaryKey?: unknown;
	syncStrategy?: unknown;
	lastSyncCursor?: unknown;
	batchSize?: unknown;
	activeColumn?: unknown;
	activeValue?: unknown;
	syncFrequency?: unknown;
	syncInterval?: unknown;
	syncTime?: unknown;
	syncDayOfMonth?: unknown;
	syncActive?: unknown;
}

const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);

apiRouter.post('/erp/query', requireAuth, async (req: Request<Record<string, string>, unknown, ErpQueryBody>, res, next) => {
	try {
		const query = validateReadOnlyQuery(req.body.query);
		const expectedFields = validateExpectedFields(req.body.expectedFields);
		const rows = await new SankhyaService().executeQuery(query, expectedFields);

		res.status(200).json({ data: rows });
	} catch (error) {
		next(error);
	}
});

apiRouter.get('/erp/configurations', requireAdmin, async (_req, res, next) => {
	try {
		res.status(200).json({ data: await erpConfigurationService.list() });
	} catch (error) {
		next(error);
	}
});

apiRouter.post('/erp/configurations', requireAdmin, async (req: Request<Record<string, string>, unknown, ErpConfigurationBody>, res, next) => {
	try {
		res.status(201).json({ data: await erpConfigurationService.create(validateErpConfiguration(req.body)) });
	} catch (error) {
		next(error);
	}
});

apiRouter.put('/erp/configurations/:id', requireAdmin, async (req: Request<{ id: string }, unknown, ErpConfigurationBody>, res, next) => {
	try {
		const configuration = await erpConfigurationService.update(req.params.id, validateErpConfiguration(req.body));
		if (!configuration) {
			res.status(404).json({ error: 'Configuração SQL não encontrada.' });
			return;
		}

		res.status(200).json({ data: configuration });
	} catch (error) {
		next(error);
	}
});

apiRouter.delete('/erp/configurations/:id', requireAdmin, async (req: Request<{ id: string }>, res, next) => {
	try {
		if (!await erpConfigurationService.delete(req.params.id)) {
			res.status(404).json({ error: 'Configuração SQL não encontrada.' });
			return;
		}

		res.status(204).end();
	} catch (error) {
		next(error);
	}
});

apiRouter.post('/erp/configurations/:id/sync', requireAdmin, async (req: Request<{ id: string }>, res, next) => {
	try {
		const config = await prismaClient.erpConfiguration.findUnique({
			where: { id: req.params.id },
		});

		if (!config) {
			res.status(404).json({ error: 'Configuração SQL não encontrada.' });
			return;
		}

		const result = await erpSyncScheduler.executeJob(config);
		res.status(200).json({
			success: result.success,
			message: result.message,
			data: result,
		});
	} catch (error) {
		next(error);
	}
});

apiRouter.get('/erp/queue', requireAdmin, (_req, res) => {
	res.status(200).json({ data: syncQueueManager.getStatus() });
});

apiRouter.get('/ai/configurations', requireAdmin, async (_req, res, next) => {
	try {
		const config = await aiConfigurationService.get();
		res.status(200).json({ data: config });
	} catch (error) {
		next(error);
	}
});

apiRouter.put('/ai/configurations', requireAdmin, async (req: Request<Record<string, string>, unknown, AiConfigurationInput>, res, next) => {
	try {
		const input = validateAIConfiguration(req.body);
		const config = await aiConfigurationService.update(input);
		res.status(200).json({ data: config });
	} catch (error) {
		next(error);
	}
});

apiRouter.post('/chat', requireAuth, async (req: Request<Record<string, string>, unknown, ChatBody>, res, next) => {
	try {
		const history = validateHistory(req.body.history);

		// Carrega as configurações da IA e as integrações cadastradas do banco de dados
		const aiConfig = await aiConfigurationService.get();
		const erpIntegrations = await erpConfigurationService.list();

		let erpContext = '';
		if (erpIntegrations.length > 0) {
			erpContext = '\n\nTabelas e Integrações do ERP disponíveis no banco:\n' + erpIntegrations.map((i) => (
				`- Contexto: "${i.context}" (Tabela: "${i.tableName}"): ${i.description}. Colunas: ${i.expectedFields.join(', ')}`
			)).join('\n');
		}

		// Executa pipeline RAG / Text-to-SQL para buscar dados reais no banco de dados
		const lastUserMessage = [...history].reverse().find((m) => m.role === 'user')?.parts.map((p) => p.text).join(' ') ?? '';
		let realDatabaseContext = '';
		if (lastUserMessage) {
			try {
				const dbContext = await chatRagService.retrieveDatabaseContext(lastUserMessage);
				if (dbContext) {
					realDatabaseContext = `\n\n${dbContext}`;
				}
			} catch (ragErr) {
				console.warn('[ChatRoute] Erro ao buscar dados reais via RAG:', ragErr);
			}
		}

		const baseSystemPrompt = (typeof req.body.systemPrompt === 'string' && req.body.systemPrompt.trim())
			? req.body.systemPrompt.trim()
			: aiConfig.systemPrompt;

		const systemPrompt = `${baseSystemPrompt}${erpContext}${realDatabaseContext}`;

		let parameters: GeminiParameters = {
			temperature: aiConfig.temperature,
			topP: aiConfig.topP,
		};
		if (isRecord(req.body.parameters) && typeof req.body.parameters.temperature === 'number' && typeof req.body.parameters.topP === 'number') {
			parameters = {
				temperature: req.body.parameters.temperature,
				topP: req.body.parameters.topP,
			};
		}

		const gemini = new GeminiService();

		res.status(200);
		res.set({
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no',
		});
		res.flushHeaders();

		for await (const text of gemini.streamResponse(history, systemPrompt, parameters)) {
			if (res.writableEnded || res.closed) {
				break;
			}

			// JSON encoding preserves line breaks and avoids SSE frame injection by model output.
			if (!res.write(`data: ${JSON.stringify({ text })}\n\n`)) {
				await waitForDrain(res);
			}
		}

		if (!res.writableEnded && !res.closed) {
			res.write('event: done\ndata: {}\n\n');
			res.end();
		}
	} catch (error) {
		if (res.headersSent && !res.writableEnded && !res.closed) {
			res.write(`event: error\ndata: ${JSON.stringify({ message: toPublicErrorMessage(error) })}\n\n`);
			res.end();
			return;
		}

		next(error);
	}
});

function validateReadOnlyQuery(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new RequestValidationError('query deve ser uma string nao vazia.');
	}

	const query = value.trim();
	if (!/^select\b/i.test(query) || /;|--|\/\*|\*\//.test(query)) {
		throw new RequestValidationError('Apenas uma consulta SELECT, sem comentarios ou multiplos comandos, e permitida.');
	}

	return query;
}

function validateExpectedFields(value: unknown): string[] {
	if (!Array.isArray(value) || value.length === 0 || value.some((field) => typeof field !== 'string')) {
		throw new RequestValidationError('expectedFields deve conter ao menos um campo.');
	}

	const fields = [...new Set(value.map((field) => field.trim()))];
	if (fields.some((field) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field))) {
		throw new RequestValidationError('Os campos esperados devem ser identificadores validos.');
	}

	return fields;
}

function validateErpConfiguration(body: ErpConfigurationBody): ErpConfigurationInput {
	if (typeof body.context !== 'string' || !body.context.trim()) {
		throw new RequestValidationError('context deve ser uma string não vazia.');
	}

	if (typeof body.query !== 'string' || !body.query.trim()) {
		throw new RequestValidationError('query deve ser uma string não vazia.');
	}

	if (body.description !== undefined && typeof body.description !== 'string') {
		throw new RequestValidationError('description deve ser uma string.');
	}

	let syncFrequency: 'MINUTES' | 'HOURS' | 'DAILY' | 'MONTHLY' | 'MANUAL' | undefined;
	if (body.syncFrequency !== undefined) {
		const validFrequencies = ['MINUTES', 'HOURS', 'DAILY', 'MONTHLY', 'MANUAL'];
		if (typeof body.syncFrequency !== 'string' || !validFrequencies.includes(body.syncFrequency.toUpperCase())) {
			throw new RequestValidationError('syncFrequency deve ser MINUTES, HOURS, DAILY, MONTHLY ou MANUAL.');
		}
		syncFrequency = body.syncFrequency.toUpperCase() as 'MINUTES' | 'HOURS' | 'DAILY' | 'MONTHLY' | 'MANUAL';
	}

	let syncInterval: number | undefined;
	if (body.syncInterval !== undefined && body.syncInterval !== null) {
		const parsed = Number(body.syncInterval);
		if (Number.isNaN(parsed) || parsed < 1) {
			throw new RequestValidationError('syncInterval deve ser um número maior ou igual a 1.');
		}
		syncInterval = Math.floor(parsed);
	}

	let syncTime: string | undefined;
	if (body.syncTime !== undefined && body.syncTime !== null) {
		if (typeof body.syncTime !== 'string' || !/^\d{1,2}:\d{2}$/.test(body.syncTime.trim())) {
			throw new RequestValidationError('syncTime deve estar no formato HH:mm.');
		}
		syncTime = body.syncTime.trim();
	}

	let syncDayOfMonth: number | undefined;
	if (body.syncDayOfMonth !== undefined && body.syncDayOfMonth !== null) {
		const parsed = Number(body.syncDayOfMonth);
		if (Number.isNaN(parsed) || parsed < 1 || parsed > 31) {
			throw new RequestValidationError('syncDayOfMonth deve ser um número entre 1 e 31.');
		}
		syncDayOfMonth = Math.floor(parsed);
	}

	const syncActive = body.syncActive !== undefined ? Boolean(body.syncActive) : undefined;

	let primaryKey: string | undefined;
	if (body.primaryKey !== undefined && body.primaryKey !== null) {
		if (typeof body.primaryKey !== 'string') {
			throw new RequestValidationError('primaryKey deve ser uma string indicando a coluna PK.');
		}
		primaryKey = body.primaryKey.trim();
	}

	let syncStrategy: 'FULL' | 'HASH_COMPARATOR' | 'INCREMENTAL' | undefined;
	if (body.syncStrategy !== undefined && body.syncStrategy !== null) {
		const s = String(body.syncStrategy).trim().toUpperCase();
		if (s !== 'FULL' && s !== 'HASH_COMPARATOR' && s !== 'INCREMENTAL') {
			throw new RequestValidationError('syncStrategy deve ser FULL ou HASH_COMPARATOR.');
		}
		syncStrategy = (s === 'INCREMENTAL' ? 'HASH_COMPARATOR' : s) as 'FULL' | 'HASH_COMPARATOR';
	}

	let batchSize: number | undefined;
	if (body.batchSize !== undefined && body.batchSize !== null) {
		const parsed = Number(body.batchSize);
		if (Number.isNaN(parsed) || parsed < 1) {
			throw new RequestValidationError('batchSize deve ser um número maior ou igual a 1.');
		}
		batchSize = Math.floor(parsed);
	}

	const lastSyncCursor = typeof body.lastSyncCursor === 'string' ? body.lastSyncCursor.trim() : undefined;
	const activeColumn = typeof body.activeColumn === 'string' ? body.activeColumn.trim() : undefined;
	const activeValue = typeof body.activeValue === 'string' ? body.activeValue.trim() : undefined;

	return {
		context: body.context.trim(),
		description: typeof body.description === 'string' ? body.description.trim() : '',
		query: body.query,
		expectedFields: validateExpectedFields(body.expectedFields),
		primaryKey,
		syncStrategy,
		lastSyncCursor,
		batchSize,
		activeColumn,
		activeValue,
		syncFrequency,
		syncInterval,
		syncTime,
		syncDayOfMonth,
		syncActive,
	};
}

function validateHistory(value: unknown): GeminiMessage[] {
	if (!Array.isArray(value)) {
		throw new RequestValidationError('history deve ser um array de mensagens.');
	}

	return value as GeminiMessage[];
}

function validateSystemPrompt(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new RequestValidationError('systemPrompt deve ser uma string nao vazia.');
	}

	return value;
}

function validateAIConfiguration(body: AiConfigurationInput): AiConfigurationInput {
	if (typeof body.systemPrompt !== 'string' || !body.systemPrompt.trim()) {
		throw new RequestValidationError('systemPrompt deve ser uma string nao vazia.');
	}

	if (typeof body.temperature !== 'number') {
		throw new RequestValidationError('temperature deve ser um numero.');
	}

	if (typeof body.topP !== 'number') {
		throw new RequestValidationError('topP deve ser um numero.');
	}

	if (typeof body.memorySize !== 'number') {
		throw new RequestValidationError('memorySize deve ser um numero.');
	}

	return {
		systemPrompt: body.systemPrompt.trim(),
		temperature: body.temperature,
		topP: body.topP,
		memorySize: body.memorySize,
	};
}

function validateParameters(value: unknown): GeminiParameters {
	if (!isRecord(value) || typeof value.temperature !== 'number' || typeof value.topP !== 'number') {
		throw new RequestValidationError('parameters deve informar temperature e topP numericos.');
	}

	return { temperature: value.temperature, topP: value.topP };
}

function waitForDrain(res: Response): Promise<void> {
	return new Promise((resolve) => {
		const finish = () => {
			res.off('drain', finish);
			res.off('close', finish);
			resolve();
		};

		res.once('drain', finish);
		res.once('close', finish);
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toPublicErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Falha inesperada ao gerar a resposta.';
}

export class RequestValidationError extends Error {
	readonly statusCode = 400;
}

export function apiErrorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
	const statusCode = error instanceof RequestValidationError ? error.statusCode : 500;
	const message = toPublicErrorMessage(error);

	res.status(statusCode).json({ error: message });
}

export default apiRouter;
