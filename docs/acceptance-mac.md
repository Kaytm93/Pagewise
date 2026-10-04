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

## M2 Mac-Hülle ([D-053](decisions.md))

Alle Punkte mit „ja“ unter Linux: `pnpm --filter @pagewise/desktop test` (112 Tests) und, für „im echten Electron“, ein Lauf unter Xvfb mit dem gebauten Stand (`pnpm --filter @pagewise/desktop smoke` für den Rauchtest).

| Punkt | Agent getestet | Kay prüft |
| --- | --- | --- |
| Fenster ohne Adressleiste, lädt `http://127.0.0.1:3000` | ja, im echten Electron (Linux) | Mac: Pagewise öffnen, kein Adressfeld, Titel „Pagewise“ |
| Sicherheitsoptionen (Kontext getrennt, Sandkasten, kein Node, kein Preload, kein `webview`) | ja: festgenagelt im Test und am laufenden Fenster gemessen | – |
| Navigation nur zur eigenen Herkunft, `target=_blank` im Standardbrowser, `file:` und `javascript:` abgelehnt | ja, im echten Electron | Mac: Link in einer Antwort anklicken: öffnet im Standardbrowser, Pagewise-Fenster bleibt |
| Alle Berechtigungen abgelehnt (Kamera, Mikrofon, Benachrichtigungen, Standort) | ja, im echten Electron (Benachrichtigungen und Standort gemessen) | – |
| Menü deutsch mit Kürzeln: Cmd+N neuer Chat, Cmd+, Einstellungen, Cmd+W, Cmd+R, Zoom Cmd+Plus, Cmd+− und Cmd+0, Cmd+P | ja: Datenstruktur und im echten Electron per Menüpunkt (Kürzel selbst nicht gedrückt) | Mac: jedes Kürzel einmal drücken, Zoom bleibt nach Neustart erhalten, Fenstergröße und -lage ebenso |
| Fenster schließen versteckt nur, Server läuft weiter | ja, im echten Electron | iPhone: Pagewise-Fenster am Mac schließen (Cmd+W), auf dem iPhone weiterarbeiten: antwortet; Dock-Symbol anklicken: Fenster kommt zurück |
| „Pagewise beenden“ warnt bei laufenden Antworten und Anmeldungen | ja: Logik und Texte im Test | Mac: Cmd+Q bei angemeldetem iPhone: Warnung mit Zahl der Anmeldungen; „Abbrechen“ lässt alles laufen; „Beenden“ beendet auch den Server (`curl http://127.0.0.1:3000/api/health` im Terminal antwortet danach nicht mehr) |
| Menüleisten-Symbol (Serverstatus, öffnen, Mac wach halten, Adresse kopieren, Beenden) | ja: Menüstruktur im Test | Mac: Symbol rechts oben in der Menüleiste sichtbar (auch hell und dunkel lesbar), alle Punkte probieren |
| Server-Überwacher: Neustart mit Pause, nach fünf Abstürzen Fehlermeldung, kein verwaister Prozess | ja: 22 Tests mit Ersatzprozess und Fake-Zeit, Beenden im echten Electron | Mac: Aktivitätsanzeige öffnen, bei „Pagewise“ den Hilfsprozess des Servers beenden (Name dort vermutlich „Pagewise Server“ oder „Pagewise Helper“, nicht verifiziert): der Server startet von selbst neu, die Menüleiste zeigt kurz „startet neu“, `curl http://127.0.0.1:3000/api/health` antwortet danach wieder |
| Einzelinstanz | ja, im echten Electron | Mac: Pagewise im Programme-Ordner doppelt anklicken, während es läuft: kein zweites Symbol, Fenster kommt nach vorn |
| Start bei Anmeldung (Hilfe → Bei Anmeldung starten), startet versteckt, Zustand „braucht Freigabe“ | ja: Zustandslogik im Test (Electron-44-Typen) | Mac: Haken setzen; erscheint ein Dialog „Freigabe nötig“, in Systemeinstellungen → Allgemein → Anmeldeobjekte erlauben; abmelden, anmelden: Pagewise läuft im Hintergrund (Menüleisten-Symbol), Fenster zu |
| Mac wach halten (Voreinstellung an, automatisch an während Antworten) | ja: Regel im Test | Mac: `pmset -g assertions` im Terminal zeigt bei eingeschaltetem „Mac wach halten“ eine Zusicherung `PreventUserIdleSystemSleep` des Prozesses Pagewise, bei ausgeschaltetem keine (Wortlaut nicht verifiziert); Deckel zu ohne externes Display: der Mac schläft trotzdem (bekannt, siehe D-053) |
| Downloads (Agent-Dateien) nach `~/Downloads` mit „Im Finder zeigen“ | ja: sicherer Dateiname, Zählung | Mac: Agent-Chat mit Datei: Benachrichtigung „Download fertig“, Klick öffnet den Finder |
| Dateiwahl nativ | nein (Chromium-Standard) | Mac: in einem Dialog mit Dateiwahl („Fächer importieren“) öffnet sich der Finder-Dialog |
| Einrichtungscode in der App statt in der Konsole; „Passcode zurücksetzen“ ohne Terminal | ja: Kanal und Neustart im Test (`control/embedded.test.ts`) | Mac: frische Installation (`PAGEWISE_DATA_DIR` auf leeren Ordner): Dialog mit Code, „Kopieren“; später Hilfe → Passcode zurücksetzen → neuer Code |
| „Alles löschen“ leert auch die Fensterdaten (Cookies bleiben) | ja: Auslöser und Datenarten im Test | Mac: in den Einstellungen „Alles löschen“; danach ist die Anmeldung noch da, Designwahl und Entwürfe sind weg |
| `claude` finden: Pfad einstellbar | ja: Server (`routes/engines.test.ts`) und Oberfläche | Mac: Einstellungen → Agent-CLI: zeigt „Claude Code gefunden“ auch bei Start aus dem Finder; sonst Pfad eintragen (`which claude` im Terminal) |
| `--smoke-test` | ja: Linux, Rauchtest der gebauten und der gepackten App (Exit 0), negativ geprüft (Exit 1) | macOS-CI (kommt mit M4) |
| Keine Secrets in Prozess-Argumenten, Umgebung ist Allowlist | ja: Strukturtest und Test mit Fake-Schlüsseln | Mac: `ps -axww -o args | grep -i pagewise` zeigt in keiner Zeile einen Schlüssel oder Einrichtungscode |
| Keine Telemetrie, kein Hintergrund-Ping | ja: Strukturtest (keine fremden Adressen im Quelltext) | Mac (optional): Little Snitch oder `nettop` zeigen keine Verbindungen außer zu 127.0.0.1 und deinen Anbietern |

