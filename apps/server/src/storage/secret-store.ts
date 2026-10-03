import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * Fehler im Secret-Speicher. Die Meldung ist für Menschen gedacht und enthält nie einen Wert,
 * auch nicht Teile davon.
 */
export class SecretStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretStoreError';
  }
}

/** Was die Oberfläche über ein Secret erfahren darf: den Namen und einen Hinweis, nie den Wert. */
export interface SecretInfo {
  name: string;
  /** Letzte vier Zeichen, nur bei langen Werten. Bei kurzen Werten `null`. */
  last4: string | null;
}

/**
 * Speicher für API-Schlüssel und Tokens. `get` ist nur für Server-Code gedacht, kein Endpunkt
 * gibt den Wert zurück. Die Schnittstelle ist asynchron, damit später ein anderer Speicher
 * (z. B. ein System-Schlüsselbund) möglich bleibt.
 */
export interface SecretStore {
  set(name: string, value: string): Promise<void>;
  get(name: string): Promise<string | undefined>;
  has(name: string): Promise<boolean>;
  delete(name: string): Promise<boolean>;
  list(): Promise<SecretInfo[]>;
}

const NAME_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const MAX_VALUE_LENGTH = 4096;
/** Erst ab dieser Länge verrät der Hinweis die letzten vier Zeichen. */
const MIN_LENGTH_FOR_HINT = 16;

const FileSchema = z.object({
  version: z.literal(1),
  secrets: z.record(z.string(), z.string()),
});

export function assertValidSecretName(name: string): void {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new SecretStoreError(
      'Ungültiger Name für ein Secret. Erlaubt sind Kleinbuchstaben, Ziffern, Punkt, Minus und Unterstrich, höchstens 64 Zeichen.',
    );
  }
}

/** Entfernt umgebende Leerzeichen und prüft den Wert, ohne ihn in einer Meldung zu nennen. */
function normalizeValue(value: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0)
    throw new SecretStoreError('Der Wert eines Secrets darf nicht leer sein.');
  if (trimmed.length > MAX_VALUE_LENGTH) {
    throw new SecretStoreError(
      `Der Wert eines Secrets darf höchstens ${MAX_VALUE_LENGTH} Zeichen lang sein.`,
    );
  }
  // Zeilenumbrüche und Steuerzeichen haben in Schlüsseln nichts verloren und würden
  // beim Einsetzen in HTTP-Kopfzeilen Probleme machen.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst abgelehnt.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new SecretStoreError(
      'Der Wert eines Secrets enthält ungültige Zeichen (Zeilenumbruch oder Steuerzeichen).',
    );
  }
  return trimmed;
}

/**
 * Secrets in einer JSON-Datei mit Rechten 600 im Datenverzeichnis. Die Datei ist nicht
 * verschlüsselt: Schutz bieten die Rechte und die Festplattenverschlüsselung des Systems.
 * Die macOS-Keychain wird bewusst nicht genutzt, weil das `security`-Werkzeug Werte nur als
 * Kommandozeilenargument annimmt (siehe docs/decisions.md).
 */
export class FileSecretStore implements SecretStore {
  constructor(private readonly file: string) {}

  /** Liest die Datei bei jedem Aufruf neu, im Speicher bleiben keine Werte liegen. */
  private load(): Map<string, string> {
    if (!existsSync(this.file)) return new Map();

    this.ensureOwnerOnly();
    let parsed: z.infer<typeof FileSchema>;
    try {
      parsed = FileSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      // Absichtlich ohne Details: Fehlermeldungen von Parsern können Dateiinhalt enthalten.
      throw new SecretStoreError(
        `Die Secrets-Datei ist beschädigt oder hat ein unbekanntes Format: ${this.file}`,
      );
    }
    return new Map(Object.entries(parsed.secrets));
  }

  private ensureOwnerOnly(): void {
    const mode = statSync(this.file).mode & 0o777;
    if ((mode & 0o077) === 0) return;
    try {
      chmodSync(this.file, 0o600);
    } catch {
      throw new SecretStoreError(
        `Die Secrets-Datei ist für andere lesbar und die Rechte lassen sich nicht auf 600 setzen: ${this.file}`,
      );
    }
  }

  /** Schreibt atomar: Temp-Datei mit Rechten 600 im selben Ordner, dann umbenennen. */
  private save(secrets: Map<string, string>): void {
    const directory = dirname(this.file);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temp = join(directory, `.secrets-${randomBytes(8).toString('hex')}.tmp`);
    const body = `${JSON.stringify({ version: 1, secrets: Object.fromEntries(secrets) }, null, 2)}\n`;
    const fd = openSync(temp, 'wx', 0o600);
    try {
      writeSync(fd, body);
      fsyncSync(fd);
    } catch (error) {
      closeSync(fd);
      rmSync(temp, { force: true });
      throw error;
    }
    closeSync(fd);
    try {
      renameSync(temp, this.file);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  }

  async set(name: string, value: string): Promise<void> {
    assertValidSecretName(name);
    const normalized = normalizeValue(value);
    const secrets = this.load();
    secrets.set(name, normalized);
    this.save(secrets);
  }

  async get(name: string): Promise<string | undefined> {
    assertValidSecretName(name);
    return this.load().get(name);
  }

  async has(name: string): Promise<boolean> {
    assertValidSecretName(name);
    return this.load().has(name);
  }

  async delete(name: string): Promise<boolean> {
    assertValidSecretName(name);
    const secrets = this.load();
    if (!secrets.delete(name)) return false;
    this.save(secrets);
    return true;
  }

  async list(): Promise<SecretInfo[]> {
    return [...this.load().entries()]
      .map(([name, value]) => ({
        name,
        last4: value.length >= MIN_LENGTH_FOR_HINT ? value.slice(-4) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
