/**
 * Extrai automaticamente os nomes/aliases das colunas projetadas na cláusula SELECT principal
 * de uma query SQL (Oracle / PostgreSQL / SQL Server), respeitando parênteses (ex: SUM(...), TO_CHAR(...), CASE ... END).
 */
export function extractSqlSelectAliases(query: string): string[] {
	if (!query || typeof query !== 'string') {
		return [];
	}

	// Remove comentários de linha (--) e de bloco (/* */)
	const withoutComments = query
		.replace(/--[^\r\n]*/g, ' ')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.trim();

	if (!withoutComments) {
		return [];
	}

	// Localiza o primeiro SELECT de nível superior e o FROM correspondente de nível 0
	const selectMatch = /^\s*SELECT\b(?:\s+DISTINCT\b)?/i.exec(withoutComments);
	if (!selectMatch) {
		return [];
	}

	const startIdx = selectMatch[0].length;
	let depth = 0;
	let inSingleQuote = false;
	let fromIdx = -1;

	for (let i = startIdx; i < withoutComments.length; i++) {
		const ch = withoutComments[i];

		if (ch === "'") {
			if (inSingleQuote && withoutComments[i + 1] === "'") {
				i += 1;
				continue;
			}
			inSingleQuote = !inSingleQuote;
			continue;
		}

		if (inSingleQuote) continue;

		if (ch === '(') {
			depth += 1;
		} else if (ch === ')') {
			depth = Math.max(0, depth - 1);
		} else if (depth === 0) {
			// Verifica se encontrou a palavra reservada FROM em nível 0
			const prevChar = i > 0 ? withoutComments[i - 1] : ' ';
			if (/[\s)]/.test(prevChar) && /^FROM\b/i.test(withoutComments.slice(i))) {
				fromIdx = i;
				break;
			}
		}
	}

	if (fromIdx === -1) {
		return [];
	}

	const selectClause = withoutComments.slice(startIdx, fromIdx).trim();
	if (!selectClause) {
		return [];
	}

	// Divide pelos separadores ',' de nível 0 (fora de parênteses e de strings)
	const items: string[] = [];
	let current = '';
	depth = 0;
	inSingleQuote = false;

	for (let i = 0; i < selectClause.length; i++) {
		const ch = selectClause[i];

		if (ch === "'") {
			current += ch;
			if (inSingleQuote && selectClause[i + 1] === "'") {
				current += selectClause[i + 1];
				i += 1;
				continue;
			}
			inSingleQuote = !inSingleQuote;
			continue;
		}

		if (!inSingleQuote) {
			if (ch === '(') {
				depth += 1;
			} else if (ch === ')') {
				depth = Math.max(0, depth - 1);
			} else if (ch === ',' && depth === 0) {
				items.push(current.trim());
				current = '';
				continue;
			}
		}

		current += ch;
	}

	if (current.trim()) {
		items.push(current.trim());
	}

	const aliases: string[] = [];
	const seenUpper = new Set<string>();
	const reservedEndTokens = new Set(['END', 'NULL', 'TRUE', 'FALSE', 'DISTINCT', 'ALL', 'ASC', 'DESC']);

	for (const item of items) {
		if (!item || item === '*' || /\.\*\s*$/.test(item)) {
			continue;
		}

		// 1. Tenta extrair alias explícito: ... AS NOME_COLUNA
		const explicitAsMatch = /\bAS\s+["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*$/i.exec(item);
		if (explicitAsMatch && explicitAsMatch[1]) {
			const alias = explicitAsMatch[1].trim().toUpperCase();
			if (!seenUpper.has(alias)) {
				seenUpper.add(alias);
				aliases.push(alias);
			}
			continue;
		}

		// 2. Expressão simples sem AS (ex: NF.DATA_EMISSAO ou CODPROD)
		const simpleColMatch = /^(?:[A-Za-z_][A-Za-z0-9_]*\.)?["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*$/i.exec(item);
		if (simpleColMatch && simpleColMatch[1]) {
			const col = simpleColMatch[1].trim().toUpperCase();
			if (!reservedEndTokens.has(col) && !seenUpper.has(col)) {
				seenUpper.add(col);
				aliases.push(col);
			}
		}
	}

	return aliases;
}

/**
 * Mescla os campos esperados informados manualmente com todos os aliases extraídos da query SQL,
 * garantindo que nenhuma coluna selecionada na query (como DATA_EMISSAO ou VALOR_LIQUIDO) seja omitida.
 */
export function mergeExpectedFieldsWithQueryAliases(
	query: string,
	expectedFields: string[] = [],
): string[] {
	const cleanExpected = (expectedFields ?? []).map((f) => f.trim()).filter(Boolean);
	const extractedFromSql = extractSqlSelectAliases(query);

	const merged: string[] = [];
	const seenUpper = new Set<string>();

	for (const field of cleanExpected) {
		const upper = field.toUpperCase();
		if (!seenUpper.has(upper)) {
			seenUpper.add(upper);
			merged.push(field);
		}
	}

	for (const sqlAlias of extractedFromSql) {
		const upper = sqlAlias.toUpperCase();
		if (!seenUpper.has(upper)) {
			seenUpper.add(upper);
			merged.push(sqlAlias);
		}
	}

	return merged;
}
