import { DataDirError, prepareDataDir } from '../data-dir';
import { DatabaseError } from '../db/client';
import { InstanceLockError } from '../instance-lock';
import { resolveResources } from '../paths';
import { resetPasscode } from '../reset-passcode';

// Setzt den Passcode zurück, falls er vergessen wurde. Aufruf (Server vorher beenden):
//   pnpm --filter @pagewise/server reset-passcode
function main(): void {
  try {
    const resources = resolveResources(process.env);
    const dataDir = prepareDataDir(process.env, { appRoot: resources.root });
    resetPasscode(dataDir, { resources });
    console.log(
      'Der Passcode und alle Sitzungen wurden entfernt. Deine Fächer und Daten bleiben erhalten.',
    );
    console.log('Starte Pagewise neu: Die Konsole zeigt dann einen neuen Einrichtungscode.');
  } catch (error) {
    if (
      error instanceof DataDirError ||
      error instanceof DatabaseError ||
      error instanceof InstanceLockError
    ) {
      console.error(`Zurücksetzen nicht möglich.\n${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

main();
