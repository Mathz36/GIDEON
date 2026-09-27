import aiConfigurationService, { AiConfigurationInput } from './ai-configuration.service';
import type { AiConfiguration } from '@prisma/client';

export type AIConfigurationInput = AiConfigurationInput;
export type AIConfiguration = AiConfiguration;

export class AIConfigurationStore {
	static async list(): Promise<AIConfiguration[]> {
		const config = await aiConfigurationService.get();
		return [config];
	}

	static async get(): Promise<AIConfiguration | undefined> {
		const config = await aiConfigurationService.get();
		return config ?? undefined;
	}

	static async create(input: AIConfigurationInput): Promise<AIConfiguration> {
		return aiConfigurationService.update(input);
	}

	static async update(input: AIConfigurationInput): Promise<AIConfiguration | undefined> {
		return aiConfigurationService.update(input);
	}
}

export default AIConfigurationStore;