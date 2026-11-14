import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
process.env.SANKHYA_SERVICE_URL = process.env.SANKHYA_SERVICE_URL || 'https://api.sankhya.test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import {
	extractSqlSelectAliases,
	mergeExpectedFieldsWithQueryAliases,
} from '../utils/sql-alias-extractor';
import {
	selectSmartAxes,
	formatSmartAxisLabel,
} from '../utils/smart-axis-selector';
import { BuildSqlGenerationPromptUseCase } from '../modules/data-dictionary/application/use-cases/build-sql-generation-prompt.use-case';
import { MetaTableEntity } from '../modules/data-dictionary/domain/entities/meta-table.entity';
import { MetaColumnEntity } from '../modules/data-dictionary/domain/entities/meta-column.entity';

describe('Smart Axis Engineering & SQL Alias Auto-Extractor Suite', () => {
	describe('1. Auto-Extração de Aliases SQL (extractSqlSelectAliases & mergeExpectedFieldsWithQueryAliases)', () => {
		it('deve extrair todas as 11 colunas (incluindo CASE, SUM, TO_CHAR e concatenação) da query NOTA_FISCAL do Sankhya', () => {
			const notaFiscalSql = `
SELECT
    NF.NUMERO_NOTA||'-'||NF.EMPRESA_NOTA||'-'||NF.NUM_PEDIDO AS ID,
    NF.DESCROPER AS OPERACAO,
    NF.NUMERO_NOTA AS NOTA_FISCAL,
    NF.NUM_PEDIDO AS PEDIDO_ORIGEM,
    NF.COD_VENDEDOR AS COD_VENDEDOR,
    NF.COD_CLIENTE AS COD_CLIENTE,
    NF.EMPRESA_NOTA AS EMPRESA,
    CASE
        WHEN NF.TIPO = 'E' THEN 'ENTRADA'
        WHEN NF.TIPO = 'S' THEN 'SAIDA'
    END AS TIPO_MOVIMENTO,
    SUM(NF.VALOR_BRUTO) AS VALOR_BRUTO,
    SUM(NF.VALOR_LIQUIDO) AS VALOR_LIQUIDO,
    TO_CHAR(NF.DATA_EMISSAO, 'YYYY-MM-DD HH24:MI:SS') AS DATA_EMISSAO
FROM BI_NOTAS_FISCAIS NF
WHERE NF.DATA_EMISSAO >= '01/10/2026'
GROUP BY NF.NUMERO_NOTA`;

			const aliases = extractSqlSelectAliases(notaFiscalSql);
			assert.deepEqual(aliases, [
				'ID',
				'OPERACAO',
				'NOTA_FISCAL',
				'PEDIDO_ORIGEM',
				'COD_VENDEDOR',
				'COD_CLIENTE',
				'EMPRESA',
				'TIPO_MOVIMENTO',
				'VALOR_BRUTO',
				'VALOR_LIQUIDO',
				'DATA_EMISSAO',
			]);

			const incompleteExpected = ['ID', 'OPERACAO', 'NOTA_FISCAL', 'COD_VENDEDOR', 'COD_CLIENTE', 'EMPRESA'];
			const merged = mergeExpectedFieldsWithQueryAliases(notaFiscalSql, incompleteExpected);
			assert.equal(merged.length, 11);
			assert.ok(merged.includes('DATA_EMISSAO'));
			assert.ok(merged.includes('VALOR_LIQUIDO'));
			assert.ok(merged.includes('VALOR_BRUTO'));
		});
	});

	describe('2. Seleção Semântica de Eixos (SmartAxisSelector)', () => {
		it('deve selecionar a coluna de data/dia no Eixo X e valor monetário no Eixo Y para gráficos de linha (evolução diária)', () => {
			const rows = [
				{ nota_fiscal: '124323', data_emissao: '2026-10-01 00:00:00', faturamento_total: '15420.50' },
				{ nota_fiscal: '124324', data_emissao: '2026-10-02 00:00:00', faturamento_total: '22100.00' },
			];

			const axes = selectSmartAxes(rows, 'line', 'Evolução diária do faturamento em outubro');
			assert.equal(axes.labelKey, 'data_emissao', 'Deve escolher data_emissao em vez de nota_fiscal');
			assert.equal(axes.numericKey, 'faturamento_total', 'Deve escolher faturamento_total em vez de nota_fiscal');
			assert.equal(axes.isTemporal, true);
			assert.equal(axes.isCurrency, true);
		});

		it('deve selecionar razaosocial/nome descritivo no Eixo X em vez de cod_cliente em gráficos de ranking/barra', () => {
			const rows = [
				{ cod_cliente: '105', razaosocial: 'SUPERMERCADO ALFA LTDA', valor_liquido: 85000 },
				{ cod_cliente: '208', razaosocial: 'ATACADAO BETA S/A', valor_liquido: 64000 },
			];

			const axes = selectSmartAxes(rows, 'horizontal-bar', 'Top clientes por faturamento');
			assert.equal(axes.labelKey, 'razaosocial', 'Deve priorizar razaosocial sobre cod_cliente');
			assert.equal(axes.numericKey, 'valor_liquido');
			assert.equal(axes.isCurrency, true);
		});

		it('deve formatar timestamps ISO para DD/MM e números de dia para Dia XX no Eixo X', () => {
			assert.equal(formatSmartAxisLabel('2026-10-05 00:00:00', 'data_emissao'), '05/10');
			assert.equal(formatSmartAxisLabel('2026-10-18', 'data'), '18/10');
			assert.equal(formatSmartAxisLabel('2026-10', 'mes'), '10/2026');
			assert.equal(formatSmartAxisLabel('3', 'dia'), 'Dia 03');
			assert.equal(formatSmartAxisLabel('15/10', 'dia'), '15/10');
		});
	});

	describe('3. Diretrizes de Granularidade Temporal no Prompt Text-to-SQL', () => {
		it('deve instruir agrupamento por DD/MM e proibir nota_fiscal no eixo X de séries temporais', () => {
			const builder = new BuildSqlGenerationPromptUseCase();
			const table = new MetaTableEntity({
				tenantId: 'default',
				tableName: 'erp_nota_fiscal',
				description: 'Notas fiscais de venda',
				columns: [
					new MetaColumnEntity({ columnName: 'ID', description: 'PK', isPrimaryKey: true }),
					new MetaColumnEntity({ columnName: 'DATA_EMISSAO', description: 'Data de emissão' }),
					new MetaColumnEntity({ columnName: 'VALOR_LIQUIDO', description: 'Valor líquido' }),
				],
			});

			const out = builder.execute({
				question: 'Evolução do faturamento no mês de outubro por dia',
				schemaGraph: {
					primaryTables: [table],
					expandedTables: [],
					allTables: [table],
					joinPaths: [],
				},
			});

			assert.ok(out.systemPrompt.includes("TO_CHAR(CAST(data_emissao AS TIMESTAMP), 'DD/MM')"));
			assert.ok(out.systemPrompt.includes('PROIBIDO colocar nota_fiscal'));
		});
	});
});
