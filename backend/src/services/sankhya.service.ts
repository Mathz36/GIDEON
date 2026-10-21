import axios, { AxiosError } from 'axios';

type Primitive = string | number | boolean | null;
export type SankhyaRow = Record<string, Primitive | undefined>;

interface SankhyaConfig {
	apiUrl?: string;
	dbExplorerUrl: string;
	xToken?: string;
	apiToken?: string;
	clientId?: string;
	clientSecret?: string;
	grantType?: string;
	sessionSecret?: string;
	username?: string;
	password?: string;
}

interface SankhyaTokenCache {
	accessToken: string;
	expiresAt: number;
}

interface FieldMeta {
	name: string;
	description?: string;
	order?: number;
}

interface SankhyaResponseBody {
	fieldsMetadata?: FieldMeta[];
	rows?: unknown[];
}

interface SankhyaResponse {
	serviceName?: string;
	status?: string | number;
	statusMessage?: string;
	responseBody?: SankhyaResponseBody;
	data?: unknown;
	result?: unknown;
	results?: unknown;
	rows?: unknown;
	items?: unknown;
}

export class SankhyaService {
	private readonly config: SankhyaConfig;
	private static tokenCache: SankhyaTokenCache | null = null;
	private static tokenRefreshPromise: Promise<string> | null = null;

	private static readonly MAX_RETRIES = 3;
	private static readonly BASE_BACKOFF_MS = 300;
	private static readonly MAX_BACKOFF_MS = 4_000;
	private static readonly RETRYABLE_HTTP_STATUS = new Set([429, 502, 503, 504]);
	private static readonly RETRYABLE_ERROR_CODES = new Set([
		'ECONNRESET',
		'ETIMEDOUT',
		'ECONNABORTED',
		'ENOTFOUND',
		'EAI_AGAIN',
		'EPIPE',
		'SOCKET_HANG_UP',
	]);

	constructor(config: SankhyaConfig = SankhyaService.getConfigFromEnvironment()) {
		this.config = config;
	}

	/**
	 * Invalida explicitamente o cache de token em memória.
	 */
	public static invalidateTokenCache(): void {
		SankhyaService.tokenCache = null;
	}

	/**
	 * Obtém ou renova o token Bearer via OAuth2 (Client Credentials) com padrão Single-Flight (Promise Lock):
	 * se múltiplas chamadas concorrentes detectarem que o token expirou, apenas 1 requisição HTTP de renovação
	 * é disparada à API do Sankhya, e todas as demais aguardam a mesma Promise em voo.
	 */
	private async getAccessToken(forceRefresh: boolean = false): Promise<string> {
		if (this.config.apiToken) {
			return this.config.apiToken;
		}

		if (forceRefresh) {
			SankhyaService.tokenCache = null;
		}

		const now = Date.now();
		if (
			!forceRefresh &&
			SankhyaService.tokenCache &&
			SankhyaService.tokenCache.expiresAt > now + 30_000
		) {
			return SankhyaService.tokenCache.accessToken;
		}

		if (SankhyaService.tokenRefreshPromise) {
			return SankhyaService.tokenRefreshPromise;
		}

		if (this.config.apiUrl && this.config.clientId && this.config.clientSecret) {
			const refreshTask = this.requestOAuthTokenWithRetry().finally(() => {
				if (SankhyaService.tokenRefreshPromise === refreshTask) {
					SankhyaService.tokenRefreshPromise = null;
				}
			});

			SankhyaService.tokenRefreshPromise = refreshTask;
			return refreshTask;
		}

		if (this.config.sessionSecret) {
			return this.config.sessionSecret;
		}

		throw new Error('Credenciais de autenticação da Sankhya não configuradas (CLIENT_ID / CLIENT_SECRET).');
	}

	/**
	 * Realiza a chamada OAuth2 com retry exponencial + jitter para falhas transitórias de rede.
	 */
	private async requestOAuthTokenWithRetry(): Promise<string> {
		const apiUrl = this.config.apiUrl!;
		const params = new URLSearchParams();
		params.append('grant_type', this.config.grantType ?? 'client_credentials');
		params.append('client_id', this.config.clientId!);
		params.append('client_secret', this.config.clientSecret!);

		let attempt = 0;

		while (true) {
			try {
				const requestTime = Date.now();
				const response = await axios.post<{ access_token: string; expires_in?: number }>(
					apiUrl,
					params.toString(),
					{
						timeout: 15_000,
						headers: {
							'Content-Type': 'application/x-www-form-urlencoded',
							...(this.config.xToken ? { 'X-Token': this.config.xToken } : {}),
						},
					},
				);

				const token = response.data?.access_token;
				if (!token) {
					throw new Error('O serviço de autenticação do Sankhya não retornou access_token.');
				}

				const expiresInSeconds = Number(response.data?.expires_in) || 300;
				SankhyaService.tokenCache = {
					accessToken: token,
					expiresAt: requestTime + expiresInSeconds * 1000,
				};

				return token;
			} catch (error: unknown) {
				if (attempt < SankhyaService.MAX_RETRIES && SankhyaService.isTransientError(error)) {
					attempt += 1;
					const delayMs = SankhyaService.calculateBackoffWithJitter(attempt);
					console.warn(
						`[SankhyaService] Falha transitória na autenticação OAuth (tentativa ${attempt}/${SankhyaService.MAX_RETRIES}). Retentando em ${delayMs}ms...`,
					);
					await SankhyaService.sleep(delayMs);
					continue;
				}

				const rawDetails = SankhyaService.getErrorDetails(
					axios.isAxiosError(error) ? error.response?.data : error,
				);
				const safeDetails = this.sanitizeSensitiveData(rawDetails);
				throw new Error(`Falha na autenticação OAuth com Sankhya: ${safeDetails}`);
			}
		}
	}

