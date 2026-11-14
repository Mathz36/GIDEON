import { PrismaClient, AiConfiguration as PrismaAiConfig } from '@prisma/client';
import prismaClient from '../config/prisma';

export interface AiConfigurationInput {
	systemPrompt: string;
	temperature: number;
	topP: number;
	memorySize: number;
}

export interface IAiConfigurationService {
	get(): Promise<PrismaAiConfig>;
	update(input: AiConfigurationInput): Promise<PrismaAiConfig>;
	getInternalSystemDirectives(): string;
	buildFullSystemPrompt(businessRulesPrompt?: string): string;
}

/**
 * Regras de Negócio e Orientações da Empresa (Visíveis e Editáveis pelo Administrador na tela "Controle do Gemini").
 * Não contém detalhes técnicos internos de JSON ou renderização de componentes do sistema.
 */
export const DEFAULT_COMPANY_BUSINESS_RULES = `Você é a Gideon, inteligência artificial corporativa e consultora executiva de negócios da empresa, integrada ao banco de dados do ERP.

REGRAS DE NEGÓCIO E ORIENTAÇÕES DA EMPRESA:
1. DIFERENÇA ENTRE VALOR BRUTO E VALOR LÍQUIDO (DESCONTOS):
   - Valor Bruto (valor_bruto): é o valor SEM desconto.
   - Valor Líquido (valor_liquido): é o valor COM desconto aplicado.
   - O valor padrão mais usado na empresa para qualquer consulta (faturamento, venda, bonificação ou devolução) é SEMPRE o Valor Líquido (valor_liquido).
   - Só utilize o Valor Bruto (valor_bruto) quando o usuário pedir EXPLICITAMENTE "bruto" ou "bruta" (ex: "faturamento bruto", "venda bruta", "bonificação bruta").

2. CÁLCULO DE FATURAMENTO E VALOR DE VENDA (SEMPRE VENDA MENOS DEVOLUÇÃO):
   - Sempre que alguém pedir Faturamento, Quanto Faturou, Valor de Venda ou Vendas, estamos falando OBRIGATORIAMENTE de VENDA menos DEVOLUÇÃO (VENDAS - DEVOLUÇÃO DE VENDAS).
   - Por padrão (usando o valor líquido com desconto):
     Faturamento / Venda = Valor Líquido (VENDAS) - Valor Líquido (DEVOLUÇÃO DE VENDAS).
   - Quando solicitado explicitamente o valor bruto (sem desconto):
     Faturamento Bruto / Venda Bruta = Valor Bruto (VENDAS) - Valor Bruto (DEVOLUÇÃO DE VENDAS).

3. COMUNICAÇÃO E POSTURA EXECUTIVA:
   - Responda sempre em linguagem natural, profissional, objetiva e consultiva, baseando-se exclusivamente nos números reais apurados no ERP.`;

/**
 * Diretivas Técnicas Internas da Gideon (Ocultas no código — NUNCA exibidas no campo de Regras de Negócio da UI).
 * Define o protocolo interno de estruturação de gráficos e tabelas JSON (```dashboard) e a Matriz Heurística Visual.
 */
export const INTERNAL_GIDEON_SYSTEM_DIRECTIVES = `[DIRETIVA DE VISUALIZAÇÃO DE DADOS]
Quando o usuário solicitar painéis, gráficos, relatórios tabulares ou quando a resposta contiver dados agregados ou analíticos que sejam melhor compreendidos visualmente, você DEVE gerar os dados estruturados em JSON.
Insira este JSON no meio da sua resposta, usando EXATAMENTE o seguinte bloco Markdown:

\`\`\`dashboard
{ ... }
\`\`\`

ATENÇÃO CRÍTICA: Os blocos abaixo demonstram APENAS a estrutura sintática do JSON. NUNCA copie os rótulos ou valores ilustrativos abaixo; preencha EXCLUSIVAMENTE com os registros reais retornados do PostgreSQL.

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
4. Se a consulta não contiver registros ou dados concretos, NUNCA gere o bloco \`\`\`dashboard\`\`\`.`;

const DEFAULT_AI_CONFIG: AiConfigurationInput = {
	systemPrompt: DEFAULT_COMPANY_BUSINESS_RULES,
	temperature: 0.1,
	topP: 0.9,
	memorySize: 10,
};

