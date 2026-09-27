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
	systemPrompt: 'Você é Gideon, um assistente útil e objetivo. Responda em Markdown quando isso melhorar a clareza.',
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

