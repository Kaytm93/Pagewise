# Sicherheit und Privatsphäre

Pagewise verarbeitet Schul- und Personendaten, auch von Minderjährigen. Die Grundregel: **Alle Daten bleiben auf dem Rechner der Nutzerin oder des Nutzers.** Das Projekt sammelt nichts, es gibt keine Telemetrie, keine Analytics und keine Konten bei uns.

## Bedrohungsmodell (kurz)

| Bedrohung | Maßnahme |
| --- | --- |
| Versehentlich veröffentlichte Daten oder Schlüssel im Repo | Daten außerhalb des Repos, `.gitignore`, Secret-Scan im Pre-Commit-Hook und in der CI, Privacy-Check |
| Zugriff aus dem Netz | Server bindet nur an Loopback, Erreichbarkeit nur über Tailscale Serve, kein Funnel |
| Fremder Zugriff im eigenen Netz | Passcode (Hash), Sitzungs-Cookies, Rate-Limit, CSRF-Schutz, strenge CORS-Regel, Security-Header |
| Schadcode aus Modell-Ausgaben | Markdown ohne rohes HTML, Bereinigung von SVG und HTML, kein `eval` |
| Prompt-Injection über Bilder, Dateien, Antworten, Notizen | Inhalte lösen nie selbstständig Aktionen aus, Agenten laufen mit Whitelist und im Workspace, Werkzeuge der KI lesen nur und ihre Ergebnisse gelten als Daten (D-044) |
| Abfluss von Schlüsseln | Secrets nur serverseitig, nie in Antworten, Logs, Jobs oder Exporten, nie als Prozess-Argument |
| Daten bei Anbietern | Transparente Anzeige pro Anbieter, Option „Bilder nicht senden“, Schalter für Stundenplan und Tests (global und je Anbieter, nur bei Abruf), Hinweis bei Free-Modellen |

## Stand der Umsetzung

