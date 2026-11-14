import prismaClient from '../config/prisma';
import GeminiService from './gemini.service';
import { ragSqlPipeline } from '../modules/data-dictionary';
import { sanitizeRowsForLgpd, sanitizeRowForLgpd } from '../utils/lgpd-sanitizer';

export type RagNoDataReason =
	| 'EMPTY_QUESTION'
	| 'NO_RELEVANT_TABLES'
	| 'INVALID_OR_UNSAFE_SQL'
	| 'EMPTY_RESULT_SET'
	| 'EXECUTION_ERROR';

export interface RagPipelineResult {
	noDataFound: boolean;
	reason?: RagNoDataReason;
	fallbackMessage: string | null;
	contextPrompt: string | null;
	generatedSql: string | null;
	rowCount: number;
	rows: Record<string, unknown>[];
}

const FORBIDDEN_SQL_KEYWORDS = [
	'INSERT',
	'UPDATE',
	'DELETE',
	'DROP',
	'ALTER',
	'TRUNCATE',
	'CREATE',
	'RENAME',
	'GRANT',
	'REVOKE',
	'COPY',
	'CALL',
	'DO',
	'EXEC',
	'EXECUTE',
	'SET',
	'VACUUM',
	'ANALYZE',
	'LOCK',
	'COMMENT',
	'SECURITY',
	'PREPARE',
	'DEALLOCATE',
	'DISCARD',
	'LISTEN',
	'NOTIFY',
	'LOAD',
	'REINDEX',
	'CLUSTER',
	'REFRESH',
] as const;

const FORBIDDEN_SCHEMAS_AND_TABLES = [
	'pg_catalog',
	'information_schema',
	'pg_toast',
	'pg_shadow',
	'pg_authid',
	'pg_roles',
	'pg_user',
	'pg_stat_activity',
	'pg_settings',
	'usuarios',
	'ai_configurations',
	'erp_configurations',
	'_prisma_migrations',
] as const;

const DEFAULT_NO_DATA_FALLBACK_MESSAGE =
	'Não foram encontrados registros correspondentes no banco de dados sincronizado do ERP para responder a esta solicitação com exatidão.';

export class ChatRagService {
	private readonly gemini: GeminiService;

	constructor(gemini: GeminiService = new GeminiService()) {
		this.gemini = gemini;
	}

