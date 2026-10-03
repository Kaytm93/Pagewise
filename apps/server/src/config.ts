import { z } from 'zod';

/** Fehler in der Konfiguration. Die Meldung ist für Menschen gedacht. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

const EnvSchema = z.object({
  SCHULHEFT_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SCHULHEFT_HOST: z.string().trim().min(1).default('127.0.0.1'),
  SCHULHEFT_ALLOW_NON_LOOPBACK: z.enum(['1', 'true']).optional(),
});

export interface Config {
  host: string;
  port: number;
}

/**
 * Liest die Konfiguration aus der Umgebung. Der Server bindet nur an Loopback-Adressen.
 * Einzige Ausnahme: SCHULHEFT_ALLOW_NON_LOOPBACK=1 (Docker), dann muss der Port außerhalb
 * des Containers ausschließlich an 127.0.0.1 des Hosts veröffentlicht werden.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'Konfiguration'}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Ungültige Konfiguration (${details}).`);
  }

  const {
    SCHULHEFT_HOST: host,
    SCHULHEFT_PORT: port,
    SCHULHEFT_ALLOW_NON_LOOPBACK: allow,
  } = parsed.data;
  if (!LOOPBACK_HOSTS.has(host) && !allow) {
    throw new ConfigError(
      [
        `SCHULHEFT_HOST="${host}" ist keine Loopback-Adresse.`,
        'Schulheft bindet nur an 127.0.0.1, ::1 oder localhost und wird über Tailscale Serve erreichbar gemacht.',
        'Nur für Docker gibt es die Ausnahme SCHULHEFT_ALLOW_NON_LOOPBACK=1, siehe docs/self-hosting.md.',
      ].join('\n'),
    );
  }
  return { host, port };
}
