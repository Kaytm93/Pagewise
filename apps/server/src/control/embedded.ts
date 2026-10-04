import { ConfigError } from '../config';
import { DataDirError } from '../data-dir';
import { DatabaseError } from '../db/client';
import { InstanceLockError } from '../instance-lock';
import { resetPasscode } from '../reset-passcode';
import {
  isStartupError,
  PortInUseError,
  type RunningServer,
  type StartServerOptions,
  startServer,
} from '../server';
import { parseCommand, type ServerMessage, type StartFailureKind } from './protocol';

/** Nachrichtenkanal zum Elternprozess (bei Electron `process.parentPort`). */
export interface Channel {
  post(message: ServerMessage): void;
  onMessage(handler: (data: unknown) => void): void;
}

export function failureKind(error: unknown): StartFailureKind {
  if (error instanceof PortInUseError) return 'port_in_use';
  if (error instanceof InstanceLockError) return 'instance_running';
  if (error instanceof ConfigError) return 'config';
  if (error instanceof DataDirError) return 'data_dir';
  if (error instanceof DatabaseError) return 'database';
  return 'other';
}

export interface EmbeddedHandle {
  /** Wartet, bis der Server beendet ist (nach `stop` oder einem Fehler beim Start). */
  done: Promise<void>;
}

/**
 * Betrieb als eingebetteter Server der Mac-App: startet, meldet `ready` oder `failed` und beantwortet Befehle des
 * Elternprozesses. Gibt nichts auf der Konsole aus, vor allem nie den Einrichtungscode (er geht nur über den Kanal).
 */
export function runEmbedded(channel: Channel, options: StartServerOptions = {}): EmbeddedHandle {
  let server: RunningServer | null = null;
  let finished: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  let busy = false;

  const announce = (running: RunningServer): void => {
    channel.post({
      type: 'ready',
      host: running.host,
      port: running.port,
      dataDir: running.dataDir,
    });
  };

  const start = async (): Promise<boolean> => {
    try {
      server = await startServer(options);
      announce(server);
      return true;
    } catch (error) {
      server = null;
      // Nur Fehler mit Erklärung für Menschen weitergeben; bei allem anderen eine feste Meldung (nie Stacktrace, nie Secrets).
      channel.post({
        type: 'failed',
        kind: failureKind(error),
        message: isStartupError(error)
          ? error.message
          : 'Der Server konnte nicht gestartet werden (unerwarteter Fehler).',
      });
      return false;
    }
  };

  const reply = (id: number, value: Extract<ServerMessage, { type: 'reply'; ok: true }>['value']) =>
    channel.post({ id, type: 'reply', ok: true, value });
  const fail = (id: number, error: string) => channel.post({ id, type: 'reply', ok: false, error });

  channel.onMessage((data) => {
    const command = parseCommand(data);
    if (!command) return;
    void (async () => {
      if (command.type === 'stop') {
        await server?.stop();
        server = null;
        reply(command.id, null);
        channel.post({ type: 'stopped' });
        finished();
        return;
      }
      if (!server || busy) {
        fail(command.id, busy ? 'busy' : 'not_running');
        return;
      }
      if (command.type === 'status') {
        reply(command.id, server.status());
      } else if (command.type === 'setup-code') {
        reply(command.id, { code: server.setupCode() });
      } else if (command.type === 'reset-passcode') {
        busy = true;
        try {
          const running = server;
          await running.stop();
          server = null;
          try {
            resetPasscode(running.dataDir, {
              resources: running.resources,
              sqliteBinding: options.sqliteBinding ?? process.env.PAGEWISE_SQLITE_BINDING,
            });
          } catch (error) {
            // Auch bei einem Fehler soll der Server wieder laufen.
            await start();
            fail(command.id, isStartupError(error) ? error.message : 'reset_failed');
            return;
          }
          if (await start()) reply(command.id, null);
          else fail(command.id, 'restart_failed');
        } finally {
          busy = false;
        }
      }
    })();
  });

  void start().then((ok) => {
    if (!ok) finished();
  });
  return { done };
}