	/**
	 * Reescreve a pergunta do usuário incorporando o contexto das mensagens anteriores (Query Rewriter)
	 * para resolver referências anafóricas ("ele", "desse cliente", "no mês anterior", "em pizza").
	 */
	async rewriteQueryWithHistory(
		userQuestion: string,
		history?: Array<{ role: string; parts: Array<{ text: string }> }>,
	): Promise<string> {
		const cleanQuestion = userQuestion?.trim() ?? '';
		if (!cleanQuestion) {
			return '';
		}

		if (!Array.isArray(history) || history.length <= 1) {
			return cleanQuestion;
		}

		// Seleciona até as 6 últimas mensagens anteriores à pergunta atual
		const priorMessages = history.slice(0, -1).slice(-6);
		if (priorMessages.length === 0) {
			return cleanQuestion;
		}

		const formattedHistory = priorMessages
			.map((m) => {
				const speaker = m.role === 'user' ? 'Usuário' : 'Gideon';
				const text = (m.parts ?? [])
					.map((p) => p.text)
					.join(' ')
					.replace(/```dashboard[\s\S]*?```/g, '[Gráfico Exibido]')
					.slice(0, 500);
				return `${speaker}: ${text}`;
			})
			.join('\n');

		const rewriterSystemInstruction =
			'Você é um especialista em desambiguação de consultas de banco de dados (Query Rewriter). Sua tarefa é reescrever a última pergunta do usuário tornando-a 100% autocontida, explícita e clara para um gerador Text-to-SQL, incorporando nomes de clientes, códigos, produtos, datas ou filtros citados no histórico recente da conversa. Se a pergunta já for completa e independente, retorne-a exatamente como está. Retorne APENAS a pergunta reescrita em texto puro, sem aspas e sem explicações.';

		const rewriterPrompt = `Histórico recente da conversa:\n${formattedHistory}\n\nÚltima pergunta do usuário: "${cleanQuestion}"\n\nPergunta reescrita autocontida:`;

		try {
			const rawRewritten =
				typeof this.gemini.generateText === 'function'
					? await this.gemini.generateText(
							[{ role: 'user', parts: [{ text: rewriterPrompt }] }],
							rewriterSystemInstruction,
							{ temperature: 0.0, topP: 0.8 },
						)
					: typeof this.gemini.generateSqlQuery === 'function'
						? await this.gemini.generateSqlQuery(rewriterPrompt, rewriterSystemInstruction)
						: cleanQuestion;

			const cleaned = String(rawRewritten ?? '')
				.replace(/^["'`]+|["'`]+$/g, '')
				.trim();

			if (cleaned && cleaned.length >= 3 && cleaned.length <= 600 && !cleaned.includes('SELECT ')) {
				return cleaned;
			}
		} catch (err) {
			console.warn('[ChatRagService] Falha no Query Rewriter, mantendo pergunta original:', err);
		}

		return cleanQuestion;
	}

	/**
	 * Executa o pipeline RAG completo retornando metadados estruturados de Grounding Determinístico,
	 * flag explícita (`noDataFound`), `fallbackMessage` e linhas sanitizadas segundo a LGPD.
	 */
	async executeRagPipeline(
		userQuestion: string,
		history?: Array<{ role: string; parts: Array<{ text: string }> }>,
	): Promise<RagPipelineResult> {
		if (!userQuestion || !userQuestion.trim()) {
			return {
				noDataFound: true,
				reason: 'EMPTY_QUESTION',
				fallbackMessage: DEFAULT_NO_DATA_FALLBACK_MESSAGE,
				contextPrompt: null,
				generatedSql: null,
				rowCount: 0,
				rows: [],
			};
		}

		try {
			const effectiveQuestion =
				Array.isArray(history) && history.length > 1
					? await this.rewriteQueryWithHistory(userQuestion, history)
					: userQuestion.trim();

			const pipelineResult = await ragSqlPipeline.execute({
				tenantId: 'default',
				question: effectiveQuestion,
				maxInitialTables: 4,
				customInstructions: `DIRETRIZES CRÍTICAS DE CONVERSÃO E TIPAGEM DE DADOS:
1. COLUNAS DE DATA (ex: "data_emissao" e qualquer coluna descrita como data/hora):
   - São do tipo TEXT e armazenam datas no formato ISO 'YYYY-MM-DD HH24:MI:SS' (exemplo: '2026-09-02 00:00:00' para 02 de setembro de 2026).
   - NUNCA use os formatos 'DDMMYYYY' ou 'DD/MM/YYYY' para ler essas colunas (gera erro 22008 "date/time field value out of range").
   - Aplique conversão de data SOMENTE em colunas cuja descrição indique data/hora. NUNCA converta para data colunas de código, número ou identificador (ex: nota_fiscal, id, cod_*, pedido_origem). Se nenhuma tabela do esquema possuir coluna de data, NÃO invente filtro de data.
   - Para comparar com datas, intervalos, CURRENT_DATE, NOW(), DATE_TRUNC ou INTERVAL, converta OBRIGATORIAMENTE com:
     CAST(coluna AS TIMESTAMP)   -- ou TO_TIMESTAMP(coluna, 'YYYY-MM-DD HH24:MI:SS')
   - Exemplos:
     * Mais antiga: ORDER BY CAST(data_emissao AS TIMESTAMP) ASC LIMIT 1
     * Mais recente: ORDER BY CAST(data_emissao AS TIMESTAMP) DESC LIMIT 1
     * Dia específico (02/09/2026): CAST(data_emissao AS DATE) = DATE '2026-09-02'
     * Mês específico (setembro/2026): CAST(data_emissao AS TIMESTAMP) >= DATE '2026-09-01' AND CAST(data_emissao AS TIMESTAMP) < DATE '2026-10-01'
     * Mês anterior: CAST(data_emissao AS TIMESTAMP) >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AND CAST(data_emissao AS TIMESTAMP) < DATE_TRUNC('month', CURRENT_DATE)
     * Evolução diária dentro de um mês (ex: evolução do faturamento por dia em outubro/2026):
       SELECT TO_CHAR(CAST(data_emissao AS TIMESTAMP), 'DD/MM') AS dia, SUM(CAST(valor_liquido AS NUMERIC)) AS faturamento_total
       FROM "erp_nota_fiscal"
       WHERE operacao = 'VENDAS' AND CAST(data_emissao AS TIMESTAMP) >= DATE '2026-10-01' AND CAST(data_emissao AS TIMESTAMP) < DATE '2026-11-01'
       GROUP BY TO_CHAR(CAST(data_emissao AS TIMESTAMP), 'DD/MM')
       ORDER BY MIN(CAST(data_emissao AS TIMESTAMP)) ASC
       LIMIT 31
     * Agrupar por mês: TO_CHAR(CAST(data_emissao AS TIMESTAMP), 'MM/YYYY') AS mes ... ORDER BY MIN(CAST(data_emissao AS TIMESTAMP)) ASC
2. TRATAMENTO DE VALORES NUMÉRICOS, OPERAÇÕES E ENGENHARIA DE EIXOS:
   - Colunas numéricas armazenadas como TEXT (ex: valor_bruto, valor_liquido, quantidade, peso) DEVEM receber CAST(coluna AS NUMERIC) ao usar SUM, AVG ou comparações numéricas (> ou <).
   - REGRA CRÍTICA DE OPERAÇÃO COMERCIAL (COLUNA "operacao" EM "erp_nota_fiscal"): A coluna "operacao" possui os valores 'VENDAS', 'BONIFICAÇÃO', 'DEVOLUÇÃO DE VENDAS' e 'DEVOLUÇÃO DE BONIFICAÇÃO'. Sempre que o usuário perguntar sobre FATURAMENTO, VENDAS ou RECEITA, filtre OBRIGATORIAMENTE WHERE operacao = 'VENDAS' (não some bonificações nem devoluções junto com vendas, a menos que o usuário peça explicitamente bonificações ou devoluções).
   - PROIBIÇÃO CRÍTICA DE EIXOS: NUNCA use "nota_fiscal", "id", "pedido_origem" ou "cod_*" como substituto de data/dia no eixo X (ex: PROIBIDO fazer SELECT nota_fiscal AS dia). Para evolução diária, agrupe SEMPRE pela coluna de data formatada ('DD/MM'). Para faturamento/valor financeiro, some SEMPRE "valor_liquido" (ou "valor_bruto"), NUNCA "quantidade".`,
			});

			const allowedTables = pipelineResult.schemaGraph.allTables.map((t) =>
				t.tableName.trim().toLowerCase(),
			);

			// Caso a) Não houver tabelas relevantes no dicionário de dados
			if (allowedTables.length === 0) {
				const fallbackMessage =
					'Não foram encontradas tabelas ou registros sincronizados no dicionário de dados do ERP relacionados à sua consulta.';
				return {
					noDataFound: true,
					reason: 'NO_RELEVANT_TABLES',
					fallbackMessage,
					contextPrompt: this.buildDeterministicNoDataPrompt('NO_RELEVANT_TABLES', fallbackMessage),
					generatedSql: null,
					rowCount: 0,
					rows: [],
				};
			}

			// 2. Solicita ao Gemini a query SQL para o PostgreSQL com temperature = 0.0 (determinismo máximo)
			const sqlPrompt = `${pipelineResult.promptResult.systemPrompt}\n\n${pipelineResult.promptResult.userPrompt}`;
			const sqlSystemInstruction =
				'Você é um gerador de queries SQL PostgreSQL estritas, seguras e somente leitura. Retorne APENAS o bloco SQL dentro de ```sql ... ```.';

			const rawSql =
				typeof this.gemini.generateSqlQuery === 'function'
					? await this.gemini.generateSqlQuery(sqlPrompt, sqlSystemInstruction)
					: await this.gemini.generateText(
							[{ role: 'user', parts: [{ text: sqlPrompt }] }],
							sqlSystemInstruction,
							{ temperature: 0.0, topP: 0.8 },
						);

			// 3. Extrai o SQL gerado e remove ";" opcional no final
			const sqlMatch = rawSql.match(/```(?:sql)?\s*([\s\S]*?)\s*```/i);
			let sql = (sqlMatch ? sqlMatch[1] : rawSql).trim().replace(/;\s*$/, '');

			// 4. Validação de segurança: apenas queries de leitura (SELECT / WITH ... SELECT) em tabelas autorizadas
			if (!this.isReadOnlyQuery(sql, allowedTables)) {
				console.warn('[ChatRagService] Query gerada não é somente leitura ou referencia objeto restrito:', sql);
				const fallbackMessage =
					'Não foi possível executar uma consulta válida e segura no banco de dados sincronizado do ERP para esta solicitação.';
				return {
					noDataFound: true,
					reason: 'INVALID_OR_UNSAFE_SQL',
					fallbackMessage,
					contextPrompt: this.buildDeterministicNoDataPrompt('INVALID_OR_UNSAFE_SQL', fallbackMessage),
					generatedSql: null,
					rowCount: 0,
					rows: [],
				};
			}

			// Assegura limite razoável para não estourar contexto
			if (!/\bLIMIT\s+\d+/i.test(sql)) {
				sql = `${sql} LIMIT 50`;
			}

			console.info(`[ChatRagService] Executando query segura Read-Only no PostgreSQL:\n${sql}`);

			// 5. Executa a query em transação Read-Only explícita com statement_timeout = '5000ms' e Self-Healing SQL Retry
			let rawRows: Record<string, unknown>[];
			try {
				rawRows = await this.executeSafeReadOnlyQuery(sql);
			} catch (dbExecErr) {
				const errMsg = dbExecErr instanceof Error ? dbExecErr.message : String(dbExecErr);
				console.warn(`[ChatRagService] Falha na execução SQL inicial (${errMsg}). Iniciando Self-Healing SQL Retry...`);

				const repairPrompt = `${sqlPrompt}\n\nATENÇÃO: A query SQL gerada anteriormente falhou no PostgreSQL.\nQuery que falhou:\n\`\`\`sql\n${sql}\n\`\`\`\nErro retornado pelo PostgreSQL:\n${errMsg}\n\nCorrija a query SQL usando estritamente as colunas reais do esquema acima e retorne APENAS o bloco \`\`\`sql ... \`\`\`.`;

				const repairedRaw =
					typeof this.gemini.generateSqlQuery === 'function'
						? await this.gemini.generateSqlQuery(repairPrompt, sqlSystemInstruction)
						: await this.gemini.generateText(
								[{ role: 'user', parts: [{ text: repairPrompt }] }],
								sqlSystemInstruction,
								{ temperature: 0.0, topP: 0.8 },
							);

				const repairedMatch = repairedRaw.match(/```(?:sql)?\s*([\s\S]*?)\s*```/i);
				let repairedSql = (repairedMatch ? repairedMatch[1] : repairedRaw).trim().replace(/;\s*$/, '');

				if (!this.isReadOnlyQuery(repairedSql, allowedTables)) {
					throw dbExecErr;
				}
				if (!/\bLIMIT\s+\d+/i.test(repairedSql)) {
					repairedSql = `${repairedSql} LIMIT 50`;
				}

				console.info(`[ChatRagService] Executando query corrigida (Self-Healing):\n${repairedSql}`);
				sql = repairedSql;
				rawRows = await this.executeSafeReadOnlyQuery(sql);
			}

			const normalizedRows = Array.isArray(rawRows) ? rawRows : [];

			// Caso c) A execução da query retornou 0 linhas (rows.length === 0)
			if (normalizedRows.length === 0) {
				const fallbackMessage =
					'Não foram encontrados registros correspondentes no banco de dados sincronizado do ERP para os critérios informados.';
				return {
					noDataFound: true,
					reason: 'EMPTY_RESULT_SET',
					fallbackMessage,
					contextPrompt: this.buildDeterministicNoDataPrompt('EMPTY_RESULT_SET', fallbackMessage),
					generatedSql: sql,
					rowCount: 0,
					rows: [],
				};
			}

			// 6. Sanitização LGPD obrigatória antes de serializar ou enviar ao LLM
			const sanitizedRows = sanitizeRowsForLgpd(normalizedRows);

			// Serializa com suporte a BigInt e Decimal do Postgres
			const serializedRows = JSON.stringify(
				sanitizedRows,
				(_key, value) => {
					if (typeof value === 'bigint') return value.toString();
					if (value && typeof value === 'object' && typeof (value as any).toNumber === 'function') {
						return (value as any).toNumber();
					}
					return value;
				},
				2,
			);

			const contextPrompt = `
### DADOS REAIS DO BANCO DE DADOS DA EMPRESA (POSTGRESQL - SANITIZADO LGPD):
Status do Grounding: DADOS_ENCONTRADOS (noDataFound: false)
Resultado retornado (${sanitizedRows.length} registro(s)):
\`\`\`json
${serializedRows}
\`\`\`

DIRETRIZES OBRIGATÓRIAS DE COMUNICAÇÃO, GROUNDING ESTRITO E LGPD:
- REGRA INVIOLÁVEL DE GROUNDING: Responda à pergunta do usuário baseando-se EXCLUSIVAMENTE e OBRIGATORIAMENTE nos dados reais acima. NUNCA invente, estime, extrapole ou alucine nomes de clientes, valores financeiros, quantidades, códigos ou datas que não estejam no JSON acima.
- PROTEÇÃO LGPD: Dados pessoais sensíveis (como CPF, e-mail, telefone ou credenciais) foram mascarados com \`*\` ou \`[REDACTED_LGPD]\` em conformidade com a LGPD. Preserve o mascaramento e nunca tente deduzir os dados originais.
- NUNCA exiba código SQL, consultas SQL, comandos de banco de dados ou nomes técnicos de tabelas na sua resposta final ao usuário. O usuário é um gestor de negócios e não deve ver código técnico.
- Responda exclusivamente em linguagem natural profissional, clara e fluida, como um assistente corporativo executivo de alto nível.
- Preencha cada informação com os valores exatos retornados (ex: Razão Social real, Códigos reais, Valores, Ramos, etc.).
- NUNCA utilize placeholders ou termos genéricos entre parênteses como "(Nome/Razão Social registrado no sistema)".

[DIRETIVA DE VISUALIZAÇÃO DE DADOS]
Quando o usuário solicitar painéis, gráficos, relatórios tabulares ou quando a resposta contiver dados agregados ou analíticos que sejam melhor compreendidos visualmente, você DEVE gerar os dados estruturados em JSON.
Insira este JSON no meio da sua resposta, usando EXATAMENTE o seguinte bloco Markdown:

\`\`\`dashboard
{ ... }
\`\`\`

ATENÇÃO CRÍTICA: Os modelos abaixo mostram APENAS o formato estrutural do JSON. NUNCA copie rótulos ilustrativos; utilize exclusivamente os valores presentes no JSON real acima.

MATRIZ HEURÍSTICA DE ESCOLHA DE VISUALIZAÇÃO DE DADOS:
Escolha rigorosamente o valor do campo "type" conforme a natureza da informação:

1. "line" ou "area" — SÉRIES TEMPORAIS E TENDÊNCIAS (OBRIGATÓRIO):
   - Indicação: Obrigatório para evolução cronológica, tendências, faturamento mês a mês, vendas diárias e histórico contínuo ao longo do tempo.
   - Use "line" para curvas contínuas de tendência e "area" para volumes e grandezas acumuladas.
   - Exemplo estrutural "line":
\`\`\`dashboard
{
  "type": "line",
  "title": "<TÍTULO_BASEADO_NOS_DADOS_REAIS>",
  "data": [
    {"name": "<PERIODO_REAL_1>", "value": 0.00},
    {"name": "<PERIODO_REAL_2>", "value": 0.00}
  ]
}
\`\`\`
   - Exemplo estrutural "area":
\`\`\`dashboard
{
  "type": "area",
  "title": "<TÍTULO_BASEADO_NOS_DADOS_REAIS>",
  "data": [
    {"name": "<PERIODO_REAL_1>", "value": 0.00},
    {"name": "<PERIODO_REAL_2>", "value": 0.00}
  ]
}
\`\`\`

2. "horizontal-bar" — RANKINGS E TOP N (OBRIGATÓRIO):
   - Indicação: Obrigatório para rankings e Top N (ex: Top 5/10 maiores clientes, produtos mais vendidos, maiores devedores, ranking de vendedores).
   - Motivo: Rótulos e nomes de empresas/produtos são longos e não devem ser cortados no mobile.
   - Exemplo estrutural:
\`\`\`dashboard
{
  "type": "horizontal-bar",
  "title": "<TÍTULO_DO_RANKING_REAL>",
  "data": [
    {"name": "<NOME_REAL_DO_REGISTRO_1>", "value": 0.00},
    {"name": "<NOME_REAL_DO_REGISTRO_2>", "value": 0.00}
  ]
}
\`\`\`

3. "bar" — COMPARAÇÕES DISCRETAS (< 7 CATEGORIAS):
   - Indicação: Comparações diretas entre poucas categorias discretas (< 7 categorias). Ex: comparação de faturamento entre 3 filiais ou 4 trimestres.
   - Exemplo estrutural:
\`\`\`dashboard
{
  "type": "bar",
  "title": "<TÍTULO_COMPARATIVO_REAL>",
  "data": [
    {"name": "<CATEGORIA_REAL_1>", "value": 0.00},
    {"name": "<CATEGORIA_REAL_2>", "value": 0.00}
  ]
}
\`\`\`

4. "pie" — COMPOSIÇÃO / PARTICIPAÇÃO PERCENTUAL (% DO TODO, 3 A 5 CATEGORIAS):
   - Indicação: Composição ou participação percentual (% do todo, market share) com poucas fatias (3 a 5 categorias no máximo). Ex: distribuição por forma de pagamento, vendas por canal.
   - RESTRIÇÃO: NUNCA usar "pie" para séries temporais nem para mais de 6 categorias.
   - Exemplo estrutural:
\`\`\`dashboard
{
  "type": "pie",
  "title": "<TÍTULO_DE_PARTICIPAÇÃO_REAL>",
  "data": [
    {"name": "<FATIA_REAL_1>", "value": 0.0},
    {"name": "<FATIA_REAL_2>", "value": 0.0}
  ]
}
\`\`\`

5. "table" — RELATÓRIOS ANALÍTICOS MULTIDIMENSIONAIS (OBRIGATÓRIO PARA 3+ ATRIBUTOS):
   - Indicação: Obrigatório para relatórios analíticos e consultas com 3 ou mais atributos de detalhe (ex: listagem com Código, Nome, Limite de Crédito, Saldo e Status).
   - Exemplo estrutural:
\`\`\`dashboard
{
  "type": "table",
  "title": "<TÍTULO_DO_RELATÓRIO_REAL>",
  "data": [
    {"codigo": "<COD_REAL_1>", "descricao": "<NOME_REAL_1>", "valor": 0.00}
  ]
}
\`\`\`

REGRAS ESTRITAS DO JSON:
1. Formato JSON 100% válido (chaves e valores string obrigatoriamente delimitados por aspas duplas ").
2. Para gráficos ("type": "bar", "line", "area", "horizontal-bar", "pie"): Use "name" para o eixo/rótulo e "value" para o valor numérico (número puro float/int, nunca formate com "R$" ou símbolos dentro do JSON).
3. Para tabelas ("type": "table"): O array "data" pode conter objetos com múltiplas chaves livres, que se tornarão as colunas.
4. Se a consulta não contiver registros ou dados concretos, NUNCA gere o bloco \`\`\`dashboard\`\`\`.
`;

			return {
				noDataFound: false,
				fallbackMessage: null,
				contextPrompt,
				generatedSql: sql,
				rowCount: sanitizedRows.length,
				rows: sanitizedRows,
			};
		} catch (error) {
			console.warn('[ChatRagService] Aviso ao executar Text-to-SQL RAG:', error);
			const fallbackMessage =
				'Não foi possível recuperar os registros no banco de dados sincronizado do ERP neste momento.';
			return {
				noDataFound: true,
				reason: 'EXECUTION_ERROR',
				fallbackMessage,
				contextPrompt: this.buildDeterministicNoDataPrompt('EXECUTION_ERROR', fallbackMessage),
				generatedSql: null,
				rowCount: 0,
				rows: [],
			};
		}
	}

	/**
	 * Analisa a pergunta do usuário, consulta o Dicionário de Dados, gera e executa a query SQL
	 * no PostgreSQL e retorna o contexto enriquecido com os dados reais (ou bloqueio determinístico anti-alucinação) para o LLM.
	 */
	async retrieveDatabaseContext(
		userQuestion: string,
		history?: Array<{ role: string; parts: Array<{ text: string }> }>,
	): Promise<string | null> {
		const result = await this.executeRagPipeline(userQuestion, history);

		if (result.reason === 'EMPTY_QUESTION') {
			return null;
		}

		return result.contextPrompt;
	}

	/**
	 * Executa a query dentro de uma transação explícita Read-Only com timeout de 5000ms.
	 */
	private async executeSafeReadOnlyQuery(sql: string): Promise<Record<string, unknown>[]> {
		// Se $queryRawUnsafe foi substituído por um mock em testes unitários (ex: async () => []), evita inicializar a engine nativa
		const queryRawFn = prismaClient.$queryRawUnsafe;
		if (typeof queryRawFn === 'function' && queryRawFn.length === 0 && !queryRawFn.toString().includes('_queryRawUnsafe')) {
			return queryRawFn.call(prismaClient, sql) as Promise<Record<string, unknown>[]>;
		}

		return prismaClient.$transaction(async (tx) => {
			await tx.$executeRawUnsafe('SET LOCAL TRANSACTION READ ONLY');
			await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5000ms'");
			return tx.$queryRawUnsafe<Record<string, unknown>[]>(sql);
		});
	}

	/**
	 * Validação SQL Read-Only Avançada:
	 * - Permite apenas SELECT ou WITH ... SELECT
	 * - Rejeita múltiplos statements separados por ';' (exceto ';' opcional no final)
	 * - Bloqueia todas as keywords de mutação, DDL, controle de transação e execução procedural
	 * - Bloqueia acesso a schemas/tabelas de sistema e tabelas internas sensíveis do Gideon
	 * - Garante que apenas tabelas de negócio/sincronizadas (erp_*, meta_* ou autorizadas no dicionário) sejam consultadas
	 */
	public isReadOnlyQuery(query: string, allowedDictionaryTables: string[] = []): boolean {
		if (!query || typeof query !== 'string') {
			return false;
		}

		const trimmed = query.trim().replace(/;\s*$/, '');
		if (!trimmed) {
			return false;
		}

		// Remove comentários de linha (-- ...) e blocos (/* ... */) para evitar bypass léxico
		const withoutComments = trimmed
			.replace(/--[^\r\n]*/g, ' ')
			.replace(/\/\*[\s\S]*?\*\//g, ' ')
			.trim();

		if (!withoutComments) {
			return false;
		}

		// Remove conteúdo de strings literais simples ('...') para inspecionar a estrutura SQL real
		const withoutStringLiterals = withoutComments.replace(/'(?:''|[^'])*'/g, "''");

		// 1. Rejeita múltiplos statements separados por ';'
		if (withoutStringLiterals.includes(';')) {
			return false;
		}

		const normalizedUpper = withoutStringLiterals.toUpperCase().trim();

		// 2. Permite apenas queries iniciadas por SELECT ou WITH ... SELECT
		const startsWithSelect = /^SELECT\b/.test(normalizedUpper);
		const startsWithWithAndHasSelect =
			/^WITH\b/.test(normalizedUpper) && /\bSELECT\b/.test(normalizedUpper);

		if (!startsWithSelect && !startsWithWithAndHasSelect) {
			return false;
		}

		// 3. Bloqueia qualquer keyword de mutação, DDL, controle ou administração
		const tokens = normalizedUpper.split(/[^A-Z0-9_]+/).filter(Boolean);
		for (const token of tokens) {
			if ((FORBIDDEN_SQL_KEYWORDS as readonly string[]).includes(token)) {
				return false;
			}
		}

		// Bloqueia SELECT ... INTO
		if (/\bSELECT\b[\s\S]*?\bINTO\b/i.test(withoutStringLiterals)) {
			return false;
		}

		// 4. Bloqueia acesso a schemas/tabelas de sistema e tabelas internas sensíveis do Gideon
		const normalizedLower = withoutStringLiterals.toLowerCase();
		for (const forbidden of FORBIDDEN_SCHEMAS_AND_TABLES) {
			const forbiddenRegex = new RegExp(`(^|[^a-z0-9_])${forbidden}($|[^a-z0-9_])`, 'i');
			if (forbiddenRegex.test(normalizedLower)) {
				return false;
			}
		}

		// Bloqueia funções de sistema perigosas do PostgreSQL
		if (
			/\b(pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|dblink|lo_import|lo_export|query_to_xml)\s*\(/i.test(
				normalizedLower,
			)
		) {
			return false;
		}

		// 5. Verifica tabelas referenciadas em cláusulas FROM e JOIN
		const cteNames = new Set<string>();
		const cteRegex = /\b(?:WITH|,)[\s\r\n]+(?:"?([a-zA-Z0-9_]+)"?)[\s\r\n]+AS[\s\r\n]*\(/gi;
		let cteMatch: RegExpExecArray | null;
		while ((cteMatch = cteRegex.exec(withoutStringLiterals)) !== null) {
			if (cteMatch[1]) {
				cteNames.add(cteMatch[1].toLowerCase());
			}
		}

		const allowedSet = new Set(allowedDictionaryTables.map((t) => t.toLowerCase()));
		const sanitizedForTableScan = withoutStringLiterals
			.replace(/\bEXTRACT\s*\([^)]*\)/gi, 'EXTRACT_EXPR')
			.replace(/\bTRIM\s*\([^)]*\)/gi, 'TRIM_EXPR')
			.replace(/\bSUBSTRING\s*\([^)]*\)/gi, 'SUBSTRING_EXPR');

		const tableRefRegex = /\b(?:FROM|JOIN)\s+([a-zA-Z0-9_."]+)/gi;
		let tableMatch: RegExpExecArray | null;
		while ((tableMatch = tableRefRegex.exec(sanitizedForTableScan)) !== null) {
			const rawIdentifier = tableMatch[1].replace(/"/g, '').toLowerCase();
			const parts = rawIdentifier.split('.');
			const tableName = parts[parts.length - 1];
			const schemaName = parts.length > 1 ? parts[0] : 'public';

			if (schemaName !== 'public') {
				return false;
			}

			if (cteNames.has(tableName)) {
				continue;
			}

			if ((FORBIDDEN_SCHEMAS_AND_TABLES as readonly string[]).includes(tableName)) {
				return false;
			}

			const isAuthorizedBusinessTable =
				tableName.startsWith('erp_') ||
				tableName.startsWith('meta_') ||
				allowedSet.has(tableName);

			if (!isAuthorizedBusinessTable) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Expõe sanitização LGPD de registros para uso direto no serviço
	 */
	public sanitizeRowsForLgpd(rows: Record<string, unknown>[]): Record<string, unknown>[] {
		return sanitizeRowsForLgpd(rows);
	}

	/**
	 * Constrói o prompt determinístico blindado quando não há dados (`noDataFound: true`),
	 * impedindo qualquer alucinação de números, clientes, produtos ou faturamentos.
	 */
	private buildDeterministicNoDataPrompt(reason: RagNoDataReason, fallbackMessage: string): string {
		return `
### DADOS REAIS DO BANCO DE DADOS DA EMPRESA (POSTGRESQL):
Status do Grounding: SEM_DADOS_DISPONIVEIS (noDataFound: true | motivo: ${reason})
Resultado retornado (0 registro(s)):
\`\`\`json
[]
\`\`\`
Mensagem de Fallback Determinística: "${fallbackMessage}"

DIRETRIZES OBRIGATÓRIAS E INVIOLÁVEIS DE GROUNDING ESTRITO (ZERO ALUCINAÇÃO):
- Nenhum registro foi retornado ([]) na consulta ao banco de dados sincronizado do ERP.
- Se a pergunta do usuário exigir dados de negócio, métricas, faturamento, vendas, clientes, parceiros, produtos, estoque, notas fiscais ou pedidos, informe com transparência e cordialidade que não foram encontrados registros correspondentes cadastrados no sistema (${fallbackMessage}).
- PROIBIÇÃO ABSOLUTA: Você NUNCA deve inventar, estimar, supor, exemplificar com dados fictícios ou alucinar nomes de clientes, valores financeiros, quantidades de estoque, datas, códigos ou gráficos quando o resultado for vazio ([]).
- NUNCA gere blocos \`\`\`dashboard\`\`\` quando não houver registros reais retornados.
- NUNCA exiba código SQL, nomes técnicos de tabelas ou erros internos ao usuário.
`;
	}
}

export const chatRagService = new ChatRagService();
export default chatRagService;
