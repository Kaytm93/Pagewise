/**
 * Mit HTTPS im Tailnet erscheinen die Namen der Geräte im öffentlichen Certificate-Transparency-Verzeichnis (laut
 * Tailscale, D-030). Ein Rechnername wie „kays-macbook-pro“ verrät dort eine Person. Die Prüfung ist eine Näherung
 * ohne Namensliste (im Repo stehen keine Namen von Personen): Sie sucht die Form, in der macOS Rechnernamen vergibt
 * („<Name>s MacBook Pro“, „MacBook Pro von <Name>“), und Wörter mit Schulbezug. Ein Treffer ist eine Warnung, kein Verbot.
 */
const DEVICE_WORDS = new Set([
  'macbook',
  'mac',
  'imac',
  'mini',
  'studio',
  'pro',
  'air',
  'mbp',
  'mba',
  'laptop',
  'notebook',
  'pc',
  'computer',
  'desktop',
  'server',
  'rechner',
  'ipad',
  'iphone',
]);
/** Wörter, die keine Person bezeichnen. */
const NEUTRAL_WORDS = new Set([
  'pagewise',
  'von',
  'der',
  'die',
  'das',
  's',
  'm1',
  'm2',
  'm3',
  'm4',
  'm5',
  'home',
  'zuhause',
  'buero',
  'office',
  'test',
]);
const SCHOOL =
  /(schule|gymnasium|realschule|grundschule|klasse|lehrer|lehrerin|abitur|uni-|campus)/;

export function looksPersonal(label: string | null): boolean {
  if (!label) return false;
  const lower = label.toLowerCase();
  if (SCHOOL.test(lower)) return true;
  const tokens = lower.split('-').filter(Boolean);
  const hasDevice = tokens.some((t) => DEVICE_WORDS.has(t));
  if (!hasDevice) return false;
  const rest = tokens.filter(
    (t) => !DEVICE_WORDS.has(t) && !NEUTRAL_WORDS.has(t) && !/^\d+$/.test(t),
  );
  // „kays-macbook-pro“ (Besitzform), „macbook-pro-von-kay“, „lukas-air“: ein Rest, der ein Name sein kann.
  return rest.length > 0;
}

/** Ein Rechnername, den Tailscale als DNS-Etikett annimmt (klein, Ziffern, Bindestrich, höchstens 63 Zeichen). */
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidHostLabel(name: string): boolean {
  return LABEL.test(name);
}

export const NEUTRAL_HOSTNAME = 'pagewise-mac';