| Maßnahme | Stand |
| --- | --- |
| Datenverzeichnis außerhalb des Repos mit Start-Check | umgesetzt (Phase 0) |
| Server nur an Loopback | umgesetzt (Phase 0) |
| Security-Header inkl. CSP | Grundstock umgesetzt (Phase 0) |
| `.gitignore`, Secret-Scan-Hook, Privacy-Check, CI mit gitleaks | umgesetzt (Phase 0) |
| Passcode (scrypt), Einrichtungscode, Sitzungen, CSRF, Rate-Limit | umgesetzt (Phase 1a), siehe D-020 und D-021 |
| Secrets in Datei mit Rechten 600, nie in Antworten oder Logs | umgesetzt (Phase 1a), Keychain bewusst nicht, siehe D-018 |
| Oberfläche ohne Inline-Styles und ohne externe Ressourcen (strenge CSP), CSRF-Token nur im Speicher | umgesetzt (Phase 1a), siehe D-023 |
| Import von Fächern (JSON, CSV): Größen- und Mengengrenze, nur bekannte Felder, Fehlerantworten ohne Dateiinhalt | umgesetzt (Phase 1a) |
| Bekannter Befund: `pnpm audit` meldet eine mittlere Lücke in `esbuild` über `drizzle-kit` (nur Entwicklung, läuft nie im Betrieb); die CI-Schwelle ist „high“ | beobachtet, wird mit dem nächsten `drizzle-kit`-Update behoben |
| Datenbank, Sicherungen vor Migrationen und Unterordner nur für den Besitzer (600/700) | umgesetzt (Phase 1a), siehe D-017 und D-019 |
| Anbieter-Schlüssel nur im Secret-Speicher, in Antworten nur `hasKey` und letzte vier Zeichen, Test belegt: kein Schlüssel in Antworten oder Fehlern | umgesetzt (Phase 1a), siehe D-026 |
| Anfragen an Anbieter: `https` Pflicht (`http` nur für Loopback), keine Weiterleitungen, Fehler nur als Codes, Größen- und Mengengrenzen | umgesetzt (Phase 1a), siehe D-026 |
| Hinweis bei kostenlosen Modellen („können Eingaben protokollieren“) im Formular und im Onboarding | umgesetzt (Phase 1a), siehe D-024 |
| Modell-Antworten im Chat: Markdown ohne rohes HTML, Links nur `http`, `https`, `mailto` mit `noopener noreferrer nofollow`, Bilder werden nie geladen; Test belegt: kein `script`, `img`, `onerror`, `javascript:` | umgesetzt (Phase 1a), siehe D-028 |
| Chat-Antworten und Fehler: Texte der Anbieter und der Nachrichten erscheinen nie in Fehlern oder Logs, nur Codes | umgesetzt (Phase 1a), siehe D-026 und D-027 |
| Service Worker speichert nur Startseite, `/assets` und `/icons`, nie `/api` oder den Antwort-Strom; Test liest den echten Quelltext | umgesetzt (Phase 1a), siehe D-029 |
| Bereinigung von SVG, HTML und Formeln in Hefteinträgen | **umgesetzt (Phase 1b)**, siehe D-048 und [acceptance-1b.md](acceptance-1b.md) |
| EXIF-Entfernung, Upload-Prüfung | geplant (Phase 1c) |
| PDF-Rendering ohne Netzwerk | geplant (Phase 1d) |
| Agent-CLI mit Umgebungs-Allowlist und Workspace-Isolation (Sandbox und Berechtigungsregeln, `--safe-mode`) | umgesetzt (Phase 1e), siehe D-039, D-040 und [agent-cli.md](agent-cli.md) |
| Strenge CORS-Regel: fremde Herkunft wird abgelehnt, keine `Access-Control-*`-Header | umgesetzt (Phase 1a), siehe D-031 |
| „Alles löschen“ mit Passcode, leert Datenbank (`VACUUM`), Dateien, Sicherungen und Schlüssel; Test: Text nicht mehr in Datenbankdatei oder WAL | umgesetzt (Phase 1a), siehe D-032 |
| Je Anbieter: Übersicht, was gesendet wird, und Schalter „Bilder nicht senden“ | Übersicht und Schalter umgesetzt (Phase 1a), Durchsetzung ab Phase 1c, siehe D-033 |
| Löschen von Fach, Chat oder Asset entfernt auch Dateien auf der Platte | Zeilen umgesetzt, Dateien mit Assets (ab 1b/1c) |
| Standard-Prompts im öffentlichen Repo (D-034): neutral, ohne Namen, Orte, Schulen, Bundesländer, Lehrplan- oder Prüfungsangaben; Test prüft jede Datei | umgesetzt, siehe D-034 |
| „Alles löschen“ leert jede Tabelle außer Anmeldung, Sitzungen und Migrationsprotokoll (auch künftige) | umgesetzt, siehe D-038 |
| Verschlüsselte Backups und Export | geplant |
| Werkzeugzugriff der KI: nur lesend, geprüfte Argumente, begrenzte Ausgabe, Schalter global und je Anbieter, nur Name und Zustand gespeichert | umgesetzt (Welle 3), siehe D-044 und [tools.md](tools.md) |
| Mac-App: Fenster mit Sandkasten, getrenntem Kontext und ohne Node, Hauptfenster ohne Preload, alle Berechtigungen der Seite abgelehnt, Navigation nur zur eigenen Herkunft | umgesetzt (Mac-Hülle), im echten Electron gemessen, siehe D-053 |
| Mac-App: Server als Unterprozess mit Allowlist-Umgebung und leerer Argumentliste, Status und Einrichtungscode nur über IPC, nie über HTTP | umgesetzt, siehe D-050, D-051, D-053 |
| Mac-App: Hüllen-Fenster nur mit festen Funktionen im Preload, IPC nur von eigenen lokalen Seiten (Sender und Frame-URL geprüft), strenge CSP ohne Inline-Skript und -Style | umgesetzt, siehe D-053, D-054 |
| Mac-App: Tailscale nur über `execFile` ohne Shell mit minimaler Umgebung, nie `tailscale funnel`, rote Warnung bei öffentlicher Freigabe, Warnung bei Rechnernamen mit Personenbezug | umgesetzt, siehe D-054 |
| Mac-App: keine Telemetrie, Chromium-Hintergrundverbindungen abgeschaltet (Netzprotokoll geprüft) | umgesetzt (unter Linux gemessen, am Mac ungeprüft), siehe D-053 |
| Mac-App: Lizenzhinweise der mitgelieferten Pakete in der App | umgesetzt, siehe D-055 |
| Mac-App: Developer-ID-Signatur und Notarisierung | **nicht eingerichtet** (Stufe 1: nur ad hoc), Entscheidungsvorlage D-056 |

