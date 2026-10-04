/**
 * Steuerkanal zwischen der Mac-App (Hauptprozess) und dem Server (utilityProcess). Er läuft über den Nachrichtenkanal
 * des Prozesses (IPC), nie über HTTP: Hinter Tailscale Serve kommen alle Anfragen von 127.0.0.1, ein „nur lokaler“
 * HTTP-Endpunkt wäre für das ganze Tailnet lesbar (D-021, D-050). Dieses Modul hat keine Abhängigkeiten, damit
 * Server und Mac-App es teilen können.
 */

/** Anfragen der App an den Server. `id` ordnet die Antwort zu. */
export type ServerCommand =
  | { id: number; type: 'status' }
  /** Einrichtungscode, solange noch kein Passcode gesetzt ist. Nie in Logs, nie über HTTP. */
  | { id: number; type: 'setup-code' }
  /** Passcode und Sitzungen entfernen (Daten bleiben). Der Server startet danach neu. */
  | { id: number; type: 'reset-passcode' }
  | { id: number; type: 'stop' };

export type StartFailureKind =
  | 'port_in_use'
  | 'instance_running'
  | 'config'
  | 'data_dir'
  | 'database'
  | 'other';

export interface StatusValue {
  port: number;
  activeChats: number;
  sessions: number;
  setupPending: boolean;
}

export type ServerReply =
  | { id: number; type: 'reply'; ok: true; value: StatusValue | { code: string | null } | null }
  | { id: number; type: 'reply'; ok: false; error: string };

/** Meldungen des Servers an die App. */
export type ServerMessage =
  | { type: 'ready'; host: string; port: number; dataDir: string }
  /** Der Start ist gescheitert. `message` ist ein deutscher Text für Menschen (nie Secrets). */
  | { type: 'failed'; kind: StartFailureKind; message: string }
  | { type: 'stopped' }
  | ServerReply;

const COMMAND_TYPES = new Set(['status', 'setup-code', 'reset-passcode', 'stop']);

/** Prüft eine eingehende Nachricht von Hand. Alles, was nicht genau passt, wird verworfen. */
export function parseCommand(value: unknown): ServerCommand | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, type } = value as Record<string, unknown>;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) return null;
  if (typeof type !== 'string' || !COMMAND_TYPES.has(type)) return null;
  return { id, type } as ServerCommand;
}

const FAILURE_KINDS = new Set<string>([
  'port_in_use',
  'instance_running',
  'config',
  'data_dir',
  'database',
  'other',
]);

/** Prüft eine Nachricht des Servers (die App vertraut dem Kind nicht blind). */
export function parseServerMessage(value: unknown): ServerMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'ready':
      return typeof message.host === 'string' &&
        typeof message.port === 'number' &&
        Number.isInteger(message.port) &&
        typeof message.dataDir === 'string'
        ? { type: 'ready', host: message.host, port: message.port, dataDir: message.dataDir }
        : null;
    case 'failed':
      return typeof message.kind === 'string' &&
        FAILURE_KINDS.has(message.kind) &&
        typeof message.message === 'string'
        ? {
            type: 'failed',
            kind: message.kind as StartFailureKind,
            message: message.message,
          }
        : null;
    case 'stopped':
      return { type: 'stopped' };
    case 'reply': {
      if (typeof message.id !== 'number' || !Number.isSafeInteger(message.id)) return null;
      if (message.ok === false && typeof message.error === 'string') {
        return { id: message.id, type: 'reply', ok: false, error: message.error };
      }
      if (message.ok === true) {
        const v = message.value;
        if (v === null) return { id: message.id, type: 'reply', ok: true, value: null };
        if (typeof v === 'object' && v !== null) {
          const o = v as Record<string, unknown>;
          if ('code' in o && (typeof o.code === 'string' || o.code === null)) {
            return { id: message.id, type: 'reply', ok: true, value: { code: o.code } };
          }
          if (
            typeof o.port === 'number' &&
            typeof o.activeChats === 'number' &&
            typeof o.sessions === 'number' &&
            typeof o.setupPending === 'boolean'
          ) {
            return {
              id: message.id,
              type: 'reply',
              ok: true,
              value: {
                port: o.port,
                activeChats: o.activeChats,
                sessions: o.sessions,
                setupPending: o.setupPending,
              },
            };
          }
        }
      }
      return null;
    }
    default:
      return null;
  }
}
