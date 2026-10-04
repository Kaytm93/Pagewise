import { resetAccess } from './auth/reset';
import { acquireInstanceLock } from './instance-lock';
import type { ResourcePaths } from './paths';
import { createServices } from './services';

/**
 * Entfernt Passcode und alle Sitzungen, Fächer und Daten bleiben (D-021). Gedacht für die Befehlszeile und
 * für einen Menüpunkt der Mac-App, damit niemand ein Terminal braucht. Läuft gerade ein Server auf diesem
 * Datenverzeichnis, bricht es mit einer Erklärung ab (`InstanceLockError`): Zwei Prozesse auf einer Datenbank
 * wären nicht sicher, und der laufende Server würde den neuen Einrichtungscode erst beim nächsten Start erzeugen.
 */
export function resetPasscode(
  dataDir: string,
  options: { resources?: ResourcePaths; sqliteBinding?: string } = {},
): void {
  const lock = acquireInstanceLock(dataDir);
  try {
    const services = createServices(dataDir, options);
    try {
      resetAccess(services.database.db);
    } finally {
      services.close();
    }
  } finally {
    lock.release();
  }
}
