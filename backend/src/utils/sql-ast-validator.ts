/**
 * Camadas 1 e 3 de Blindagem Determinística (Metodologia "Competente o Suficiente" - Fábio Akita)
 *
 * Responsabilidades:
 * 1. Guardrail Determinístico de Escopo Fechado (Fail-Fast):
 *    Detecta perguntas sobre métricas financeiras/contábeis inexistentes no esquema sincronizado
 *    (ex: Lucro Líquido, Margem de Contribuição, CMV, Contas a Pagar, Inadimplência, Impostos)
 *    antes que o LLM tente "aproximar" usando `valor_liquido` da nota fiscal.
 * 2. Validador e Auto-Sanitizador Determinístico de AST/SQL Pré-Execução:
 *    Inspeciona e repara a query SQL gerada antes de enviá-la ao PostgreSQL:
 *    - Envolve colunas numéricas armazenadas como TEXT (`valor_liquido`, `valor_bruto`, `quantidade`, `peso`)
 *      em `CAST(... AS NUMERIC)` dentro de `SUM`, `AVG`, `MIN`, `MAX`.
 *    - Corrige `ORDER BY` lexicográfico (alfabético) em colunas numéricas não agrupadas.
 *    - Impõe a invariante de negócio `operacao = 'VENDAS'` em consultas de faturamento/vendas
 *      sobre `erp_nota_fiscal` quando omitida pela LLM.
 */

export interface OutOfScopeDetectionResult {
	outOfScope: boolean;
	unsupportedConcept?: string;
	reasonCode?: string;
	explanation?: string;
}

export interface SqlAstSanitizationResult {
	sql: string;
	wasModified: boolean;
	appliedFixes: string[];
}

interface OutOfScopeRule {
	code: string;
	conceptLabel: string;
	/** Expressões ou radicais na pergunta que acionam a verificação */
	questionTriggers: RegExp[];
	/** Exceções na pergunta que indicam métrica válida (ex: "faturamento líquido", "valor líquido da nota") */
	validQuestionExceptions?: RegExp[];
	/** Radicais de nomes de colunas que, se existirem no schema do tenant, tornam a métrica suportada */
	requiredColumnPatterns: string[];
	explanation: string;
}

const OUT_OF_SCOPE_RULES: OutOfScopeRule[] = [
	{
		code: 'UNSUPPORTED_PROFIT_OR_COST_METRIC',
		conceptLabel: 'Lucro Líquido, Margem de Lucro, CMV ou Custos',
		questionTriggers: [
			/\blucro\b/i,
			/\blucratividade\b/i,
			/\bmargem\s+de\s+lucro\b/i,
			/\bmargem\s+bruta\b/i,
			/\bmargem\s+liquida\b/i,
			/\bmargem\s+de\s+contribuicao\b/i,
			/\bcmv\b/i,
			/\bcusto\s+d[aeo]s?\s+(mercadoria|produto|venda)/i,
			/\bebitda\b/i,
			/\brentabilidade\b/i,
		],
		validQuestionExceptions: [
			/\bfaturamento\s+liquido\b/i,
			/\bvalor\s+liquido\b/i,
			/\breceita\s+liquida\b/i,
			/\bvenda[s]?\s+liquida[s]?\b/i,
		],
		requiredColumnPatterns: ['lucro', 'margem', 'cmv', 'custo', 'ebitda'],
		explanation:
			'O esquema sincronizado do ERP contém dados de **Faturamento Bruto e Valor Líquido de Notas Fiscais** (`valor_bruto` e `valor_liquido`), mas **não possui colunas de Custo de Mercadoria Vendida (CMV), Despesas Operacionais ou Margem de Lucro**. Por segurança e precisão contábil, a Gideon não confunde *Valor Líquido da Nota Fiscal* (faturamento após descontos comerciais) com *Lucro Líquido*.',
	},
	{
		code: 'UNSUPPORTED_ACCOUNTS_PAYABLE_OR_EXPENSES',
		conceptLabel: 'Contas a Pagar, Despesas Operacionais ou Folha Salarial',
		questionTriggers: [
			/\bcontas?\s+a\s+pagar\b/i,
			/\bdespesas?\s+(operacionais|fixas|administrativas|gerais)\b/i,
			/\bfolha\s+(de\s+pagamento|salarial)\b/i,
			/\bsalarios?\s+dos\s+funcionarios\b/i,
			/\bpagamento\s+de\s+fornecedores\b/i,
		],
		requiredColumnPatterns: ['pagar', 'despesa', 'fornecedor', 'salario', 'folha'],
		explanation:
			'O banco de dados sincronizado atualmente contempla o módulo comercial (**Notas Fiscais, Clientes, Vendedores e Produtos**), não possuindo tabelas sincronizadas de **Contas a Pagar, Fornecedores ou Despesas Operacionais**.',
	},
	{
		code: 'UNSUPPORTED_DELINQUENCY_OR_RECEIVABLES_STATUS',
		conceptLabel: 'Inadimplência, Boletos Vencidos ou Títulos em Atraso',
		questionTriggers: [
			/\binadimplen(cia|tes?)\b/i,
			/\bboletos?\s+(vencidos?|em\s+aberto|atrasados?)\b/i,
			/\btitulos?\s+(vencidos?|em\s+atraso|em\s+aberto)\b/i,
			/\bclientes?\s+devedores\b/i,
			/\bcontas?\s+a\s+receber\s+(vencidas?|em\s+atraso)\b/i,
		],
		requiredColumnPatterns: ['inadimpl', 'vencimento', 'boleto', 'atraso', 'status_pagamento', 'quitado'],
		explanation:
			'O esquema atual registra a emissão das **Notas Fiscais (`erp_nota_fiscal`)**, mas não possui colunas de baixa financeira, data de vencimento de boletos ou status de inadimplência de títulos.',
	},
	{
		code: 'UNSUPPORTED_TAX_ACCOUNTING_METRIC',
		conceptLabel: 'Apuração de Impostos e Tributos (ICMS, PIS, COFINS, IPI)',
		questionTriggers: [
			/\bicms\b/i,
			/\bpis\b/i,
			/\bcofins\b/i,
			/\bipi\b/i,
			/\bimpostos?\s+(pagos?|recolhidos?|sobre\s+vendas)\b/i,
			/\bcarga\s+tributaria\b/i,
		],
		requiredColumnPatterns: ['icms', 'pis', 'cofins', 'ipi', 'imposto', 'tributo', 'aliquota'],
		explanation:
			'As tabelas sincronizadas possuem o `valor_bruto` e o `valor_liquido` das notas fiscais, mas não contêm o detalhamento contábil de alíquotas e tributos individuais (**ICMS, PIS, COFINS, IPI**).',
	},
];

