import { bundleDefaults } from './bundle-defaults';
import { runEmbedded } from './control/embedded';

// Einstieg für die Mac-App: läuft als `utilityProcess` von Electron und spricht über `process.parentPort`.
// Die Umgebung stellt die App ausdrücklich zusammen (Allowlist), der Server erbt nichts.
interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', handler: (event: { data: unknown }) => void): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!parentPort) {
  console.error(
    'embedded.ts läuft nur als Electron-utilityProcess. Für die Befehlszeile gibt es main.ts.',
  );
  process.exit(1);
}

const handle = runEmbedded(
  {
    post: (message) => parentPort.postMessage(message),
    onMessage: (handler) => parentPort.on('message', (event) => handler(event.data)),
  },
  bundleDefaults(process.env),
);
void handle.done.then(() => process.exit(0));
