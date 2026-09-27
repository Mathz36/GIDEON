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

	constructor(config: SankhyaConfig = SankhyaService.getConfigFromEnvironment()) {
		this.config = config;
	}

	/**
	 * Obtém ou renova o token Bearer via OAuth2 (Client Credentials) ou variáveis de ambiente.
	 */
	private async getAccessToken(): Promise<string> {
		if (this.config.apiToken) {
			return this.config.apiToken;
		}

		const now = Date.now();
		if (SankhyaService.tokenCache && SankhyaService.tokenCache.expiresAt > now + 30_000) {
			return SankhyaService.tokenCache.accessToken;
		}

		if (this.config.apiUrl && this.config.clientId && this.config.clientSecret) {
			try {
				const params = new URLSearchParams();
				params.append('grant_type', this.config.grantType ?? 'client_credentials');
				params.append('client_id', this.config.clientId);
				params.append('client_secret', this.config.clientSecret);

				const response = await axios.post<{ access_token: string; expires_in?: number }>(
					this.config.apiUrl,
					params.toString(),
					{
						timeout: 15_000,
						headers: {
							'Content-Type': 'application/x-www-form-urlencoded',
							...(this.config.xToken ? { 'X-Token': this.config.xToken } : {}),
						},
					},
				);

				const token = response.data.access_token;
				if (!token) {
					throw new Error('O serviço de autenticação do Sankhya não retornou access_token.');
				}

				const expiresInSeconds = response.data.expires_in ?? 300;
				SankhyaService.tokenCache = {
					accessToken: token,
					expiresAt: now + expiresInSeconds * 1000,
				};

				return token;
			} catch (error) {
				const details = SankhyaService.getErrorDetails(axios.isAxiosError(error) ? error.response?.data : error);
				throw new Error(`Falha na autenticação OAuth com Sankhya: ${details}`, { cause: error });
			}
		}

		if (this.config.sessionSecret) {
			return this.config.sessionSecret;
		}

		throw new Error('Credenciais de autenticação da Sankhya não configuradas (CLIENT_ID / CLIENT_SECRET).');
	}

	/**
	 * Executa uma consulta SQL no DbExplorer do Sankhya e formata os dados para as colunas esperadas.
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

		const token = await this.getAccessToken();

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
				throw error;
			}

			const axiosError = error as AxiosError<unknown>;
			const status = axiosError.response?.status;
			const details = SankhyaService.getErrorDetails(axiosError.response?.data);
			const suffix = status ? ` (HTTP ${status})` : '';

			throw new Error(`Falha na requisicao ao dbexplorer da Sankhya${suffix}: ${details}`, {
				cause: error,
			});
		}
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
