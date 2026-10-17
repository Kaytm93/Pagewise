// Setzt eine vorbereitete Pagewise.app ein und startet sie (D-057). Die App ruft dieses Skript losgelöst von sich auf
// und beendet sich dann; es wartet auf ihr Ende, tauscht die Ordner und öffnet die neue Fassung.
//
//   node scripts/apply-update.mjs --pid <Nummer> --built <neue App> --dest <installierte App> \
//        --backup <Ort der alten App> --result <Ergebnisdatei.json> [--no-open] [--wait <Sekunden>]
//
// Ablauf (jeder Schritt bricht ab und stellt den alten Stand wieder her, wenn etwas schiefgeht):
//   1. Warten, bis die laufende App beendet ist (höchstens --wait Sekunden, Voreinstellung 90; danach nichts ändern).
//   2. Die alte App an den Backup-Ort verschieben (die vorherige Sicherung wird dabei ersetzt).
//   3. Die neue App an den Platz der alten verschieben (auf demselben Datenträger ist das ein Umbenennen).
//   4. Die Signatur der neuen App prüfen (`codesign --verify --deep --strict`).
//   5. Ergebnis in die Ergebnisdatei schreiben (die neue App meldet es beim Start), dann die App öffnen.
//
// Das Skript führt nur feste Programme ohne Shell aus (ditto, codesign, open), nimmt nur absolute Pfade an und
// verschiebt oder löscht nichts außerhalb der drei übergebenen Orte. Es überspringt keine Sicherheitsabfrage von macOS.
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export class UsageError extends Error {}

const DEFAULT_WAIT_SECONDS = 90;
const SETTLE_MS = 800;

/** Liest die Befehlszeile. Wirft `UsageError` bei Unbekanntem oder Unvollständigem. */
export function parseArgs(argv) {
  const options = { open: true, waitSeconds: DEFAULT_WAIT_SECONDS };
  const paths = {
    '--built': 'built',
    '--dest': 'dest',
    '--backup': 'backup',
    '--result': 'result',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-open') {
      options.open = false;
    } else if (arg === '--pid' || arg === '--wait') {
      const raw = argv[++i];
      const value = Number(raw);
      if (!/^\d+$/.test(raw ?? '') || !Number.isSafeInteger(value) || value < 1) {
        throw new UsageError(`${arg} erwartet eine positive ganze Zahl.`);
      }
      options[arg === '--pid' ? 'pid' : 'waitSeconds'] = value;
    } else if (arg !== undefined && arg in paths) {
      const value = argv[++i];
      if (!value) throw new UsageError(`${arg} erwartet einen Pfad.`);
      options[paths[arg]] = value;
    } else {
      throw new UsageError(`Unbekannte Option: ${arg}`);
    }
  }
  for (const [flag, key] of [['--pid', 'pid'], ...Object.entries(paths)]) {
    if (options[key] === undefined) throw new UsageError(`${flag} fehlt.`);
  }
  return options;
}

const isInside = (child, parent) => child === parent || child.startsWith(parent + sep);

/** Prüft die Pfade, bevor irgendetwas verschoben wird. Wirft `UsageError`. */
export function validate(options) {
  const { built, dest, backup, result } = options;
  for (const [name, path] of Object.entries({ built, dest, backup, result })) {
    if (!isAbsolute(path) || resolve(path) !== path || /[\0\n\r]/.test(path)) {
      throw new UsageError(`${name}: erwartet einen sauberen, absoluten Pfad.`);
    }
  }
  if (!dest.endsWith('.app') || !built.endsWith('.app')) {
    throw new UsageError('built und dest müssen App-Pakete (.app) sein.');
  }
  if (basename(backup) !== 'Pagewise.app' || basename(dirname(backup)) !== 'backup') {
    throw new UsageError('backup muss auf …/backup/Pagewise.app zeigen.');
  }
  if (!result.endsWith('.json')) throw new UsageError('result muss eine .json-Datei sein.');
  const places = { built, dest, backup };
  for (const [a, pathA] of Object.entries(places)) {
    for (const [b, pathB] of Object.entries(places)) {
      if (a !== b && isInside(pathA, pathB)) {
        throw new UsageError(`${a} und ${b} dürfen sich nicht überlappen.`);
      }
    }
  }
}

