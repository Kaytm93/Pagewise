# Abnahme Mac-App

Stand: 5. Oktober 2026. **Nicht abgenommen.** Die Mac-App gilt erst als abgenommen, wenn der Maintainer die Spalte „Maintainer prüft“ abgehakt hat. Der Agent läuft unter Linux: Er kann keine `.app` signieren oder auf macOS starten und schreibt deshalb nie „funktioniert“ ohne Test. Entscheidungen: [D-050](decisions.md) (Electron), [D-051](decisions.md) (Server bündelbar).

Legende: **Agent getestet** = Test oder Lauf im Container (Befehl genannt). **Maintainer prüft** = nur am Mac möglich, mit konkretem Schritt.

## M0 Spike (Electron mit gebündeltem Server)

| Punkt | Agent getestet | Maintainer prüft |
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

| Punkt | Agent getestet | Maintainer prüft |
| --- | --- | --- |
| Bundle läuft aus fremdem Ordner, `/api/health`, Einrichtung, Anmeldung, Vorlagen, Fach, Standard-Prompt | ja: `pnpm --filter @pagewise/server test` (`bundle.test.ts`) | – |
| `PAGEWISE_RESOURCES_DIR`, Portkonflikt, Instanzsperre, geordnetes Beenden | ja: `server.test.ts`, `bundle.test.ts`, `instance-lock.test.ts` | – |
| Einrichtungscode nur über Bibliothek und IPC, nicht in Ausgabe oder HTTP | ja: `server.test.ts`, `control/embedded.test.ts` | – |
| Laufende Antworten beim Beenden als `interrupted` | ja: `routes/chats.test.ts` | – |

## P iPad und iPhone robuster ([D-052](decisions.md))

| Punkt | Agent getestet | Maintainer prüft |
| --- | --- | --- |
| Service Worker: 3 s (Seite), 1,5 s (`boot.js`), Rückfall auf die gemerkte Fassung, späte Netzantwort aktualisiert den Speicher, 502 bis 504, Vorabspeichern | ja: `pnpm --filter @pagewise/web test` (`pwa/sw.test.ts`, simuliertes hängendes Netz mit Fake-Zeit); im echten Chromium mit Server, der nie antwortet: Seite nach 4,5 s | iPhone: Mac in den Ruhezustand schicken (Apfelmenü), Tailscale bleibt verbunden, Pagewise auf dem Home-Bildschirm öffnen: die Oberfläche erscheint nach wenigen Sekunden samt Hinweis, kein weißer Bildschirm |
| Banner „Mac nicht erreichbar“ erscheint und verschwindet, Ansichten und Entwürfe bleiben | ja: `Connection.test.tsx`, `connection/monitor.test.ts` (Abstände 2, 5, 10, 30 s, alle Anlässe), Echtbrowser: Banner sichtbar, 0 CSP-Verstöße, 0 Konsolenmeldungen | iPad: in einem Chat etwas tippen (nicht senden), Mac schlafen schicken, zurück in die App wechseln: Banner, Entwurf bleibt; Mac aufwecken: Banner verschwindet von selbst, spätestens nach „Erneut versuchen“ |
| Zeitlimit beim Laden (8 s) statt ewigem „Verbindung wird geprüft …“ | ja: `Connection.test.tsx`; Echtbrowser | iPhone: App bei schlafendem Mac starten: nach etwa 8 Sekunden „Der Server antwortet nicht.“ |
| Manifest und maskierbares Icon | ja: `pwa/pwa-files.test.ts` (1024 × 1024, deckend, getrennte Zwecke) | iPhone: neu zum Home-Bildschirm hinzufügen, Icon sieht richtig aus (hell und dunkel, alle drei Designrichtungen) |
| Safe-Areas links und rechts | Klassen im Quelltext und erzeugtes CSS geprüft (`ui/safe-area.test.ts`) | iPhone quer (Notch links und rechts): nichts verschwindet hinter der Aussparung (Seitenleiste, Chat, Dialog, Anmeldung) |
| Tastatur: Eingabezeile hebt sich | ja, mit gefälschtem `visualViewport` (`ui/keyboard.test.ts`) | iPad und iPhone: Chat-Eingabe antippen: Eingabezeile bleibt über der Tastatur sichtbar; Dialog mit Eingabefeld ebenso; Tastatur schließen: alles zurück |

## M2 Mac-Hülle ([D-053](decisions.md))

Alle Punkte mit „ja“ unter Linux: `pnpm --filter @pagewise/desktop test` (112 Tests) und, für „im echten Electron“, ein Lauf unter Xvfb mit dem gebauten Stand (`pnpm --filter @pagewise/desktop smoke` für den Rauchtest).

