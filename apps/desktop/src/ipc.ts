/**
 * Kanäle zwischen dem Hauptprozess und den kleinen Hüllen-Fenstern (Preload `preload.ts`). Der Preload legt nur feste,
 * einzeln benannte Funktionen in die Seite, nie ein allgemeines `invoke`. Der Hauptprozess prüft bei jeder Anfrage,
 * woher sie kommt (nur die eigene lokale Seite), und validiert jede Eingabe. Der Server-Inhalt im Hauptfenster hat
 * keinen Preload und damit keinen Zugriff darauf.
 */
export const CHANNELS = {
  getStatus: 'pagewise:get-status',
  getConnectView: 'pagewise:connect:get-view',
  setupServe: 'pagewise:connect:setup-serve',
  useAltPort: 'pagewise:connect:use-alt-port',
  resetServe: 'pagewise:connect:reset-serve',
  renameHost: 'pagewise:connect:rename-host',
  copyAddress: 'pagewise:connect:copy-address',
  openTailscale: 'pagewise:connect:open-tailscale',
  openAdmin: 'pagewise:connect:open-admin',
  openDownload: 'pagewise:connect:open-download',
} as const;

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

/** Erlaubt nur Anfragen aus einer Seite unter dem Ordner der Hüllen-Seiten dieser App (`file://…/shell/…`). */
export function isTrustedSender(senderUrl: string | undefined, shellDirUrl: string): boolean {
  if (!senderUrl) return false;
  let sender: URL;
  let dir: URL;
  try {
    sender = new URL(senderUrl);
    dir = new URL(shellDirUrl.endsWith('/') ? shellDirUrl : `${shellDirUrl}/`);
  } catch {
    return false;
  }
  if (sender.protocol !== 'file:' || dir.protocol !== 'file:') return false;
  if (sender.host !== dir.host) return false;
  // Gleicher Ordner, keine Umwege über „..“ (URL löst sie bereits auf).
  return sender.pathname.startsWith(dir.pathname) && !sender.pathname.includes('/../');
}
