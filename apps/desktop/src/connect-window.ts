import { join } from 'node:path';
import { shell } from 'electron';
import { DOCS_URL } from './config';

/** Ordner der Seiten des Verbindungsfensters (nur von hier nimmt der Hauptprozess Anfragen an). */
export function connectWindowDir(shellDir: string): string {
  return join(shellDir, 'connect');
}

// Platzhalter bis M3: „Mit iPhone und iPad verbinden“ öffnet vorerst die Anleitung. Das Hüllen-Fenster mit
// Adresse und QR-Code löst ihn ab.
export function showConnect(): void {
  void shell.openExternal(DOCS_URL);
}
