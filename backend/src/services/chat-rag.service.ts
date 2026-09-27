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
			// 1. Executa o pipeline RAG (Keywords -> Busca -> Expansão de FKs -> DDL)
			const pipelineResult = await ragSqlPipeline.execute({
				tenantId: 'default',
				question: userQuestion,
				maxInitialTables: 4,
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
Consulta SQL executada no banco:
\`\`\`sql
${sql}
\`\`\`

Resultado retornado (${Array.isArray(rows) ? rows.length : 0} registro(s)):
\`\`\`json
${serializedRows}
\`\`\`

INSTRUÇÕES OBRIGATÓRIAS:
- Responda à pergunta do usuário baseando-se OBRIGATORIAMENTE nos dados reais acima.
- Preencha cada informação com os valores exatos retornados (ex: Razão Social real, Códigos reais, Valores, Ramos, etc.).
- NUNCA utilize placeholders ou termos genéricos entre parênteses como "(Nome/Razão Social registrado no sistema)".
- Se nenhum registro foi retornado ([]), informe com transparência que não há registros correspondentes cadastrados no sistema.
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
