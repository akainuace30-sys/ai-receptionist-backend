import dotenv from 'dotenv';
import app from './src/app.js';
import { runMigrations } from './src/db/index.js';
import { logger } from './src/services/logger.js';

dotenv.config();

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  await runMigrations();
  app.listen(PORT, () => {
    logger.info('server_started', { port: PORT });
  });
}

bootstrap();