| Punkt | Agent getestet | Maintainer prüft |
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
| Mac wach halten (Voreinstellung an, automatisch an während Antworten) | ja: Regel im Test | Mac: `pmset -g assertions` im Terminal zeigt bei eingeschaltetem „Mac wach halten“ eine Zusicherung `NoIdleSleepAssertion` des Prozesses Pagewise (Name „Electron“), bei ausgeschaltetem keine (am Mac gemessen: der gemessene Wortlaut ist `NoIdleSleepAssertion`, der früher vermutete `PreventUserIdleSystemSleep` trifft nicht zu); Deckel zu ohne externes Display: der Mac schläft trotzdem (bekannt, siehe D-053) |
| Downloads (Agent-Dateien) nach `~/Downloads` mit „Im Finder zeigen“ | ja: sicherer Dateiname, Zählung | Mac: Agent-Chat mit Datei: Benachrichtigung „Download fertig“, Klick öffnet den Finder |
| Dateiwahl nativ | nein (Chromium-Standard) | Mac: in einem Dialog mit Dateiwahl („Fächer importieren“) öffnet sich der Finder-Dialog |
| Einrichtungscode in der App statt in der Konsole; „Passcode zurücksetzen“ ohne Terminal | ja: Kanal und Neustart im Test (`control/embedded.test.ts`) | Mac: frische Installation (`PAGEWISE_DATA_DIR` auf leeren Ordner): Dialog mit Code, „Kopieren“; später Hilfe → Passcode zurücksetzen → neuer Code |
| „Alles löschen“ leert auch die Fensterdaten (Cookies bleiben) | ja: Auslöser und Datenarten im Test | Mac: in den Einstellungen „Alles löschen“; danach ist die Anmeldung noch da, Designwahl und Entwürfe sind weg |
| `claude` finden: Pfad einstellbar | ja: Server (`routes/engines.test.ts`) und Oberfläche | Mac: Einstellungen → Agent-CLI: zeigt „Claude Code gefunden“ auch bei Start aus dem Finder; sonst Pfad eintragen (`which claude` im Terminal) |
| `--smoke-test` | ja: Linux, Rauchtest der gebauten und der gepackten App (Exit 0), negativ geprüft (Exit 1); **ja, auf macOS:** Rauchtest der gepackten App in der macOS-CI (M4) grün | Mac (optional): `~/Applications/Pagewise.app/Contents/MacOS/Pagewise --smoke-test` endet mit „Rauchtest bestanden“ und Exit 0 (`echo $?`) |
| Keine Secrets in Prozess-Argumenten, Umgebung ist Allowlist | ja: Strukturtest und Test mit Fake-Schlüsseln | Mac: `ps -axww -o args \| grep -i '[p]agewise' \| grep -oiE 'setup.?code\|passcode\|api.?key\|token\|secret\|sk-…'` — keine Treffer in 11 Prozesszeilen der App (am Mac gemessen) |
| Keine Telemetrie, kein Hintergrund-Ping | ja: Strukturtest (keine fremden Adressen im Quelltext) | Mac (optional): Little Snitch oder `nettop` zeigen keine Verbindungen außer zu 127.0.0.1 und deinen Anbietern; am Mac gemessen (Momentaufnahme, kein Dauerprotokoll): `lsof -nP -a -p <PIDs der App> -i` zeigt nur `127.0.0.1:3000` (Server lauscht, Fenster verbindet), keine anderen Ziele |


## M3 Tailscale und „Mit iPhone und iPad verbinden“ ([D-054](decisions.md))

„Agent getestet“ heißt: `pnpm --filter @pagewise/desktop test` (Parser und Zustände gegen Fixtures nach den Quelltexten von Tailscale, Aktionen mit Ersatz für `execFile`) und ein Lauf im echten Electron unter Xvfb mit einem **Fake-`tailscale`** (Skript mit Zustandsdatei, nicht das echte Programm). Echte Tailscale-Läufe kann nur der Maintainer am Mac prüfen.