## Mac-App

Die Mac-App ist eine Hülle um denselben Server (D-050 bis D-056). Wo die Grenzen liegen:

- **Das Hauptfenster lädt nur den eigenen Server** (`http://127.0.0.1:3000`). Es hat keinen Preload und damit keine Brücke in den Inhalt, `contextIsolation` und `sandbox` sind an, Node ist aus (`require` und `process` sind in der Seite nicht vorhanden, gemessen). Fremde Links gehen in den Standardbrowser, `file:`, `javascript:` und `data:` werden abgelehnt, `window.open` öffnet nie ein App-Fenster. Alle Berechtigungen der Seite (Kamera, Mikrofon, Standort, Benachrichtigungen, Geräte, Zwischenablage) werden abgelehnt.
- **Hüllen-Fenster** („Mit iPhone und iPad verbinden“, Start- und Fehlerseite) sind lokale Seiten mit eigener strenger CSP und einem Preload mit **festen Funktionen**; der Hauptprozess nimmt IPC nur von diesen Seiten an und prüft Sender und Frame-URL. Die Seite kann keine Befehle, Pfade oder Adressen vorgeben.
- **Der Server läuft als Unterprozess** mit einer ausdrücklich zusammengestellten Umgebung (nur `HOME`, `USER`, Sprache, Zeitzone, ein erweiterter `PATH` und die `PAGEWISE_*`-Werte, nie `process.env` als Ganzes) und leerer Argumentliste. Schlüssel anderer Programme, Proxy-Einstellungen, `NODE_OPTIONS` und `DYLD_*` kommen nie an.
- **Status und Steuerung laufen nur über IPC, nie über HTTP.** Hinter Tailscale Serve kommen alle Anfragen von 127.0.0.1 (D-021): ein „nur lokaler“ Endpunkt wäre für das ganze Tailnet sichtbar. Der Einrichtungscode erscheint nur in einem Dialog der App.
- **Tailscale** wird nur mit `execFile` ohne Shell, mit Zeitlimit und minimaler Umgebung aufgerufen. `tailscale funnel` kommt im Quelltext nicht vor (Strukturtest). Die App prüft bei jeder Abfrage, ob irgendeine Freigabe öffentlich ist, und warnt in Rot. Eine fremde Freigabe überschreibt sie nie, `serve reset` (nimmt alle Freigaben weg) nur nach Rückfrage.
- **Keine Telemetrie.** Chromium-Schalter schalten Hintergrundverbindungen (Komponenten-Updates, Verbindungsprüfung, Domain-Reliability) ab; ein Strukturtest sucht fremde Adressen im Quelltext. Unter Linux blieb im Netzprotokoll nur der Download eines Rechtschreib-Wörterbuchs, den es auf dem Mac nicht gibt (D-053). Am Mac nicht gemessen.
- **Signatur.** Stufe 1 (D-055) signiert nur ad hoc und notarisiert nicht: macOS blockiert eine heruntergeladene App deshalb beim ersten Start, eine selbst gebaute nicht. Das ist ein Komfort-, kein Sicherheitsmerkmal: Eine ad-hoc-Signatur sagt nichts über den Urheber. **Lade `Pagewise.app` nur aus deinem eigenen Build oder aus der CI dieses Repos.**
- **Daten des Fensters** (Cookies, `localStorage`, Cache) liegen im Datenverzeichnis unter `Fenster` mit Rechten 700, getrennt vom Server; „Alles löschen“ leert sie (nicht den Passcode).

