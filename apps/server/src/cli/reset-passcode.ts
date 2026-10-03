import { resetAccess } from '../auth/reset';
import { DataDirError, prepareDataDir } from '../data-dir';
import { DatabaseError } from '../db/client';
import { APP_ROOT } from '../paths';
import { createServices } from '../services';

// Setzt den Passcode zurück, falls er vergessen wurde. Aufruf (Server vorher beenden):
//   pnpm --filter @pagewise/server reset-passcode
function main(): void {
  try {
    const dataDir = prepareDataDir(process.env, { appRoot: APP_ROOT });
    const services = createServices(dataDir);
    try {
      resetAccess(services.database.db);
    } finally {
      services.close();
    }
    console.log(
      'Der Passcode und alle Sitzungen wurden entfernt. Deine Fächer und Daten bleiben erhalten.',
    );
    console.log('Starte Pagewise neu: Die Konsole zeigt dann einen neuen Einrichtungscode.');
  } catch (error) {
    if (error instanceof DataDirError || error instanceof DatabaseError) {
      console.error(`Zurücksetzen nicht möglich.\n${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

main();
