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
     * Agrupar por mês: TO_CHAR(CAST(data_emissao AS TIMESTAMP), 'YYYY-MM')
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