| Punkt | Agent getestet | Maintainer prüft |
| --- | --- | --- |
| Verbindungsfenster öffnet über Hilfe → „Mit iPhone und iPad verbinden …“ (und aus dem Menüleisten-Symbol) | ja, im echten Electron (Menüpunkt ausgelöst) | Mac: beides probieren, Fenster erscheint vorn |
| Fenster hat keine Verbindung zu Node, nur feste Funktionen; Navigation und `window.open` gesperrt; keine CSP-Verstöße | ja, im echten Electron gemessen | – |
| Zustände: nicht installiert, nicht angemeldet, wartet auf Freigabe, gestoppt, HTTPS im Tailnet aus, läuft | ja: Parser und Zustandsabbildung (`tailscale/tailscale.test.ts`, `connect-view.test.ts`) | Mac: Tailscale beenden → Fenster zeigt „Tailscale läuft nicht“ mit Knopf zum Öffnen; Tailscale starten → nach „Erneut prüfen“ „läuft“; Tailscale abmelden → „nicht angemeldet“ |
| Tailscale-Programm wird gefunden (App von Tailscale, Homebrew, `PATH`) | ja: Kandidatenliste und Prüfung mit Ersatz | **Mac: die wichtigste Prüfung:** Terminal: `/Applications/Tailscale.app/Contents/MacOS/Tailscale status --json` liefert JSON (Exit 0), `BackendState` = `Running`, Schlüssel `Self`, `CertDomains` (1 Eintrag: HTTPS im Tailnet an), `Peer`, `User` (am Mac gemessen). In `/usr/local/bin` und `/opt/homebrew/bin` gibt es kein `tailscale` — die Variante als App ist die einzige; das Fenster zeigt „läuft“ |
| HTTPS im Tailnet aus: Hinweis mit Link zur Admin-Seite | ja: Zustand und Link | Mac: im Admin-Bereich unter DNS HTTPS-Zertifikate ausschalten (nur im Testtailnet), Fenster zeigt den Hinweis; wieder einschalten, „Erneut prüfen“ (HTTPS im Tailnet ist laut Messung an: `CertDomains` hat einen Eintrag) |
| „Freigabe einrichten“ führt `tailscale serve --bg --yes 3000` aus, prüft danach und zeigt Adresse mit QR-Code | ja: Befehlszeile im Test, im echten Electron mit Fake | Mac: Knopf drücken; im Terminal `tailscale serve status` zeigt `https://<name>.<tailnet>.ts.net` mit Ziel `127.0.0.1:3000`; Adresse und QR im Fenster stimmen damit überein |
| QR-Code: Kamera des iPhones öffnet die Adresse | QR als SVG gerendert (Pfad, keine Bilddatei); Lesbarkeit nicht mit einer Kamera geprüft | iPhone: Kamera auf den QR halten, Link öffnet Pagewise (Tailscale muss auf dem iPhone verbunden sein) |
| Fremde Freigabe auf 443 wird nie überschrieben, Ausweichport (8443, 10000) auf Knopfdruck | ja: Zustandslogik und Aktion | Mac: `tailscale serve --bg 8080` für einen fremden Dienst, dann „Freigabe einrichten“: Hinweis auf Ausweichport, Knopf nutzt 8443; danach `tailscale serve status` zeigt beide |
| Rechnername wirkt personenbezogen: Warnung, Vorschlag `pagewise-mac`, Umbenennen mit Rückfrage | ja: Erkennung am Muster (`hostname.ts`), im echten Electron `set --hostname=pagewise-mac` | Mac: Rechnername im Tailnet ansehen (`tailscale status`); wirkt er nach dir wie eine Person, erscheint die Warnung; Umbenennen im Fenster (ändert den Namen **nur** im Tailnet, nicht den des Macs): danach neue Adresse, iPhone: neu anmelden und App neu zum Home-Bildschirm |
| `tailscale funnel` kommt nie vor; ist Funnel an, rote Warnung und Dialog beim Start, „Freigabe zurücksetzen“ mit Rückfrage | ja: Strukturtest, im echten Electron mit Fake-Zustand | Mac (nur im Testtailnet): `tailscale funnel 3000` im Terminal einschalten; beim nächsten Start der App Dialog, im Fenster rote Warnung; „Freigabe zurücksetzen“ nimmt sie weg; danach `tailscale serve status` leer. **Danach `tailscale funnel reset`** zur Sicherheit |
| Freigabe überlebt einen Neustart des Macs | nein (Verhalten von Tailscale) | Mac: Neustart, Tailscale und Pagewise starten, `tailscale serve status` zeigt die Freigabe weiter; wenn nicht, richtet die App sie beim Start wieder ein (nur, wenn sie früher darüber eingerichtet wurde) |
| iPhone und iPad erreichen Pagewise über die Adresse | nein | iPhone: Safari → Adresse → Pagewise lädt, Einrichtung bzw. Anmeldung; Teilen → „Zum Home-Bildschirm“; App öffnet im Vollbild |
| Tailscale-Adresse kopieren im Menüleisten-Symbol | ja: Menüstruktur mit Adresse | Mac: Symbol → „Tailscale-Adresse kopieren“, einfügen: `https://…ts.net` |
| Schlafender Mac, ehrlicher Hinweis im Fenster („Schläft er, ist Pagewise dort nicht erreichbar“) | ja: Text vorhanden | siehe M2 und P |

## M4 Bauen und Verteilen, Stufe 1 ([D-055](decisions.md), Stufe 2: [D-056](decisions.md))

