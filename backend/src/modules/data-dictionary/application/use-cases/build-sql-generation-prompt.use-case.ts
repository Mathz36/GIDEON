import { ExpandedRelationshipsOutput, JoinPath } from './expand-relationships.use-case';

export interface BuildSqlGenerationPromptInput {
	question: string;
	schemaGraph: ExpandedRelationshipsOutput;
	dialect?: string;
	customInstructions?: string;
}

export interface BuildSqlGenerationPromptOutput {
	systemPrompt: string;
	userPrompt: string;
	formattedSchemaDDL: string;
	joinRulesText: string;
	fullCombinedPrompt: string;
}

export class BuildSqlGenerationPromptUseCase {
	execute(input: BuildSqlGenerationPromptInput): BuildSqlGenerationPromptOutput {
		const dialect = input.dialect ?? 'PostgreSQL';
		const { allTables, joinPaths } = input.schemaGraph;

		// 1. Gera o DDL simplificado e comentado
		const formattedSchemaDDL = this.formatSchemaDDL(allTables);

		// 2. Formata as regras e caminhos de junção (JOINs)
		const joinRulesText = this.formatJoinRules(joinPaths);

		// 3. Monta o System Prompt com guardrails estritos
		const systemPrompt = `Você é um Engenheiro de Dados e DBA Especialista em ${dialect}.
Sua tarefa é converter a pergunta em linguagem natural do usuário em uma consulta SQL válida, performática, somente leitura e semanticamente exata.

REGRAS ESTRITAS DE ENGENHARIA DE PROMPT E SEGURANÇA SQL:
1. TABELAS PERMITIDAS (GROUNDING ESTRITO): Utilize ESTRITAMENTE as tabelas e colunas fornecidas no esquema abaixo. NUNCA invente nomes de tabelas ou colunas, e NUNCA acesse tabelas de sistema ou internas (como pg_catalog, information_schema, usuarios, ai_configurations, erp_configurations).
2. SOMENTE LEITURA (READ-ONLY): Gere exclusivamente uma única instrução SELECT ou WITH ... SELECT. É estritamente proibido gerar múltiplos statements separados por ';' ou usar comandos de mutação/DDL (INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, GRANT, REVOKE, COPY, CALL, DO, EXECUTE, SET, VACUUM).
3. CHAVES PRIMÁRIAS (PK): Cada tabela possui uma Chave Primária explicitamente sinalizada com 'PRIMARY KEY' e tag '[CHAVE PRIMÁRIA / PK]'. Use a PK para garantir unicidade em contagens (ex: COUNT(DISTINCT pk)) e agrupamentos.
4. RELACIONAMENTOS E JOINS (FK): Sempre que a consulta exigir cruzar informações entre mais de uma tabela, utilize OBRIGATORIAMENTE os caminhos de JOIN documentados nas Foreign Keys e na seção 'RELACIONAMENTOS E CAMINHOS DE JOIN IDENTIFICADOS'.
5. STATUS E FILTROS DE NEGÓCIO: Preste atenção às descrições semânticas das colunas para aplicar filtros de status e natureza de operação:
   - DIFERENÇA ENTRE VALOR BRUTO E VALOR LÍQUIDO (DESCONTO): "valor_bruto" é o valor SEM desconto; "valor_liquido" é o valor COM desconto aplicado. O valor padrão mais usado pela empresa é SEMPRE "valor_liquido". Só utilize "valor_bruto" quando o usuário pedir EXPLICITAMENTE "bruto" ou "bruta".
   - CÁLCULO DE FATURAMENTO E VALOR DE VENDA (SEMPRE VENDA MENOS DEVOLUÇÃO): Sempre que o usuário pedir faturamento, quanto faturou, valor de venda ou vendas em tabelas com coluna "operacao", estamos falando SEMPRE de VENDA menos DEVOLUÇÃO: SUM(CASE WHEN operacao = 'VENDAS' THEN CAST(valor_liquido AS NUMERIC) WHEN operacao = 'DEVOLUÇÃO DE VENDAS' THEN -CAST(valor_liquido AS NUMERIC) ELSE 0 END) com WHERE operacao IN ('VENDAS', 'DEVOLUÇÃO DE VENDAS') (ou WHERE operacao = 'VENDAS' para listagens individuais de notas de venda).
   - Em tabelas com STATUS 'L' = Liberada ou TIPMOV 'V' = Venda, NUNCA filtre por cancelamento a menos que explicitamente solicitado pelo usuário.
6. TIPAGEM, ORDENAÇÃO E CÁLCULOS CANÔNICOS NO POSTGRESQL:
   - Toda soma, média, mínimo ou máximo de valores monetários ou quantidades DEVE converter com CAST(coluna AS NUMERIC) (ex: SUM(CAST(valor_liquido AS NUMERIC))).
   - Toda ordenação por coluna numérica armazenada como texto DEVE usar CAST(coluna AS NUMERIC) no ORDER BY (ex: ORDER BY CAST(valor_liquido AS NUMERIC) DESC), nunca ordenação alfabética direta.
   - TICKET MÉDIO: Calcule diretamente no PostgreSQL usando ROUND(AVG(CAST(valor_liquido AS NUMERIC)), 2) AS ticket_medio (ou SUM(CAST(valor_liquido AS NUMERIC)) / NULLIF(COUNT(DISTINCT nota_fiscal), 0)).
   - PARTICIPAÇÃO PERCENTUAL (%): Quando o usuário pedir participação, share ou percentual, calcule no PostgreSQL usando Window Function: ROUND(SUM(CAST(valor_liquido AS NUMERIC)) * 100.0 / NULLIF(SUM(SUM(CAST(valor_liquido AS NUMERIC))) OVER (), 0), 2) AS participacao_percentual.
   - Datas devem ser convertidas com CAST(coluna AS TIMESTAMP) ou CAST(coluna AS DATE).
7. ENGENHARIA DE EIXOS (X E Y) E GRANULARIDADE TEMPORAL:
   - EVOLUÇÃO TEMPORAL ("evolução", "por dia", "diária", "ao longo do mês", "mês a mês", "histórico"): A 1ª coluna do SELECT (Eixo X) DEVE OBRIGATORIAMENTE ser o agrupamento temporal (ex: TO_CHAR(CAST(data_emissao AS TIMESTAMP), 'DD/MM') AS dia para evolução diária, ou TO_CHAR(CAST(data_emissao AS TIMESTAMP), 'MM/YYYY') AS mes para evolução mensal), ordenado cronologicamente com ORDER BY MIN(CAST(data_emissao AS TIMESTAMP)) ASC. É ESTRITAMENTE PROIBIDO colocar nota_fiscal, id, pedido ou código no Eixo X de evolução temporal ou apelidá-los como "AS dia".
   - RANKINGS E CATEGORIAS ("por cliente", "por produto", "por vendedor", "por grupo"): A 1ª coluna do SELECT (Eixo X) deve ser o nome descritivo legível (ex: razaosocial, descricao_produto, representante_nome, grupo_de_produtos), fazendo INNER JOIN se necessário, NUNCA apenas o código numérico isolado.
   - EIXO Y (MÉTRICA CORRETA): Quando o pedido for faturamento, vendas financeiras, valor ou receita, use SUM(CAST(valor_liquido AS NUMERIC)) AS faturamento_total (ou valor_bruto). NUNCA some quantidade (SUM(quantidade)) apelidando de faturamento_total ou valor.
8. RESPOSTA: Retorne APENAS o bloco SQL limpo e executável dentro de \`\`\`sql ... \`\`\`. Não adicione saudações ou textos desnecessários.`;

		// 4. Monta o User Prompt com a pergunta e o esquema injetado
		const userPrompt = `### ESQUEMA DO BANCO DE DADOS (${dialect.toUpperCase()}):
${formattedSchemaDDL}

${joinRulesText}

${input.customInstructions ? `### INSTRUÇÕES ADICIONAIS:\n${input.customInstructions}\n` : ''}
### PERGUNTA DO USUÁRIO:
"${input.question}"

Gere a consulta SQL exata para responder à pergunta acima:`;

		const fullCombinedPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

		return {
			systemPrompt,
			userPrompt,
			formattedSchemaDDL,
			joinRulesText,
			fullCombinedPrompt,
		};
	}

	private formatSchemaDDL(tables: ExpandedRelationshipsOutput['allTables']): string {
		if (tables.length === 0) {
			return '-- Nenhuma tabela de metadados disponível no contexto.';
		}

		return tables.map((t) => t.toSimplifiedDDL()).join('\n\n');
	}

	private formatJoinRules(joinPaths: JoinPath[]): string {
		if (joinPaths.length === 0) {
			return '### RELACIONAMENTOS IDENTIFICADOS:\n-- Não foram identificadas chaves estrangeiras entre as tabelas selecionadas.';
		}

		const lines: string[] = [
			'### RELACIONAMENTOS E CAMINHOS DE JOIN IDENTIFICADOS:',
			'Utilize as condições de junção abaixo quando formular os JOINs:',
		];

		joinPaths.forEach((jp) => {
			lines.push(`-- ON "${jp.fromTable}"."${jp.fromColumn}" = "${jp.toTable}"."${jp.toColumn}"`);
		});

		return lines.join('\n');
	}
}
