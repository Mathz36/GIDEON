import erpConfigurationService, { ErpConfigurationInput as ServiceInput } from './erp-configuration.service';
import type { ErpConfiguration as PrismaErpConfig } from '@prisma/client';

export type ErpConfigurationInput = ServiceInput;
export type ErpConfiguration = PrismaErpConfig;

export class ErpConfigurationStore {
	static async list(): Promise<ErpConfiguration[]> {
		return erpConfigurationService.list();
	}

	static async getById(id: string): Promise<ErpConfiguration | null> {
		return erpConfigurationService.getById(id);
	}

	static async create(input: ErpConfigurationInput): Promise<ErpConfiguration> {
		return erpConfigurationService.create(input);
	}

	static async update(id: string, input: ErpConfigurationInput): Promise<ErpConfiguration | undefined> {
		const updated = await erpConfigurationService.update(id, input);
		return updated ?? undefined;
	}

	static async remove(id: string): Promise<boolean> {
		return erpConfigurationService.delete(id);
	}
}

export default ErpConfigurationStore;