	/**
	 * Executa uma consulta SQL no DbExplorer do Sankhya e formata os dados para as colunas esperadas.
	 * Conta com:
	 * - Reconexão automática em caso de 401 Unauthorized (invalida o token e renova uma única vez via Single-Flight).
	 * - Retry automático com Exponential Backoff + Jitter para erros transitórios (429, 502, 503, 504, ECONNRESET, ETIMEDOUT).
	 */
	async executeQuery(query: string, expectedFields: string[]): Promise<SankhyaRow[]> {
		const normalizedQuery = query.trim();
		const fields = [...new Set(expectedFields.map((field) => field.trim()).filter(Boolean))];

		if (!normalizedQuery) {
			throw new Error('A query do Sankhya não pode ser vazia.');
		}

		if (fields.length === 0) {
			throw new Error('Informe ao menos um campo esperado para a consulta do Sankhya.');
		}

		let token = await this.getAccessToken(false);
		let hasRetriedAuth = false;
		let transientAttempt = 0;

		while (true) {
			try {
				const response = await axios.post<unknown>(
					this.config.dbExplorerUrl,
					{
						requestBody: {
							sql: normalizedQuery,
						},
					},
					{
						timeout: 30_000,
						headers: {
							Accept: 'application/json',
							'Content-Type': 'application/json',
							Authorization: `Bearer ${token}`,
							...(this.config.xToken ? { 'X-Token': this.config.xToken } : {}),
						},
					},
				);

				return SankhyaService.mapResponse(response.data, fields);
			} catch (error: unknown) {
				if (error instanceof Error && !axios.isAxiosError(error)) {
					throw new Error(this.sanitizeSensitiveData(error.message));
				}

				const axiosError = error as AxiosError<unknown>;
				const status = axiosError.response?.status;

				// Reconexão automática em 401 Unauthorized (apenas 1 vez por chamada)
				if (status === 401 && !hasRetriedAuth && !this.config.apiToken) {
					hasRetriedAuth = true;
					console.warn(
						'[SankhyaService] Recebido HTTP 401 Unauthorized do Sankhya. Invalidando token em cache e renovando sessão (Single-Flight)...',
					);
					token = await this.getAccessToken(true);
					continue;
				}

				// Retry com Exponential Backoff + Jitter para falhas transitórias de rede / rate limit / gateway
				if (
					transientAttempt < SankhyaService.MAX_RETRIES &&
					SankhyaService.isTransientError(axiosError)
				) {
					transientAttempt += 1;
					const delayMs = SankhyaService.calculateBackoffWithJitter(transientAttempt);
					console.warn(
						`[SankhyaService] Falha transitória na consulta ao DbExplorer (${status ? `HTTP ${status}` : axiosError.code ?? 'Network Error'}). Tentativa ${transientAttempt}/${SankhyaService.MAX_RETRIES} em ${delayMs}ms...`,
					);
					await SankhyaService.sleep(delayMs);
					continue;
				}

				const rawDetails = SankhyaService.getErrorDetails(axiosError.response?.data);
				const safeDetails = this.sanitizeSensitiveData(rawDetails);
				const suffix = status ? ` (HTTP ${status})` : '';

				throw new Error(`Falha na requisicao ao dbexplorer da Sankhya${suffix}: ${safeDetails}`);
			}
		}
	}

	/**
	 * Verifica se o erro é transitório (429, 502, 503, 504 ou falha de socket/timeout).
	 */
	private static isTransientError(error: unknown): boolean {
		if (!axios.isAxiosError(error)) {
			return false;
		}

		const status = error.response?.status;
		if (status !== undefined && SankhyaService.RETRYABLE_HTTP_STATUS.has(status)) {
			return true;
		}

		const code = error.code?.toUpperCase();
		if (code && SankhyaService.RETRYABLE_ERROR_CODES.has(code)) {
			return true;
		}

		const msg = (error.message || '').toUpperCase();
		if (
			msg.includes('ECONNRESET') ||
			msg.includes('ETIMEDOUT') ||
			msg.includes('SOCKET HANG UP') ||
			msg.includes('TIMEOUT OF')
		) {
			return true;
		}

		return false;
	}

