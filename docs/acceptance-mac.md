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
