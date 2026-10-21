/**
 * Utilitário de Sanitização e Mascaramento de Dados Pessoais (LGPD - Lei nº 13.709/2018)
 * Garante que dados sensíveis e PII (CPF, RG, e-mail, telefone, senhas/tokens)
 * sejam mascarados antes de serem enviados ao provedor LLM externo (Google Gemini) ou logs.
 */

export const REDACTED_LGPD_TOKEN = '[REDACTED_LGPD]';

const SECRET_COLUMN_REGEX = /(^|_)(senha|password|passwd|pwd|hash|salt|token|access_token|refresh_token|secret|client_secret|api_key|apikey|x_token|chave_secreta|chave_acesso|credencial|jwt|private_key)($|_)/i;
const CPF_COLUMN_REGEX = /(^|_)(cpf|nr_cpf|num_cpf|cod_cpf|cpf_cliente|cpf_parceiro|cpf_usuario|cpf_cnpj|cnpj_cpf|cgc_cpf|documento|documento_pessoal)($|_)/i;
const RG_COLUMN_REGEX = /(^|_)(rg|nr_rg|num_rg|identidade|doc_identidade)($|_)/i;
const EMAIL_COLUMN_REGEX = /(^|_)(email|e_mail|ds_email|end_email|endereco_email|correio_eletronico)($|_)/i;
const PHONE_COLUMN_REGEX = /(^|_)(telefone|celular|fone|tel|whatsapp|nr_telefone|nr_celular|num_telefone|num_celular|telemovel)($|_)/i;

