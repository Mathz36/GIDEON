import GeminiService, { GeminiMessage, GeminiParameters } from './gemini.service';
import { RagPipelineResult } from './chat-rag.service';
import { parseNumericValue } from '../utils/number-sanitizer';

export interface ReviewVerdict {
	approved: boolean;
	stage: 'DETERMINISTIC_GUARDRAIL' | 'CRITIC_AGENT';
	issues?: string;
	correctionInstruction?: string;
}

export interface ReviewPipelineResult {
	finalResponse: string;
	attempts: number;
	wasCorrected: boolean;
	usedDeterministicFallback: boolean;
	verdicts: ReviewVerdict[];
}

export interface ReviewStatusStep {
	step: number;
	title: string;
	subtitle: string;
}

const BANNED_HALLUCINATION_STRINGS = [
	'silva & santos',
	'aliança do brasil',
	'agrocomercial do cerrado',
	'viação & turismo progresso',
	'mecânica e peças horizonte',
	'atacadão central',
	'distribuidora progresso',
	'supermercados estrela',
	'varejo brasil ltda',
	'logística global s/a',
	'comércio nova era',
	'<nome_real_do_registro',
	'<periodo_real',
	'<título_',
	'<categoria_real',
	'<fatia_real',
	'<cod_real',
];

const GREETING_ONLY_REGEX =
	/^(oi|ol[áa]|bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|como\s+vai|quem\s+[ée]\s+voc[êe]|o\s+que\s+voc[êe]\s+faz|qual\s+seu\s+nome|obrigad[oa]|valeu|ajuda|help)[?!.\s]*$/i;

const BUSINESS_DATA_INTENT_REGEX =
	/\b(cliente|clientes|parceiro|parceiros|venda|vendas|faturamento|receita|nota|notas|pedido|pedidos|produto|produtos|estoque|vendedor|vendedores|representante|valor|valores|limite|cr[ée]dito|ranking|top|maior|maiores|menor|menores|total|soma|m[ée]dia|quantos|quantas|quais|listar|liste|mostre|gr[áa]fico|tabela|relat[óo]rio|m[êe]s|ano|ontem|hoje|semana|per[íi]odo|compra|compraram|faturou)\b/i;

export class ResponseReviewerService {
	private readonly gemini: GeminiService;
	private readonly maxCorrectionRetries: number;

	constructor(gemini?: GeminiService, maxCorrectionRetries = 2) {
		this.gemini = gemini ?? new GeminiService();
		this.maxCorrectionRetries = maxCorrectionRetries;
	}

	/**
	 * Verifica se a mensagem do usuário é puramente uma saudação ou pergunta institucional sobre o assistente,
	 * sem solicitar dados do banco do ERP.
	 */
	public isPureConversationalGreeting(question: string): boolean {
		const clean = question.trim();
		if (!clean) return false;
		if (BUSINESS_DATA_INTENT_REGEX.test(clean)) {
			return false;
		}
		return GREETING_ONLY_REGEX.test(clean) || clean.split(/\s+/).length <= 3;
	}

	/**
	 * Calcula resumos matemáticos exatos (soma, média, mínimo, máximo) das colunas numéricas
	 * retornadas pelo PostgreSQL para evitar que o LLM erre contas de cabeça e para embasar o Agente Revisor.
	 */
	public computeDeterministicAggregates(rows: Record<string, unknown>[]): Record<string, { sum: number; avg: number; min: number; max: number; count: number }> {
		const aggregates: Record<string, { sum: number; avg: number; min: number; max: number; count: number }> = {};
		if (!Array.isArray(rows) || rows.length === 0) {
			return aggregates;
		}

		const sampleKeys = Object.keys(rows[0] ?? {});
		for (const key of sampleKeys) {
			if (/^(id|cod|codigo|código|num|nro|numero|número|nota|pedido|cpf|cnpj|cep|ano|telefone)/i.test(key)) {
				continue;
			}

			const numericValues: number[] = [];
			for (const row of rows) {
				const parsed = parseNumericValue(row[key]);
				if (parsed !== null) {
					numericValues.push(parsed);
				}
			}

			if (numericValues.length > 0 && numericValues.length >= rows.length * 0.5) {
				const sum = Number(numericValues.reduce((acc, v) => acc + v, 0).toFixed(2));
				const min = Math.min(...numericValues);
				const max = Math.max(...numericValues);
				const avg = Number((sum / numericValues.length).toFixed(2));
				aggregates[key] = { sum, avg, min, max, count: numericValues.length };
			}
		}

		return aggregates;
	}

