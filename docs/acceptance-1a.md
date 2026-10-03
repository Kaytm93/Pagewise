# Abnahme Phase 1a

Stand: 3. Oktober 2026. Eine Phase gilt erst als abgenommen, wenn die berührten Punkte aus Abschnitt 12 des Pflichtenhefts erfüllt und getestet sind. Abschnitt 12 liegt vor und ist unten Punkt für Punkt abgeglichen. **Nicht abgenommen**, solange die Tests auf iPhone und iPad aus dem letzten Abschnitt fehlen.

## Kriterien Phase 1a (Abschnitt 14)

| Kriterium | Stand | Beleg |
| --- | --- | --- |
| Frische Installation startet leer | belegt | Lauf mit leerem Datenverzeichnis: Einrichtung nötig, Profil leer, keine Fächer, keine Anbieter, keine Chats |
| Nutzbar über Tailscale per HTTPS auf iPad und iPhone | **offen, Test durch Kay** | Anleitung in [self-hosting.md](self-hosting.md), Quellen und Grenzen in D-030 |
| Installierbar als Web-App | Technik belegt, **Installation offen, Test durch Kay** | Manifest, Icons, Service Worker in Chromium geprüft (D-029); „Zum Home-Bildschirm“ prüft Kay |
| Chats bleiben in ihrem Fach | belegt | Server-Tests und Lauf: ein Chat in Fach A erscheint nicht in Fach B; die Oberfläche zeigt einen Chat unter dem falschen Fach als „nicht gefunden“ (D-028) |
| Zweiter Anbieter ohne Codeänderung | belegt | Zwei Anbieter über die Oberfläche beziehungsweise API angelegt, Standard- und Ausweichmodell aus verschiedenen Anbietern gewählt |
| Nach einem Nutzungslauf zeigt `git status` keine neuen Dateien | belegt | Lauf mit Einrichtung, Fächern, Anbietern und Chat: `git status` leer, außer den ignorierten Ordnern `node_modules` und `dist` nichts im Repo |
| Schlüssel weder in Antworten noch in Logs | belegt | Erfundene Schlüssel wurden in keiner Antwort (Inhalt und Header), im Server-Log und in der Datenbank gefunden, nur im Secret-Speicher (`secrets/`, Rechte 600) |

Die Läufe nutzen einen erfundenen, lokalen Anbieter, der Antworten streamt. Mit einem echten OpenRouter-Schlüssel wurde nichts getestet (kein Netzzugang zu OpenRouter in der Entwicklungsumgebung).

## Abgleich mit Abschnitt 12 (Datensicherheit und Privatsphäre)

Legende: **erfüllt** = umgesetzt und getestet, **später** = gehört zu einer späteren Phase und ist dort Abnahmebedingung, **Abweichung** = bewusst anders, mit Begründung.

