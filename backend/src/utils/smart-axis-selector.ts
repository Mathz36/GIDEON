import { parseNumericValue } from './number-sanitizer';

export interface SmartAxisSelection {
	labelKey: string;
	numericKey: string;
	isTemporal: boolean;
	isCurrency: boolean;
}

const TIME_KEY_REGEX =
	/(^|_)(dia|data|data_emissao|dt|dt_.*|mes|mês|ano|periodo|período|semana|trimestre|date|month|year|day)($|_)/i;

const ID_OR_CODE_KEY_REGEX =
	/^(id|_id|cod|cod_.*|.*_id|codigo|código|nota_fiscal|numero_nota|num_pedido|pedido|pedido_origem|nro|numero|cpf|cnpj|cep)$/i;

const DESCRIPTIVE_LABEL_KEY_REGEX =
	/(nome|razaosocial|razao_social|descricao|descrição|apelido|cliente|parceiro|produto|vendedor|representante|gerente|grupo|subgrupo|operacao|operação|cidade|bairro|uf|rede|ramo|classificacao|tipo|status|name|label|categoria)/i;

const METRIC_KEY_REGEX =
	/(faturamento|valor|vlr|receita|total|liquido|líquido|bruto|preco|preço|ticket|lucro|saldo|limite|custo|quantidade|qtd|volume|peso|contagem|count|value)/i;

const CURRENCY_METRIC_REGEX =
	/(faturamento|valor|vlr|receita|liquido|líquido|bruto|preco|preço|ticket|lucro|saldo|limite|custo|r\$)/i;

const QUANTITY_METRIC_REGEX = /(quantidade|qtd|volume|peso|itens|unidades|contagem|count)/i;

const ISO_DATE_VALUE_REGEX = /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const PTBR_SHORT_DATE_REGEX = /^\d{2}\/\d{2}(?:\/\d{2,4})?$/;
const YEAR_MONTH_REGEX = /^\d{4}-\d{2}$/;

export function isTemporalColumn(key: string, sampleValue?: unknown): boolean {
	const cleanKey = (key || '').trim();
	if (ID_OR_CODE_KEY_REGEX.test(cleanKey)) {
		return false;
	}
	if (TIME_KEY_REGEX.test(cleanKey)) {
		return true;
	}
	if (typeof sampleValue === 'string') {
		const trimmed = sampleValue.trim();
		if (
			ISO_DATE_VALUE_REGEX.test(trimmed) ||
			PTBR_SHORT_DATE_REGEX.test(trimmed) ||
			YEAR_MONTH_REGEX.test(trimmed) ||
			/^Dia\s+\d{1,2}$/i.test(trimmed)
		) {
			return true;
		}
	}
	return false;
}

export function isIdOrCodeColumn(key: string): boolean {
	return ID_OR_CODE_KEY_REGEX.test((key || '').trim());
}

export function isDescriptiveLabelColumn(key: string): boolean {
	const cleanKey = (key || '').trim();
	return !isIdOrCodeColumn(cleanKey) && DESCRIPTIVE_LABEL_KEY_REGEX.test(cleanKey);
}

export function isMetricValueColumn(key: string): boolean {
	const cleanKey = (key || '').trim();
	return !isIdOrCodeColumn(cleanKey) && METRIC_KEY_REGEX.test(cleanKey);
}

export function parseRowNumericValue(val: unknown): number | null {
	if (typeof val === 'string') {
		const trimmed = val.trim();
		if (!trimmed) return null;
		// Não tratar datas ISO ou DD/MM como número
		if (ISO_DATE_VALUE_REGEX.test(trimmed) || PTBR_SHORT_DATE_REGEX.test(trimmed) || YEAR_MONTH_REGEX.test(trimmed)) {
			return null;
		}
	}
	return parseNumericValue(val);
}

/**
 * Seleciona de forma semântica e determinística qual coluna das linhas SQL deve ser o Eixo X (labelKey)
 * e qual deve ser o Eixo Y (numericKey), evitando que códigos de nota fiscal ou IDs virem eixo X/Y indevidamente.
 */