	/**
	 * Camada 4 (Blindagem Akita): Reconcilia e sanitiza deterministicamente os blocos ```dashboard
	 * gerados pela LLM pela CPU (Node.js) com latência 0ms:
	 * 1. Converte strings numéricas formatadas (ex: "R$ 12.500,50", "1.200,00") em números puros (`number`) via `parseNumericValue`.
	 * 2. Converte automaticamente gráficos `"pie"` com > 6 categorias em `"horizontal-bar"` para respeitar a Matriz Heurística.
	 * 3. Garante que todo item de gráfico possua as chaves canônicas `name` e `value`.
	 */
	public reconcileAndSanitizeDashboardBlocks(
		draftResponse: string,
		rows: Record<string, unknown>[] = [],
	): string {
		if (!draftResponse || !/```dashboard/i.test(draftResponse)) {
			return draftResponse;
		}

		const chartTypes = new Set(['bar', 'horizontal-bar', 'line', 'area', 'pie']);

		return draftResponse.replace(/```dashboard\s*([\s\S]*?)\s*```/gi, (fullBlock, rawJson: string) => {
			try {
				const parsed = JSON.parse(rawJson.trim()) as {
					type?: string;
					title?: string;
					data?: Array<Record<string, unknown>>;
				};

				if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.data)) {
					return fullBlock;
				}

				let normalizedType = String(parsed.type || 'bar').toLowerCase().trim();

				// Regra Heurística Determinística: "pie" com mais de 6 fatias é convertido automaticamente para "horizontal-bar"
				if (normalizedType === 'pie' && parsed.data.length > 6) {
					normalizedType = 'horizontal-bar';
				}
				parsed.type = normalizedType;

				if (chartTypes.has(normalizedType)) {
					parsed.data = parsed.data.map((item, idx) => {
						if (!item || typeof item !== 'object') {
							return item;
						}

						const clone: Record<string, unknown> = { ...item };

						// Garante chave 'name' legível
						if (clone.name === undefined || clone.name === null || String(clone.name).trim() === '') {
							const fallbackLabelKey = Object.keys(clone).find((k) =>
								/^(label|categoria|cliente|razaosocial|nome|produto|descricao|vendedor|representante|dia|mes|periodo)/i.test(k),
							);
							if (fallbackLabelKey && clone[fallbackLabelKey] !== undefined) {
								clone.name = String(clone[fallbackLabelKey]);
							} else if (rows[idx]) {
								const firstRowVal = Object.values(rows[idx])[0];
								if (firstRowVal !== undefined) {
									clone.name = String(firstRowVal);
								}
							}
						}

						// Sanitiza chave 'value' para número puro float/int (nunca string "R$ 1.234,56")
						if (typeof clone.value !== 'number') {
							const parsedVal = parseNumericValue(clone.value);
							if (parsedVal !== null) {
								clone.value = parsedVal;
							} else {
								// Procura outra propriedade numérica no item
								for (const [k, v] of Object.entries(clone)) {
									if (k === 'name') continue;
									const candidate = parseNumericValue(v);
									if (candidate !== null) {
										clone.value = candidate;
										break;
									}
								}
							}
						}

						return clone;
					});
				}

				return `\`\`\`dashboard\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
			} catch {
				return fullBlock;
			}
		});
	}

	/**
	 * Etapa 1 do Revisor: Inspeção Heurística e Determinística Instantânea (Latência 0ms).
	 * Verifica vazamento de SQL, placeholders de exemplos, JSON de gráfico inválido ou invenção de números quando noDataFound=true.
	 */
	public evaluateDeterministicGrounding(
		userQuestion: string,
		draftResponse: string,
		ragResult: RagPipelineResult,
	): ReviewVerdict {
		const trimmed = draftResponse?.trim() ?? '';
		if (!trimmed) {
			return {
				approved: false,
				stage: 'DETERMINISTIC_GUARDRAIL',
				issues: 'A resposta gerada está vazia.',
				correctionInstruction: 'Elabore uma resposta clara e objetiva em português respondendo à solicitação do usuário.',
			};
		}

		const lowerDraft = trimmed.toLowerCase();

		// 1. Verifica presença de empresas fictícias banidas ou placeholders estruturais não preenchidos
		for (const banned of BANNED_HALLUCINATION_STRINGS) {
			if (lowerDraft.includes(banned)) {
				return {
					approved: false,
					stage: 'DETERMINISTIC_GUARDRAIL',
					issues: `A resposta contém um nome fictício ou placeholder proibido ("${banned}") que não pertence ao banco de dados real.`,
					correctionInstruction:
						'Remova imediatamente qualquer nome de exemplo ou placeholder. Utilize EXCLUSIVAMENTE os nomes e valores reais retornados no JSON do PostgreSQL.',
				};
			}
		}

		// 2. Verifica vazamento de código SQL técnico para o usuário final
		if (/```sql[\s\S]*?```/i.test(trimmed) || /\bSELECT\s+.+\s+FROM\s+erp_/i.test(trimmed)) {
			return {
				approved: false,
				stage: 'DETERMINISTIC_GUARDRAIL',
				issues: 'A resposta exibiu código SQL ou nomes internos de tabelas técnicas ao usuário executivo.',
				correctionInstruction:
					'Remova todo código SQL e nomes técnicos de tabelas (erp_*). Apresente apenas a análise executiva em linguagem natural e visualizações.',
			};
		}

		// 3. Se não há dados no banco (noDataFound === true), proíbe estritamente blocos dashboard e invenção de valores monetários/rankings
		if (ragResult.noDataFound) {
			if (/```dashboard/i.test(trimmed)) {
				return {
					approved: false,
					stage: 'DETERMINISTIC_GUARDRAIL',
					issues: 'A resposta gerou um gráfico/tabela ```dashboard``` mesmo quando a consulta ao banco retornou 0 registros (noDataFound: true).',
					correctionInstruction:
						'Não gere nenhum bloco ```dashboard```. Informe com transparência que não foram encontrados registros correspondentes no ERP para os critérios pesquisados.',
				};
			}

			// Se o rascunho cita valores em Reais (R$ 1.234,56) que não estavam na própria pergunta do usuário
			const currencyMatches = trimmed.match(/R\$\s*[\d.,]+/gi) ?? [];
			for (const currency of currencyMatches) {
				if (!userQuestion.includes(currency)) {
					return {
						approved: false,
						stage: 'DETERMINISTIC_GUARDRAIL',
						issues: `A consulta retornou 0 registros do banco, mas a resposta inventou o valor monetário "${currency}".`,
						correctionInstruction:
							'Remova todos os valores financeiros inventados. Informe apenas que não foram localizados registros no banco de dados para a consulta.',
					};
				}
			}

			return { approved: true, stage: 'DETERMINISTIC_GUARDRAIL' };
		}

