# Abnahme Mac-App

Stand: 4. Oktober 2026. **Nicht abgenommen.** Die Mac-App gilt erst als abgenommen, wenn Kay die Spalte „Kay prüft“ abgehakt hat. Der Agent läuft unter Linux: Er kann keine `.app` signieren oder auf macOS starten und schreibt deshalb nie „funktioniert“ ohne Test. Entscheidungen: [D-050](decisions.md) (Electron), [D-051](decisions.md) (Server bündelbar).

Legende: **Agent getestet** = Test oder Lauf im Container (Befehl genannt). **Kay prüft** = nur am Mac möglich, mit konkretem Schritt.

## M0 Spike (Electron mit gebündeltem Server)

| Punkt | Agent getestet | Kay prüft |
| --- | --- | --- |
| Electron 44.5.1 startet im Container (Linux, Xvfb) | ja: Chromium 152.0.7977.130, Node 24.21.0; headless mit `--ozone-platform=headless` stürzt ab (SIGSEGV), Xvfb geht | – |
| Server als `utilityProcess` aus dem Bundle, Umgebung nur Allowlist | ja (Linux x64): `better-sqlite3` 13 lädt seine Binärdatei, `ready`, `status`, `stop` über IPC, Exit 0 | `darwin-arm64.node` unter Electron auf dem Mac: App starten, Fenster zeigt die Anmeldung |
| Fenster auf `http://127.0.0.1:<Port>` ohne Konsolenmeldungen | ja (Linux): Titel „Pagewise“, 0 Meldungen | – |
| Service Worker registriert sich im App-Fenster | ja (Linux): 1 Registrierung | Mac: Pagewise einmal öffnen, den Server stoppen (Menüleiste, kommt mit M2), dann Fenster neu laden: die Oberfläche erscheint aus dem Speicher des Service Workers samt Hinweis, dass der Server fehlt |
| Anmeldung bleibt nach Neustart der App | ja (Linux): Cookie dauerhaft, `HttpOnly`, `SameSite=Strict`; nach Neustart `sessions: 1` und gültige Sitzung | Mac: anmelden, Pagewise beenden (Cmd+Q), neu starten: keine Anmeldung nötig |
| Streaming einer Antwort im App-Fenster | nein (nur im Prozess und im Browser getestet) | Mac: im Chat eine Frage stellen, der Text erscheint nach und nach |
| Download der Agent-Dateien | nein | Mac: Agent-Chat, der eine Datei erzeugt: Datei landet in `~/Downloads`, „Im Finder zeigen“ funktioniert |
| `target=_blank` öffnet den Standardbrowser | nein | Mac: Link in einer Antwort anklicken: Safari (oder Standardbrowser) öffnet, App bleibt |
| Drucken | nein | Mac: Cmd+P im Hefteintrag: Druckdialog erscheint |

## M1 Server bündelbar

| Punkt | Agent getestet | Kay prüft |
| --- | --- | --- |
| Bundle läuft aus fremdem Ordner, `/api/health`, Einrichtung, Anmeldung, Vorlagen, Fach, Standard-Prompt | ja: `pnpm --filter @pagewise/server test` (`bundle.test.ts`) | – |
| `PAGEWISE_RESOURCES_DIR`, Portkonflikt, Instanzsperre, geordnetes Beenden | ja: `server.test.ts`, `bundle.test.ts`, `instance-lock.test.ts` | – |
| Einrichtungscode nur über Bibliothek und IPC, nicht in Ausgabe oder HTTP | ja: `server.test.ts`, `control/embedded.test.ts` | – |
| Laufende Antworten beim Beenden als `interrupted` | ja: `routes/chats.test.ts` | – |

## P iPad und iPhone robuster ([D-052](decisions.md))

| Punkt | Agent getestet | Kay prüft |
| --- | --- | --- |
| Service Worker: 3 s (Seite), 1,5 s (`boot.js`), Rückfall auf die gemerkte Fassung, späte Netzantwort aktualisiert den Speicher, 502 bis 504, Vorabspeichern | ja: `pnpm --filter @pagewise/web test` (`pwa/sw.test.ts`, simuliertes hängendes Netz mit Fake-Zeit); im echten Chromium mit Server, der nie antwortet: Seite nach 4,5 s | iPhone: Mac in den Ruhezustand schicken (Apfelmenü), Tailscale bleibt verbunden, Pagewise auf dem Home-Bildschirm öffnen: die Oberfläche erscheint nach wenigen Sekunden samt Hinweis, kein weißer Bildschirm |
| Banner „Mac nicht erreichbar“ erscheint und verschwindet, Ansichten und Entwürfe bleiben | ja: `Connection.test.tsx`, `connection/monitor.test.ts` (Abstände 2, 5, 10, 30 s, alle Anlässe), Echtbrowser: Banner sichtbar, 0 CSP-Verstöße, 0 Konsolenmeldungen | iPad: in einem Chat etwas tippen (nicht senden), Mac schlafen schicken, zurück in die App wechseln: Banner, Entwurf bleibt; Mac aufwecken: Banner verschwindet von selbst, spätestens nach „Erneut versuchen“ |
| Zeitlimit beim Laden (8 s) statt ewigem „Verbindung wird geprüft …“ | ja: `Connection.test.tsx`; Echtbrowser | iPhone: App bei schlafendem Mac starten: nach etwa 8 Sekunden „Der Server antwortet nicht.“ |
| Manifest und maskierbares Icon | ja: `pwa/pwa-files.test.ts` (1024 × 1024, deckend, getrennte Zwecke) | iPhone: neu zum Home-Bildschirm hinzufügen, Icon sieht richtig aus (hell und dunkel, alle drei Designrichtungen) |
| Safe-Areas links und rechts | Klassen im Quelltext und erzeugtes CSS geprüft (`ui/safe-area.test.ts`) | iPhone quer (Notch links und rechts): nichts verschwindet hinter der Aussparung (Seitenleiste, Chat, Dialog, Anmeldung) |
| Tastatur: Eingabezeile hebt sich | ja, mit gefälschtem `visualViewport` (`ui/keyboard.test.ts`) | iPad und iPhone: Chat-Eingabe antippen: Eingabezeile bleibt über der Tastatur sichtbar; Dialog mit Eingabefeld ebenso; Tastatur schließen: alles zurück |