„Agent getestet“ heißt hier: unter Linux (Packen für `darwin-arm64` und `linux-x64`, Aufbau des Pakets, Rauchtest der gepackten Linux-App, Repo-Tests). Alles, was `codesign`, `ditto` oder den Start auf macOS braucht, läuft erst in der macOS-CI und beim Maintainer.

| Punkt | Agent getestet | Maintainer prüft |
| --- | --- | --- |
| `pnpm app:mac` baut und installiert nach `~/Applications` | Argumente, Zielordner, Abbruch außerhalb von macOS, kein Shell-Aufruf (`tests/app-mac.test.mjs`); Packen für `darwin-arm64` unter Linux (Aufbau von `Pagewise.app` mit `Info.plist`, Ressourcen, Lizenzen); am Mac gemessen: `codesign --verify --deep --strict --verbose=2 ~/Applications/Pagewise.app` meldet „valid on disk“, „satisfies its Designated Requirement“, Exit 0; `xattr -l ~/Applications/Pagewise.app` bleibt ohne Ausgabe (keine Quarantäne-Markierung) | Mac: `pnpm install && pnpm app:mac`; am Ende steht „Installiert: …“ und `codesign --verify` meldet keinen Fehler; `open ~/Applications/Pagewise.app` startet die App, ohne dass macOS blockiert (`xattr -l ~/Applications/Pagewise.app` zeigt kein `com.apple.quarantine`) |
| Läuft Pagewise schon, bricht das Skript ab, statt die App zu überschreiben | nein (`pgrep -x Pagewise`, nur auf dem Mac) | Mac: Pagewise starten, `pnpm app:mac`: Abbruch mit Hinweis; Pagewise beenden, Befehl wiederholen: klappt |
| macOS-CI `desktop-mac` grün: Bauen, Signatur prüfen, Rauchtest der gepackten App, Artefakt | **ja, auf dem macOS-Läufer:** Lauf auf `716276f` komplett grün (Packen und Ad-hoc-Signatur, `codesign --verify`, Ressourcen und Lizenzdatei vorhanden, Rauchtest der gepackten App mit better-sqlite3 für `darwin-arm64`, Artefakt 134 653 167 Byte, 3 Tage aufbewahrt) | Seite „Actions“ auf GitHub: der Job `desktop-mac` ist bei den neuesten Läufen grün (Artefakt `Pagewise-mac-arm64` herunterladbar) |
| Artefakt aus der CI starten (Quarantäne) | nein | Mac (Apple-Silizium): Zip aus dem Artefakt laden, entpacken, `Pagewise.app` nach `~/Applications`; erster Start wird blockiert; Systemeinstellungen → Datenschutz & Sicherheit → „Trotzdem öffnen“ (Anleitung in `docs/self-hosting.md`, **ungeprüft**); danach startet die App. Stimmt die Anleitung nicht, bitte die Meldung von macOS wörtlich melden |
| Mindestversion | nur gelesen: `LSMinimumSystemVersion` 13.0 (Vorgabe von Electron 44); am Mac gemessen (PlistBuddy am installierten Bundle): `LSMinimumSystemVersion` = 13.0, Bundle-ID `io.github.kaytm93.pagewise`, Zugriffstext „Pagewise nutzt die Kamera nicht.“ | Mac-Modell und macOS-Version nennen (Apfelmenü → Über diesen Mac), danach lege ich eine Mindestversion fest oder lasse sie |
| Lizenzhinweise in der App | ja: `licenses.test.ts` (128 Pakete, nichts Unfreies, Schriften mit OFL-Text), `Resources/licenses/` im gepackten Paket; am Mac gemessen: `ls ~/Applications/Pagewise.app/Contents/Resources/licenses` zeigt `Electron-LICENSE`, `LICENSES.chromium.html`, `THIRD-PARTY-LICENSES.txt` | – |
| Deutsche Zugriffsfragen im Paket, App fragt nie nach Kamera, Mikrofon, Bluetooth | `Info.plist` gelesen, Test am Quelltext; Ablehnung aller Berechtigungen im echten Electron (M2) | Mac: Systemeinstellungen → Datenschutz & Sicherheit → Kamera/Mikrofon: Pagewise taucht dort nicht auf, auch nicht nach der Nutzung |
| Größe der App | rund 325 MB entpackt (`darwin-arm64`, gepackt unter Linux), Zip aus der CI 134 653 167 Byte; am Mac gemessen: `du -sh ~/Applications/Pagewise.app` = 323 MB | – |
| Stufe 2 (Entwicklerzertifikat, Notarisierung, DMG) | nur Entscheidungsvorlage, **nichts eingerichtet** | Der Maintainer entscheidet nach D-056 (Alter, 99 USD pro Jahr, Bedarf); bis dahin nichts zu tun |