const KNOWN_TEXT_NUMERIC_COLUMNS = new Set([
	'valor_liquido',
	'valor_bruto',
	'quantidade',
	'peso',
	'vlrnota',
	'vlrunit',
	'vlrdesc',
]);

/**
 * Camada 1: Detecta deterministamente se o usuário está pedindo uma métrica financeira/contábil
 * que não existe nas colunas sincronizadas do tenant (Fail-Fast / Design by Contract).
 */
export function detectOutOfScopeBusinessMetric(
	question: string,
	availableColumns: string[],
): OutOfScopeDetectionResult {
	if (!question || !question.trim()) {
		return { outOfScope: false };
	}

	const normalizedQuestion = question
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();

	const normalizedCols = (availableColumns || []).map((c) =>
		c
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase(),
	);

	for (const rule of OUT_OF_SCOPE_RULES) {
		const triggered = rule.questionTriggers.some((regex) => regex.test(normalizedQuestion));
		if (!triggered) {
			continue;
		}

		// Se a pergunta menciona explicitamente uma exceção válida (ex: "faturamento líquido") e não pede "lucro" ou "cmv", permite
		if (rule.validQuestionExceptions?.some((ex) => ex.test(normalizedQuestion))) {
			const hasExplicitUnsupportedTerm = /\b(lucro|cmv|ebitda|custo)\b/i.test(normalizedQuestion);
			if (!hasExplicitUnsupportedTerm) {
				continue;
			}
		}

		// Verifica se o tenant sincronizou alguma coluna que suporte essa métrica
		const hasSupportingColumn = normalizedCols.some((colName) =>
			rule.requiredColumnPatterns.some((pattern) => colName.includes(pattern)),
		);

		if (!hasSupportingColumn) {
			return {
				outOfScope: true,
				unsupportedConcept: rule.conceptLabel,
				reasonCode: rule.code,
				explanation: rule.explanation,
			};
		}
	}

	return { outOfScope: false };
}

/**
 * Camada 3: Inspeciona e repara deterministicamente a árvore sintática SQL antes da execução no PostgreSQL.
 */