export function realDeps() {
  return {
    platform: process.platform,
    now: () => Date.now(),
    sleep: (ms) => sleep(ms),
    isAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return error?.code === 'EPERM';
      }
    },
    exists: (path) => existsSync(path),
    mkdir: (path) => mkdirSync(path, { recursive: true, mode: 0o700 }),
    rename: (from, to) => renameSync(from, to),
    remove: (path) => rmSync(path, { recursive: true, force: true }),
    // Pakete kopiert `ditto` wie der Finder (Rechte, Symlinks und Signatur bleiben erhalten).
    copy: (from, to) => execFileSync('ditto', [from, to], { stdio: 'ignore' }),
    verify: (app) =>
      execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], {
        stdio: 'ignore',
      }),
    open: (app) => execFileSync('open', [app], { stdio: 'ignore' }),
    readText: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    writeText: (path, text) => {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, text, { mode: 0o600 });
    },
    appendText: (path, text) => {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      appendFileSync(path, text, { mode: 0o600 });
    },
  };
}

/**
 * Führt den Austausch aus. Gibt `{ ok, message }` zurück und schreibt dasselbe in die Ergebnisdatei. Ändert nichts, wenn
 * die App sich nicht beendet; stellt die alte App wieder her, wenn das Einsetzen scheitert.
 */
export async function applyUpdate(options, deps = realDeps()) {
  const { pid, built, dest, backup, result } = options;
  const logFile = join(dirname(result), 'apply.log');
  const log = (text) => {
    try {
      deps.appendText(logFile, `${new Date(deps.now()).toISOString()} ${text}\n`);
    } catch {
      // Das Protokoll ist Komfort.
    }
  };
  const finish = async (ok, message, { reopen = true } = {}) => {
    log(`${ok ? 'fertig' : 'gescheitert'}: ${message}`);
    try {
      deps.writeText(
        result,
        `${JSON.stringify({ ok, message, at: new Date(deps.now()).toISOString() })}\n`,
      );
    } catch {
      // Ohne Ergebnisdatei bleibt die Meldung nach dem Start aus; der Austausch selbst ist davon unberührt.
    }
    if (options.open && reopen && deps.exists(dest)) {
      try {
        deps.open(dest);
      } catch (error) {
        log(`open: ${error?.message ?? error}`);
      }
    }
    return { ok, message };
  };
  const move = (from, to) => {
    try {
      deps.rename(from, to);
    } catch (error) {
      if (error?.code !== 'EXDEV') throw error;
      // Anderer Datenträger: kopieren, dann erst das Original entfernen.
      deps.copy(from, to);
      deps.remove(from);
    }
  };

  // 1. Warten, bis die App beendet ist. Bis dahin ist nichts verändert.
  const deadline = deps.now() + options.waitSeconds * 1000;
  log(`warte auf Prozess ${pid}`);
  while (deps.isAlive(pid)) {
    if (deps.now() > deadline) {
      return finish(false, 'Pagewise hat sich nicht rechtzeitig beendet.', { reopen: false });
    }
    await deps.sleep(250);
  }
  await deps.sleep(SETTLE_MS);

  if (!deps.exists(join(built, 'Contents', 'MacOS'))) {
    return finish(false, 'Die vorbereitete App fehlt oder ist unvollständig.');
  }

  // 2. Alte App wegräumen (an den Backup-Ort).
  const hadOld = deps.exists(dest);
  try {
    deps.mkdir(dirname(backup));
    deps.remove(backup);
    if (hadOld) move(dest, backup);
  } catch (error) {
    return finish(
      false,
      `Die alte App ließ sich nicht beiseitelegen (${error?.code ?? error?.message}).`,
    );
  }
  log('alte App beiseitegelegt');

  const restore = () => {
    try {
      deps.remove(dest);
      if (hadOld) move(backup, dest);
    } catch (error) {
      log(`Wiederherstellen: ${error?.message ?? error}`);
    }
  };

  // 3. Neue App einsetzen.
  try {
    move(built, dest);
  } catch (error) {
    restore();
    return finish(
      false,
      `Die neue App ließ sich nicht einsetzen (${error?.code ?? error?.message}).`,
    );
  }
  log('neue App eingesetzt');

  // 4. Signatur prüfen (nur auf dem Mac gibt es `codesign`).
  if (deps.platform === 'darwin') {
    try {
      deps.verify(dest);
    } catch {
      restore();
      return finish(false, 'Die Signatur der neuen App ist ungültig. Die alte App läuft weiter.');
    }
  }

  const info = (() => {
    try {
      return JSON.parse(
        deps.readText(join(dest, 'Contents', 'Resources', 'build-info.json')) ?? '',
      );
    } catch {
      return null;
    }
  })();
  const short = typeof info?.commit === 'string' ? info.commit.slice(0, 7) : null;
  return finish(true, short ? `Aktualisiert auf Fassung ${short}.` : 'Aktualisiert.');
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    validate(options);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }
  const outcome = await applyUpdate(options);
  process.exit(outcome.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
