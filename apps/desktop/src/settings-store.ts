import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Bounds } from './window-options';

/** Einstellungen der Hülle (nicht des Servers): Fensterlage, Zoom, Wachhalten. Nur lokal in `userData`, nichts davon verlässt den Mac. */
export interface DesktopSettings {
  windowBounds: Bounds | null;
  zoomLevel: number;
  /** Mac wach halten (Voreinstellung an: Der Mac ist der Server). */
  keepAwake: boolean;
}

export const DEFAULT_SETTINGS: DesktopSettings = {
  windowBounds: null,
  zoomLevel: 0,
  keepAwake: true,
};

export const ZOOM_MIN = -3;
export const ZOOM_MAX = 5;

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function readBounds(value: unknown): Bounds | null {
  if (typeof value !== 'object' || value === null) return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (!isNumber(width) || !isNumber(height)) return null;
  if (width < 200 || height < 200 || width > 20_000 || height > 20_000) return null;
  const position =
    isNumber(x) && isNumber(y) && Math.abs(x) < 100_000 && Math.abs(y) < 100_000
      ? { x: Math.round(x), y: Math.round(y) }
      : {};
  return { ...position, width: Math.round(width), height: Math.round(height) };
}

/** Prüft von Hand (kein zod: kleiner und ohne Überraschungen). Alles Ungültige fällt auf die Voreinstellung zurück. */
export function parseSettings(raw: unknown): DesktopSettings {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const zoom = value.zoomLevel;
  return {
    windowBounds: readBounds(value.windowBounds),
    zoomLevel: isNumber(zoom)
      ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 2) / 2))
      : 0,
    keepAwake: typeof value.keepAwake === 'boolean' ? value.keepAwake : DEFAULT_SETTINGS.keepAwake,
  };
}

/** Eine Fensterlage, die auf keinem angeschlossenen Bildschirm mehr sichtbar wäre, wird ohne Position verwendet. */
export function fitBounds(
  bounds: Bounds | null,
  displays: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
): Bounds | null {
  if (!bounds) return null;
  if (bounds.x === undefined || bounds.y === undefined) return bounds;
  const x = bounds.x;
  const y = bounds.y;
  const visible = displays.some(
    (d) =>
      x + 100 < d.x + d.width && x + bounds.width - 100 > d.x && y < d.y + d.height && y + 40 > d.y,
  );
  return visible ? bounds : { width: bounds.width, height: bounds.height };
}

export class SettingsStore {
  private cache: DesktopSettings | null = null;

  constructor(private readonly file: string) {}

  read(): DesktopSettings {
    if (this.cache) return this.cache;
    try {
      this.cache = parseSettings(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      this.cache = { ...DEFAULT_SETTINGS };
    }
    return this.cache;
  }

  update(patch: Partial<DesktopSettings>): DesktopSettings {
    const next = parseSettings({ ...this.read(), ...patch });
    this.cache = next;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const temp = `${this.file}.tmp`;
      writeFileSync(temp, `${JSON.stringify(next)}\n`, { mode: 0o600 });
      renameSync(temp, this.file);
      chmodSync(this.file, 0o600);
    } catch {
      // Fensterlage und Zoom sind Komfort: Ein Schreibfehler stört den Betrieb nicht.
    }
    return next;
  }
}
