# Entscheidungen

Stand: 3. Oktober 2026. Jede Entscheidung nennt Begründung und, wo sie von Quellen abhängt, die Quelle. Quellen können sich ändern, vor dem Einbauen erneut prüfen.

## D-001 Stack

TypeScript, pnpm-Monorepo, `apps/server` (Hono), `apps/web` (Vite, React, Tailwind v4), Tests mit Vitest, Lint und Format mit Biome.

Begründung: Eine Sprache für Server, Worker und Oberfläche hält das Selbst-Hosting einfach. Hono ist klein, nutzt Web-Standards (Streaming per SSE ist eingebaut) und braucht wenige Abhängigkeiten. SQLite mit Drizzle kommt in Phase 1a, `packages/render` in Phase 1b. Pakete werden erst angelegt, wenn sie gebraucht werden.

## D-002 Server läuft mit `tsx`, ohne eigenen Build-Schritt

Entwicklung und Betrieb starten den TypeScript-Quelltext direkt mit `tsx`. Die Oberfläche wird mit Vite gebaut und vom Server ausgeliefert.

Begründung: Ein Befehl (`pnpm start`) genügt, es gibt kein zweites Build-Artefakt für den Server. Die Node-eigene Typ-Entfernung wurde verworfen, weil sie Pfad-Aliase und Pakete unter `node_modules` nicht zuverlässig unterstützt.

## D-003 Secret-Scan: eigenes Skript lokal, gitleaks in der CI

Der Pre-Commit-Hook ruft `scripts/secret-scan.mjs` auf (ohne zusätzliche Installation lauffähig). Die CI führt zusätzlich gitleaks aus.

Begründung: Der Hook muss auf jedem Rechner sofort funktionieren, auch ohne gitleaks. Das eigene Skript deckt die wichtigsten Muster ab (private Schlüssel, GitHub, OpenRouter, OpenAI, Anthropic, Google, Slack, AWS, Z.ai-Format, allgemeine `key = wert`-Zuweisungen), gitleaks fängt in der CI mehr ab. Das Skript gibt gefundene Werte nie aus, nur Datei, Zeile und Regel.

## D-004 Privacy-Check mit lokaler Blacklist

`scripts/check-privacy.mjs` sucht in allen getrackten bzw. gestagten Dateien nach Begriffen aus `config/privacy-blacklist.local.txt`. Die Datei ist per `.gitignore` ausgeschlossen und liegt nur lokal. Fehlt sie, gibt der Check einen Hinweis aus und besteht.

Begründung: Eine Blacklist mit echten Schul- oder Personennamen darf nicht selbst im Repo liegen. In der CI gibt es sie deshalb nicht, dort greifen nur Secret-Scan und Review.

## D-005 Start-Check für das Datenverzeichnis

Die App verweigert den Start, wenn das aufgelöste Datenverzeichnis (nach `realpath`, auch für noch nicht existierende Pfade über den nächsten vorhandenen Elternordner) innerhalb eines Git-Arbeitsverzeichnisses liegt oder innerhalb des Ordners dieser Anwendung. Erkannt wird ein Git-Arbeitsverzeichnis an einem `.git`-Eintrag (Ordner oder Datei) in einem Elternordner.

Grenzfall: Ist dein Home-Ordner selbst ein Git-Repository (z. B. für Dotfiles), schlägt der Check mit dem Standardpfad an. Setze dann `PAGEWISE_DATA_DIR` auf einen Ort außerhalb. Das ist gewollt, die Fehlermeldung erklärt es.

Das Datenverzeichnis wird mit Rechten `700` angelegt.

## D-006 Server bindet nur an Loopback

`PAGEWISE_HOST` akzeptiert nur `127.0.0.1`, `::1` und `localhost`. Für Docker gibt es die Ausnahme `PAGEWISE_ALLOW_NON_LOOPBACK=1`, dann muss der Port ausschließlich an `127.0.0.1` des Hosts veröffentlicht werden.

Begründung: Erreichbarkeit soll nur über Tailscale Serve entstehen, nie über einen offenen Port. Tailscale Serve leitet laut Doku an einen lokalen Dienst auf `127.0.0.1` weiter.

## D-007 Lizenz: MIT

