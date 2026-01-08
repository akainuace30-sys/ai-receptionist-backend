import dotenv from 'dotenv';
import app from './src/app.js';
import { runMigrations } from './src/services/db.js';

dotenv.config();

const PORT = process.env.PORT || 3000;

async function start() {
  await runMigrations();
  app.listen(PORT, () => {
    process.stdout.write(`Server listening on ${PORT}\n`);
  });
}

start();
