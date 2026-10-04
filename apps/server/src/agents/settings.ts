import { homedir } from 'node:os';
import { delimiter, dirname } from 'node:path';

/**
 * Einstellungen für `claude`, mit denen der Agent nur im Arbeitsordner arbeiten kann. Sie werden bei jedem Lauf
 * neu erzeugt, liegen außerhalb des Arbeitsordners (der Agent kann sie nicht ändern) und werden mit `--settings`
 * übergeben. Sie wurden mit Claude Code 2.1.220 auf macOS gemessen (siehe docs/agent-cli.md und
 * `apps/server/src/agents/e2e.test.ts`); dort gilt:
 *
 * - Die Sandbox schützt nur Shell-Befehle (Bash). Die Datei-Werkzeuge (Read, Write, Edit, Glob, Grep) folgen den
 *   Berechtigungsregeln, deshalb braucht es beides.
 * - Pfadregeln müssen absolut sein und mit `//` beginnen. Relative Regeln (`./**`) gelten relativ zur Ort der
 *   Einstellungsdatei, nicht zum Arbeitsordner, und griffen im Test nicht.
 * - Schreiben erlaubt eine `Edit(...)`-Regel (sie gilt auch für Write); `Write(...)`-Regeln allein genügen nicht.
 * - Lesen im Arbeitsordner braucht keine Regel, alles andere wird im Modus `dontAsk` verweigert.
 * - Die Sandbox liest standardmäßig fast die ganze Maschine: Das Benutzerverzeichnis, das Datenverzeichnis und
 *   andere Benutzer werden ausdrücklich gesperrt, der Arbeitsordner ist als engerer Pfad wieder lesbar.
 * - Das Netz ist für Befehle aus (leere Liste erlaubter Adressen).
 */

export interface AgentSettings {
  permissions: { allow: string[]; deny: string[] };
  sandbox: {
    enabled: true;
    failIfUnavailable: true;
    allowUnsandboxedCommands: false;
    autoAllowBashIfSandboxed: true;
    filesystem: { denyRead: string[]; allowRead: string[] };
    network: { allowedDomains: string[] };
  };
}

export interface SettingsInput {
  /** Aufgelöster Pfad des Arbeitsordners. */
  workspace: string;
  /** Echtes Benutzerverzeichnis des Servers (nicht das eigene `HOME` des Agenten). */
  realHome?: string;
  /** Wurzel des Datenverzeichnisses (Datenbank, Secrets, Sicherungen, andere Arbeitsordner). */
  dataRoot: string;
  /** `PATH` des Agenten: Ordner darin, die im Benutzerverzeichnis liegen, bleiben lesbar (Werkzeuge wie node). */
  searchPath?: string;
}

/** Orte, die ein Agent nie lesen soll, weil dort Konten, Dokumente anderer Personen oder Datenträger liegen. */
const ALWAYS_DENIED = ['/Users', '/home', '/Volumes', '/mnt', '/media'];

/** Zeichen, die in einer Pfadregel als Muster gelten würden. Pfade damit werden abgelehnt statt falsch gedeutet. */
const GLOB = /[*?[\]{}!]/;

/** Regelpfad für absolute Pfade: Der Doppelstrich am Anfang heißt „absolut“. */
export const absRule = (path: string): string => `/${path}`;

export class UnsafePathError extends Error {
  constructor() {
    super('Der Pfad enthält Zeichen, die in Regeln als Muster gelten.');
    this.name = 'UnsafePathError';
  }
}

function assertPlain(path: string): void {
  if (!path.startsWith('/') || GLOB.test(path)) throw new UnsafePathError();
}

/** Ordner aus `PATH` im Benutzerverzeichnis (und deren Elternordner, wo Bibliotheken liegen): Lesen bleibt erlaubt. */
export function toolReadDirs(searchPath: string, home: string): string[] {
  const dirs = new Set<string>();
  for (const entry of searchPath.split(delimiter)) {
    if (!entry.startsWith(`${home}/`)) continue;
    if (GLOB.test(entry)) continue;
    dirs.add(entry);
    // Ein Werkzeug wie `~/.nvm/versions/node/v22/bin/node` liest seine Bibliotheken eine Ebene darüber.
    const parent = dirname(entry);
    if (parent.startsWith(`${home}/`) && parent !== home) dirs.add(parent);
  }
  return [...dirs].sort();
}

export function buildAgentSettings(input: SettingsInput): AgentSettings {
  const home = input.realHome ?? homedir();
  for (const path of [input.workspace, input.dataRoot, home]) assertPlain(path);
  const workspace = absRule(input.workspace);

  const denyRead = [
    ...new Set([absRule(home), absRule(input.dataRoot), ...ALWAYS_DENIED.map(absRule)]),
  ];
  const allowRead = [
    workspace,
    ...toolReadDirs(input.searchPath ?? process.env.PATH ?? '', home).map(absRule),
  ];

  return {
    permissions: {
      allow: [`Edit(${workspace}/**)`],
      // Der Agent darf seine eigene Umgebung nicht umbauen: keine Einstellungen, keine Projekt-Anweisungen,
      // keine Server für Werkzeuge. (Die Sandbox schützt `.claude` zusätzlich von sich aus.)
      deny: [
        `Edit(${workspace}/.claude/**)`,
        `Edit(${workspace}/CLAUDE.md)`,
        `Edit(${workspace}/.mcp.json)`,
      ],
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: true,
      filesystem: { denyRead, allowRead },
      network: { allowedDomains: [] },
    },
  };
}
