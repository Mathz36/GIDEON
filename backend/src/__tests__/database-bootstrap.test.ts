import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseBootstrapService } from '../services/database-bootstrap.service';

describe('DatabaseBootstrapService Suite — Inicialização Automática e Idempotente do Banco', () => {
	it('deve executar todas as 11 tabelas com CREATE TABLE IF NOT EXISTS sem tocar em tabelas erp_*', async () => {
		const executedSqls: string[] = [];
		const mockPrisma = {
			$executeRawUnsafe: async (sql: string) => {
				executedSqls.push(sql);
				return 0;
			},
		} as any;

		const service = new DatabaseBootstrapService(mockPrisma);
		await service.bootstrap();

		assert.ok(executedSqls.length >= 10, 'Deve executar DDLs para todas as tabelas');

		// Verifica presença de todas as tabelas essenciais
		const allSql = executedSqls.join('\n');
		assert.ok(allSql.includes('CREATE TABLE IF NOT EXISTS "ai_configurations"'));
		assert.ok(allSql.includes('CREATE TABLE IF NOT EXISTS "erp_configurations"'));
		assert.ok(allSql.includes('CREATE TABLE IF NOT EXISTS "meta_tables"'));
		assert.ok(allSql.includes('CREATE TABLE IF NOT EXISTS "meta_columns"'));
		assert.ok(allSql.includes('CREATE TABLE IF NOT EXISTS "usuarios"'));
		assert.ok(allSql.includes('CREATE TABLE IF NOT EXISTS "user_dashboards"'));
		assert.ok(allSql.includes('CREATE TABLE IF NOT EXISTS "dashboard_widgets"'));
		assert.ok(allSql.includes('CREATE TABLE IF NOT EXISTS "chat_conversations"'));
		assert.ok(allSql.includes('CREATE TABLE IF NOT EXISTS "chat_messages"'));
		assert.ok(allSql.includes('CREATE TABLE IF NOT EXISTS "user_memories"'));
		assert.ok(allSql.includes('CREATE TABLE IF NOT EXISTS "chat_feedbacks"'));

		// Garante que nenhuma tabela erp_* dinâmica é citada ou alterada
		assert.equal(allSql.includes('erp_clientes'), false);
		assert.equal(allSql.includes('erp_produtos'), false);
		assert.equal(allSql.includes('erp_nota_fiscal'), false);
		assert.equal(allSql.includes('DROP TABLE'), false);
		assert.equal(allSql.includes('TRUNCATE'), false);
	});

	it('deve ser estritamente idempotente (não executar novamente na mesma instância se já inicializado)', async () => {
		let callCount = 0;
		const mockPrisma = {
			$executeRawUnsafe: async () => {
				callCount++;
				return 0;
			},
		} as any;

		const service = new DatabaseBootstrapService(mockPrisma);
		await service.bootstrap();
		const countAfterFirst = callCount;
		assert.ok(countAfterFirst > 0);

		// Segunda chamada não deve reexecutar nada
		await service.bootstrap();
		assert.equal(callCount, countAfterFirst);
	});
});
