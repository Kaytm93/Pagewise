import { type KnownRoute, ROUTES } from './config';

/** Was mit einer Navigation oder einem neuen Fenster im Hauptfenster geschehen soll. */
export type NavigationDecision =
  /** Bleibt im Fenster (gleiche Herkunft). */
  | { action: 'allow' }
  /** Im Standardbrowser öffnen (nur http und https), im Fenster nichts tun. */
  | { action: 'external'; url: string }
  /** Eine Datei der eigenen API laden: der Hauptprozess lädt sie herunter (mit den Cookies des Fensters). */
  | { action: 'download'; url: string }
  /** Eine Seite der eigenen Oberfläche, die in diesem Fenster geöffnet wird. */
  | { action: 'navigate'; url: string }
  | { action: 'deny' };

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** `will-navigate` und `will-redirect`: nur die eigene Herkunft, fremdes `http(s)` geht in den Browser. */
export function decideNavigation(url: string, origin: string): NavigationDecision {
  const parsed = parse(url);
  if (!parsed) return { action: 'deny' };
  if (parsed.origin === origin) return { action: 'allow' };
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return { action: 'external', url: parsed.href };
  }
  return { action: 'deny' };
}

/** `setWindowOpenHandler` (z. B. `target=_blank`): nie ein neues App-Fenster, nur Browser, Download oder dieses Fenster. */
export function decideWindowOpen(url: string, origin: string): NavigationDecision {
  const parsed = parse(url);
  if (!parsed) return { action: 'deny' };
  if (parsed.origin === origin) {
    return parsed.pathname.startsWith('/api/')
      ? { action: 'download', url: parsed.href }
      : { action: 'navigate', url: parsed.href };
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return { action: 'external', url: parsed.href };
  }
  return { action: 'deny' };
}

const KNOWN: ReadonlySet<string> = new Set(Object.values(ROUTES));

/** Nur diese Pfade steuern Menü und Kürzel an. */
export function isKnownRoute(path: string): path is KnownRoute {
  return KNOWN.has(path);
}

/** Baut die Adresse einer bekannten Route. Unbekannte Pfade werfen, damit nie etwas anderes geladen wird. */
export function routeUrl(origin: string, path: string): string {
  if (!isKnownRoute(path)) throw new Error(`Unbekannte Route: ${path}`);
  return `${origin}${path}`;
}