Begründung: Kurz, bekannt, erlaubt Selbst-Hosting, Anpassung und Weitergabe ohne Hürden. Das passt zu einem Projekt, das jeder für die eigene Schule anpassen soll. Es gibt keinen Patentschutz-Zusatz wie bei Apache-2.0, für ein kleines Schulprojekt ist das vertretbar.

**Bestätigt** vom Maintainer am 3. Oktober 2026.

## D-008 Designsystem: Kontrast bei Links und Hilfstexten

Die Vorgabe „Research Blue `#207dff` nur für Links und kleine aktive Akzente“ wird als Token `--color-research-blue` übernommen. Für **Text-Links** gilt ein dunkleres Token `--color-link-text` (`#1560cc`), weil `#207dff` als Text den Kontrast von 4,5 : 1 (WCAG AA) nicht erreicht: gemessen 3,77 : 1 auf Eggshell Canvas, 3,60 : 1 auf Cloud Surface, 3,38 : 1 auf Paper Beige und 3,30 : 1 auf Whiteboard Gray. Das dunklere Blau kommt im ungünstigsten Fall auf 5,02 : 1. Die originale Farbe bleibt als `--accent` für Fokusringe und kleine aktive Elemente, dort genügen 3 : 1.

Alle übrigen Kombinationen der Vorgabe erreichen AA (Quiet Gray `#6a6972` mindestens 4,64 : 1 auf den hellen Flächen). Disabled Ash `#a8a8a8` erreicht nur 2,0 bis 2,3 : 1, das ist für deaktivierte Elemente zulässig, darf aber nie für lesbaren Text verwendet werden.

Der Dark Mode ist abgeleitet (Werte aus der Vorgabe, ergänzt um Sekundär- und Hilfstext) und per Test gegen AA geprüft, alle Kombinationen liegen über 5,3 : 1. Die Tests stehen in `apps/web/src/styles/tokens.test.ts`.

## D-009 Fonts selbst gehostet

Inter und Instrument Sans kommen über `@fontsource` ins Bundle, es gibt keine Aufrufe an Font-CDNs zur Laufzeit.

## D-010 Erkenntnisse für Phase 1e (Agent-CLI), Stand 3. Oktober 2026

- **Nicht-interaktiver Modus:** `claude -p` mit `--output-format stream-json --verbose --include-partial-messages`. Berechtigungen über `--allowedTools` (Tool-Whitelist) und `--permission-mode dontAsk` bzw. `--permission-prompts none`, damit nichts auf eine Antwort wartet. Quelle: <https://code.claude.com/docs/en/headless>
- **`--bare` passt nicht zum Claude-Abo-Profil.** Im Bare-Modus liest Claude Code weder OAuth-Zugangsdaten noch den System-Schlüsselbund, dort geht nur ein API-Key. Das Abo-Profil läuft deshalb ohne `--bare`. Dafür muss sichergestellt werden, dass nur der App-eigene Workspace-Ordner als Arbeitsverzeichnis dient (Projekt-Hooks und `.mcp.json` werden im `-p`-Modus ohne Rückfrage geladen). Quelle: dieselbe Seite.
- **Die Sandbox betrifft nur Shell-Befehle.** Die Tools Read, Edit und Write sowie MCP-Server und Hooks laufen außerhalb der Sandbox und folgen den Berechtigungsregeln. Workspace-Isolation braucht deshalb beides: Sandbox-Einstellungen (`sandbox.enabled`, `failIfUnavailable: true`, `allowUnsandboxedCommands: false`, `filesystem.denyRead` für das Home-Verzeichnis mit `allowRead` für den Workspace) **und** Berechtigungsregeln für die Datei-Tools. Der Test „Zugriff außerhalb des Workspace scheitert“ muss beide Wege abdecken. Quelle: <https://code.claude.com/docs/en/sandboxing>
- **Regeln zur Nutzung:** Unveränderte Binary, keine entfernten oder umgangenen Anmeldewege, keine Claude.ai-Anmeldung in eigenen Anwendungen, keine Weitergabe von Abo-Zugängen an andere. Ein Endnutzer darf sich in der unveränderten Binary mit dem eigenen Abo anmelden. Die Namen „Claude Code“ und „Anthropic“ dürfen nicht Teil des Produktnamens oder Logos sein, als Hinweis im Text sind sie erlaubt. Quelle: <https://code.claude.com/docs/en/legal-and-compliance>

