import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// Configura variáveis de ambiente e mock global do Prisma antes da importação dinâmica
// para evitar inicialização de binário nativo do PrismaClient em ambiente de teste isolado/CI
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini-api-key-ci';
process.env.SANKHYA_SERVICE_URL = process.env.SANKHYA_SERVICE_URL || 'https://api.sankhya.test/dbexplorer';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/gideon_test';

const globalForPrisma = globalThis as unknown as { prisma?: any };
if (!globalForPrisma.prisma) {
	globalForPrisma.prisma = {
		$queryRawUnsafe: async () => [],
		$executeRawUnsafe: async () => 0,
	};
}

describe('DynamicTableManager - Deterministic Row Hash & Incremental Sync Comparator Suite', () => {
	let DynamicTableManagerClass: any;
	let manager: any;

	before(async () => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const mod = require('../services/dynamic-table.manager');
		DynamicTableManagerClass = mod.DynamicTableManager;

		const mockPrisma = {} as any;
		const mockSankhyaGateway = {
			executeQuery: async () => [],
		};

		manager = new DynamicTableManagerClass(mockPrisma, mockSankhyaGateway);
	});

	describe('1. Determinismo na Ordenação de Chaves (Key-Order Independence)', () => {
		it('deve produzir exatamente o mesmo hash MD5 para objetos com as mesmas propriedades em ordens diferentes ({ a: 1, b: "x" } vs { b: "x", a: 1 })', () => {
			const rowOrderA = { a: 1, b: 'x' };
			const rowOrderB = { b: 'x', a: 1 };

			const hashA = manager.generateRowHash(rowOrderA);
			const hashB = manager.generateRowHash(rowOrderB);

			assert.equal(hashA.length, 32, 'O hash gerado deve ser um MD5 hexadecimal de 32 caracteres');
			assert.equal(hashA, hashB, 'A ordem das propriedades no objeto não pode alterar o hash MD5');
		});

		it('deve produzir o mesmo hash para registros complexos do ERP independentemente da ordem das colunas retornadas pelo Sankhya', () => {
			const erpRow1 = {
				CODPARC: '5012',
				NOMEPARC: ' DISTRIBUIDORA ALFA LTDA ',
				LIMITE_CREDITO: 10000,
				ATIVO: 'S',
				CIDADE: 'São Paulo',
			};

			const erpRow2 = {
				CIDADE: 'São Paulo',
				ATIVO: 'S',
				LIMITE_CREDITO: '10000',
				CODPARC: 5012,
				NOMEPARC: 'DISTRIBUIDORA ALFA LTDA',
			};

			assert.equal(
				manager.generateRowHash(erpRow1),
				manager.generateRowHash(erpRow2),
				'Registros equivalentes com chaves reordenadas e espaços periféricos devem gerar o mesmo hash',
			);
		});
	});

	describe('2. Tratamento de null vs undefined e Exclusão de Metadados Internos', () => {
		it('deve tratar null, undefined e string vazia de forma consistente sem gerar falsos positivos', () => {
			const rowWithNull = { codparc: '100', observacao: null, telefone: undefined };
			const rowWithUndefined = { codparc: '100', observacao: undefined, telefone: null };
			const rowWithEmpty = { codparc: '100', observacao: '', telefone: '   ' };

			const hashNull = manager.generateRowHash(rowWithNull);
			const hashUndefined = manager.generateRowHash(rowWithUndefined);
			const hashEmpty = manager.generateRowHash(rowWithEmpty);

			assert.equal(hashNull, hashUndefined, 'Campos null e undefined devem produzir o mesmo hash');
			assert.equal(hashNull, hashEmpty, 'Campos null/undefined e strings vazias/whitespace devem ser normalizados igualmente');
		});

		it('deve ignorar metadados técnicos internos (_id, _row_hash, _synced_at, created_at) no cálculo do hash', () => {
			const cleanErpRow = {
				codparc: '2050',
				nomeparc: 'Indústria Beta S/A',
				limite_credito: '50000.00',
			};

			const persistedDbRow = {
				_id: 98123,
				codparc: '2050',
				nomeparc: 'Indústria Beta S/A',
				limite_credito: '50000.00',
				_row_hash: 'f4a1b2c3d4e5f678901234567890abcd',
				_synced_at: '2026-10-20T12:00:00.000Z',
				created_at: '2026-01-01T00:00:00.000Z',
			};

			assert.equal(
				manager.generateRowHash(cleanErpRow),
				manager.generateRowHash(persistedDbRow),
				'Metadados de auditoria do banco não podem contaminar o cálculo do hash de negócio',
			);
		});
	});

	describe('3. Detecção Precisa de Alterações Reais de Valores de Negócio', () => {
		it('deve gerar hashes diferentes quando um valor numérico ou textual real é modificado (ex: limite_credito de 10000 para 12000)', () => {
			const beforeUpdate = {
				codparc: '3001',
				nomeparc: 'Comércio Delta',
				limite_credito: 10000,
				ativo: 'S',
			};

			const afterCreditChange = {
				codparc: '3001',
				nomeparc: 'Comércio Delta',
				limite_credito: 12000,
				ativo: 'S',
			};

			const afterStatusChange = {
				codparc: '3001',
				nomeparc: 'Comércio Delta',
				limite_credito: 10000,
				ativo: 'N',
			};

			const hashBefore = manager.generateRowHash(beforeUpdate);
			const hashAfterCredit = manager.generateRowHash(afterCreditChange);
			const hashAfterStatus = manager.generateRowHash(afterStatusChange);

			assert.notEqual(
				hashBefore,
				hashAfterCredit,
				'Mudança de limite de crédito de 10000 para 12000 DEVE alterar o hash MD5',
			);
			assert.notEqual(
				hashBefore,
				hashAfterStatus,
				'Mudança de status ativo de S para N DEVE alterar o hash MD5',
			);
		});
	});

	describe('4. Sincronização Incremental HASH_COMPARATOR (Skip Unchanged vs Upsert Changed)', () => {
		it('deve ignorar registros cujo _row_hash no banco seja idêntico e fazer upsert apenas dos registros novos ou alterados', async () => {
			const unchangedRow = { CODPARC: '10', NOMEPARC: 'Cliente Inalterado', LIMITE_CREDITO: '10000' };
			const changedRow = { CODPARC: '20', NOMEPARC: 'Cliente Alterado', LIMITE_CREDITO: '12000' };
			const newRow = { CODPARC: '30', NOMEPARC: 'Cliente Novo', LIMITE_CREDITO: '5000' };

			const unchangedHash = manager.generateRowHash(unchangedRow);
			const oldHashForRow20 = manager.generateRowHash({
				CODPARC: '20',
				NOMEPARC: 'Cliente Alterado',
				LIMITE_CREDITO: '10000', // Valor antigo no banco era 10000
			});

			const executedSqlStatements: string[] = [];

			const mockPrisma = {
				$executeRawUnsafe: async (sql: string) => {
					executedSqlStatements.push(sql);
					return 1;
				},
				$queryRawUnsafe: async (sql: string) => {
					if (sql.includes('information_schema.columns')) {
						return [
							{ column_name: '_id', data_type: 'bigint' },
							{ column_name: 'codparc', data_type: 'text' },
							{ column_name: 'nomeparc', data_type: 'text' },
							{ column_name: 'limite_credito', data_type: 'text' },
							{ column_name: '_row_hash', data_type: 'text' },
							{ column_name: '_synced_at', data_type: 'timestamp with time zone' },
						];
					}
					if (sql.includes('SELECT "codparc"::text AS "pk", "_row_hash"')) {
						return [
							{ pk: '10', _row_hash: unchangedHash },
							{ pk: '20', _row_hash: oldHashForRow20 },
						];
					}
					if (sql.includes('SELECT "codparc"::text AS "pk" FROM')) {
						return [{ pk: '10' }, { pk: '20' }, { pk: '30' }];
					}
					return [];
				},
				erpConfiguration: {
					update: async () => ({}),
				},
			} as any;

			const mockSankhya = {
				executeQuery: async () => [
					{ ...unchangedRow },
					{ ...changedRow },
					{ ...newRow },
				],
			};

			const syncManager = new DynamicTableManagerClass(mockPrisma, mockSankhya);

			const result = await syncManager.hashComparatorSync({
				id: 'cfg-test-1',
				name: 'Clientes',
				tableName: 'erp_clientes',
				query: 'SELECT CODPARC, NOMEPARC, LIMITE_CREDITO FROM TGFPAR',
				expectedFields: ['CODPARC', 'NOMEPARC', 'LIMITE_CREDITO'],
				primaryKey: 'CODPARC',
				syncStrategy: 'HASH_COMPARATOR',
				batchSize: 100,
			});

			assert.equal(result.strategy, 'HASH_COMPARATOR');
			assert.equal(result.totalProcessed, 3, 'Deve processar as 3 linhas retornadas pelo ERP');
			assert.equal(result.totalSkipped, 1, 'Deve pular exatamente 1 linha inalterada (CODPARC 10)');
			assert.equal(result.totalUpserted, 2, 'Deve fazer upsert apenas das 2 linhas novas/modificadas (CODPARC 20 e 30)');
			assert.equal(result.totalDeleted, 0, 'Nenhuma linha deve ser deletada quando todas as PKs permanecem presentes');
		});
	});
});
