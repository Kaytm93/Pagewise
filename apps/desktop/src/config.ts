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

/**
 * Adresse, die nur die Mac-App versteht (D-057): Der Knopf „Nach Updates suchen“ in den Einstellungen der Oberfläche
 * navigiert dorthin, die Hülle fängt das ab und öffnet das Update-Fenster. Es wird nie etwas geladen, und die Seite kann
 * damit nichts auslösen außer dem Öffnen dieses Fensters (ein Klick darin startet erst das Update).
 */
export const UPDATE_PATH = '/__pagewise/update';

export type KnownRoute = (typeof ROUTES)[keyof typeof ROUTES];

/** Ordner für die Daten des Fensters (Cookies, Speicher, Cache) im Datenverzeichnis, getrennt vom Server (D-050). */
export const WINDOW_DATA_DIRNAME = 'Fenster';

export const APP_NAME = 'Pagewise';
export const DOCS_URL = 'https://github.com/Kaytm93/Pagewise/blob/main/docs/self-hosting.md';
export const RELEASES_API_URL = 'https://api.github.com/repos/Kaytm93/Pagewise/releases/latest';

/**
 * Quelle der Updates (D-057): das öffentliche Repository, nur dieser Zweig. Die App fragt dort nur auf Klick nach
 * (oder beim Start, wenn die Person es eingeschaltet hat) und installiert nie von selbst. Die Adresse ist fest: Weder
 * die Oberfläche noch eine Einstellung kann eine andere vorgeben.
 */
export const UPDATE_REPO_URL = 'https://github.com/Kaytm93/Pagewise.git';
export const UPDATE_BRANCH = 'main';
/** Arbeitsordner der Updates im Cache-Ordner von macOS (`~/Library/Caches`): wegwerfbar, nicht Teil von Sicherungen. */
export const UPDATE_DIRNAME = 'pagewise-update';

/** Feste Adressen, die die App im Browser öffnen kann (nur auf Klick, nie von sich aus). */
export const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download';
export const TAILSCALE_ADMIN_DNS_URL = 'https://login.tailscale.com/admin/dns';
export const TAILSCALE_ADMIN_MACHINES_URL = 'https://login.tailscale.com/admin/machines';
export const TAILSCALE_APP_PATH = '/Applications/Tailscale.app';