export function sanitizeAndValidateGeneratedSql(
	sql: string,
	question: string,
): SqlAstSanitizationResult {
	if (!sql || !sql.trim()) {
		return { sql, wasModified: false, appliedFixes: [] };
	}

	let sanitized = sql.trim();
	const appliedFixes: string[] = [];

	const normQuestion = (question || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();

	// 0. Regra de Negócio: Padrão = Valor Líquido (só usa valor_bruto quando o usuário pedir explicitamente "bruto"/"bruta")
	const explicitlyAsksForBruto = /\bbrut[oa]s?\b/i.test(normQuestion);
	const hasBothLiquidoAndBruto =
		/\bvalor_liquido\b/i.test(sanitized) && /\bvalor_bruto\b/i.test(sanitized);

	if (!explicitlyAsksForBruto && !hasBothLiquidoAndBruto && /\bvalor_bruto\b/i.test(sanitized)) {
		sanitized = sanitized.replace(/\bvalor_bruto\b/gi, 'valor_liquido');
		appliedFixes.push(
			'Regra de negócio aplicada: valor_bruto convertido para valor_liquido (usuário não solicitou valor bruto explicitamente)',
		);
	}

	// 1. Auto-Wrap de colunas numéricas TEXT dentro de funções de agregação: SUM(col), AVG(col), MIN(col), MAX(col)
	const aggRegex = /\b(SUM|AVG|MIN|MAX)\s*\(\s*(DISTINCT\s+)?([a-zA-Z0-9_."]+)\s*\)/gi;
	sanitized = sanitized.replace(aggRegex, (fullMatch, funcName: string, distinctPart: string | undefined, colExpr: string) => {
		const rawColName = extractBaseColumnName(colExpr);
		if (KNOWN_TEXT_NUMERIC_COLUMNS.has(rawColName)) {
			const distinctPrefix = distinctPart ? `${distinctPart}` : '';
			const fixed = `${funcName.toUpperCase()}(${distinctPrefix}CAST(${colExpr} AS NUMERIC))`;
			appliedFixes.push(`Auto-CAST em agregação: ${fullMatch} -> ${fixed}`);
			return fixed;
		}
		return fullMatch;
	});

	// 2. Auto-CAST em ORDER BY de colunas numéricas brutas (evita ordenação ASCII onde '1000' < '200')
	// Apenas quando a query NÃO possui GROUP BY (ou quando a coluna no ORDER BY é qualificada por tabela e não é um alias já numérico)
	const hasGroupBy = /\bGROUP\s+BY\b/i.test(sanitized);
	const numericAliasesInSelect = extractNumericSelectAliases(sanitized);

	const orderByRegex = /(\bORDER\s+BY\s+)([^;\n]+?)(\s+LIMIT\b|\s+OFFSET\b|$)/i;
	const orderByMatch = sanitized.match(orderByRegex);
	if (orderByMatch) {
		const prefix = orderByMatch[1];
		const orderExpressions = orderByMatch[2];
		const suffix = orderByMatch[3] || '';

		const parts = splitTopLevelCommas(orderExpressions);
		let orderModified = false;

		const fixedParts = parts.map((part) => {
			const trimmedPart = part.trim();
			// Ignora se já possui CAST, ::, ou chamada de função como SUM(...), MIN(...)
			if (/\bCAST\s*\(/i.test(trimmedPart) || /::/.test(trimmedPart) || /\w+\s*\(/.test(trimmedPart)) {
				return part;
			}

			const termMatch = trimmedPart.match(/^([a-zA-Z0-9_."]+)(\s+(?:ASC|DESC))?(\s+NULLS\s+(?:FIRST|LAST))?$/i);
			if (!termMatch) {
				return part;
			}

			const colIdentifier = termMatch[1];
			const direction = termMatch[2] || '';
			const nullsClause = termMatch[3] || '';
			const baseCol = extractBaseColumnName(colIdentifier);
			const isTableQualified = colIdentifier.includes('.');

			if (KNOWN_TEXT_NUMERIC_COLUMNS.has(baseCol)) {
				// Se não há GROUP BY e o identificador não é um alias já convertido com CAST no SELECT (ou é qualificado por tabela), aplica CAST
				if (!hasGroupBy && (!numericAliasesInSelect.has(baseCol) || isTableQualified)) {
					orderModified = true;
					const replacement = `CAST(${colIdentifier} AS NUMERIC)${direction}${nullsClause}`;
					appliedFixes.push(`Auto-CAST em ORDER BY: ${trimmedPart} -> ${replacement}`);
					return replacement;
				}
			}

			return part;
		});

		if (orderModified) {
			sanitized = sanitized.replace(orderByRegex, `${prefix}${fixedParts.join(', ')}${suffix}`);
		}
	}

	// 3. Invariante de Negócio em erp_nota_fiscal:
	//    - Garante filtro operacao = 'VENDAS' (ou IN ('VENDAS', 'DEVOLUÇÃO DE VENDAS')) quando omitido
	//    - Quando a pergunta pede "faturamento" / "quanto faturou" com SUM(CAST(valor_liquido AS NUMERIC)),
	//      aplica a regra: Faturamento = Valor Líquido (VENDAS) - Valor Líquido (DEVOLUÇÃO DE VENDAS)
	if (shouldEnforceVendasOperationFilter(sanitized, question)) {
		const injected = injectVendasOperationFilter(sanitized);
		if (injected !== sanitized) {
			sanitized = injected;
			appliedFixes.push(`Invariante de negócio aplicada: filtro operacao = 'VENDAS' injetado em erp_nota_fiscal`);
		}
	}

	if (shouldEnforceNetBillingMinusReturns(sanitized, normQuestion)) {
		const netAdjusted = upgradeToNetBillingMinusReturns(sanitized);
		if (netAdjusted !== sanitized) {
			sanitized = netAdjusted;
			appliedFixes.push(
				`Regra de Faturamento Líquido aplicada: Valor Líquido (VENDAS) - Devolução Líquida (DEVOLUÇÃO DE VENDAS)`,
			);
		}
	}

	return {
		sql: sanitized,
		wasModified: appliedFixes.length > 0,
		appliedFixes,
	};
}

function extractBaseColumnName(identifier: string): string {
	const parts = identifier.replace(/"/g, '').trim().split('.');
	return (parts[parts.length - 1] || '').toLowerCase();
}

function extractNumericSelectAliases(sql: string): Set<string> {
	const aliases = new Set<string>();
	const selectMatch = sql.match(/\bSELECT\s+([\s\S]+?)\bFROM\b/i);
	if (!selectMatch) return aliases;

	const selectBody = selectMatch[1];
	const aliasRegex = /(?:CAST\s*\([\s\S]+?AS\s+NUMERIC\s*\)|::\s*numeric)\s*(?:\)\s*)*AS\s+"?([a-zA-Z0-9_]+)"?/gi;
	let match: RegExpExecArray | null;
	while ((match = aliasRegex.exec(selectBody)) !== null) {
		aliases.add(match[1].toLowerCase());
	}
	return aliases;
}

function splitTopLevelCommas(input: string): string[] {
	const result: string[] = [];
	let current = '';
	let depth = 0;

	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (ch === '(') depth++;
		else if (ch === ')' && depth > 0) depth--;

		if (ch === ',' && depth === 0) {
			result.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	if (current.trim()) {
		result.push(current);
	}
	return result;
}

function shouldEnforceVendasOperationFilter(sql: string, question: string): boolean {
	// Só aplica se a query consultar erp_nota_fiscal
	if (!/\berp_nota_fiscal\b/i.test(sql)) {
		return false;
	}

	// Se a query já filtra ou agrupa por operacao ou tipo_movimento, respeita a query gerada
	if (/\boperacao\b/i.test(sql) || /\btipo_movimento\b/i.test(sql)) {
		return false;
	}

	const normQ = (question || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();

	// Se o usuário pediu devolução, bonificação, troca, entrada, todas as notas ou operações, NÃO força 'VENDAS'
	if (/\b(devoluc|devolv|bonific|brind|troc|operac|moviment|entrad|remess|todas\s+as\s+notas)\w*/i.test(normQ)) {
		return false;
	}

	// Se o usuário perguntou sobre vendas, faturamento, receita, ticket médio, ranking de clientes/vendedores ou evolução
	const asksForSalesOrRevenue =
		/\b(fatur|vend|receit|ticket|maior|melhor|top|ranking|evoluc|diari|mensal|compr)\w*/i.test(normQ);

	return asksForSalesOrRevenue;
}

function injectVendasOperationFilter(sql: string): string {
	// Descobre se erp_nota_fiscal possui um alias (ex: FROM "erp_nota_fiscal" nf ou JOIN erp_nota_fiscal AS nf)
	const aliasMatch = sql.match(
		/\b(?:FROM|JOIN)\s+"?erp_nota_fiscal"?(?:\s+AS)?\s+([a-zA-Z0-9_]+)\b/i,
	);
	const reservedSqlWords = new Set([
		'where', 'group', 'order', 'limit', 'inner', 'left', 'right', 'full', 'join', 'on', 'having', 'union', 'offset',
	]);

	let aliasPrefix = '';
	if (aliasMatch && aliasMatch[1] && !reservedSqlWords.has(aliasMatch[1].toLowerCase())) {
		aliasPrefix = `${aliasMatch[1]}.`;
	}

	const condition = `${aliasPrefix}operacao = 'VENDAS'`;

	// Caso 1: Já existe cláusula WHERE no nível principal
	if (/\bWHERE\b/i.test(sql)) {
		return sql.replace(/\bWHERE\b/i, `WHERE ${condition} AND`);
	}

	// Caso 2: Não existe WHERE, mas existe GROUP BY, ORDER BY ou LIMIT
	const clauseAnchor = sql.match(/\b(GROUP\s+BY|ORDER\s+BY|LIMIT)\b/i);
	if (clauseAnchor && clauseAnchor.index !== undefined) {
		const before = sql.slice(0, clauseAnchor.index).trimEnd();
		const after = sql.slice(clauseAnchor.index);
		return `${before} WHERE ${condition} ${after}`;
	}

	// Caso 3: Query simples sem WHERE, GROUP BY, ORDER BY ou LIMIT
	return `${sql.replace(/;+\s*$/, '')} WHERE ${condition}`;
}

function shouldEnforceNetBillingMinusReturns(sql: string, normQuestion: string): boolean {
	if (!/\berp_nota_fiscal\b/i.test(sql)) {
		return false;
	}
	// Se a query já trata DEVOLUÇÃO DE VENDAS ou já possui CASE WHEN na soma, não modifica
	if (/DEVOLU[ÇC][ÃA]O\s+DE\s+VENDAS/i.test(sql) || /\bSUM\s*\(\s*CASE\b/i.test(sql)) {
		return false;
	}
	// Se a query consulta simultaneamente múltiplas métricas brutas/líquidas em testes de agregação simples, preserva
	if (/\bAVG\s*\(/i.test(sql) && /\bMAX\s*\(/i.test(sql)) {
		return false;
	}
	// Só aplica quando há SUM(CAST(...valor_liquido... AS NUMERIC)) e a pergunta pede faturamento / quanto faturou
	const hasSumValor = /\bSUM\s*\(\s*CAST\s*\(\s*[a-zA-Z0-9_."]*valor_(?:liquido|bruto)\s+AS\s+NUMERIC\s*\)\s*\)/i.test(sql);
	const asksForBilling = /\b(fatur|faturou|faturamento)\w*/i.test(normQuestion);
	const asksForBonificacaoOrDevolucaoOnly = /\b(bonific|brind|troc)\w*/i.test(normQuestion);

	return hasSumValor && asksForBilling && !asksForBonificacaoOrDevolucaoOnly;
}

function upgradeToNetBillingMinusReturns(sql: string): string {
	const aliasMatch = sql.match(
		/\b(?:FROM|JOIN)\s+"?erp_nota_fiscal"?(?:\s+AS)?\s+([a-zA-Z0-9_]+)\b/i,
	);
	const reservedSqlWords = new Set([
		'where', 'group', 'order', 'limit', 'inner', 'left', 'right', 'full', 'join', 'on', 'having', 'union', 'offset',
	]);

	let aliasPrefix = '';
	if (aliasMatch && aliasMatch[1] && !reservedSqlWords.has(aliasMatch[1].toLowerCase())) {
		aliasPrefix = `${aliasMatch[1]}.`;
	}

	const opCol = `${aliasPrefix}operacao`;

	// 1. Converte SUM(CAST(col AS NUMERIC)) para SUM(CASE WHEN operacao = 'VENDAS' THEN ... WHEN operacao = 'DEVOLUÇÃO DE VENDAS' THEN -... ELSE 0 END)
	let updated = sql.replace(
		/\bSUM\s*\(\s*CAST\s*\(\s*([a-zA-Z0-9_."]*valor_(?:liquido|bruto))\s+AS\s+NUMERIC\s*\)\s*\)/gi,
		(_full, colIdentifier: string) =>
			`SUM(CASE WHEN ${opCol} = 'VENDAS' THEN CAST(${colIdentifier} AS NUMERIC) WHEN ${opCol} = 'DEVOLUÇÃO DE VENDAS' THEN -CAST(${colIdentifier} AS NUMERIC) ELSE 0 END)`,
	);

	// 2. Converte WHERE operacao = 'VENDAS' para WHERE operacao IN ('VENDAS', 'DEVOLUÇÃO DE VENDAS')
	updated = updated.replace(
		new RegExp(`\\b(${aliasPrefix.replace('.', '\\.')}?operacao)\\s*=\\s*'VENDAS'`, 'gi'),
		`$1 IN ('VENDAS', 'DEVOLUÇÃO DE VENDAS')`,
	);

	return updated;
}
