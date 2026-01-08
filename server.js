import dotenv from 'dotenv';
import app from './src/app.js';
import { runMigrations } from './src/db/index.js';

dotenv.config();

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  await runMigrations();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

bootstrap();