	/**
	 * Calcula delay de Exponential Backoff com Full/Equal Jitter.
	 */
	private static calculateBackoffWithJitter(attempt: number): number {
		const exponential = Math.min(
			SankhyaService.MAX_BACKOFF_MS,
			SankhyaService.BASE_BACKOFF_MS * Math.pow(2, attempt - 1),
		);
		const jitter = Math.floor(Math.random() * 150);
		return exponential + jitter;
	}

	private static sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Remove qualquer vazamento acidental de segredos (clientSecret, password, tokens) em mensagens de erro ou logs.
	 */
	private sanitizeSensitiveData(input: string): string {
		if (!input) return input;

		let sanitized = input.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');

		const secretsToRedact = [
			this.config.clientSecret,
			this.config.password,
			this.config.apiToken,
			this.config.sessionSecret,
			this.config.xToken,
			SankhyaService.tokenCache?.accessToken,
		];

		for (const secret of secretsToRedact) {
			if (secret && secret.trim().length >= 4) {
				sanitized = sanitized.split(secret).join('[REDACTED]');
			}
		}

		return sanitized;
	}

	private static getConfigFromEnvironment(): SankhyaConfig {
		const dbExplorerUrl = process.env.SANKHYA_SERVICE_URL ?? process.env.SANKHYA_DBEXPLORER_URL;

		if (!dbExplorerUrl) {
			throw new Error('A variável SANKHYA_SERVICE_URL não foi configurada.');
		}

		return {
			apiUrl: process.env.SANKHYA_API_URL,
			dbExplorerUrl,
			xToken: process.env.SANKHYA_X_TOKEN,
			apiToken: process.env.SANKHYA_API_TOKEN,
			clientId: process.env.CLIENT_ID,
			clientSecret: process.env.CLIENT_SECRET,
			grantType: process.env.grant_type ?? 'client_credentials',
			sessionSecret: process.env.SESSION_SECRET,
			username: process.env.SANKHYA_USERNAME,
			password: process.env.SANKHYA_PASSWORD,
		};
	}

	private static mapResponse(payload: unknown, expectedFields: string[]): SankhyaRow[] {
		if (!SankhyaService.isObject(payload)) {
			throw new Error('A resposta do dbexplorer possui um formato inesperado.');
		}

		const resp = payload as SankhyaResponse;

		// Verifica se o Sankhya retornou status de erro
		if (resp.status !== undefined && String(resp.status) === '0') {
			throw new Error(resp.statusMessage || 'Erro na execução da consulta SQL no Sankhya.');
		}

		const rows = SankhyaService.extractRows(resp);

		return rows.map((row) => {
			const cleanRow: SankhyaRow = {};

			expectedFields.forEach((field) => {
				const sourceKey = Object.keys(row).find((key) => key.toLowerCase() === field.toLowerCase());
				cleanRow[field] = sourceKey ? SankhyaService.toPrimitive(row[sourceKey]) : undefined;
			});

			return cleanRow;
		});
	}

	private static extractRows(response: SankhyaResponse): Record<string, unknown>[] {
		// Formato padrão do DbExplorerSP: responseBody.rows = [[val1, val2], ...] e fieldsMetadata = [{name: 'COL1'}, ...]
		if (response.responseBody && Array.isArray(response.responseBody.rows)) {
			const rows = response.responseBody.rows;
			const fieldsMeta = response.responseBody.fieldsMetadata ?? [];

			return rows.map((item) => {
				if (Array.isArray(item)) {
					const obj: Record<string, unknown> = {};
					item.forEach((val, idx) => {
						const colName = fieldsMeta[idx]?.name ?? `col_${idx}`;
						obj[colName] = val;
					});
					return obj;
				}

				if (SankhyaService.isObject(item)) {
					return item;
				}

				return {};
			});
		}

		const candidates = [response.data, response.result, response.results, response.rows, response.items];
		const directList = candidates.find(Array.isArray);

		if (Array.isArray(directList)) {
			return directList.filter(SankhyaService.isObject);
		}

		return [];
	}

	private static isObject(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}

	private static toPrimitive(value: unknown): Primitive | undefined {
		if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			return value;
		}

		return value === undefined ? undefined : String(value);
	}

	private static getErrorDetails(payload: unknown): string {
		if (typeof payload === 'string' && payload.trim()) {
			return payload;
		}

		if (SankhyaService.isObject(payload)) {
			const errorObj = payload.error as Record<string, unknown> | undefined;
			if (errorObj && typeof errorObj.descricao === 'string') {
				return errorObj.descricao;
			}

			const message = payload.statusMessage ?? payload.message ?? payload.error ?? payload.mensagem;
			if (typeof message === 'string' && message.trim()) {
				return message;
			}
		}

		return 'resposta sem detalhes';
	}
}

export default SankhyaService;
