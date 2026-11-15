import 'dotenv/config';
import { databaseBootstrapService } from '../services/database-bootstrap.service';
import prismaClient from '../config/prisma';

async function main() {
	console.info('[bootstrap-db] Inicializando estrutura do banco de dados PostgreSQL...');
	await databaseBootstrapService.bootstrap();
	console.info('[bootstrap-db] Concluído com sucesso.');
	await prismaClient.$disconnect();
	process.exit(0);
}

main().catch(async (err) => {
	console.error('[bootstrap-db] Erro ao sincronizar banco:', err);
	await prismaClient.$disconnect();
	process.exit(1);
});
