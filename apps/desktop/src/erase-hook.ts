/**
 * „Alles löschen“ im Server (D-032) räumt dessen Daten. Das Fenster hat eigene (Speicher, Cache, Service Worker):
 * Hat der Server das Löschen bestätigt (`POST /api/data/erase` mit 204), leert die App auch diese. Cookies bleiben,
 * wie im Server die Anmeldung (D-032): Passcode und Anmeldung bestehen weiter.
 */
export const ERASE_PATH = '/api/data/erase';

export const ERASE_DATA_TYPES = [
  'cache',
  'localStorage',
  'indexedDB',
  'serviceWorkers',
  'fileSystems',
  'webSQL',
] as const;

export function isEraseSuccess(
  details: { method: string; statusCode: number; url: string },
  origin: string,
): boolean {
  return (
    details.method === 'POST' &&
    details.statusCode === 204 &&
    details.url === `${origin}${ERASE_PATH}`
  );
}
