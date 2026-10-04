/** Der Server lauscht fest auf diesem Port (D-050): Anmeldung und Einstellungen im Fenster hängen am Origin samt Port. */
export const SERVER_HOST = '127.0.0.1';
export const SERVER_PORT = 3000;
export const SERVER_ORIGIN = `http://${SERVER_HOST}:${SERVER_PORT}`;

/** Bekannte Adressen des Servers, zu denen Menü und Tastenkürzel navigieren (nie über `executeJavaScript`). */
export const ROUTES = {
  home: '/',
  newChat: '/chat',
  settings: '/settings',
} as const;

export type KnownRoute = (typeof ROUTES)[keyof typeof ROUTES];

/** Ordner für die Daten des Fensters (Cookies, Speicher, Cache) im Datenverzeichnis, getrennt vom Server (D-050). */
export const WINDOW_DATA_DIRNAME = 'Fenster';

export const APP_NAME = 'Pagewise';
export const DOCS_URL = 'https://github.com/Kaytm93/Pagewise/blob/main/docs/self-hosting.md';
export const RELEASES_API_URL = 'https://api.github.com/repos/Kaytm93/Pagewise/releases/latest';

/** Feste Adressen, die die App im Browser öffnen kann (nur auf Klick, nie von sich aus). */
export const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download';
export const TAILSCALE_ADMIN_DNS_URL = 'https://login.tailscale.com/admin/dns';
export const TAILSCALE_ADMIN_MACHINES_URL = 'https://login.tailscale.com/admin/machines';
export const TAILSCALE_APP_PATH = '/Applications/Tailscale.app';
