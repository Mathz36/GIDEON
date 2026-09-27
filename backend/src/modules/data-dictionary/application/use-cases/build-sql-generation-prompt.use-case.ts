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
Sua tarefa é converter a pergunta em linguagem natural do usuário em uma consulta SQL válida, performática e semanticamente exata.

REGRAS ESTRITAS DE ENGENHARIA DE PROMPT:
1. TABELAS PERMITIDAS: Utilize ESTRITAMENTE as tabelas e colunas fornecidas no esquema abaixo. Não invente nomes de tabelas ou colunas.
2. CHAVES PRIMÁRIAS (PK): Cada tabela possui uma Chave Primária explicitamente sinalizada com 'PRIMARY KEY' e tag '[CHAVE PRIMÁRIA / PK]'. Use a PK para garantir unicidade em contagens (ex: COUNT(DISTINCT pk)) e agrupamentos.
3. RELACIONAMENTOS (FK): Sempre que a consulta exigir cruzar informações entre mais de uma tabela, utilize OBRIGATORIAMENTE os caminhos de JOIN documentados nas Foreign Keys.
4. FILTROS E TIPAGEM: Preste atenção às descrições semânticas das colunas para aplicar filtros de status (ex: 'S' para ativo), datas e valores monetários.
5. RESPOSTA: Retorne APENAS o bloco SQL limpo e executável dentro de \`\`\`sql ... \`\`\`. Não adicione saudações ou textos desnecessários.`;

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