## D-011 Z.ai Coding Plan

- Das Kontingent darf nur in offiziell unterstützten Tools genutzt werden, das Abo gehört allein dem Kontoinhaber. Quelle: <https://docs.z.ai/devpack/usage-policy>
- Ausdrücklich ausgeschlossen ist die Nutzung für direkt aufgerufene Modell-APIs aus eigenen Anwendungen, Bots, Websites oder anderen Systemen, außer es gibt eine schriftliche Vereinbarung. Folgen reichen von Einschränkung bis Sperre ohne Rückerstattung. Quelle: <https://docs.z.ai/legal-agreement/subscription-terms>
- Folge für Pagewise: Der Coding Plan wird **nur** über den Agent-CLI-Adapter genutzt (unveränderte `claude`-Binary mit `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`). Es gibt kein Chat-Provider-Preset dafür. Enthält eine frei eingetragene Basis-URL `/api/coding/`, zeigt die UI einen Warnhinweis.
- Laut Z.ai-Anleitung für Claude Code werden `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `API_TIMEOUT_MS` und das Modell-Mapping gesetzt (Haiku auf `glm-5.3-flash`, Sonnet und Opus auf `glm-5.3`). Pagewise nutzt als Standard `glm-5.3-flash` für alle drei Stufen, das Mapping bleibt änderbar. Quelle: <https://docs.z.ai/devpack/tool/claude>

**Offene Frage vor Phase 1e:** Ob eine App, die die unveränderte `claude`-Binary startet, für Z.ai als „unterstütztes Tool“ gilt, steht in den Bedingungen nicht eindeutig. Nach dem Grundsatz „bei Unklarheit stoppen und fragen“ wird das Profil erst nach Klärung (z. B. Anfrage beim Z.ai-Support) aktiviert und trägt bis dahin einen deutlichen Warnhinweis.

## D-012 Modelle und Preise, Stand 3. Oktober 2026

- `z-ai/glm-5.3-flash` ist auf OpenRouter gelistet: nativ multimodal (Text, Bild, Video rein, Text raus), 1.048.576 Token Kontext, Function Calling und strukturierte Ausgaben, veröffentlicht am 26. August 2026. Quelle: <https://openrouter.ai/z-ai/glm-5.3-flash>
- Der Free-Router hat den Slug `openrouter/free` und filtert nach Fähigkeiten der Anfrage (z. B. Bildverständnis). Quelle: <https://openrouter.ai/docs/cookbook/get-started/free-models-router-playground>
- **Preise werden nicht fest eingebaut.** Die OpenRouter-Seite zeigt für dasselbe Modell widersprüchliche Preise (je nach Anbieter und Bereich der Seite). Die App liest Preise bei Bedarf live von der Modell-Liste.
- Ob Bildanfragen beim Free-Router zuverlässig bei einem Vision-Modell landen, wird in Phase 1c praktisch getestet. Bis dahin gilt der Fallback auf `z-ai/glm-5.3-flash`.

## D-013 Tailscale Serve

Zugriff per `tailscale serve --bg <port>` (HTTPS im Tailnet, läuft nach Neustart weiter). Kein `tailscale funnel`. Laut Doku werden als Proxy-Ziel nur lokale HTTP-Dienste unterstützt. Quelle: <https://tailscale.com/docs/reference/tailscale-cli/serve>. HTTPS-Zertifikate und MagicDNS müssen im Tailnet aktiviert sein, das wird in Phase 1a praktisch geprüft.

## D-015 CI (GitHub Actions), Stand 3. Oktober 2026

Die Pipeline (`.github/workflows/ci.yml`) führt Lint, Typecheck, Tests, den Build der Oberfläche, den eigenen Secret-Scan, gitleaks über den Verlauf und `pnpm audit` aus. Dependabot aktualisiert npm-Pakete und die Actions wöchentlich.

Verwendete Actions und geprüfte Versionen: `actions/checkout` v7 (neueste v7.0.1, 20. Juli 2026), `actions/setup-node` v7 (v7.0.0, 14. Juli 2026), `pnpm/action-setup` v6 (v6.1.0, 5. September 2026), `gitleaks/gitleaks-action` v3 (siehe unten, ersetzt). Quellen: die jeweiligen Release-Seiten auf GitHub.

- **gitleaks (geändert am 3. Oktober 2026):** Der erste CI-Lauf scheiterte im Schritt mit der gitleaks-Action (`unknown revision`), weil die Action beim ersten Push den Bereich ab dem Vorgänger des ersten Commits bildet und der Root-Commit keinen hat. Statt der Action läuft jetzt gitleaks v8.30.1 als Programm (`gitleaks git`, gesamter Verlauf) mit festem SHA-256. Version und Hash stammen von der Release-Seite des Projekts (Stand 3. Oktober 2026); passt der Hash nicht, bricht der Schritt ab. Vorteil: Auch in Organisationen ist kein Lizenzschlüssel nötig. Updates der Version macht der Maintainer von Hand (Version und Hash zusammen ändern), Dependabot sieht das Programm nicht.
- **Offen:** Die Actions sind über Versions-Tags eingebunden, nicht über Commit-Hashes. Das Festnageln auf Hashes ist die stärkere Variante und steht aus, weil sich die Hashes hier nicht prüfen ließen. Dependabot hält die Tags aktuell.

## D-014 Versionen (Stand 3. Oktober 2026)

Beim Anlegen des Projekts aktuell laut npm: Hono 4.13, Vite 8.3, React 19.3, Tailwind 4.3, Vitest 5, Biome 2.5, TypeScript 7.0, Zod 4.6. Die genauen Versionen stehen im Lockfile.

## D-016 Projektname: Pagewise, Stand 3. Oktober 2026

Der Arbeitstitel war „Schulheft“. Der Maintainer wollte einen nicht deutschen Namen und hat „Pagewise“ gewählt. Der Name passt zum Kern (Seiten im Heft), ist kurz und klingt nach Notizen mit KI.

Geprüfte Kandidaten (Websuche, Stand 3. Oktober 2026, weder Marken noch Domains geprüft): Für „Pagewise“ gab es nur ein kleines GitHub-Repo mit gleichem Namen. Ausgeschieden sind „Kladde“ (selbst gehostete Notiz-PWA mit diesem Namen), „Scholia“, „Looseleaf“, „Jotter“, „Inkgrid“ und „Marginly“ wegen bestehender Projekte.

Folgen der Umbenennung: Paket-Scope `@pagewise/*`, Umgebungsvariablen `PAGEWISE_*`, Standard-Datenverzeichnis `Pagewise` (macOS) beziehungsweise `pagewise` (Linux). Es gab noch keine Installation, daher ist keine Migration nötig.

## D-017 Datenbank: SQLite mit better-sqlite3 und Drizzle, Stand 3. Oktober 2026

- Treiber `better-sqlite3` 13.0.3 (Node ab 22), ORM `drizzle-orm` 0.45.3, dazu `drizzle-kit` 0.31.11 als Entwicklungsabhängigkeit, nur zum Erzeugen der SQL-Dateien. Die Drizzle-Versionen 1.0 sind noch Beta und werden nicht genutzt. Quelle: npm-Registry (`pnpm view`, 3. Oktober 2026).
- Verworfen: das in Node eingebaute `node:sqlite`. Es gibt in Node 22.22.0 beim Laden noch eine Experimental-Warnung aus, und Drizzle 0.45.3 hat dafür keinen Treiber. Beides wurde beim Ausprobieren beobachtet.
- `better-sqlite3` bringt fertige Binärdateien für macOS (arm64, x64), Linux und Windows im Paket mit und lädt sie direkt. Der Build-Schritt von pnpm bleibt deshalb aus (`ignoredBuiltDependencies`), auf dem Mac werden keine Entwicklerwerkzeuge gebraucht. Geprüft mit einer frischen Installation ohne `build/`-Ordner.
- Einstellungen beim Öffnen: WAL, Fremdschlüssel an, `busy_timeout` 5 Sekunden, `synchronous = NORMAL`, `secure_delete = ON` (gelöschte Inhalte werden überschrieben, damit Löschen auch wirklich löscht). Datenbank- und WAL-Dateien haben Rechte 600.
- Schema der ersten Migration: `profile` (genau eine Zeile), `subjects`, `subject_groups`. Die Tabelle heißt nicht `groups`, weil das in SQL ein Schlüsselwort ist. Namen sind je Fach beziehungsweise je Untergruppe ohne Beachtung der Groß- und Kleinschreibung eindeutig (Index über `lower(name)`). Spalten heißen englisch (`federal_state`, `school_type`, `grade_level`), die Prompt-Variablen (`{{bundesland}}` usw.) werden erst in der Prompt-Schicht zugeordnet. Weitere Tabellen kommen mit den Inkrementen, die sie brauchen.

## D-018 Secrets als Datei mit Rechten 600, keine Keychain

- Secrets liegen in `<Datenverzeichnis>/secrets/secrets.json` (Rechte 600, atomares Schreiben, zu lockere Rechte werden beim Lesen korrigiert). Der Server hält keine Werte im Speicher, sondern liest bei Bedarf. Die Oberfläche bekommt nie einen Wert, nur den Namen und bei Werten ab 16 Zeichen die letzten vier Zeichen. Werte mit Zeilenumbruch oder Steuerzeichen werden abgelehnt (Schutz vor Header-Injection), umgebende Leerzeichen werden entfernt.
- Die macOS-Keychain wird vorerst nicht genutzt. Nach meinem Kenntnisstand nimmt das Werkzeug `security` das Passwort bei nicht interaktiven Aufrufen als Kommandozeilenargument (`-w`), das verbietet die Regel „Secrets nie als Kommandozeilenargument“. Das konnte ich hier nicht prüfen, die Sitzung läuft auf Linux. Vor einer späteren Keychain-Anbindung bitte mit `man security` auf dem Mac gegenprüfen.
- `SecretStore` ist asynchron, ein anderer Speicher lässt sich später einhängen. Die Datei ist nicht verschlüsselt, Schutz bieten die Rechte und die Festplattenverschlüsselung des Systems (siehe security.md).

## D-019 Migrationen und Sicherung vor Migrationen

- Die SQL-Migrationen liegen in `apps/server/drizzle/`. Erzeugt werden sie mit `pnpm --filter @pagewise/server db:generate`, danach von Hand gelesen und eingecheckt. Der Server wendet ausstehende Migrationen beim Start an. Die generierten Metadateien in `drizzle/meta` sind vom Biome-Lauf ausgenommen.
- Enthält die Datenbank schon Daten und steht eine Migration aus, entsteht vorher eine Kopie per `VACUUM INTO` in `<Datenverzeichnis>/backups/` (Rechte 600, die letzten fünf bleiben). Das schützt nur vor einer fehlgeschlagenen Migration und ist kein Backup-Konzept (Phase 2). Die Kopien sind unverschlüsselt, wie der Rest des Datenverzeichnisses.
- Eine Datenbank, die neuer ist als die App (unbekannte Migrationen), wird nicht angefasst. Der Start bricht mit einer Erklärung ab.
- Stolperfalle: `.gitignore` ignoriert `secrets*`, `backups/`, `workspaces/`, `uploads/`, `exports/`, `*.db` und `*.log`. Quelltext mit solchen Namen würde stillschweigend nicht eingecheckt. Deshalb heißt die Datei `secret-store.ts` und es gibt keine Quell-Ordner mit diesen Namen.

## D-020 Passcode-Hash: scrypt aus Node, Stand 3. Oktober 2026

- Der Passcode wird mit scrypt (`node:crypto`) gehasht: N = 2^17, r = 8, p = 1, 16 Byte Salz, 64 Byte Schlüssel. Das ist die Empfehlung von OWASP für scrypt, wenn Argon2id nicht verfügbar ist. Quelle: <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
- Argon2id wäre die erste Wahl. Node 22 hat es nicht eingebaut (`crypto.argon2` ist hier `undefined`), und eine native Zusatzabhängigkeit nur dafür lohnt sich für diese App nicht. Das Hash-Format ist versioniert (`scrypt$N$r$p$Salz$Hash`), ein späterer Wechsel auf Argon2id ist möglich, ohne dass bestehende Passcodes ungültig werden.
- Passcodes werden vor dem Hashen Unicode-normalisiert (NFKC), damit zusammengesetzte und getrennte Umlaute (iOS-Tastatur) denselben Hash ergeben. Regeln: mindestens 8 und höchstens 128 Zeichen, keine Zeichenarten-Vorgaben (lange Sätze sind besser als Sonderzeichen). Das ist eine Annahme, ändere sie bei Bedarf in `auth/passcode.ts`.
- Aus einem gespeicherten Hash gelesene Parameter werden begrenzt (N höchstens 2^20), damit eine manipulierte Zeile nichts aufbläht.

## D-021 Einrichtung, Sitzungen, CSRF und Rate-Limit

- **Einrichtungscode:** Solange noch kein Passcode gesetzt ist, erzeugt der Server beim Start einen Code (`XXXXX-XXXXX`) und zeigt ihn nur in der Konsole. Ohne ihn lässt sich der Passcode nicht setzen. So kann niemand im Tailnet eine frisch gestartete, noch leere Instanz übernehmen. Das ist bewusst eine Ausnahme von „nichts Geheimes in Logs“: Der Code gilt nur bis zur Einrichtung, ist kein Schlüssel zu Daten und steht in keiner Datei. Läuft die Konsolenausgabe in eine Logdatei, ist der Code nach der Einrichtung wertlos.
- **Passcode vergessen:** `pnpm --filter @pagewise/server reset-passcode` (Server vorher beenden) entfernt Passcode und Sitzungen, Fächer und Daten bleiben. Beim nächsten Start gibt es wieder einen Einrichtungscode.
- **Sitzungen:** Zufälliges 256-Bit-Token im Cookie `pagewise_session` (`HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` bei HTTPS). In der Datenbank steht nur der SHA-256-Hash. Laufzeit 30 Tage nach der letzten Nutzung, spätestens 90 Tage nach der Anmeldung. Ein Passcode-Wechsel beendet alle anderen Sitzungen.
- **`Secure`-Flag:** Gesetzt wird es, wenn die Anfrage per HTTPS ankam (`X-Forwarded-Proto: https`, hinter Tailscale Serve). Beim direkten Zugriff über `http://localhost` bleibt es aus, weil Browser solche Cookies dort teils nicht annehmen. **Ungetestet:** Ob Tailscale Serve `X-Forwarded-Proto` setzt, habe ich nicht geprüft. Fehlt es, fehlt nur das `Secure`-Flag, der Rest des Schutzes bleibt.
- **CSRF:** Bei ändernden Methoden wird `Sec-Fetch-Site` geprüft (alles außer `same-origin` und `none` wird abgelehnt), und mit Sitzung muss der Header `X-CSRF-Token` mit dem Token der Sitzung übereinstimmen. Einen Vergleich von `Origin` und `Host` gibt es bewusst nicht, weil unklar ist, wie ein Proxy den `Host` verändert, und ein falscher Alarm die ganze App unbenutzbar machen würde.
- **Rate-Limit:** Hinter Tailscale Serve kommen alle Anfragen von 127.0.0.1, eine Begrenzung je Adresse hätte keinen Sinn. Gezählt wird deshalb für die Instanz: fünf Fehlversuche (Anmeldung, Einrichtungscode, aktueller Passcode beim Wechsel) in 15 Minuten, danach 429 mit `Retry-After`. Jeder Versuch zählt im Voraus und wird bei Erfolg gutgeschrieben, damit gleichzeitige Anfragen die Grenze nicht umgehen. Ein Angreifer im Tailnet kann so die Anmeldung zeitweise sperren. Das ist die gewählte Abwägung gegenüber dem Erraten des Passcodes. Der Zustand liegt nur im Speicher.
- **API-Fehler:** Antworten enthalten nur Codes (`unauthorized`, `csrf`, `invalid_passcode`, `rate_limited` usw.), nie Eingaben, Pfade oder Hashes. Ein falscher aktueller Passcode beim Wechsel liefert 403 statt 401, damit die Oberfläche nicht zur Anmeldung zurückspringt.
