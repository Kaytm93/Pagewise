import { defineConfig } from 'drizzle-kit';

// Nur zum Erzeugen von Migrationen (`pnpm --filter @pagewise/server db:generate`).
// Zur Laufzeit führt der Server die SQL-Dateien aus `drizzle/` selbst aus.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