// Regex para detecção em texto livre (CPFs com ou sem pontuação, e-mails, telefones e tokens)
const CPF_ANY_FORMAT_REGEX = /\b(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})\b/g;
const EMAIL_TEXT_REGEX = /\b([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g;
const FORMATTED_PHONE_REGEX = /(?:\+?55\s*)?\(?([1-9]\d)\)?[\s.-]*(?:9?\d{4})[\s.-]+(\d{4})\b/g;
const INLINE_SECRET_TEXT_REGEX = /\b(bearer\s+[a-zA-Z0-9_\-.~+/]+=*|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)?)\b/gi;

/**
 * Mascara um CPF mantendo apenas os blocos intermediários: `***.XXX.XXX-**`
 */
export function maskCpf(value: string): string {
	const trimmed = value.trim();

	// Caso contenha exatamente 11 dígitos numéricos (CPF puro ou formatado)
	const digits = trimmed.replace(/\D/g, '');
	if (digits.length === 11 && /^[\d.\-\s]+$/.test(trimmed)) {
		return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
	}

	// Caso seja um texto contendo CPF formatado ou de 11 dígitos embutido
	return trimmed.replace(CPF_ANY_FORMAT_REGEX, '***.$2.$3-**');
}

/**
 * Mascara um RG mantendo apenas dígitos intermediários
 */
export function maskRg(value: string): string {
	const digits = value.replace(/\D/g, '');
	if (digits.length >= 7 && digits.length <= 10) {
		const middle = digits.slice(2, -2);
		return `**.${middle}-*`;
	}
	return '***.***-*';
}

/**
 * Mascara um endereço de e-mail mantendo os primeiros caracteres e o domínio (ex: `ma***@dominio.com.br`)
 */
export function maskEmail(value: string): string {
	return value.replace(EMAIL_TEXT_REGEX, (_match, localPart: string, domain: string) => {
		const visibleChars = localPart.length <= 2 ? localPart.slice(0, 1) : localPart.slice(0, 2);
		return `${visibleChars}***@${domain}`;
	});
}

/**
 * Mascara um telefone/celular mantendo o DDD e os 4 últimos dígitos (ex: `(11) *****-1234`)
 */
export function maskPhone(value: string): string {
	const trimmed = value.trim();
	const digits = trimmed.replace(/\D/g, '');

	// Remove DDI 55 se presente (12 ou 13 dígitos começando com 55)
	const normalizedDigits =
		(digits.length === 12 || digits.length === 13) && digits.startsWith('55')
			? digits.slice(2)
			: digits;

	if (normalizedDigits.length === 10 || normalizedDigits.length === 11) {
		const ddd = normalizedDigits.slice(0, 2);
		const last4 = normalizedDigits.slice(-4);
		return `(${ddd}) *****-${last4}`;
	}

	if (normalizedDigits.length === 8 || normalizedDigits.length === 9) {
		const last4 = normalizedDigits.slice(-4);
		return `(**) *****-${last4}`;
	}

	return trimmed.replace(FORMATTED_PHONE_REGEX, '($1) *****-$2');
}

/**
 * Sanitiza qualquer string livre aplicando mascaramento por regex para CPFs, e-mails, telefones e tokens
 */
export function sanitizeTextForLgpd(text: string): string {
	if (!text) {
		return text;
	}

	return text
		.replace(INLINE_SECRET_TEXT_REGEX, REDACTED_LGPD_TOKEN)
		.replace(CPF_ANY_FORMAT_REGEX, '***.$2.$3-**')
		.replace(EMAIL_TEXT_REGEX, (_match, localPart: string, domain: string) => {
			const visibleChars = localPart.length <= 2 ? localPart.slice(0, 1) : localPart.slice(0, 2);
			return `${visibleChars}***@${domain}`;
		})
		.replace(FORMATTED_PHONE_REGEX, '($1) *****-$2');
}

/**
 * Sanitiza o valor de uma célula considerando o nome da coluna e padrões de texto
 */
export function sanitizeColumnValueForLgpd(columnName: string, value: unknown): unknown {
	if (value === null || value === undefined) {
		return value;
	}

	const normalizedCol = columnName.trim().toLowerCase();

	// 1. Colunas de senhas, hashes, tokens ou chaves secretas -> [REDACTED_LGPD]
	if (SECRET_COLUMN_REGEX.test(normalizedCol)) {
		return REDACTED_LGPD_TOKEN;
	}

	// 2. Colunas de CPF / Documento
	if (CPF_COLUMN_REGEX.test(normalizedCol)) {
		const strVal = String(value);
		const digits = strVal.replace(/\D/g, '');
		if (digits.length === 11 || /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(strVal)) {
			return maskCpf(strVal);
		}
	}

	// 3. Colunas de RG
	if (RG_COLUMN_REGEX.test(normalizedCol)) {
		return maskRg(String(value));
	}

	// 4. Colunas de E-mail
	if (EMAIL_COLUMN_REGEX.test(normalizedCol)) {
		return maskEmail(String(value));
	}

	// 5. Colunas de Telefone / Celular
	if (PHONE_COLUMN_REGEX.test(normalizedCol)) {
		return maskPhone(String(value));
	}

	// 6. Valores textuais genéricos -> varredura por regex (CPF, e-mail, telefone, tokens)
	if (typeof value === 'string') {
		return sanitizeTextForLgpd(value);
	}

	if (Array.isArray(value)) {
		return value.map((item) =>
			typeof item === 'object' && item !== null
				? sanitizeRowForLgpd(item as Record<string, unknown>)
				: sanitizeColumnValueForLgpd(columnName, item),
		);
	}

	if (typeof value === 'object' && !(value instanceof Date)) {
		return sanitizeRowForLgpd(value as Record<string, unknown>);
	}

	return value;
}

/**
 * Sanitiza um único registro (linha) do banco de dados
 */
export function sanitizeRowForLgpd(row: Record<string, unknown>): Record<string, unknown> {
	const sanitized: Record<string, unknown> = {};

	for (const [column, value] of Object.entries(row)) {
		sanitized[column] = sanitizeColumnValueForLgpd(column, value);
	}

	return sanitized;
}

/**
 * Percorre os registros retornados do banco e aplica o mascaramento LGPD
 * tanto pelo nome da coluna quanto por regex nos valores de texto.
 */
export function sanitizeRowsForLgpd(rows: Record<string, unknown>[]): Record<string, unknown>[] {
	if (!Array.isArray(rows) || rows.length === 0) {
		return [];
	}

	return rows.map((row) => {
		if (!row || typeof row !== 'object') {
			return {};
		}
		return sanitizeRowForLgpd(row);
	});
}
