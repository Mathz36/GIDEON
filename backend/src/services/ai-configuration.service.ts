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
}

const DEFAULT_AI_CONFIG: AiConfigurationInput = {
	systemPrompt: `Você é Gideon, uma inteligência artificial corporativa e consultor executivo de negócios integrado ao banco de dados do ERP.
Responda sempre em linguagem natural, profissional e consultiva.

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
2. Para gráficos ("type": "bar", "line", "pie"): Use "name" para o eixo X (rótulos) e "value" ou "total" para o eixo Y (valores numéricos).
3. Para tabelas ("type": "table"): O array "data" pode conter objetos com múltiplas chaves livres, que se tornarão as colunas.`,
	temperature: 0.7,
	topP: 0.9,
	memorySize: 10,
};

export class AiConfigurationService implements IAiConfigurationService {
	private readonly prisma: PrismaClient;
	private readonly configId = 'ai-config';

	constructor(prisma: PrismaClient = prismaClient) {
		this.prisma = prisma;
	}

	async get(): Promise<PrismaAiConfig> {
		const existing = await this.prisma.aiConfiguration.findUnique({
			where: { id: this.configId },
		});

		if (existing) {
			return existing;
		}

		// Se ainda não existir no banco, cria com as configurações padrão
		return this.prisma.aiConfiguration.create({
			data: {
				id: this.configId,
				...DEFAULT_AI_CONFIG,
			},
		});
	}

	async update(input: AiConfigurationInput): Promise<PrismaAiConfig> {
		return this.prisma.aiConfiguration.upsert({
			where: { id: this.configId },
			update: {
				systemPrompt: input.systemPrompt.trim(),
				temperature: input.temperature,
				topP: input.topP,
				memorySize: input.memorySize,
			},
			create: {
				id: this.configId,
				systemPrompt: input.systemPrompt.trim(),
				temperature: input.temperature,
				topP: input.topP,
				memorySize: input.memorySize,
			},
		});
	}
}

export const aiConfigurationService = new AiConfigurationService();
export default aiConfigurationService;