export function selectSmartAxes(
	rows: Record<string, unknown>[],
	widgetType?: string,
	promptOrTitle?: string,
): SmartAxisSelection {
	if (!Array.isArray(rows) || rows.length === 0) {
		return {
			labelKey: 'name',
			numericKey: 'value',
			isTemporal: false,
			isCurrency: false,
		};
	}

	const first = rows[0] ?? {};
	const keys = Object.keys(first);
	if (keys.length === 0) {
		return {
			labelKey: 'name',
			numericKey: 'value',
			isTemporal: false,
			isCurrency: false,
		};
	}

	const isNumericKey = (k: string): boolean => {
		for (let i = 0; i < Math.min(rows.length, 5); i++) {
			const v = rows[i]?.[k];
			if (v !== null && v !== undefined && v !== '') {
				return parseRowNumericValue(v) !== null;
			}
		}
		return false;
	};

	const numericCandidates = keys.filter(isNumericKey);

	// 1. Seleção do Eixo Y (numericKey):
	// Prioridade 1: Coluna de métrica explícita (faturamento, valor_liquido, total, quantidade) que não seja ID nem Data
	// Prioridade 2: Coluna numérica que não seja ID, nem Data, nem Rótulo descritivo
	// Prioridade 3: Última coluna numérica que não seja a primeira coluna (quando houver >1 coluna)
	const numericKey =
		numericCandidates.find((k) => isMetricValueColumn(k) && !isTemporalColumn(k, first[k])) ||
		numericCandidates.find(
			(k) => !isIdOrCodeColumn(k) && !isTemporalColumn(k, first[k]) && !isDescriptiveLabelColumn(k),
		) ||
		numericCandidates.find((k) => k !== keys[0] && !isTemporalColumn(k, first[k])) ||
		numericCandidates[numericCandidates.length - 1] ||
		keys[1] ||
		keys[0];

	// 2. Seleção do Eixo X (labelKey):
	const xCandidates = keys.filter((k) => k !== numericKey);
	const isTimeChart =
		widgetType === 'line' ||
		widgetType === 'area' ||
		Boolean(promptOrTitle && /(evolu[çc][ãa]o|por dia|di[áa]ri[oa]|m[êe]s a m[êe]s|hist[óo]rico|ao longo)/i.test(promptOrTitle));

	let labelKey: string;
	if (isTimeChart) {
		labelKey =
			xCandidates.find((k) => isTemporalColumn(k, first[k])) ||
			xCandidates.find((k) => isDescriptiveLabelColumn(k)) ||
			xCandidates.find((k) => !isIdOrCodeColumn(k)) ||
			xCandidates[0] ||
			keys[0];
	} else {
		// Para barras / rankings / pizza: prioriza nome/descrição/razão social acima de códigos
		labelKey =
			xCandidates.find((k) => isDescriptiveLabelColumn(k)) ||
			xCandidates.find((k) => isTemporalColumn(k, first[k])) ||
			xCandidates.find((k) => !isIdOrCodeColumn(k)) ||
			xCandidates[0] ||
			keys[0];
	}

	const isTemporal = isTemporalColumn(labelKey, first[labelKey]);

	const hasExplicitQuantity = QUANTITY_METRIC_REGEX.test(numericKey);
	const isCurrency =
		!hasExplicitQuantity &&
		(CURRENCY_METRIC_REGEX.test(numericKey) ||
			Boolean(promptOrTitle && CURRENCY_METRIC_REGEX.test(promptOrTitle) && !QUANTITY_METRIC_REGEX.test(promptOrTitle)));

	return {
		labelKey,
		numericKey,
		isTemporal,
		isCurrency,
	};
}

/**
 * Formata o rótulo do Eixo X de forma amigável para gráficos executivos:
 * - Datas ISO ('2026-10-05 00:00:00' ou '2026-10-05') -> '05/10'
 * - Ano-Mês ('2026-10') -> '10/2026'
 * - Coluna 'dia' com número puro ('1', '5', '12') -> 'Dia 01', 'Dia 05', 'Dia 12'
 */
export function formatSmartAxisLabel(rawVal: unknown, labelKey: string): string {
	if (rawVal === null || rawVal === undefined || rawVal === '') {
		return 'Sem identificação';
	}

	if (rawVal instanceof Date && !Number.isNaN(rawVal.getTime())) {
		const day = String(rawVal.getUTCDate()).padStart(2, '0');
		const month = String(rawVal.getUTCMonth() + 1).padStart(2, '0');
		return `${day}/${month}`;
	}

	const str = String(rawVal).trim();
	if (!str) {
		return 'Sem identificação';
	}

	// Caso 1: Timestamp ou Data ISO 'YYYY-MM-DD HH:mm:ss' ou 'YYYY-MM-DD'
	const isoMatch = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]\d{2}:\d{2}(?::\d{2})?.*)?$/.exec(str);
	if (isoMatch) {
		const [, , month, day] = isoMatch;
		return `${day}/${month}`;
	}

	// Caso 2: Ano-Mês 'YYYY-MM'
	const ymMatch = /^(\d{4})-(\d{2})$/.exec(str);
	if (ymMatch) {
		const [, year, month] = ymMatch;
		return `${month}/${year}`;
	}

	// Caso 3: Coluna chamada especificamente 'dia' (ou 'day') com número do dia do mês (1 a 31)
	if (/^(dia|day)$/i.test((labelKey || '').trim()) && /^\d{1,2}$/.test(str)) {
		const dayNum = Number(str);
		if (dayNum >= 1 && dayNum <= 31) {
			return `Dia ${String(dayNum).padStart(2, '0')}`;
		}
	}

	return str;
}