## Datenverzeichnis

Alles, was Nutzerdaten enthält, liegt im Datenverzeichnis: Datenbank, Uploads, Workspaces, Logs, Secrets, Backups. Standard unter macOS `~/Library/Application Support/Pagewise`, unter Linux `$XDG_DATA_HOME/pagewise`, überschreibbar mit `PAGEWISE_DATA_DIR`. Der Start-Check lehnt Orte innerhalb eines Git-Arbeitsverzeichnisses ab (Details: [decisions.md](decisions.md), D-005).

## Repo-Hygiene

- Der Hook `.githooks/pre-commit` wird bei `pnpm install` aktiviert und führt `scripts/secret-scan.mjs --staged` und `scripts/check-privacy.mjs --staged` aus.
- Der Secret-Scan zeigt nie den gefundenen Wert an, nur Datei, Zeile und Regel.
- Der Privacy-Check liest eigene Begriffe aus `config/privacy-blacklist.local.txt` (nicht im Repo).
- Die CI prüft zusätzlich mit gitleaks, führt `pnpm audit` aus und lässt Dependabot Abhängigkeiten aktualisieren.
- Tests und Beispiele nutzen nur erfundene Daten.

## Bekannte Grenzen

- Ein lokales Skript kann keine Garantie geben. Der Scan erkennt bekannte Muster, nicht jedes Geheimnis. Prüfe Commits vor dem Veröffentlichen selbst.
- Wer Zugriff auf den Rechner hat, hat Zugriff auf die Daten. Das Datenverzeichnis ist nicht verschlüsselt, nutze die Festplattenverschlüsselung deines Systems.
- Modell-Anbieter sehen, was du ihnen sendest. Free-Modelle können Prompts protokollieren. Pagewise prüft die Datenschutzregeln der Anbieter nicht, auch nicht die von OpenRouter und der Anbieter dahinter.
- Ein eingetragener Anbieter bekommt deinen Schlüssel und alles, was du an ihn schickst. Trägst du eine fremde Adresse ein, geht der Schlüssel dorthin. Pagewise prüft nur, dass die Adresse `https` nutzt, nicht, wem sie gehört.
- Die Sicherungen vor Migrationen im Ordner `backups` sind unverschlüsselt, wie der Rest des Datenverzeichnisses.
- „Alles löschen“ erreicht nur Pagewise selbst. Kopien durch Time Machine, Snapshots des Dateisystems oder eine Cloud-Sicherung des Ordners bleiben bestehen, und auf SSDs gibt es kein garantiertes Überschreiben. Schließe das Datenverzeichnis aus solchen Sicherungen aus, wenn das wichtig ist.
- Die Antworten im Chat sind Text des Modells. Pagewise zeigt sie bereinigt an, prüft aber nicht, ob sie stimmen. Ein Modell kann sich irren, erfundene Quellen nennen oder Anweisungen aus eingefügten Texten folgen. Prüfe Wichtiges nach.
- Der Passcode-Schutz ist für ein privates Tailnet gedacht, nicht für das offene Internet.
- Mit HTTPS im Tailnet steht der **Rechnername im öffentlichen Zertifikatsverzeichnis** (laut Tailscale). Die Mac-App warnt vor Namen, die nach einer Person klingen, und schlägt `pagewise-mac` vor; die Erkennung ist eine Näherung und beweist keine Unbedenklichkeit.
- Die Mac-App hält den Mac wach, solange sie läuft, aber ein MacBook mit **zugeklapptem Deckel ohne externes Display schläft trotzdem**: Dann ist Pagewise auf iPhone und iPad nicht erreichbar.

Meldeweg für Sicherheitslücken: [SECURITY.md](../SECURITY.md).
