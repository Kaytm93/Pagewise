// Startseite der Hülle: Texte nur aus `i18n.ts` (Regel 7), Auswahl nach dem Zustandsparameter (`state`), den
// `main.ts` beim Laden übergibt. Kein Inline-Skript: Das Bündeln (`scripts/build.ts`) ersetzt das frühere
// `starting.js` mit hart kodierten Texten.
import { messages } from './i18n';

// Nur die kleine DOM-Oberfläche, die diese Seite braucht (die Typumgebung dieses Pakets hat kein DOM).
declare const window: { location: { search: string } };
declare const document: { getElementById(id: string): { textContent: string | null } | null };

/** Setzt Titel und Meldung der Startseite nach dem Zustand („startet“, „startet neu“, „gestoppt“, „läuft nicht“). */
function show(): void {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('state');
  const message = params.get('message');
  const title = document.getElementById('title');
  const text = document.getElementById('message');
  if (!title || !text) return;
  const t = messages.startingPage;

  if (state === 'failed') {
    // Der Server meldet einen Fehler: dessen Text (ohne Secrets, siehe `supervisor.ts`) oder ein Fallback.
    title.textContent = t.failed.title;
    text.textContent = message || t.failed.fallback;
  } else if (state === 'restarting') {
    title.textContent = t.restarting.title;
    text.textContent = t.restarting.message;
  } else if (state === 'stopped') {
    // Bewusst gestoppt (Menü/Tray „Server neu starten“ in Arbeit): nicht behaupten, er starte gerade.
    title.textContent = t.stopped.title;
    text.textContent = t.stopped.message;
  } else {
    // 'starting' und jeder unbekannte Wert: von Anfang an oder nach dem Beenden der App.
    title.textContent = t.starting.title;
    text.textContent = t.starting.message;
  }
}

show();