/**
 * Remove blocos técnicos legados (`[DIRETIVA DE VISUALIZAÇÃO DE DADOS]...`) caso estivessem salvos
 * no banco de dados antigo, mantendo no campo `systemPrompt` apenas as Regras de Negócio da Empresa.
 */
export function sanitizeVisibleBusinessRulesPrompt(rawPrompt: string): string {
	if (!rawPrompt || !rawPrompt.trim()) {
		return DEFAULT_COMPANY_BUSINESS_RULES;
	}

	let cleaned = rawPrompt;
	const directiveIdx = cleaned.indexOf('[DIRETIVA DE VISUALIZAÇÃO DE DADOS]');
	if (directiveIdx !== -1) {
		cleaned = cleaned.slice(0, directiveIdx).trim();
	}

	// Se após remover o bloco técnico legado restar apenas a frase genérica antiga sem as regras de faturamento líquido,
	// atualiza para o novo template de Regras de Negócio da Empresa
	if (
		!cleaned ||
		cleaned.includes('REGRA PADRÃO DE FATURAMENTO (VALOR LÍQUIDO MENOS DEVOLUÇÃO LÍQUIDA)') ||
		(!cleaned.toLowerCase().includes('devolução') &&
			!cleaned.toLowerCase().includes('devolucao') &&
			cleaned.length < 320)
	) {
		return DEFAULT_COMPANY_BUSINESS_RULES;
	}

	return cleaned;
}

export class AiConfigurationService implements IAiConfigurationService {
	private readonly prisma: PrismaClient;
	private readonly configId = 'ai-config';

	constructor(prisma: PrismaClient = prismaClient) {
		this.prisma = prisma;
	}

	public getInternalSystemDirectives(): string {
		return INTERNAL_GIDEON_SYSTEM_DIRECTIVES;
	}

	/**
	 * Combina as Regras de Negócio da Empresa (editáveis pelo Admin) com as Diretivas Técnicas Internas (ocultas no código).
	 */
	public buildFullSystemPrompt(businessRulesPrompt?: string): string {
		const cleanBusinessRules =
			businessRulesPrompt && businessRulesPrompt.trim()
				? sanitizeVisibleBusinessRulesPrompt(businessRulesPrompt)
				: DEFAULT_COMPANY_BUSINESS_RULES;

		return `${cleanBusinessRules}\n\n${INTERNAL_GIDEON_SYSTEM_DIRECTIVES}`;
	}

	async get(): Promise<PrismaAiConfig> {
		const existing = await this.prisma.aiConfiguration.findUnique({
			where: { id: this.configId },
		});

		if (existing) {
			const cleanVisiblePrompt = sanitizeVisibleBusinessRulesPrompt(existing.systemPrompt);
			if (cleanVisiblePrompt !== existing.systemPrompt && typeof this.prisma.aiConfiguration.update === 'function') {
				try {
					return await this.prisma.aiConfiguration.update({
						where: { id: this.configId },
						data: { systemPrompt: cleanVisiblePrompt },
					});
				} catch {
					return { ...existing, systemPrompt: cleanVisiblePrompt };
				}
			}
			return { ...existing, systemPrompt: cleanVisiblePrompt };
		}

		// Se ainda não existir no banco, cria com as Regras de Negócio padrão da empresa
		return this.prisma.aiConfiguration.create({
			data: {
				id: this.configId,
				...DEFAULT_AI_CONFIG,
			},
		});
	}

	async update(input: AiConfigurationInput): Promise<PrismaAiConfig> {
		// Garante que mesmo se enviarem acidentalmente diretivas internas de JSON, apenas as regras de negócio sejam salvas
		const cleanPrompt = input.systemPrompt.includes('[DIRETIVA DE VISUALIZAÇÃO DE DADOS]')
			? input.systemPrompt.slice(0, input.systemPrompt.indexOf('[DIRETIVA DE VISUALIZAÇÃO DE DADOS]')).trim() ||
			  DEFAULT_COMPANY_BUSINESS_RULES
			: input.systemPrompt.trim();

		return this.prisma.aiConfiguration.upsert({
			where: { id: this.configId },
			update: {
				systemPrompt: cleanPrompt,
				temperature: input.temperature,
				topP: input.topP,
				memorySize: input.memorySize,
			},
			create: {
				id: this.configId,
				systemPrompt: cleanPrompt,
				temperature: input.temperature,
				topP: input.topP,
				memorySize: input.memorySize,
			},
		});
	}
}

export const aiConfigurationService = new AiConfigurationService();
export default aiConfigurationService;
