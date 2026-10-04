import { bundleDefaults } from './bundle-defaults';
import { isStartupError, type RunningServer, startServer } from './server';

// Einstieg für die Befehlszeile (`pnpm start`, `pnpm dev`). Die Mac-App benutzt `startServer` über `embedded.ts`.
async function main(): Promise<void> {
  let server: RunningServer;
  try {
    server = await startServer(bundleDefaults(process.env));
  } catch (error) {
    if (isStartupError(error)) {
      console.error(`Pagewise startet nicht.\n${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  console.log(`Pagewise läuft auf ${server.url}`);
  console.log(`Datenverzeichnis: ${server.dataDir}`);

  // Solange noch kein Passcode gesetzt ist, braucht die Einrichtung diesen Code. Er gilt nur bis zur
  // Einrichtung (D-021) und steht deshalb nur hier in der Konsole.
  const setupCode = server.setupCode();
  if (setupCode) {
    console.log('');
    console.log('Pagewise ist noch nicht eingerichtet.');
    console.log(`Einrichtungscode: ${setupCode}`);
    console.log(`Öffne ${server.url} und lege deinen Passcode fest.`);
  }

  const shutdown = (): void => {
    void server.stop({ timeoutMs: 4_000 }).finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 6_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
