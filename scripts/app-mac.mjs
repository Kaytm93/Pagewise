// Baut Pagewise.app für diesen Mac und legt sie nach ~/Applications (D-055, Stufe 1: lokal gebaut, ohne Apple-Konto).
//
//   pnpm app:mac                    baut für die Architektur dieses Macs und installiert
//   pnpm app:mac --no-install       baut nur, nennt den Ort
//   pnpm app:mac --arch x64         andere Architektur (Standard: die dieses Macs)
//   pnpm app:mac --dest <Ordner>    anderer Zielordner (Standard: ~/Applications)
//
// Das Skript führt nur feste Programme ohne Shell aus (pnpm, pgrep, ditto, codesign) und überspringt keine
// Sicherheitsabfrage von macOS. Ein lokal gebautes Programm trägt keine Quarantäne-Markierung und wird von
// Gatekeeper deshalb nicht blockiert (anders als ein heruntergeladenes).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHS = ['arm64', 'x64'];

export class UsageError extends Error {}

/** Liest die Befehlszeile. Wirft `UsageError` bei Unbekanntem (kein stilles Ignorieren). */
export function parseArgs(argv, hostArch, home = homedir()) {
  const options = {
    arch: ARCHS.includes(hostArch) ? hostArch : 'arm64',
    install: true,
    dest: join(home, 'Applications'),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-install') {
      options.install = false;
    } else if (arg === '--arch') {
      const value = argv[++i];
      if (!ARCHS.includes(value)) throw new UsageError('--arch erwartet arm64 oder x64.');
      options.arch = value;
    } else if (arg === '--dest') {
      const value = argv[++i];
      if (!value) throw new UsageError('--dest erwartet einen Ordner.');
      options.dest = resolve(value);
    } else {
      throw new UsageError(`Unbekannte Option: ${arg}`);
    }
  }
  return options;
}

/** Wo der Packager die App ablegt. */
export function builtAppPath(arch, root = repoRoot) {
  return join(root, 'apps', 'desktop', 'out', `Pagewise-darwin-${arch}`, 'Pagewise.app');
}

function run(command, args) {
  execFileSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
}

function isRunning() {
  // pgrep -x: genauer Programmname, kein Muster aus der eigenen Kommandozeile.
  return spawnSync('pgrep', ['-x', 'Pagewise']).status === 0;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2), process.arch);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      console.error('Aufruf: pnpm app:mac [--no-install] [--arch arm64|x64] [--dest <Ordner>]');
      process.exit(2);
    }
    throw error;
  }
  if (process.platform !== 'darwin') {
    console.error(
      'Pagewise.app lässt sich nur auf einem Mac bauen und signieren (macOS). Hier läuft sie nicht: ' +
        'führe den Befehl auf dem Mac aus.',
    );
    process.exit(1);
  }

  if (options.install && isRunning()) {
    console.error(
      'Pagewise läuft gerade. Beende es zuerst (Cmd+Q in Pagewise oder Menüleisten-Symbol → Beenden) und starte den Befehl erneut.',
    );
    process.exit(1);
  }

  // Der Paketierer baut zuerst die Oberfläche und den Server (scripts/build.ts), dann die App.
  run('pnpm', [
    '--filter',
    '@pagewise/desktop',
    'package',
    '--platform',
    'darwin',
    '--arch',
    options.arch,
  ]);
  const built = builtAppPath(options.arch);
  if (!existsSync(built)) {
    console.error(`Die App wurde nicht gefunden: ${built}`);
    process.exit(1);
  }
  if (!options.install) {
    console.log(`Fertig (nicht installiert): ${built}`);
    return;
  }

  mkdirSync(options.dest, { recursive: true });
  const target = join(options.dest, 'Pagewise.app');
  rmSync(target, { recursive: true, force: true });
  // `ditto` kopiert Pakete wie der Finder (Symlinks, Rechte, erweiterte Attribute bleiben, die Signatur bleibt gültig).
  execFileSync('ditto', [built, target], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', target], { stdio: 'inherit' });
  console.log(`Installiert: ${target}`);
  console.log(`Starten: open "${target}"`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
