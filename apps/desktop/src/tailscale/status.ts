/**
 * Auswertung von `tailscale status --json`. Die Ausgabe kann sich ändern (Quelle: `ipn/ipnstate/ipnstate.go`,
 * Hauptzweig, gelesen am 4. Oktober 2026), deshalb liest dieser Teil tolerant: unbekannte Felder werden ignoriert,
 * fehlende ergeben `null` oder leere Listen, nie einen Absturz.
 */
export type BackendState =
  | 'NoState'
  | 'NeedsLogin'
  | 'NeedsMachineAuth'
  | 'Stopped'
  | 'Starting'
  | 'Running'
  | 'Unknown';

export interface ParsedStatus {
  backendState: BackendState;
  /** Voller Name des Rechners im Tailnet ohne Punkt am Ende, z. B. `beispiel-mac.tail1234.ts.net`. */
  dnsName: string | null;
  /** Name des Rechners (erstes Etikett des DNS-Namens, sonst `HostName`). */
  hostLabel: string | null;
  certDomains: string[];
  magicDnsSuffix: string | null;
  tailnetName: string | null;
  tailscaleIps: string[];
}

const STATES: readonly BackendState[] = [
  'NoState',
  'NeedsLogin',
  'NeedsMachineAuth',
  'Stopped',
  'Starting',
  'Running',
];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v !== '')
    : [];
}

/** Entfernt den Punkt am Ende eines DNS-Namens und macht ihn klein. */
export function cleanDnsName(name: string | null): string | null {
  if (!name) return null;
  const cleaned = name.replace(/\.+$/, '').toLowerCase();
  return cleaned === '' ? null : cleaned;
}

export function parseStatus(raw: unknown): ParsedStatus {
  const root = record(raw) ?? {};
  const self = record(root.Self) ?? {};
  const tailnet = record(root.CurrentTailnet) ?? {};
  const state = text(root.BackendState);
  const backendState = (STATES as readonly string[]).includes(state ?? '')
    ? (state as BackendState)
    : 'Unknown';

  const magicDnsSuffix = text(tailnet.MagicDNSSuffix) ?? text(root.MagicDNSSuffix);
  const hostName = text(self.HostName);
  let dnsName = cleanDnsName(text(self.DNSName));
  // Fehlt der volle Name, aber Rechnername und Suffix sind da, setzt er sich daraus zusammen.
  if (!dnsName && hostName && magicDnsSuffix) {
    dnsName = `${hostName.toLowerCase()}.${magicDnsSuffix.toLowerCase()}`;
  }
  const hostLabel = dnsName ? (dnsName.split('.')[0] ?? null) : (hostName?.toLowerCase() ?? null);

  return {
    backendState,
    dnsName,
    hostLabel,
    certDomains: strings(root.CertDomains).map((d) => d.replace(/\.+$/, '').toLowerCase()),
    magicDnsSuffix: magicDnsSuffix?.toLowerCase() ?? null,
    tailnetName: text(tailnet.Name),
    tailscaleIps: strings(root.TailscaleIPs),
  };
}

/** HTTPS im Tailnet ist an, wenn die Verwaltung Zertifikatsnamen liefert (und, falls bekannt, für diesen Rechner). */
export function httpsEnabled(status: ParsedStatus): boolean {
  if (status.certDomains.length === 0) return false;
  return status.dnsName ? status.certDomains.includes(status.dnsName) : true;
}

export function parseJson(textValue: string): unknown {
  try {
    return JSON.parse(textValue);
  } catch {
    return null;
  }
}