| Punkt | Stand | Beleg und Anmerkung |
| --- | --- | --- |
| 12.1 Daten außerhalb des Repos, Standardordner, Umgebungsvariable | erfüllt, **Abweichung bei Namen** | `Pagewise` statt „Schulheft“, `PAGEWISE_DATA_DIR` statt `SCHULHEFT_DATA_DIR` (D-016) |
| 12.1 Start-Check: Datenverzeichnis im Git-Arbeitsverzeichnis verweigert den Start | erfüllt | D-005, Tests |
| 12.1 Dev- und Testdaten repo-extern oder temporär, erfundene Daten | erfüllt | Tests nutzen Temp-Ordner und erfundene Daten (CLAUDE.md, Regel 3) |
| 12.2 Secrets bevorzugt in der Keychain, Fallback Datei mit 600 | **Abweichung** | Nur Datei mit Rechten 600, Keychain bewusst nicht (D-018). Das Pflichtenheft nennt die Datei als Fallback. |
| 12.2 Keys verlassen den Server nie (Browser, Antworten, Logs, Fehler, Jobs, Prompts, Exporte) | erfüllt | Tests und Lauf: erfundene Schlüssel in keiner Antwort, keinem Log, nicht in der Datenbank (D-026) |
| 12.2 UI zeigt nur maskiert (letzte 4 Zeichen), nur überschreibbar | erfüllt, strenger | Letzte vier Zeichen erst bei Schlüsseln ab 16 Zeichen, kürzere zeigen nichts |
| 12.2 Secrets nie als Kommandozeilen-Argument | erfüllt | Es gibt noch keinen Subprozess; Regel gilt für 1e (agent-cli.md) |
| 12.2 Backup/Export ohne Secrets | erfüllt für Sicherungen, Export **später** | Sicherungen vor Migrationen enthalten nur die Datenbank, Schlüssel liegen nicht darin |
| 12.3 Passcode nur als Hash (Argon2id oder scrypt) | erfüllt | scrypt (D-020) |
| 12.3 Cookie HttpOnly, Secure, SameSite=Strict | erfüllt, `Secure` hinter Proxy **ungeprüft** | `Secure` folgt `X-Forwarded-Proto` (D-030), Test durch Kay |
| 12.3 CSRF-Schutz | erfüllt | D-021 |
| 12.3 Strikte CORS-Regeln | **neu erfüllt** | Fremde Herkunft wird abgelehnt, keine `Access-Control-*`-Header (D-031) |
| 12.3 Rate-Limit mit Sperre | erfüllt | D-021, auch für „Alles löschen“ |
| 12.3 Security-Header inkl. CSP | erfüllt | D-023 |
| 12.3 Nur Loopback, nur Tailscale Serve, kein Funnel | erfüllt | D-006, D-013, D-030; Praxistest durch Kay |
| 12.4 Markdown ohne rohes HTML, kein `eval` | erfüllt | D-028, Test gegen feindliches Markdown |
| 12.4 SVG und HTML bereinigen (DOMPurify) | **später** (1b) | Hefteintrags-Blöcke |
| 12.4 PDF-Rendering ohne Netzwerk | **später** (1d) | |
| 12.4 Uploads: MIME, Größe, Pfade, EXIF/GPS entfernen | **später** (1c); Pfad-Sicherheit der Dateiablage erfüllt | Dateiablage prüft Schlüssel und Symlinks (storage) |
| 12.4 Prompt-Injection löst keine Aktionen aus | teils; Engine-Schutz **später** (1e) | Technische Ebene des Prompts (D-025); im Chat gibt es keine Aktionen |
| 12.5 Agent-CLI: Umgebungs-Allowlist, Workspace-Isolation, keine Flags zum Überspringen aller Abfragen | **später** (1e) | Entwurf in agent-cli.md |
| 12.6 Pro Anbieter zeigen, was gesendet wird, Hinweis bei Free-Modellen | **neu erfüllt** | Übersicht im Anbieter-Formular, Hinweis bei Free-Modellen (D-033, D-024) |
| 12.6 Option „Bilder nicht an diesen Anbieter senden“ | Schalter erfüllt, Durchsetzung **später** (1c) | Feld `sendImages`, `allowsImages()`; Test mit echten Bildern ab 1c (D-033) |
| 12.6 Keine Telemetrie, Analytics, externe CDN-Aufrufe | erfüllt | Schriften selbst gehostet (D-009), CSP `default-src 'self'`, Test: keine fremden Adressen in `index.html` und Manifest |
| 12.7 „Alles löschen“ in den Einstellungen | **neu erfüllt** | Passcode-Abfrage, Datenbank, Dateien, Sicherungen, Schlüssel; Test: Text nicht mehr in Datenbankdatei oder WAL (D-032) |
| 12.7 Löschen von Fach, Chat, Asset entfernt auch Dateien | Zeilen erfüllt, Dateien **später** (ab 1b/1c) | Es gibt in 1a noch keine Dateien; Test wird mit den Assets Pflicht |
| 12.7 Backup/Export als Archiv, optional verschlüsselt (age) | **später** | |
| 12.7 Logs ohne Prompts, Antworten, Bildinhalte, Keys | erfüllt | Der Server schreibt keine Logdatei; die Konsole zeigt nur Adresse, Datenverzeichnis und den Einrichtungscode |
| 12.8 `.gitignore` deckt Datenverzeichnisse, `*.sqlite*`, uploads, workspaces, exports, `.env*`, `secrets*`, `*.local.*` ab | erfüllt | `.gitignore` |
| 12.8 Secret-Scan vor jedem Commit und in der CI | erfüllt | Eigenes Skript lokal, gitleaks in der CI (D-003) |
| 12.8 Test auf echte Schul- und Personendaten mit lokaler Blacklist | erfüllt | D-004 |
| 12.8 Lockfile, `pnpm audit` in der CI, Dependabot | erfüllt | `pnpm-lock.yaml`, `.github/workflows/ci.yml`, `.github/dependabot.yml` |
| 12.8 `SECURITY.md` und `docs/security.md` | erfüllt | |

## Was nur auf den Geräten geprüft werden kann

- Anmeldung über die `ts.net`-Adresse, Cookie mit `Secure` (D-030)
- Installation auf dem Home-Bildschirm und erneute Anmeldung in der installierten App (D-029)
- Eingabezeile bleibt mit eingeblendeter Tastatur sichtbar (D-028)
- Eine laufende Antwort läuft nach dem Aufwecken des Geräts weiter und hängt sich wieder an (D-027)
- „Verbindung testen“ und eine echte Antwort mit einem OpenRouter-Schlüssel
- Der Rechner bleibt wach, solange man zugreift

## Offene Punkte

- Z.ai Coding Plan: nach Entscheidung des Kontoinhabers zulässig, mit Auflagen (D-011). Vor Phase 1e werden die Bedingungen erneut geprüft.
- Autostart (`launchd`) und `docker compose` sind in [self-hosting.md](self-hosting.md) für Phase 1a angekündigt, aber noch nicht gebaut.
