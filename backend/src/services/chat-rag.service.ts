import prismaClient from '../config/prisma';
import GeminiService, { GeminiMessage } from './gemini.service';
import { ragSqlPipeline } from '../modules/data-dictionary';

export class ChatRagService {
	private readonly gemini: GeminiService;

	constructor(gemini: GeminiService = new GeminiService()) {
		this.gemini = gemini;
	}

	/**
	 * Analisa a pergunta do usuário, consulta o Dicionário de Dados, gera e executa a query SQL
	 * no PostgreSQL e retorna o contexto enriquecido com os dados reais para o LLM.
	 */
	async retrieveDatabaseContext(userQuestion: string): Promise<string | null> {
		if (!userQuestion || !userQuestion.trim()) {
			return null;
		}

		try {
			const pipelineResult = await ragSqlPipeline.execute({
				tenantId: 'default',
				question: userQuestion,
				maxInitialTables: 4,
				customInstructions: `DIRETRIZES CRÍTICAS DE CONVERSÃO E TIPAGEM DE DADOS:
1. TRATAMENTO DA COLUNA "DATA_EMISSAO" (Tabela erp_nota_fiscal):
   - Esta coluna é do tipo TEXT e armazena datas no formato 'DDMMYYYY HH24:MI:SS' (exemplo: '02092026 00:00:00' para 02 de setembro de 2026).
   - NUNCA use MIN(data_emissao), MAX(data_emissao) ou ORDER BY data_emissao diretamente como texto, pois a ordenação alfabética falha (ex: '01102026' vem antes de '02092026').
   - Para ordenar por data ou encontrar a mais antiga/recente, converta OBRIGATORIAMENTE com:
     TO_TIMESTAMP(data_emissao, 'DDMMYYYY HH24:MI:SS')
     Exemplo para mais antiga: ORDER BY TO_TIMESTAMP(data_emissao, 'DDMMYYYY HH24:MI:SS') ASC LIMIT 1
     Exemplo para mais recente: ORDER BY TO_TIMESTAMP(data_emissao, 'DDMMYYYY HH24:MI:SS') DESC LIMIT 1
   - Para filtrar datas específicas:
     * Para um dia específico (ex: 02/09/2026): use data_emissao LIKE '02092026%' ou TO_DATE(SUBSTRING(data_emissao, 1, 8), 'DDMMYYYY') = '2026-09-02'
     * Para um mês específico (ex: setembro/2026): use data_emissao LIKE '__092026%' ou TO_TIMESTAMP(data_emissao, 'DDMMYYYY HH24:MI:SS') BETWEEN '2026-09-01' AND '2026-09-30 23:59:59'
2. TRATAMENTO DE VALORES NUMÉRICOS:
   - Colunas numéricas armazenadas como TEXT (ex: valor_bruto, valor_liquido, quantidade, peso) DEVEM receber CAST(coluna AS NUMERIC) ao usar SUM, AVG ou comparações numéricas (> ou <).`,
			});

			if (pipelineResult.schemaGraph.allTables.length === 0) {
				return null;
			}

			// 2. Solicita ao Gemini a query SQL para o PostgreSQL
			const sqlPrompt = `${pipelineResult.promptResult.systemPrompt}\n\n${pipelineResult.promptResult.userPrompt}`;
			const rawSql = await this.gemini.generateText(
				[{ role: 'user', parts: [{ text: sqlPrompt }] }],
				'Você é um gerador de queries SQL PostgreSQL estritas e precisas. Retorne APENAS o bloco SQL dentro de ```sql ... ```.',
				{ temperature: 0.1, topP: 0.8 },
			);

			// 3. Extrai o SQL gerado
			const sqlMatch = rawSql.match(/```(?:sql)?\s*([\s\S]*?)\s*```/i);
			let sql = (sqlMatch ? sqlMatch[1] : rawSql).trim().replace(/;$/, '');

			// 4. Validação de segurança: apenas queries de leitura (SELECT / WITH)
			if (!this.isReadOnlyQuery(sql)) {
				console.warn('[ChatRagService] Query gerada não é somente leitura:', sql);
				return null;
			}

			// Assegura limite razoável para não estourar contexto
			if (!/LIMIT\s+\d+/i.test(sql)) {
				sql = `${sql} LIMIT 50`;
			}

			console.info(`[ChatRagService] Executando query gerada no PostgreSQL:\n${sql}`);

			// 5. Executa a query no PostgreSQL do Supabase
			const rows = await prismaClient.$queryRawUnsafe<unknown[]>(sql);

			// Serializa com suporte a BigInt do Postgres
			const serializedRows = JSON.stringify(
				rows,
				(_key, value) => (typeof value === 'bigint' ? value.toString() : value),
				2,
			);

			return `
### DADOS REAIS DO BANCO DE DADOS DA EMPRESA (POSTGRESQL):
Resultado retornado (${Array.isArray(rows) ? rows.length : 0} registro(s)):
\`\`\`json
${serializedRows}
\`\`\`

DIRETRIZES OBRIGATÓRIAS DE COMUNICAÇÃO E RESPOSTA:
- NUNCA exiba código SQL, consultas SQL, comandos de banco de dados ou nomes técnicos de tabelas na sua resposta final ao usuário. O usuário é um gestor de negócios e não deve ver código técnico.
- Responda exclusivamente em linguagem natural profissional, clara e fluida, como um assistente corporativo executivo de alto nível.
- Responda à pergunta do usuário baseando-se OBRIGATORIAMENTE nos dados reais acima.
- Preencha cada informação com os valores exatos retornados (ex: Razão Social real, Códigos reais, Valores, Ramos, etc.).
- NUNCA utilize placeholders ou termos genéricos entre parênteses como "(Nome/Razão Social registrado no sistema)".
- Se nenhum registro foi retornado ([]), informe com transparência e cordialidade que não foram encontrados registros correspondentes cadastrados no sistema.

[DIRETIVA DE VISUALIZAÇÃO DE DADOS]
Quando o usuário solicitar painéis, gráficos, relatórios tabulares ou quando a resposta contiver dados agregados que seriam melhor compreendidos visualmente, você DEVE gerar os dados estruturados em JSON.
Insira este JSON no meio da sua resposta, usando EXATAMENTE o seguinte bloco Markdown:

\`\`\`dashboard
{
  "type": "bar",
  "title": "Título descritivo",
  "data": [
    {"name": "Categoria 1", "value": 100},
    {"name": "Categoria 2", "value": 200}
  ]
}
\`\`\`

REGRAS ESTRITAS DO JSON:
1. Formato JSON válido (chaves e valores string com aspas duplas).
2. Para gráficos: Use "name" para o eixo X (rótulos) e "value" ou "total" para o eixo Y (valores numéricos).
3. Para tabelas ("type": "table"): O array "data" pode conter objetos com múltiplas chaves livres, que se tornarão as colunas.
`;
		} catch (error) {
			console.warn('[ChatRagService] Aviso ao executar Text-to-SQL RAG:', error);
			return null;
		}
	}

	private isReadOnlyQuery(query: string): boolean {
		const normalized = query.trim().toUpperCase();
		if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
			return false;
		}

		// Bloqueia qualquer comando de modificação ou DDL
		const dangerousKeywords = [
			'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE',
			'RENAME', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE',
		];

		const tokens = normalized.split(/\s+/);
		return !tokens.some((token) => dangerousKeywords.includes(token));
	}
}

export const chatRagService = new ChatRagService();
export default chatRagService;
