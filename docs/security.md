# Sicherheit und Privatsphäre

Pagewise verarbeitet Schul- und Personendaten, auch von Minderjährigen. Die Grundregel: **Alle Daten bleiben auf dem Rechner der Nutzerin oder des Nutzers.** Das Projekt sammelt nichts, es gibt keine Telemetrie, keine Analytics und keine Konten bei uns.

## Bedrohungsmodell (kurz)

| Bedrohung | Maßnahme |
| --- | --- |
| Versehentlich veröffentlichte Daten oder Schlüssel im Repo | Daten außerhalb des Repos, `.gitignore`, Secret-Scan im Pre-Commit-Hook und in der CI, Privacy-Check |
| Zugriff aus dem Netz | Server bindet nur an Loopback, Erreichbarkeit nur über Tailscale Serve, kein Funnel |
| Fremder Zugriff im eigenen Netz | Passcode (Hash), Sitzungs-Cookies, Rate-Limit, CSRF-Schutz, Security-Header |
| Schadcode aus Modell-Ausgaben | Markdown ohne rohes HTML, Bereinigung von SVG und HTML, kein `eval` |
| Prompt-Injection über Bilder, Dateien, Antworten | Inhalte lösen nie selbstständig Aktionen aus, Agenten laufen mit Whitelist und im Workspace |
| Abfluss von Schlüsseln | Secrets nur serverseitig, nie in Antworten, Logs, Jobs oder Exporten, nie als Prozess-Argument |
| Daten bei Anbietern | Transparente Anzeige pro Anbieter, Option „Bilder nicht senden“, Hinweis bei Free-Modellen |

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
| Bereinigung von SVG, HTML und Formeln in Hefteinträgen | geplant (Phase 1b) |
| EXIF-Entfernung, Upload-Prüfung | geplant (Phase 1c) |
| PDF-Rendering ohne Netzwerk | geplant (Phase 1d) |
| Agent-CLI mit Umgebungs-Allowlist und Workspace-Isolation | geplant (Phase 1e) |
| Löschen entfernt Dateien, „Alles löschen“, verschlüsselte Backups | geplant |

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
- Die Antworten im Chat sind Text des Modells. Pagewise zeigt sie bereinigt an, prüft aber nicht, ob sie stimmen. Ein Modell kann sich irren, erfundene Quellen nennen oder Anweisungen aus eingefügten Texten folgen. Prüfe Wichtiges nach.
- Der Passcode-Schutz ist für ein privates Tailnet gedacht, nicht für das offene Internet.

Meldeweg für Sicherheitslücken: [SECURITY.md](../SECURITY.md).