		// 4. Quando HÁ dados no banco (noDataFound === false), valida blocos ```dashboard se presentes
		const dashboardRegex = /```dashboard\s*([\s\S]*?)\s*```/gi;
		let match: RegExpExecArray | null;
		while ((match = dashboardRegex.exec(trimmed)) !== null) {
			const rawJson = match[1]?.trim() ?? '';
			try {
				const parsed = JSON.parse(rawJson) as { type?: unknown; title?: unknown; data?: unknown };
				if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.data) || parsed.data.length === 0) {
					return {
						approved: false,
						stage: 'DETERMINISTIC_GUARDRAIL',
						issues: 'O bloco ```dashboard contém um array "data" vazio ou inválido.',
						correctionInstruction:
							'Preencha o array "data" do bloco ```dashboard com os objetos reais retornados na consulta do PostgreSQL.',
					};
				}
			} catch {
				return {
					approved: false,
					stage: 'DETERMINISTIC_GUARDRAIL',
					issues: 'O bloco ```dashboard contém JSON malformado que falhará na renderização visual.',
					correctionInstruction:
						'Corrija a sintaxe do bloco ```dashboard garantindo que seja um JSON 100% válido com chaves e strings entre aspas duplas.',
				};
			}
		}

		// 5. Verifica se pelo menos uma entidade ou valor real das linhas retornadas aparece na resposta
		if (ragResult.rows.length > 0) {
			const realTokens: string[] = [];
			for (const row of ragResult.rows.slice(0, 15)) {
				for (const val of Object.values(row)) {
					if (typeof val === 'string' && val.trim().length >= 3 && !val.includes('REDACTED')) {
						realTokens.push(val.trim().toLowerCase());
					} else if (typeof val === 'number') {
						realTokens.push(String(val));
					}
				}
			}

			if (realTokens.length > 0) {
				const hasAnyRealToken = realTokens.some((token) => {
					if (token.length >= 4) {
						return lowerDraft.includes(token) || lowerDraft.includes(token.slice(0, Math.min(token.length, 10)));
					}
					return lowerDraft.includes(token);
				});

				// Também verifica se usou algum agregado calculado
				const aggregates = this.computeDeterministicAggregates(ragResult.rows);
				const hasAggregateMatch = Object.values(aggregates).some((agg) => {
					const intPart = String(Math.trunc(agg.sum));
					return lowerDraft.includes(intPart) || lowerDraft.includes(agg.sum.toLocaleString('pt-BR'));
				});

				if (!hasAnyRealToken && !hasAggregateMatch && !trimmed.includes(String(ragResult.rowCount))) {
					return {
						approved: false,
						stage: 'DETERMINISTIC_GUARDRAIL',
						issues: 'A resposta gerada não mencionou nenhum dos registros ou valores reais retornados pelo banco de dados.',
						correctionInstruction:
							'Baseie sua resposta diretamente nos registros reais retornados no JSON do PostgreSQL, citando os nomes e valores exatos encontrados.',
					};
				}
			}
		}

		return { approved: true, stage: 'DETERMINISTIC_GUARDRAIL' };
	}

	/**
	 * Etapa 2 do Revisor: Auditoria Semântica via Agente Crítico LLM (Claude Constitutional Self-Critique).
	 * Verifica se a resposta é fiel aos dados do banco e condizente com a pergunta do usuário.
	 */
	public async evaluateWithCriticAgent(
		userQuestion: string,
		draftResponse: string,
		ragResult: RagPipelineResult,
	): Promise<ReviewVerdict> {
		// Se não há dados e já passou pelo guardrail determinístico, está aprovado
		if (ragResult.noDataFound || ragResult.rows.length === 0) {
			return { approved: true, stage: 'CRITIC_AGENT' };
		}

		const aggregates = this.computeDeterministicAggregates(ragResult.rows);
		const sampleRows = ragResult.rows.slice(0, 30);

		const criticSystemInstruction = `Você é o Auditor de Conformidade Factual e Grounding da Gideon (Critic Agent).
Sua única responsabilidade é auditar se o RASCUNHO DE RESPOSTA gerado pela IA responde com exatidão à PERGUNTA DO USUÁRIO baseando-se EXCLUSIVAMENTE nos DADOS REAIS DO BANCO DE DADOS (PostgreSQL).

REGRAS DE AUDITORIA:
1. APROVE ("approved": true) se:
   - Todos os nomes de empresas/clientes, produtos, códigos, datas e valores citados no rascunho pertencem aos DADOS REAIS DO BANCO ou às SOMAS/AGREGAÇÕES MATEMÁTICAS EXATAS fornecidas.
   - Arredondamentos visuais ou formatações em Reais (ex: 15420.5 para "R$ 15.420,50") são válidos e DEVEM SER APROVADOS.
   - A resposta é condizente com a pergunta do usuário.
2. REPROVE ("approved": false) somente se:
   - O rascunho inventar (alucinar) nomes de clientes, produtos ou números que NÃO existem nos DADOS REAIS DO BANCO nem nas agregações.
   - O rascunho contradisser diretamente os valores do banco.
   - O rascunho ignorar a pergunta do usuário tendo os dados disponíveis.

Retorne EXCLUSIVAMENTE um objeto JSON válido (sem blocos markdown adicionais se possível) no formato:
{"approved": true, "issues": "", "correctionInstruction": ""}`;

		const criticPrompt = `PERGUNTA DO USUÁRIO:
"${userQuestion}"

TOTAL DE REGISTROS RETORNADOS DO BANCO: ${ragResult.rowCount}
AGREGAÇÕES MATEMÁTICAS EXATAS (SOMA / MÉDIA / MIN / MAX):
${JSON.stringify(aggregates)}

DADOS REAIS DO BANCO DE DADOS (AMOSTRA ATÉ 30 REGISTROS):
${JSON.stringify(sampleRows)}

RASCUNHO DE RESPOSTA DA GIDEON PARA AUDITORIA:
"""
${draftResponse}
"""

Veredito JSON da auditoria:`;

		try {
			const rawVerdict =
				typeof (this.gemini as any).generateText === 'function'
					? await (this.gemini as any).generateText(
							[{ role: 'user', parts: [{ text: criticPrompt }] }],
							criticSystemInstruction,
							{ temperature: 0.0, topP: 0.8 },
						)
					: await this.gemini.generateChatResponse(
							[{ role: 'user', parts: [{ text: criticPrompt }] }],
							criticSystemInstruction,
							{ temperature: 0.0, topP: 0.8 },
						);

			const cleaned = String(rawVerdict ?? '')
				.replace(/^```(?:json)?\s*/i, '')
				.replace(/\s*```$/i, '')
				.trim();

			const firstBrace = cleaned.indexOf('{');
			const lastBrace = cleaned.lastIndexOf('}');
			if (firstBrace !== -1 && lastBrace > firstBrace) {
				const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as {
					approved?: boolean;
					issues?: string;
					correctionInstruction?: string;
				};

				if (parsed.approved === false) {
					return {
						approved: false,
						stage: 'CRITIC_AGENT',
						issues: parsed.issues || 'Inconsistência factual detectada entre a resposta e os registros do banco.',
						correctionInstruction:
							parsed.correctionInstruction ||
							'Reescreva a resposta utilizando estritamente os valores e nomes contidos no JSON do banco de dados.',
					};
				}
			}
		} catch (err) {
			console.warn('[ResponseReviewerService] Aviso ao executar Critic Agent LLM (mantendo veredito determinístico):', err);
		}

		return { approved: true, stage: 'CRITIC_AGENT' };
	}

	/**
	 * Constrói uma resposta 100% determinística e livre de alucinação a partir dos dados reais do banco
	 * caso o modelo não passe na auditoria após todas as tentativas de auto-correção.
	 */
	public buildDeterministicFallbackResponse(userQuestion: string, ragResult: RagPipelineResult): string {
		if (ragResult.noDataFound || ragResult.rows.length === 0) {
			const baseMsg =
				ragResult.fallbackMessage ||
				'Não foram encontrados registros correspondentes no banco de dados sincronizado do ERP para responder a esta consulta.';
			return `${baseMsg}\n\nSe desejar, você pode refinar sua pergunta informando outro período, código ou nome cadastrado no sistema.`;
		}

		const rows = ragResult.rows;
		const aggregates = this.computeDeterministicAggregates(rows);
		const aggSummaries: string[] = [];

		for (const [col, stats] of Object.entries(aggregates)) {
			const isMoney = /(valor|vlr|faturamento|receita|total|preco|preço|limite|saldo|lucro)/i.test(col);
			const formattedSum = isMoney
				? stats.sum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
				: stats.sum.toLocaleString('pt-BR');
			aggSummaries.push(`- **Total (${col}):** ${formattedSum}`);
		}

		const dashboardBlock = JSON.stringify(
			{
				type: 'table',
				title: `Registros Encontrados (${rows.length})`,
				data: rows.slice(0, 25),
			},
			null,
			2,
		);

		return [
			`Foram localizados **${ragResult.rowCount} registro(s)** no banco de dados sincronizado do ERP para a sua consulta:`,
			aggSummaries.length > 0 ? `\n${aggSummaries.join('\n')}\n` : '',
			`\`\`\`dashboard\n${dashboardBlock}\n\`\`\``,
		]
			.filter(Boolean)
			.join('\n');
	}

	/**
	 * Executa o ciclo completo de Geração -> Revisão (Guardrail Determinístico + Agente Crítico) -> Auto-Correção (até N tentativas)
	 * -> Fallback Determinístico.
	 */
	public async generateAndReviewResponse(params: {
		userQuestion: string;
		history: GeminiMessage[];
		systemPrompt: string;
		ragResult: RagPipelineResult;
		parameters: GeminiParameters;
		onStatusUpdate?: (status: ReviewStatusStep) => void;
	}): Promise<ReviewPipelineResult> {
		const { userQuestion, history, systemPrompt, ragResult, parameters, onStatusUpdate } = params;
		const verdicts: ReviewVerdict[] = [];

		// Camada 1 (Fail-Fast): Se a métrica pedida está fora do escopo contábil/financeiro sincronizado,
		// retorna imediatamente a explicação determinística sem invocar a LLM geradora.
		if (ragResult.noDataFound && ragResult.reason === 'OUT_OF_SCOPE_METRIC') {
			return {
				finalResponse: this.buildDeterministicFallbackResponse(userQuestion, ragResult),
				attempts: 1,
				wasCorrected: false,
				usedDeterministicFallback: true,
				verdicts: [{ approved: true, stage: 'DETERMINISTIC_GUARDRAIL' }],
			};
		}

		// Se a consulta pediu dados de negócio mas o banco não retornou nada (noDataFound: true)
		// e NÃO é uma saudação pura, já injetamos um lembrete severo ou verificamos com rigor absoluto.
		const aggregates = !ragResult.noDataFound ? this.computeDeterministicAggregates(ragResult.rows) : {};
		const aggregatesContext =
			Object.keys(aggregates).length > 0
				? `\n\n[SOMAS E AGREGAÇÕES MATEMÁTICAS PRÉ-CALCULADAS COM EXATIDÃO PELO SISTEMA]:\n${JSON.stringify(aggregates, null, 2)}\nUtilize estes totais exatos caso precise informar somas ou médias, sem recalcular de cabeça.`
				: '';

		const enrichedSystemPrompt = `${systemPrompt}${aggregatesContext}`;
		let workingHistory: GeminiMessage[] = [...history];
		let currentDraft = '';

		const maxAttempts = this.maxCorrectionRetries + 1;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			if (attempt === 1) {
				onStatusUpdate?.({
					step: 3,
					title: 'Elaborando análise e indicadores...',
					subtitle: 'Consolidando números reais do PostgreSQL',
				});
			} else {
				onStatusUpdate?.({
					step: 4,
					title: `Auto-corrigindo resposta (Revisão #${attempt - 1})...`,
					subtitle: 'Ajustando fidelidade factual apontada pelo Agente Revisor',
				});
			}

			// Usa temperatura reduzida nas tentativas de correção para garantir determinismo máximo
			const attemptParams: GeminiParameters =
				attempt === 1
					? { temperature: Math.min(parameters.temperature, 0.2), topP: parameters.topP }
					: { temperature: 0.0, topP: 0.8 };

			try {
				currentDraft =
					typeof this.gemini.generateChatResponse === 'function'
						? await this.gemini.generateChatResponse(workingHistory, enrichedSystemPrompt, attemptParams)
						: await (this.gemini as any).generateText(workingHistory, enrichedSystemPrompt, attemptParams);

				// Camada 4: Reconcilia e sanitiza deterministicamente qualquer bloco ```dashboard antes da auditoria
				if (!ragResult.noDataFound) {
					currentDraft = this.reconcileAndSanitizeDashboardBlocks(currentDraft, ragResult.rows);
				}
			} catch (genErr) {
				console.warn(`[ResponseReviewerService] Erro na tentativa #${attempt} de geração:`, genErr);
				if (attempt === maxAttempts) {
					return {
						finalResponse: this.buildDeterministicFallbackResponse(userQuestion, ragResult),
						attempts: attempt,
						wasCorrected: attempt > 1,
						usedDeterministicFallback: true,
						verdicts,
					};
				}
				continue;
			}

			onStatusUpdate?.({
				step: 4,
				title: 'Auditando resposta (Agente Revisor)...',
				subtitle: 'Verificando se todos os dados conferem com o banco de dados',
			});

			// 1. Revisão Determinística Instantânea
			const detVerdict = this.evaluateDeterministicGrounding(userQuestion, currentDraft, ragResult);
			verdicts.push(detVerdict);

			if (!detVerdict.approved) {
				console.info(
					`[ResponseReviewerService] Tentativa #${attempt} reprovada no Guardrail Determinístico: ${detVerdict.issues}`,
				);

				// Se noDataFound === true e o modelo tentou inventar dados, aciona fallback determinístico imediatamente sem gastar mais tokens!
				if (ragResult.noDataFound && !this.isPureConversationalGreeting(userQuestion)) {
					return {
						finalResponse: this.buildDeterministicFallbackResponse(userQuestion, ragResult),
						attempts: attempt,
						wasCorrected: true,
						usedDeterministicFallback: true,
						verdicts,
					};
				}

				if (attempt < maxAttempts) {
					workingHistory = [
						...history,
						{ role: 'model', parts: [{ text: currentDraft }] },
						{
							role: 'user',
							parts: [
								{
									text: `[AUDITORIA INTERNA DE QUALIDADE - REPROVADO]\nMotivo da reprovação: ${detVerdict.issues}\nInstrução obrigatória: ${detVerdict.correctionInstruction}\nReescreva a resposta final completa para o usuário corrigindo este erro, sem mencionar esta auditoria interna.`,
								},
							],
						},
					];
					continue;
				} else {
					return {
						finalResponse: this.buildDeterministicFallbackResponse(userQuestion, ragResult),
						attempts: attempt,
						wasCorrected: true,
						usedDeterministicFallback: true,
						verdicts,
					};
				}
			}

			// 2. Revisão Semântica com o Agente Crítico LLM
			const criticVerdict = await this.evaluateWithCriticAgent(userQuestion, currentDraft, ragResult);
			verdicts.push(criticVerdict);

			if (!criticVerdict.approved) {
				console.info(
					`[ResponseReviewerService] Tentativa #${attempt} reprovada pelo Agente Crítico LLM: ${criticVerdict.issues}`,
				);

				if (attempt < maxAttempts) {
					workingHistory = [
						...history,
						{ role: 'model', parts: [{ text: currentDraft }] },
						{
							role: 'user',
							parts: [
								{
									text: `[AUDITORIA INTERNA DE QUALIDADE - REPROVADO PELO AGENTE CRÍTICO]\nProblema identificado: ${criticVerdict.issues}\nComo corrigir: ${criticVerdict.correctionInstruction}\nGere novamente a resposta completa para o usuário utilizando EXCLUSIVAMENTE os dados reais do banco, sem mencionar esta auditoria.`,
								},
							],
						},
					];
					continue;
				} else {
					return {
						finalResponse: this.buildDeterministicFallbackResponse(userQuestion, ragResult),
						attempts: attempt,
						wasCorrected: true,
						usedDeterministicFallback: true,
						verdicts,
					};
				}
			}

			// Aprovado em ambas as camadas!
			return {
				finalResponse: currentDraft,
				attempts: attempt,
				wasCorrected: attempt > 1,
				usedDeterministicFallback: false,
				verdicts,
			};
		}

		return {
			finalResponse: this.buildDeterministicFallbackResponse(userQuestion, ragResult),
			attempts: maxAttempts,
			wasCorrected: true,
			usedDeterministicFallback: true,
			verdicts,
		};
	}
}

export const responseReviewerService = new ResponseReviewerService();
export default responseReviewerService;
