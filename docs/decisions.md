# Entscheidungen

Stand: 4. Oktober 2026, verdichtet am 8. Oktober 2026. Regeln, Grenzen, Quellen und offene Punkte bleiben; Messprotokolle, Testlisten und Verlaufsberichte sind gekürzt. Der vollständige Text steht im Git-Verlauf (`9e40fb9:docs/decisions.md`). Jede Entscheidung nennt Begründung und, wo sie von Quellen abhängt, die Quelle. Quellen können sich ändern, vor dem Einbauen erneut prüfen. Die Überschriften sind das Inhaltsverzeichnis.

## D-001 Stack

TypeScript im pnpm-Monorepo: `apps/server` (Hono), `apps/web` (Vite, React, Tailwind v4), Tests mit Vitest, Lint und Format mit Biome. Eine Sprache für Server und Oberfläche hält das Selbst-Hosting einfach. Pakete entstehen erst, wenn sie gebraucht werden.

## D-002 Server ohne eigenen Build-Schritt

`tsx` startet den Quelltext direkt, die Oberfläche baut Vite und der Server liefert sie aus. Die Node-eigene Typ-Entfernung wurde verworfen, weil sie Pfad-Aliase und Pakete unter `node_modules` nicht zuverlässig unterstützt.

## D-003 Secret-Scan

`scripts/secret-scan.mjs` läuft lokal im Pre-Commit-Hook, ohne Installation. Die CI ergänzt gitleaks. Das Skript deckt die gängigen Muster ab (private Schlüssel, GitHub, OpenRouter, OpenAI, Anthropic, Google, Slack, AWS, Z.ai, `key = wert`) und gibt gefundene Werte nie aus, nur Datei, Zeile und Regel.

## D-004 Privacy-Check

`scripts/check-privacy.mjs` sucht in gestagten bzw. getrackten Dateien nach Begriffen aus `config/privacy-blacklist.local.txt`. Die Datei ist gitignored und liegt nur lokal. Fehlt sie, gibt der Check einen Hinweis und besteht. In der CI gibt es sie nicht, weil echte Namen nicht ins Repo gehören.

## D-005 Start-Check für das Datenverzeichnis

Der Start bricht ab, wenn das aufgelöste Datenverzeichnis (`realpath`, auch für noch nicht vorhandene Pfade über den nächsten vorhandenen Elternordner) in einem Git-Arbeitsverzeichnis liegt (`.git` in einem Elternordner) oder im Ordner der Anwendung. Grenzfall: Ist der Home-Ordner selbst ein Repo (Dotfiles), `PAGEWISE_DATA_DIR` auf einen Ort außerhalb setzen. Das Datenverzeichnis wird mit Rechten `700` angelegt.

## D-006 Server bindet nur an Loopback

`PAGEWISE_HOST` akzeptiert nur `127.0.0.1`, `::1` und `localhost`. Für Docker gibt es die Ausnahme `PAGEWISE_ALLOW_NON_LOOPBACK=1`; dann darf der Port nur an `127.0.0.1` des Hosts veröffentlicht werden. Erreichbarkeit entsteht nur über Tailscale Serve (D-013), nie über einen offenen Port.

## D-007 Lizenz: MIT

Kurz, bekannt, erlaubt Selbst-Hosting, Anpassung und Weitergabe. Es gibt keine Patentklausel wie bei Apache-2.0; für ein kleines Schulprojekt vertretbar. Vom Maintainer am 3. Oktober 2026 bestätigt.

## D-008 Kontrast bei Links und Hilfstexten

Research Blue `#207dff` bleibt für Links und kleine aktive Akzente, als Text-Link reicht es nicht: gemessen 3,30 bis 3,77 : 1 auf den hellen Flächen, WCAG AA verlangt 4,5 : 1. Text-Links nutzen deshalb `--color-link-text` (`#1560cc`, mindestens 5,02 : 1). `#207dff` bleibt als `--accent` für Fokusringe und kleine aktive Elemente (3 : 1). Quiet Gray erreicht AA. Disabled Ash (2,0 bis 2,3 : 1) gilt nur für deaktivierte Elemente, nie für Lesetext. Der Dark Mode ist abgeleitet, alle Kombinationen liegen über 5,3 : 1. Tests: `apps/web/src/styles/tokens.test.ts`.

## D-009 Fonts selbst gehostet

Inter und Instrument Sans kommen über `@fontsource` ins Bundle. Es gibt keine Aufrufe an Font-CDNs zur Laufzeit.

## D-010 Erkenntnisse für Phase 1e (Agent-CLI), Stand 3. Oktober 2026

- **Nicht-interaktiver Modus:** `claude -p` mit `--output-format stream-json --verbose --include-partial-messages`. Rechte über `--allowedTools` und `--permission-mode dontAsk` bzw. `--permission-prompts none`, damit nichts auf eine Antwort wartet. Quelle: <https://code.claude.com/docs/en/headless>
- **`--bare` passt nicht zum Claude-Abo.** Im Bare-Modus liest Claude Code weder OAuth-Zugangsdaten noch den Schlüsselbund. Das Abo-Profil läuft ohne `--bare`. Dann muss sichergestellt sein, dass nur der App-eigene Workspace-Ordner als Arbeitsverzeichnis dient, denn Projekt-Hooks und `.mcp.json` werden im `-p`-Modus ohne Rückfrage geladen.
- **Die Sandbox betrifft nur Shell-Befehle.** Read, Edit, Write, MCP-Server und Hooks laufen außerhalb und folgen den Berechtigungsregeln. Isolation braucht deshalb beides: Sandbox-Einstellungen (`sandbox.enabled`, `failIfUnavailable: true`, `allowUnsandboxedCommands: false`, `filesystem.denyRead` mit `allowRead` für den Workspace) und Berechtigungsregeln für die Datei-Tools. Der Test „Zugriff außerhalb des Workspace scheitert“ muss beide Wege abdecken. Quelle: <https://code.claude.com/docs/en/sandboxing>
- **Regeln zur Nutzung:** unveränderte Binary, keine umgangenen Anmeldewege, keine Claude.ai-Anmeldung in eigenen Anwendungen, keine Weitergabe von Abo-Zugängen. Ein Endnutzer darf sich in der unveränderten Binary mit dem eigenen Abo anmelden. „Claude Code“ und „Anthropic“ sind nicht Teil des Produktnamens oder Logos, im Fließtext erlaubt. Quelle: <https://code.claude.com/docs/en/legal-and-compliance>

## D-011 Z.ai Coding Plan

- Das Kontingent gilt nur in offiziell unterstützten Tools; das Abo gehört allein dem Kontoinhaber. Direkt aufgerufene Modell-APIs aus eigenen Anwendungen, Bots oder Websites sind ausgeschlossen, außer es gibt eine schriftliche Vereinbarung. Folgen reichen bis zur Sperre ohne Rückerstattung. Quellen: <https://docs.z.ai/devpack/usage-policy>, <https://docs.z.ai/legal-agreement/subscription-terms>
- Folge für Pagewise: Der Plan wird **nur** über den Agent-CLI-Adapter genutzt (unveränderte `claude`-Binary mit `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`). Es gibt kein Chat-Provider-Preset. Eine frei eingetragene Basis-URL mit `/api/coding/` zeigt einen Warnhinweis.
- Modell-Mapping laut Z.ai-Anleitung (<https://docs.z.ai/devpack/tool/claude>): Haiku `glm-5.3-flash`, Sonnet und Opus `glm-5.3`. Pagewise nutzt `glm-5.3-flash` für alle drei Stufen, änderbar.
- **Entscheidung des Kontoinhabers (3. Oktober 2026):** Nutzung auf diesem Weg. Claude Code steht auf der Liste unterstützter Tools (<https://docs.z.ai/devpack/tool/others>), und Pagewise ruft die Z.ai-Schnittstelle nie selbst auf. **Offen:** Ob ein von einem anderen Programm gestartetes Tool als „unterstützt“ gilt, hat Z.ai nicht schriftlich bestätigt. Das Restrisiko trägt der Kontoinhaber. Eine schriftliche Bestätigung des Z.ai-Supports bleibt empfohlen.
- Auflagen: nur Konto und Token der Person, der die Instanz gehört, nie weitergeben (Z.ai verbietet das Teilen des Kontingents). Nur die unveränderte `claude`-Binary. Der Warnhinweis in der Oberfläche bleibt. Die Liste der Tools und die Bedingungen wurden vor dem Bau von 1e erneut geprüft (D-036).

## D-012 Modelle und Preise, Stand 3. Oktober 2026

- `z-ai/glm-5.3-flash` ist auf OpenRouter gelistet: multimodal (Text, Bild, Video rein, Text raus), 1.048.576 Token Kontext, Function Calling, strukturierte Ausgaben, veröffentlicht am 26. August 2026. Quelle: <https://openrouter.ai/z-ai/glm-5.3-flash>
- Der Free-Router hat den Slug `openrouter/free` und filtert nach Fähigkeiten der Anfrage. Quelle: <https://openrouter.ai/docs/cookbook/get-started/free-models-router-playground>
- **Preise werden nicht fest eingebaut.** Die Modellseite und die API nennen für dasselbe Modell unterschiedliche Preise. Die App liest Preise live von der Modell-Liste.
- Ob Bildanfragen beim Free-Router zuverlässig bei einem Vision-Modell landen, war als Praxistest für Phase 1c vorgesehen. Das Ergebnis ist hier nicht festgehalten; bis dahin gilt der Fallback auf `z-ai/glm-5.3-flash`.

## D-013 Tailscale Serve

Zugriff per `tailscale serve --bg <port>` (HTTPS im Tailnet). Kein `tailscale funnel`. Laut Doku werden als Proxy-Ziel nur lokale HTTP-Dienste unterstützt. HTTPS-Zertifikate und MagicDNS müssen im Tailnet aktiv sein. Ob die Freigabe einen Neustart übersteht, ist ungeprüft (die frühere Aussage dazu ist gestrichen, siehe D-030). Quelle: <https://tailscale.com/docs/reference/tailscale-cli/serve>

## D-014 Versionen (Stand 3. Oktober 2026)

Beim Anlegen des Projekts laut npm: Hono 4.13, Vite 8.3, React 19.3, Tailwind 4.3, Vitest 5, Biome 2.5, TypeScript 7.0, Zod 4.6. Die genauen Versionen stehen im Lockfile.

## D-015 CI (GitHub Actions), Stand 3. Oktober 2026

Die Pipeline (`.github/workflows/ci.yml`) führt Lint, Typecheck, Tests, den Build der Oberfläche, den eigenen Secret-Scan, gitleaks über den Verlauf und `pnpm audit` aus. Dependabot aktualisiert npm-Pakete und Actions wöchentlich. Geprüfte Versionen (Release-Seiten auf GitHub): `actions/checkout` v7 (v7.0.1, 20. Juli 2026), `actions/setup-node` v7 (v7.0.0, 14. Juli 2026), `pnpm/action-setup` v6 (v6.1.0, 5. September 2026).

- **gitleaks (geändert am 3. Oktober 2026):** Die gitleaks-Action scheiterte am Root-Commit des ersten Pushes (`unknown revision`). Jetzt läuft gitleaks v8.30.1 als Programm (`gitleaks git`, gesamter Verlauf) mit festem SHA-256. Passt der Hash nicht, bricht der Schritt ab. Kein Lizenzschlüssel nötig. Updates macht der Maintainer von Hand (Version und Hash zusammen), Dependabot sieht das Programm nicht.
- **Offen:** Die Actions sind über Versions-Tags eingebunden, nicht über Commit-Hashes. Das Festnageln auf Hashes ist die stärkere Variante und steht aus, weil die Hashes hier nicht prüfbar waren. Dependabot hält die Tags aktuell.

## D-016 Projektname: Pagewise, Stand 3. Oktober 2026

Der Arbeitstitel war „Schulheft“. Der Maintainer wollte einen nicht deutschen Namen. „Pagewise“ passt zum Kern (Seiten im Heft). Geprüft per Websuche, weder Marken noch Domains: ausgeschieden sind „Kladde“ (selbst gehostete Notiz-PWA mit diesem Namen), „Scholia“, „Looseleaf“, „Jotter“, „Inkgrid“ und „Marginly“ (bestehende Projekte). „Pagewise“ hat nur ein kleines GitHub-Repo mit gleichem Namen.

Folgen: Paket-Scope `@pagewise/*`, Variablen `PAGEWISE_*`, Standard-Datenverzeichnis `Pagewise` (macOS) bzw. `pagewise` (Linux). Es gab noch keine Installation, daher keine Migration.

## D-017 Datenbank: SQLite mit better-sqlite3 und Drizzle, Stand 3. Oktober 2026

- Treiber `better-sqlite3` 13.0.3 (Node ab 22), ORM `drizzle-orm` 0.45.3, `drizzle-kit` 0.31.11 nur als Entwicklungsabhängigkeit. Drizzle 1.0 ist Beta und nicht genutzt. Quelle: npm-Registry.
- Verworfen: das eingebaute `node:sqlite` (Experimental-Warnung in Node 22.22.0, kein Drizzle-Treiber für 0.45.3).
- `better-sqlite3` bringt Binärdateien für macOS (arm64, x64), Linux und Windows mit; der Build-Schritt bleibt aus (`ignoredBuiltDependencies`), geprüft mit frischer Installation.
- Beim Öffnen: WAL, Fremdschlüssel an, `busy_timeout` 5 s, `synchronous = NORMAL`, `secure_delete = ON`. Datei- und WAL-Rechte 600.
- Migration 1: `profile` (eine Zeile), `subjects`, `subject_groups` (nicht `groups`, das ist ein SQL-Schlüsselwort). Namen sind je Fach bzw. Untergruppe ohne Groß-/Kleinschreibung eindeutig (Index über `lower(name)`). Spalten sind englisch; die Prompt-Variablen (`{{bundesland}}` usw.) werden erst in der Prompt-Schicht zugeordnet.

## D-018 Secrets als Datei mit Rechten 600, keine Keychain

- Secrets liegen in `<Datenverzeichnis>/secrets/secrets.json` (Rechte 600, atomares Schreiben, zu lockere Rechte werden beim Lesen korrigiert). Der Server hält keine Werte im Speicher. Die Oberfläche bekommt nur den Namen und bei Werten ab 16 Zeichen die letzten vier Zeichen. Zeilenumbrüche und Steuerzeichen werden abgelehnt.
- **Keine Keychain vorerst:** Nach Kenntnisstand übergibt `security` das Passwort bei nicht interaktiven Aufrufen als Argument (`-w`), das verbietet die Regel. Auf Linux nicht prüfbar. **Offen:** vor einer Keychain-Anbindung auf dem Mac mit `man security` gegenprüfen.
- `SecretStore` ist asynchron; ein anderer Speicher lässt sich einhängen. Die Datei ist nicht verschlüsselt; Schutz bieten Rechte und Festplattenverschlüsselung (docs/security.md).

## D-019 Migrationen und Sicherung vor Migrationen

- SQL-Migrationen liegen in `apps/server/drizzle/`, erzeugt mit `pnpm --filter @pagewise/server db:generate`, danach von Hand gelesen und eingecheckt. Der Server wendet sie beim Start an.
- Hat die Datenbank Daten und steht eine Migration aus, entsteht vorher eine Kopie per `VACUUM INTO` in `<Datenverzeichnis>/backups/` (Rechte 600, die letzten fünf). Das schützt nur vor einer fehlgeschlagenen Migration und ist kein Backup-Konzept (Phase 2).
- Eine Datenbank, die neuer ist als die App, wird nicht angefasst; der Start bricht mit Erklärung ab.
- **Stolperfalle:** `.gitignore` ignoriert `secrets*`, `backups/`, `workspaces/`, `uploads/`, `exports/`, `*.db` und `*.log`. Quelltext mit solchen Namen wird still nicht eingecheckt. Deshalb heißt die Datei `secret-store.ts`.

## D-020 Passcode-Hash: scrypt aus Node, Stand 3. Oktober 2026

- scrypt (`node:crypto`), N = 2^17, r = 8, p = 1, 16 Byte Salz, 64 Byte Schlüssel. OWASP-Empfehlung für scrypt, wenn Argon2id nicht verfügbar ist. Quelle: <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
- Argon2id wäre die erste Wahl, ist in Node 22 aber nicht eingebaut (`crypto.argon2` ist `undefined`); eine native Abhängigkeit lohnt dafür nicht. Das Format ist versioniert (`scrypt$N$r$p$Salz$Hash`); ein späterer Wechsel ist möglich.
- Vor dem Hashen NFKC-Normalisierung (zusammengesetzte und getrennte Umlaute der iOS-Tastatur ergeben denselben Hash). Regeln: 8 bis 128 Zeichen, keine Zeichenarten-Vorgaben (Annahme; änderbar in `auth/passcode.ts`). Aus einem gespeicherten Hash gelesene Parameter sind begrenzt (N höchstens 2^20).

## D-021 Einrichtung, Sitzungen, CSRF und Rate-Limit

- **Einrichtungscode:** Solange kein Passcode gesetzt ist, zeigt der Server beim Start einen Code (`XXXXX-XXXXX`) nur in der Konsole. So kann im Tailnet niemand eine frische, leere Instanz übernehmen. Bewusste Ausnahme von „nichts Geheimes in Logs“: Der Code gilt nur bis zur Einrichtung, ist kein Schlüssel zu Daten und steht in keiner Datei. Läuft die Konsole in eine Logdatei, ist er nach der Einrichtung wertlos.
- **Passcode vergessen:** `pnpm --filter @pagewise/server reset-passcode` (Server vorher beenden). Entfernt Passcode und Sitzungen; Daten bleiben.
- **Sitzungen:** 256-Bit-Token im Cookie `pagewise_session` (`HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` bei HTTPS). Die Datenbank speichert nur den SHA-256-Hash. Laufzeit 30 Tage nach der letzten Nutzung, höchstens 90 Tage nach Anmeldung. Ein Passcode-Wechsel beendet alle anderen Sitzungen.
- **`Secure`:** gesetzt, wenn `X-Forwarded-Proto: https` ankommt (hinter Tailscale Serve); bei `http://localhost` aus. Ob Serve den Header setzt, siehe D-030.
- **CSRF:** Bei ändernden Methoden wird `Sec-Fetch-Site` geprüft (außer `same-origin` und `none` wird abgelehnt); mit Sitzung muss `X-CSRF-Token` zum Token passen. Ein Vergleich von `Origin` und `Host` fehlt bewusst, weil unklar ist, wie ein Proxy den `Host` verändert, und ein Fehlalarm die App unbenutzbar machen würde.
- **Rate-Limit:** Hinter Serve kommen alle Anfragen von 127.0.0.1, deshalb zählt die Instanz: fünf Fehlversuche (Anmeldung, Einrichtungscode, aktueller Passcode beim Wechsel) in 15 Minuten, danach 429 mit `Retry-After`. Jeder Versuch zählt im Voraus und wird bei Erfolg gutgeschrieben, damit parallele Anfragen die Grenze nicht umgehen. Abwägung: Ein Angreifer im Tailnet kann die Anmeldung zeitweise sperren. Der Zustand liegt nur im Speicher.
- **API-Fehler** enthalten nur Codes (`unauthorized`, `csrf`, `invalid_passcode`, `rate_limited` …), nie Eingaben, Pfade oder Hashes. Ein falscher aktueller Passcode beim Wechsel liefert 403 statt 401, damit die Oberfläche nicht zur Anmeldung zurückspringt.

## D-022 Ergänzungen zum Designsystem

Das Designsystem (Heptabase via Refero, Mega-Prompt Abschnitt 10) kennt weder eine Fehlerfarbe noch einen ausreichenden Feldrand. Beides ist in `apps/web/src/styles/tokens.css` benannt und in `tokens.test.ts` gegen WCAG AA geprüft.

- **Fehlerfarbe** `--danger`: hell `#b42318`, dunkel `#ff9d92`. Fehler zeigen zusätzlich Symbol und Text, nie nur Farbe.
- **Feldrand** `--control-edge`: hell `#858490`, dunkel `#85827c`. Linen Border (`#e4ded3`) erreicht als Rand eines Bedienelements keine 3 : 1 (WCAG 1.4.11) und bleibt für Trennlinien.
- Research Blue bleibt auf Links und kleine Akzente (D-008); aktive Sidebar-Zeilen nutzen Paper Beige und Gewicht 500.
- Icons: `lucide-react` (ISC), nur die genutzten im Bundle, Strichstärke 1,6, einfarbig. Der Server speichert nur eine Kennung; unbekannte Kennungen zeigen das Standard-Icon.
- **Fallstrick:** Ein Token in `@theme inline` darf nicht denselben Namen tragen wie ein Palettenwert in `@theme`. Das ergibt einen Zirkelbezug, und der Wert fällt still weg. Der Test prüft das.

## D-023 Technik der Oberfläche

- **Kein Router-Paket:** `router.ts` liest `location.pathname` und nutzt die History-API. Der Server liefert für Pfade außerhalb von `/api` die `index.html`.
- **Strenge CSP** (`style-src 'self'`): Die Oberfläche setzt nie ein `style`-Attribut (React `style={…}`, `setAttribute('style')`), nur Klassen. Werte stellen Skripte über das CSSOM ein (`element.style.overflow`); das erlaubt die CSP.
- **CSRF-Token nur im Speicher**, nicht in `localStorage`; nach dem Neuladen holt `GET /api/session` ihn. Im Browser gespeichert wird nur `pagewise.theme`.
- **Fehler nach Code, nicht nach Status:** `unauthorized` und `csrf` führen zur Anmeldung, `invalid_passcode` nie.
- **Dialoge und Schublade** sperren den Hintergrund mit `inert`, schließen mit Escape und geben den Fokus zurück. Bedienelemente sind mindestens 44 px hoch.
- **Tests:** `jsdom` (`@vitest-environment jsdom`) gegen `test/fake-server.ts`. jsdom ist auf 29 festgelegt, weil Version 30 Node ab 22.22.2 verlangt, die Vorgabe aber `>=22.18` ist.

## D-024 Live-Prüfung der Anbieter, Stand 3. Oktober 2026

Geprüft gegen die Dokumentation, bevor Adressen, Modelle und Syntax in `apps/server/src/providers/presets.ts` kamen.

- **OpenRouter, Modelle** (<https://openrouter.ai/api/v1/models>, 466 Einträge): `z-ai/glm-5.3-flash` nimmt Text, Bild und Video, gibt Text aus, hat 1.048.576 Token Kontext und unterstützt `tools`, `tool_choice`, `reasoning`, `structured_outputs`. Listenpreis laut API: 0,15 US-Dollar je Million Eingabe-Token, 0,50 Ausgabe, Cache-Lesen 0,03. Die Modellseite nennt für Eingabe 0,035 US-Dollar; das ist ungeklärt. Maßgeblich ist die API (D-012). `openrouter/free`: Text und Bild, 200.000 Token, kostenlos, `tools` und `reasoning`. Voreinstellung: Bilder, Werkzeuge und Denken an, änderbar.
- **OpenRouter, Schnittstelle:** `Authorization: Bearer <Schlüssel>`. `GET /api/v1/key` (Limit, Verbrauch, Zähler) eignet sich zum Prüfen des Schlüssels; die Modellliste ohne Schlüssel nicht. Quellen: <https://openrouter.ai/docs/api-reference/overview>, <https://openrouter.ai/docs/api-reference/limits>, <https://openrouter.ai/docs/api-reference/list-available-models>
- **OpenRouter, Fehler:** 402 `insufficient_credits`, 429 `rate_limited`. Für `:free`-Modelle gelten 20 Anfragen je Minute und 50 je Tag, ab 10 US-Dollar gekauftem Guthaben 1000 je Tag. Nicht eingebaut; die Oberfläche zeigt nur den Hinweis.
- **OpenRouter, Protokollierung:** Jeder Anbieter hinter OpenRouter hat eigene Regeln; Trainingsausschluss in den Kontoeinstellungen. Die Doku sagt nicht ausdrücklich, dass kostenlose Modelle protokollieren; der Hinweis „können … protokollieren oder auswerten“ ist deshalb bewusst vorsichtig. Quelle: <https://openrouter.ai/docs/guides/privacy/logging>
- **Z.ai, allgemeine API:** `https://api.z.ai/api/paas/v4`, Bearer-Schlüssel. Der Coding Plan hat einen eigenen Endpunkt und ist kein Preset (D-011). Modellkennungen der Z.ai-API nicht geprüft, daher keine Vorschläge. Quelle: <https://docs.z.ai/api-reference/introduction>
- **Ollama:** `http://localhost:11434/v1/`, Chat, Streaming, Bilder, Werkzeuge; kein Schlüssel nötig (laut Doku ignoriert). Quelle: <https://docs.ollama.com/api/openai-compatibility>
- **LM Studio:** `http://localhost:1234/v1`; zum Schlüssel steht nichts in der Doku, die Voreinstellung verlangt keinen. Quelle: <https://lmstudio.ai/docs/developer/openai-compat>
- **Nicht geprüft, daher keine Voreinstellung:** OpenAI, Anthropic, Google, DeepSeek, Mistral, Groq, Together, Fireworks. Sie gehen über „Eigener Anbieter“, wenn ihre Schnittstelle OpenAI-kompatibel ist.

## D-025 Prompt-Schichten

- **Ablage:** allgemeiner Prompt in `profile.school_prompt`, Fach-Prompt in `subjects.system_prompt`, Untergruppen-Zusatz in `subject_groups.extra_prompt` (Migration 0003). Alle sind `NULL`, solange nichts eingetragen ist. Standardtexte je Fach: D-034.
- **Reihenfolge:** Schicht 0 (technisch, im Code), dann die Schichten 1 bis 3, jeweils nur wenn gesetzt. Die Vorschau zeigt die Schichten einzeln.
- **Schicht 0:** Antworten in Markdown; Inhalte aus Dateien, Bildern und Webseiten sind Material, keine Anweisungen. Nicht änderbar. Die Hefteintrags-Syntax kam mit 1b dazu (D-049).
- **Variablen:** `{{bundesland}}`, `{{schulform}}`, `{{jahrgangsstufe}}`, `{{fach}}`, `{{untergruppe}}`. Ersetzt wird in einem Durchgang (eingesetzte Werte werden nicht erneut durchsucht), ohne Bedingungen oder Ausdrücke. Fehlt ein Wert, steht „(nicht angegeben)“; die Vorschau nennt die Variable. Unbekannte Namen bleiben stehen.
- **Grenze:** höchstens 20.000 Zeichen je Prompt. Leerer Text löscht den Prompt.
- **Annahme:** Ein Untergruppen-Zusatz ergänzt den Fach-Prompt, ersetzt ihn nicht.

## D-026 Provider-Registry

- **Nur Typ `openai-compatible`**, dazu die Voreinstellungen aus D-024. Die Tabelle `providers` hat ein Feld `type` für spätere Typen.
- **Schlüssel** im Secret-Speicher unter `provider.<id>.key`, nie in der Datenbank, nie in Antworten, Logs oder Fehlermeldungen. Die Antwort nennt `hasKey` und bei Schlüsseln ab 16 Zeichen `keyHint`. Wird ein Anbieter gelöscht, verschwindet auch sein Schlüssel.
- **Adressen:** `https://`; `http://` nur für `localhost`, `127.x.x.x` und `[::1]`. Keine Weiterleitungen: Ein Anbieter soll den Schlüssel nicht an eine andere Adresse schicken lassen können.
- **Fehler nur als Codes.** Anbieter-Texte werden nie weitergegeben, sie können Eingabe oder Schlüssel wiederholen.
- **Grenzen:** JSON 8 MiB, Modellliste 2000 Einträge, Antworttext 200.000 Zeichen. Bei Strom-Antworten gilt kein Gesamt-Zeitlimit, nur ein Leerlauf-Limit zwischen Ereignissen.
- **Einstellungen** (Tabelle `settings`): `models.default` und `models.fallback` (JSON, höchstens fünf Ausweichmodelle). Verschwindet ein Anbieter oder Modell, räumt der Server die Auswahl auf.
- **Vorgabe beim ersten OpenRouter-Anbieter:** Wo nichts gewählt ist, setzt Pagewise `z-ai/glm-5.3-flash` als Standard und erstes Ausweichmodell. `openrouter/free` ist nie Standard oder Ausweichmodell, weil kostenlose Modelle Eingaben protokollieren können.
- **Verbindungstest:** OpenRouter über `GET /key`, sonst `GET /models`; nur bei 404, 405 oder 501 eine Anfrage mit Token. Das Ergebnis ist eine Auskunft und blockiert nichts.
- **Oberfläche:** Anbieter, Modelle und allgemeiner Prompt in den Einstellungen; Prompts für Fach und Untergruppe auf deren Seite. Der Anbieter ist im Onboarding überspringbar. Ohne Anbieter funktioniert alles außer dem Chat.

## D-027 Chats: Antworten laufen unabhängig von der Verbindung

- **Warum:** Der iPad-Bildschirm geht aus, das Netz wechselt, ein Tab wird im Hintergrund beendet. Jede Antwort läuft deshalb im Server als eigener Vorgang (`Generation`), unabhängig von der HTTP-Verbindung, und wird am Ende immer gespeichert.
- **Server-Sent Events:** `POST /api/chats/:id/messages` und `/retry` antworten als Strom; `GET /api/chats/:id/generation` hängt sich an eine laufende Antwort (204, wenn keine läuft). Ereignisse: `start`, `snapshot`, `model`, `thinking`, `delta`, `ping` (alle 15 s), zum Schluss genau eines von `done`, `stopped`, `failed`. Der `snapshot` ersetzt den Browsertext durch den des Servers.
- **Wiederanhängen:** Reißt der Strom ab, versucht die Oberfläche es viermal nach 0,4, 1,5, 3 und 6 Sekunden, dann „Erneut verbinden“. Kommt die Seite aus dem Hintergrund zurück (`visibilitychange`), hängt sie sich sofort neu an. Ein abgerissenes Senden wird nie blind wiederholt, weil der Server es schon angenommen haben kann: Dann lädt die Oberfläche den Chat neu und zeigt den Fehler.
- **Zwischenstände:** alle 2 Sekunden in die Datenbank. Beim Start werden Antworten im Status `streaming` als `interrupted` markiert. Eine unterbrochene, fehlerhafte oder gestoppte Antwort behält ihren Teiltext und lässt sich mit „Erneut versuchen“ ersetzen.
- **Ausweichmodelle** (D-026) greifen nur, solange noch kein Text da ist. Wer Text sieht, bekommt keinen Wechsel mitten im Satz, sondern einen Fehler mit Teiltext.
- **Grenzen:** eine Antwort je Chat (sonst 409 `busy`), höchstens vier gleichzeitig (sonst 429 `too_busy`). Eine Nachricht hat höchstens 50.000 Zeichen.
- **Verlauf für das Modell:** höchstens 150.000 Zeichen (grobe Schätzung). Ältere Nachrichten fallen heraus, bleiben im Chat sichtbar. Leere Antworten fallen weg, gleiche Rollen werden verbunden, der Verlauf beginnt mit dem Nutzer; die letzte Nachricht bleibt immer.
- **Titel:** erste nicht leere Zeile, höchstens 60 Zeichen; umbenennbar.
- **Modellwahl:** Chat, sonst Fach, sonst Standardmodell. Ein Chat ohne eigene Wahl folgt dem Fach, auch nach einer Änderung dort.
- **Untergruppen:** Wird eine Untergruppe gelöscht, bleibt ihr Chat im Fach unter „Chats“. Wird das Fach gelöscht, verschwinden seine Chats.

## D-028 Chat-Oberfläche

- **Markdown sicher:** `react-markdown` mit `remark-gfm`; rohes HTML wird als Text gezeigt (kein `rehype-raw`). Links nur für `http`, `https`, `mailto`, mit `rel="noopener noreferrer nofollow"` in neuem Tab. **Bilder in Antworten werden nie geladen** („Bild ausgelassen: …“); zusätzlich sperrt `img-src 'self' data: blob:`. Test: kein `script`, `img`, `onerror`, `javascript:`.
- **Formeln:** seit D-048 gezeichnet.
- **Nachladen:** Die Chatansicht ist ein eigenes Paket (rund 175 kB), geladen erst beim Öffnen eines Chats. Das Hauptpaket bleibt unter 340 kB (Grenze, siehe D-048).
- **Mitlesen:** Die Ansicht folgt dem Text, solange man nahe am Ende ist (160 px). Screenreader hören nur Anfang und Ende einer Antwort.
- **Eingabe:** Mit Maus oder Trackpad sendet Enter, Umschalt + Enter macht eine neue Zeile. Auf Touch-Geräten macht Enter eine neue Zeile, gesendet wird mit dem Knopf. Cmd oder Strg + Enter sendet immer. Das Feld wächst bis 12 rem (CSSOM). Der Entwurf bleibt beim Chatwechsel erhalten, nur im Speicher der Seite (nie `localStorage`); schlägt das Senden fehl, bleibt er stehen.
- **Neuer Chat:** höchstens ein leerer Chat je Ansicht. Leere Chats werden nicht automatisch gelöscht.
- **Adresse:** `/subjects/<Fach>/chats/<Chat>`. Gehört der Chat nicht zu diesem Fach, zeigt die Oberfläche „Diese Seite gibt es nicht“.
- **Offen bis zum Test auf dem iPad:** ob die Eingabezeile mit Tastatur sichtbar bleibt (`position: sticky` im Dokumentfluss, kein `fixed`) und ob die Antwort nach dem Aufwecken weiterläuft.

## D-029 PWA: installierbar, Oberfläche offline, Daten nie

- **Installierbar:** `manifest.webmanifest` (Name „Pagewise“, `display: standalone`, Start und Geltungsbereich `/`, Icons 192, 512, maskierbar 512 und SVG); iOS-Angaben in `index.html` (`apple-touch-icon` 180 × 180 ohne Transparenz, `apple-mobile-web-app-capable`, Statusleiste `default`). Auf iPhone und iPad: „Zum Home-Bildschirm“ in Safari; das braucht HTTPS (self-hosting.md).
- **Icons:** zwei übereinanderliegende Seiten auf Graphit, keine Schrift. Quelle sind `icon.svg` und `icon-maskable.svg`.
- **Service Worker** (`public/sw.js`) speichert nur `/`, `/assets/*` und `/icons/*`. **Nie** angefasst werden `/api/*` (auch der Antwort-Strom), alles außer GET und alles von fremder Herkunft. Chats, Fächer, Schlüssel und Sitzungen gelangen nie in den Cache; ein Test liest den echten Quelltext und belegt das.
- **Seitenaufrufe zuerst übers Netz.** Die gemerkte Startseite gibt es nur ohne Netz. Gemerkt wird nur eine erfolgreiche HTML-Antwort derselben Herkunft.
- **Hash-Dateien zuerst aus dem Speicher**, höchstens 80 Einträge. Icons haben keinen Hash: Wer ein Icon ändert, zählt `ASSET_CACHE` in `sw.js` hoch.
- **Updates:** `skipWaiting` und `clients.claim`; alte Speicher werden beim Aktivieren gelöscht. Prüfung höchstens einmal pro Stunde bei Sichtbarkeit. Fehlt nach einem Update ein nachgeladener Teil, bietet eine Fehlergrenze „Neu laden“ an. Fehlertexte werden weder angezeigt noch gespeichert.
- **Registrierung nur sicher:** nur im Produktionsbau und in sicherem Kontext (HTTPS oder `localhost`). In `pnpm dev` gibt es keinen Worker.
- **Server-Cache:** `/assets/*` mit `max-age=31536000, immutable`, sonst Statisches mit `no-cache`, `/api/*` mit `no-store`.
- **Offen bis zum Test auf iPhone und iPad:** Eine Home-Bildschirm-App hat eigene Cookies und Speicher (einmal neu anmelden); Tastatur und Weiterlaufen siehe D-028. Geprüft hier: Registrierung, Aktivierung, Speicherinhalt, Offline-Seite in Chromium über `localhost`.

## D-030 Tailscale Serve: was geprüft ist und was nicht

- **Quellen (3. Oktober 2026):** `tailscale serve [flags] <target>` mit `--bg`, `--https`, `--http`, `--set-path`, `status` und `reset`. `tailscale serve 3000` reicht an `http://127.0.0.1:3000` weiter, standardmäßig über HTTPS; fehlt HTTPS im Tailnet, bietet der Befehl die Aktivierung an. Details in [self-hosting.md](self-hosting.md).
- **Korrektur zu D-013:** Das Verhalten nach einem Neustart steht in keiner geprüften Quelle und ist gestrichen. Die Anleitung bittet, nach einem Neustart `tailscale serve status` zu prüfen.
- **Gerätenamen werden öffentlich:** HTTPS-Zertifikate erscheinen im öffentlichen Certificate-Transparency-Verzeichnis (laut Tailscale). Die Warnung steht deshalb ganz oben in der Anleitung.
- **Header:** Laut Quelltext (`addProxyForwardedHeaders`) setzt Serve `X-Forwarded-Host`, `X-Forwarded-For` und bei TLS `X-Forwarded-Proto: https`; `Host` bleibt erhalten, `Tailscale-User-*` kommen dazu. Pagewise nutzt nur `X-Forwarded-Proto` für `Secure`. Die CSRF-Prüfung hängt an `Sec-Fetch-Site` und Token, nicht an `Host` oder `Origin`. **Ungeprüft:** ob die installierte Tailscale-Version den Header schon setzt. Fehlt er, funktioniert alles, nur ohne `Secure`.
- **Identität:** `Tailscale-User-*` werden bewusst nicht ausgewertet; der Zugang bleibt der Passcode.
- **Offen:** Anmeldung über die `ts.net`-Adresse, Home-Bildschirm-App, Tastatur und Aufwachen prüft der Maintainer auf iPhone und iPad.

## D-031 Strenge CORS-Regel: nur die eigene Herkunft

- **Regel:** Pagewise setzt nie `Access-Control-*`-Header. `originGuard` (`apps/server/src/http/origin.ts`) lehnt jede `/api`-Anfrage mit fremdem, unlesbarem oder `null`-`Origin` mit 403 `cross_origin` ab, auch `OPTIONS`. Verglichen wird mit `X-Forwarded-Host` (hinter Serve) oder `Host`. Ohne `Origin` (GET, Befehlszeile) läuft alles weiter; ändernde Methoden prüft zusätzlich der CSRF-Schutz (D-021).
- **Warum doppelt:** Ein Browser liest fremde Antworten ohne CORS-Header nicht, die Anfrage erreicht den Server aber. Die Prüfung verhindert das auch bei Browsern ohne `Sec-Fetch-Site`.
- Der Vite-Proxy leitet `Host` weiter; `pnpm dev` funktioniert. Tests: `http/origin.test.ts`.

## D-032 „Alles löschen“

- **Was:** Einstellungen → „Deine Daten“ → „Alles löschen“. Der Dialog verlangt den Passcode, auch mit gültiger Sitzung; die Versuche zählen im Rate-Limit. Der Server beendet laufende Antworten und löscht dann alle Secrets; in einer Transaktion Nachrichten, Chats, Untergruppen, Fächer, Anbieter, Einstellungen und Profil; danach Dateien in `assets`, `workspaces`, `logs` und `backups`; zuletzt `wal_checkpoint(TRUNCATE)` und `VACUUM`. Seit D-038 werden **alle** Tabellen außer Anmeldung, Sitzungen und Migrationsprotokoll geleert.
- **Was bleibt:** Passcode und Anmeldung, damit die Einrichtung sofort wieder startet. Die Oberfläche lädt danach komplett neu.
- **Sicherungen werden mitgelöscht**, weil sie die alten Inhalte enthalten. Das macht den Vorgang unwiderruflich; der Dialog sagt es.
- **Wirklich weg:** `secure_delete` (D-017), Checkpoint und `VACUUM`. Ein Test belegt, dass ein Text nach dem Löschen weder in der Datenbankdatei noch im WAL steht. **Grenze:** Kopien außerhalb von Pagewise (Time Machine, Snapshots, Cloud-Sicherungen des Ordners) erreicht das nicht.
- **Fehler:** nur der Code `erase_failed`; ein erneuter Versuch räumt den Rest auf.
- **Einzelne Löschungen:** Fach, Untergruppe, Chat und Anbieter löschen ihre Zeilen mit `secure_delete`. Sobald Assets und Arbeitsordner existieren, entfernt das Löschen auch die Dateien (D-041), mit Test ([acceptance-1a.md](acceptance-1a.md)).

## D-033 Daten an Anbieter: Übersicht und Bilder-Schalter

- **Übersicht:** Das Anbieter-Formular nennt, was an den Anbieter geht (Nachricht und Verlauf, Prompts mit Profilangaben, Bilder und Dateien nur wenn selbst angehängt) und was nie (Passcode, Schlüssel anderer Anbieter, nicht geöffnete Chats). Der Hinweis auf kostenlose Modelle (D-024) bleibt.
- **Schalter „Bilder an diesen Anbieter senden“:** je Anbieter gespeichert (`providers.send_images`, Standard an; API `sendImages`). `ProviderService.allowsImages(id)` fragt der Chat vor dem Zusammenstellen einer Anfrage ab; ein unbekannter Anbieter bekommt nie Bilder. Bilder gibt es in 1a noch nicht; die Durchsetzung mit Test kommt mit 1c als Abnahmebedingung.

## D-034 Standard-Prompts je Fach (Entscheidung des Maintainers, 3. Oktober 2026)

- **Entscheidung:** Hinter jedem Fach liegt ein Standard-Prompt. Er ist für alle gleich, standardmäßig aktiv, bearbeitbar und zurücksetzbar. Das ändert die frühere Regel „keine Fach-Prompts mitliefern“ (Mega-Prompt Abschnitte 2 und 11, D-025, `CLAUDE.md` Regel 6) nur für diese Standardtexte.
- **Was gleich bleibt:** Eigene Texte der Nutzer liegen nur im lokalen Datenverzeichnis, nie im Repo. Die Standardtexte sind neutral: keine personenbezogenen Daten, Schulnamen, Lehrkräfte, Bundesland- oder Lehrplanangaben. Schul-Prompt und Untergruppen-Zusatz bleiben leer, bis der Nutzer etwas einträgt.
- **Ablage:** `prompts/defaults/<key>.md` je Katalogfach, `standard.md` für das eingebaute Fach (D-038), `_generic.md` als Rückfall. Geladen beim Start (`prompts/defaults.ts`): nur gültige Schlüssel (`[a-z0-9-]`), höchstens 16 KiB und 3.000 Zeichen, keine Steuerzeichen. Alles andere wird übersprungen.
- **Wirksam:** eigener Text (`subjects.system_prompt`), sonst der Standardtext. `NULL` heißt „Standard aktiv“; ein leerer Text beim Speichern setzt zurück. Herkunft des Standards: das eingebaute Fach nimmt `standard`; sonst `subjects.template_key`; sonst die Vorlage zum Namen (ohne Groß-/Kleinschreibung und Umlaute); zuletzt `_generic`. Vorschau und Chat nutzen `buildSystemPrompt`; die Vorschau nennt die Herkunft (`code`, `default`, `custom`).
- **Live:** Wer nichts überschrieben hat, bekommt Updates der Standardtexte; eigene Texte sind nie betroffen. Ein Text, der dem Standard gleicht, wird beim Speichern nicht als Kopie gespeichert, damit Verbesserungen nicht verloren gehen. Ein ausdrücklich leerer Fach-Prompt ohne Standard ist nicht vorgesehen.
- **Autorenschaft:** entworfen vom Entwickler, durch zwei unabhängige Durchläufe auf Neutralität und Fachlichkeit geprüft. **Offen:** Durchsicht durch den Maintainer (Rückfrage Q3). Jeder Text ist in der Datei änderbar.
- **Schranke** (`prompts/defaults.test.ts`): Länge 500 bis 1.800 Zeichen; Aufbau mit Rolle, „So arbeitest du:“, „Grenzen:“; nur `{{fach}}`; keine E-Mail-Adresse, Netzadresse, Telefonnummer, Jahreszahl, Klassen-, Bundesland-, Lehrplan-, Prüfungs- oder Schulformangabe, keine Produkt- oder Modellnamen, keine Überschrift, kein Emoji, keine Block- oder Werkzeug-Syntax; eine Datei je Katalogfach. Das ersetzt keine Durchsicht durch Menschen.

## D-035 Designsystem v2: komplexer, animierter, immersiver (Entscheidung des Maintainers, 3. Oktober 2026)

- **Entscheidung:** Der Maintainer wünscht ein komplexeres, animierteres, immersiveres Design. Das erweitert Abschnitt 10 des Mega-Prompts (flach, ohne Verläufe, ruhig); die Einschränkungen sind keine Obergrenze mehr.
- **Was bleibt:** warme, papierartige Flächen, Graphit-Bedienelemente, Instrument Sans und Inter (selbst gehostet), Research Blue nur für Links und kleine Akzente, warmer Graphit im Dunkelmodus. Keine „KI-Slop“-Muster (lila Standardverläufe, identische Karten-Raster ohne Hierarchie, Emoji-Dekoration).
- **Leitplanken (verbindlich):** `prefers-reduced-motion` wird eingehalten, dazu eine Einstellung für Effektstufen (voll, reduziert, aus). Bewegung transportiert nie allein eine Information. CSP streng (D-023), AA-Kontrast per `tokens.test.ts`. Flüssig auf dem iPad (bevorzugt `transform` und `opacity`, wenige große Blur-Flächen); der Lesebereich im Chat bleibt ruhig. Keine Laufzeit-CDN; neue Abhängigkeiten vorher auf Version, Größe und Lizenz prüfen.
- **Vorgehen:** Richtungen zeigen, dann Tokens und Bewegung, dann Shell und Bildschirme. Umsetzung in D-043 und D-045.

## D-036 GLM Coding Plan: Diagnose, Fehlernummern, Reihenfolge (3. Oktober 2026)

- **Anlass:** Der Maintainer meldete, der GLM Coding Plan funktioniere nicht; die Fehlermeldung war nicht bekannt.
- **Befund:** (1) Das GLM-Profil gehörte zu Phase 1e und war nicht gebaut. (2) Z.ai nutzt für Plan und Pay-per-Token denselben Schlüssel; die Adresse entscheidet über das Kontingent (<https://docs.z.ai/devpack/faq>, <https://docs.z.ai/devpack/tool/others>). Ein Plan-Schlüssel am Preset „Z.ai (API)“ (`/api/paas/v4`) zählt nicht: 429 mit Nummer 1113 (<https://docs.z.ai/api-reference/api-code>). (3) Der Client las den Fehlerrumpf nie und zeigte jeden 429 als „zu viele Anfragen“; die Ursache war verdeckt.
- **Änderung:** Bei 4xx und 5xx höchstens 4 KiB Rumpf, nur Nummern aus einer festen Tabelle. Neue Codes: `no_package`, `quota_exhausted`, `plan_expired`, `model_not_allowed`, `content_blocked`; 1211 wird zu `model_not_found`. Der Anbietertext bleibt tabu (Test: ein Schlüssel im Rumpf taucht nirgends auf). Das Preset „Z.ai (API)“ schlägt `glm-5.3-flash` und `glm-5.3` vor und warnt, dass ein Coding Plan dort nicht zählt.
- **Richtiger Weg:** nur über den Agent-CLI-Adapter (D-011), nie als Chat-Provider.
- **Reihenfolge:** Phase 1e wird vorgezogen und folgt direkt auf Welle 1. Gründe: nur dieser Weg bringt den Plan zum Laufen; 1e ist Pflicht-Feature; das Backend ist von der Gestaltung unabhängig. Die Regeln von Anthropic (<https://code.claude.com/docs/en/legal-and-compliance>) und Z.ai (<https://docs.z.ai/devpack/usage-policy>, <https://docs.z.ai/legal-agreement/subscription-terms>) wurden am 3. Oktober 2026 erneut gelesen und sind unverändert. Das Rest-Risiko wie in D-011. Pagewise liefert `claude` nicht mit.
- **Neue Reihenfolge:** Welle 0, Welle 1, Welle 4 (1e), Welle 2 (Design), Welle 3 (Stundenplan, Tests, Werkzeuge), Welle 5.

## D-037 Fächerkatalog (Format Version 2, 3. Oktober 2026)

- **Was:** `config/subject-catalog.json` (vorher `config/examples/subjects.example.json`, die Beispieldatei bleibt für den Import). Version 2: `categories` (`id`, `name`) und `subjects` mit `key` (klein, ASCII, Bindestrich), `name`, `category`, optional `icon` und `aliases` (Suchbegriffe, etwa „Erdkunde“ für Geographie). Version 1 bleibt lesbar. Aktuell 63 Fächer in 7 Kategorien, darunter Chemie, Biologie, Latein, Französisch und Griechisch.
- **Neutral:** nur Namen, Kategorien, Icons und Suchbegriffe. Keine Lehrkräfte, Stunden, Prompts, Lehrplaninhalte oder Schulnamen; an kein Bundesland und keine Schulform gebunden. Keine Unterfächer (Leistungskurs, Grundkurs): Das sind Untergruppen oder Namenszusätze.
- **Laden** (`loadSubjectCatalog`): höchstens 200 Vorlagen, 20 Kategorien, 8 Suchbegriffe je Fach. Eine ungültige Datei ergibt einen leeren Katalog; ein ungültiger Eintrag verwirft die ganze Datei. Doppelte Namen oder Schlüssel, reservierte Schlüssel (`standard`, `_generic`), der Name „Standard“ und unbekannte Kategorien werden aussortiert.
- **Anlegen:** `POST /api/subjects` mit optionalem `templateKey` (muss im Katalog stehen, sonst 400), gespeichert in `subjects.template_key`; daran hängt der Standard-Prompt (D-034). `GET /api/subjects/templates` liefert den Katalog.
- **Oberfläche:** eine gemeinsame Auswahl (`TemplatePicker`) im Onboarding und im Dialog „Fach anlegen“. Suche über Namen und Suchbegriffe, unabhängig von Groß-/Kleinschreibung und Umlauten („franzoesisch“ findet „Französisch“). Vorhandene Fächer sind „Schon angelegt“ und nicht wählbar (Vergleich über Name und Schlüssel). Ohne Treffer: „als eigenes Fach anlegen“ mit dem getippten Namen.

## D-038 Eingebautes Fach „Standard“ und Standard-Chat (3. Oktober 2026)

- **Was:** Ein Klick auf „Pagewise“ in der Seitenleiste öffnet einen fachunabhängigen Chat im eingebauten Fach „Standard“. So bleibt das Datenmodell („Chats gehören fest zu einem Fach“) gleich. Das Fach ist nicht löschbar und nicht umbenennbar; es hat Untergruppen, Modellwahl und den Prompt `standard` (D-034).
- **Datenmodell** (Migration `0006_standard_subject`): `subjects.kind` (`subject` oder `default`), `subjects.template_key`, teilweiser eindeutiger Index `WHERE kind = 'default'`. Höchstens ein eingebautes Fach. `ensureDefaultSubject` legt es idempotent an (Start, nach „Alles löschen“, beim Laden der Fächer). Heißt ein eigenes Fach schon „Standard“, wird es „Standard (eigenes Fach)“; das eingebaute hat Vorrang.
- **Regeln:** Der Name „Standard“ ist reserviert (409 `name_reserved`). Ändern oder Löschen des eingebauten Fachs: 409 `builtin`. Es steht nicht in `subjects` von `GET /api/subjects`, sondern im Feld `defaultSubject`, damit Onboarding-Prüfungen und Fächerlisten gleich bleiben.
- **„Alles löschen“ (Ergänzung zu D-032):** leert **alle** Tabellen außer `auth_credentials`, Sitzungen und dem Migrationsprotokoll. Die Tabellen werden aus der Datenbank gelesen, nicht aufgezählt. Danach entsteht das Standard-Fach neu.
- **Adressen:** `/` ist die Startseite mit den Fächern; der Standard-Chat steht als erster Eintrag. „Pagewise“ führt auf `/chat`: Die Seite öffnet einen leeren Chat im Fach „Standard“ oder legt einen an und ersetzt sich im Verlauf durch dessen Adresse, damit „Zurück“ nicht im Kreis führt. Frühere Chats stehen auf der Seite des Fachs „Standard“.

## D-039 Agent-CLI-Adapter: Aufruf, Umgebung, Rechte (4. Oktober 2026)

Phase 1e ist gebaut (`apps/server/src/agents/`), Details in [agent-cli.md](agent-cli.md). Gemessen mit Claude Code 2.1.220 auf macOS.

- **`--safe-mode` und `--setting-sources local` sind Pflicht.** Ohne sie laufen Hooks aus Arbeitsordner und Benutzerverzeichnis, `CLAUDE.md`, Skills und MCP-Server mit den Rechten des Programms (mit Köderdateien gemessen). `--bare` wird nicht genutzt, weil es keine OAuth-Anmeldung liest.
- **Zwei Schichten für Dateizugriffe.** Die Sandbox schützt nur Shell-Befehle; die Datei-Werkzeuge folgen den Berechtigungsregeln. Also: `Edit(//<Arbeitsordner>/**)` erlaubt, Konfigurationsdateien gesperrt; Sandbox mit `failIfUnavailable`, `allowUnsandboxedCommands: false`, Lesesperre für Benutzerverzeichnis, Datenverzeichnis und `/Users /home /Volumes /mnt /media`, ohne Netzfreigabe. Pfade sind aufgelöst und beginnen mit `//`. Ende-zu-Ende mit dem echten Programm bestätigt.
- **Umgebung per Allowlist:** `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `TMPDIR`, `USER`, `LOGNAME`, `PATH` (mit dem Ordner des Programms) und die Variablen des Zugangs. Fest gesetzt: `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` (gemessen: sonst Verbindung zu api.anthropic.com auch bei fremder Basis-Adresse), `DISABLE_AUTOUPDATER`, `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `CLAUDE_CODE_MAX_RETRIES=2` (gemessen: sonst bis zu zehn Wiederholungen je API-Fehler, auch 401, rund drei Minuten).
- **Eigenes Benutzerverzeichnis je Zugang** (`<Datenverzeichnis>/engine/<ID>/home`, `CLAUDE_CONFIG_DIR`), getrennt von der Anmeldung der Person. Das Abo nutzt das echte Benutzerverzeichnis; Pagewise liest die Anmeldung nie. Folge: Die Sitzungen des Abos liegen außerhalb und werden von „Alles löschen“ nicht erfasst (dokumentiert).
- **Auftrag über stdin, System-Prompt über Datei** (Rechte 600, je Lauf unter `engine/runs/<UUID>/`, danach gelöscht). Bei `--resume` muss das System-Prompt neu übergeben werden (gemessen).
- **Erkennung:** `PAGEWISE_CLAUDE_PATH`, sonst `PATH` und übliche Orte; Kandidaten werden mit `--version` geprüft. Ein defekter Wrapper wird übersprungen und genannt.
- **Fehler nur als Codes:** Der Parser liest `is_error` (der `subtype` bleibt bei Fehlern „success“) und gibt nie Text des Programms weiter. Vom Fehlerrumpf kommt nur die Nachricht („API Error: Request rejected (429) · …“) durch. Die Z.ai-Nummer wird erkannt, wenn sie in der Nachricht steht, sonst gilt der HTTP-Status (`rate_limited`). **Offen:** welche Nachricht Z.ai wirklich liefert, zeigt nur ein echter Plan.
- **Tests:** Unit, Integration mit Ersatz-CLI, und opt-in Ende-zu-Ende mit dem echten Programm gegen einen Ersatz der Anthropic-API (`PAGEWISE_E2E_CLAUDE`). Echte Anbieter wurden nie angesprochen.

## D-040 Arbeitsordner flach, Pfadgrenze der Sandbox (4. Oktober 2026)

- **Messung:** Ab 11 Pfadbestandteilen scheitert jeder Shell-Befehl mit „E2BIG“. Die Sandbox baut je Befehl ein Profil mit 199 Deny-Pfaden, das ab dieser Tiefe über 1 MB groß wird. Bis 10 Bestandteile läuft alles. Gilt für den Pfad des Arbeitsordners samt Datenverzeichnis; `PATH` spielt keine Rolle (gemessen).
- **Entscheidung:** `<Datenverzeichnis>/workspaces/<ID>` mit der ID des Fachs bzw. der Untergruppe (Zufalls-UUIDs), vorher `<Fach>/main` und `<Fach>/groups/<Gruppe>`. Der Standardpfad hat auf macOS 7 Bestandteile. Der Runner prüft die Tiefe und meldet `workspace_too_deep`, statt den Agenten ohne funktionierende Befehle zu starten.
- **Folge:** `AgentCleanup` merkt sich beim Löschen eines Fachs die Untergruppen-IDs, weil sie danach nicht mehr in der Datenbank stehen. Bei Linux nicht gemessen.

## D-041 Chats mit Agent: Wahl, Sitzung, Dateien, Aufräumen (4. Oktober 2026)

- **Wahl:** Chat und Fach haben `engine_profile_id` neben dem Modell; beides schließt sich aus. Reihenfolge: Zugang des Chats, Modell des Chats, Zugang des Fachs, Modell des Fachs, Standardmodell. Bei fehlendem Programm oder Fehler: „Mit API-Modell erneut“ (`POST /chats/:id/retry` mit `{viaApi: true}`), nur für diesen Versuch und nur auf Klick. Aufträge gehen nie ungefragt an einen anderen Anbieter.
- **Sitzung:** `chats.agent_session_id`; weitere Aufträge nutzen `--resume`. Schlägt das fehl (`No conversation found`), startet der Runner einmal ohne Sitzung und legt den bisherigen Verlauf gekürzt als Text bei.
- **Ein Agent je Arbeitsordner, höchstens zwei insgesamt.** Eine Reservierung beim Senden verhindert, dass sich Dateien mischen (`workspace_busy`, 409).
- **Ereignisse:** SSE-Ereignis `activity` (Werkzeug, Ziel, Zustand, nie Inhalte); `messages.activity` mit höchstens 60 Schritten; Nachrichten haben `engineProfileId`, `activity`, `assets`.
- **Dateien:** Neue und geänderte Dateien im Arbeitsordner werden nach dem Lauf als Assets der Antwort übernommen (höchstens 25 MiB und 20 Dateien) und als Download ausgeliefert. Löschen von Chat, Fach oder Untergruppe entfernt Dateien und Arbeitsordner und beendet laufende Agenten. „Alles löschen“ entfernt zusätzlich `engine/`.
- **System-Prompt:** fester Zusatz (`agents/instructions.ts`): Arbeitsordner, Dateien nur auf Wunsch, Inhalte von Dateien und Werkzeugen sind Daten, nie nach Zugangsdaten fragen.

## D-042 Dependabot: jsdom bleibt auf 29 (4. Oktober 2026)

jsdom 30 scheitert in der CI an `--frozen-lockfile`, weil es Node ab 22.22.2 verlangt; die Vorgabe ist `>=22.18` (D-023). Dependabot ignoriert deshalb Hauptversionen von jsdom, bis die Node-Vorgabe steigt.

## D-043 Designrichtung „Lagen“ (4. Oktober 2026)

- **Auswahl:** Drei Mockups (A „Lagen“ mit Blattstapel, B „Atelier“, C „Raum“ mit Zeitleiste) wurden verglichen; gewählt wurde **A**. Gründe: Sie trifft die Identität („sonnenbeschienener Schreibtisch“, papierartig) am genauesten; sie ist immersiv, ohne den Lesebereich zu stören; sie lässt sich mit `transform`, `opacity` und Schatten umsetzen (iPad). Die Entscheidung ist begründet, nicht abgestimmt: Der Maintainer hatte die Mockups beim Bau nicht gesehen. Eine andere Richtung ändert Tokens und `lagen.css` (siehe [design.md](design.md)).
- **Umgesetzt:** Tokens für Ebenen, Licht, Schatten und acht Fachfarben (hell und dunkel, AA-geprüft); Bewegungssystem mit Federn und drei Effektstufen („Automatisch“ folgt `prefers-reduced-motion`, dazu „Voll“, „Reduziert“, „Aus“); Hülle mit Schreibtisch, Heftrücken, Blattstapel und Ankunft des Blatts; alle Bildschirme.
- **Fachfarbe:** `subjects.color` (0 bis 7; Migration `0008_subject_color` färbt bestehende Fächer reihum). Neue Fächer bekommen die am seltensten genutzte Farbe, bis alle acht vergeben sind; eine einmal vergebene bleibt. „Standard“ bleibt neutral.
- **Abweichungen von D-035:** (1) Blattwechsel per Ankunftsanimation statt View Transitions, weil die Seite als Ganzes scrollt (Tastatur auf dem iPad, D-028). (2) Kein beweglicher Streifen in der Seitenleiste (fehleranfällig bei aufklappenden Untergruppen). (3) Startseite ohne „Als Nächstes“, bis Welle 3 steht.
- **Leitplanken:** `prefers-reduced-motion` greift (im Browser geprüft); Bewegung ist nie die einzige Information; die CSP bleibt streng (das Startskript liegt als `boot.js`); Bedienflächen mindestens 44 px; keine neue Laufzeit-Abhängigkeit.
- **Messung** (Chromium, sechs Ansichtswechsel): Mittel 16,7 ms je Bild, keine langen Animationsbilder. CSS 52 kB, Hauptpaket 316,6 kB (vorher 310,5 kB). **Nicht gemessen:** echtes iPad, gedrosselte CPU.
- **Ältere Geräte:** Federn nutzen `linear()` (Safari 17.2), Lichtfarbe `@property` (16.4), Umschalter `:has()` (15.4). Darunter fallen Bewegung und Licht weg; die Oberfläche bleibt benutzbar. **Offen:** iPadOS-Version des Maintainers.

## D-044 Stundenplan, Testeinträge und Werkzeugzugriff der KI (4. Oktober 2026)

- **Daten** (Migration 0009): `timetable_entries` (Wochentag 1 bis 7, `HH:MM`, optional Fach, Raum, Notiz, Wochenart `all`, `a` oder `b`) und `exams` (Fach, Art frei bis 40 Zeichen, Titel, Datum `YYYY-MM-DD`, Uhrzeit, Themen, Notizen). Wird ein Fach gelöscht, bleiben seine Stunden (`ON DELETE SET NULL`), seine Tests verschwinden (`CASCADE`). „Standard“ ist dafür gesperrt. Obergrenzen: 500 Stunden, 2.000 Tests; Fehlercodes statt Texte. Keine Note (Q5). Daten sind lokale Zeichenfolgen ohne Zeitzone; gerechnet wird über UTC-Zeitpunkte desselben Datums, „heute“ ist das lokale Datum.
- **Wochenart A und B:** Die Person legt fest, welche Wochenart die aktuelle Woche hat (`PUT /api/timetable/week`, gespeichert als Montag in `settings`); daraus folgt jede andere Woche. Ohne Festlegung gelten alle Stunden. Keine Annahmen über Schulwochen oder Ferien.
- **Werkzeugregister** (`apps/server/src/tools/`): Name, Beschreibung, JSON-Schema, striktes zod-Schema, `target`, `run`. Erzwungen: Argumente als JSON (nie `eval`), höchstens 4.096 Zeichen, unbekannte Felder abgelehnt; Ausgabe höchstens 12.000 Zeichen (`truncated` bei Kürzung); nur Lesen; Fehler gehen als `{"error":…}` ohne Eingaben an das Modell und brechen den Chat nicht ab. Start: `get_timetable`, `get_exams` (ohne Angabe ein halbes Jahr ab heute, höchstens 50).
- **Schleife** (`ChatService.run`): Werkzeuge werden nur angeboten, wenn der **globale Schalter** an ist (`settings` `tools.enabled`, Standard an), der **Anbieter** es erlaubt (`providers.allow_tools`, Migration 0010, Standard an) **und** das Modell das Flag „Werkzeuge“ hat. Höchstens 4 Runden, in der letzten ohne Werkzeuge; höchstens 12 Aufrufe je Antwort (sonst `too_many_calls`), 8 je Runde. „Stopp“ wirkt zwischen und während der Runden. Nach einem ausgeführten Werkzeug wechselt die Fallback-Kette das Modell nicht mehr.
- **Speicherung:** nur welches Werkzeug lief, mit Ziel und Zustand (`messages.activity`), nie Argumente oder Ergebnisse. Der Verlauf für spätere Aufträge enthält nur Text; Ergebnisse veralten.
- **Prompt-Injection:** Notizen und Themen sind Fremdtext. Ergebnisse gehen als JSON-Daten an das Modell; der Server führt nichts aus, was in einem Ergebnis steht. Test: eine Notiz mit „Ignoriere alle Regeln …“ ändert nichts.
- **Transparenz** (Abschnitt 12.6): An der Antwort steht „Stundenplan eingesehen“ oder „Tests eingesehen“, nie die Daten. Das Anbieter-Formular nennt, dass diese Daten nur bei einem Aufruf gesendet werden. Grenze: Kann das Modell keine Werkzeuge, gibt es keinen Hinweis, und dann gehen auch keine Daten raus.
- **Oberfläche:** `/timetable` und `/exams`. Überschneidungen werden gewarnt, nicht verboten. Startseite „Als Nächstes“; Fachseite „Anstehende Tests“.
- **Nicht geprüft:** ein echter Anbieter. Ob Modelle Werkzeugaufrufe im Strom wie erwartet liefern, hängt vom Anbieter ab (Rückfrage an den Maintainer).

## D-045 Wählbare Designrichtung: Raum, Lagen, Atelier (4. Oktober 2026)

- **Anlass:** Der Maintainer findet C „Raum“ passend und wünscht alle drei, wählbar wie der Dunkelmodus. Das ergänzt D-043; „Lagen“ bleibt.
- **Mechanik:** `data-design="raum|lagen|atelier"` am `<html>`, vor dem ersten Anstrich gesetzt durch `public/boot.js` (kein Aufblitzen), danach durch `ui/design.ts`. Gespeichert unter `pagewise.design` im Browser (verlässt das Gerät nicht). **Voreinstellung „Raum“.** Auswahl unter „Darstellung“. Ein Test vergleicht Schlüssel und Werte von `boot.js` mit dem Modul.
- **Aufbau:** Alle drei teilen **dieselben Klassen** (`lg-sheet`, `lg-row`, `lg-slip`, `lg-nav-item`, `lg-binder` …). `lagen.css` ist die Grundlage, `raum.css` und `atelier.css` überschreiben unter `:root[data-design=…]`. Neue Bildschirme brauchen keine Fallunterscheidung. Einziger Sonderbaustein: die Tageslinie (`planning/DayLine.tsx`), nur in „Raum“ und nur mit heutigen Stunden.
  - **Raum:** Ordner mit Rücken und gestrichelter Heftung in der Fachfarbe, flache Seitenleiste, Karten mit Fachfarbe als Kante, Fensterlicht, Tageslinie mit „Jetzt“-Marke.
  - **Lagen:** wie D-043.
  - **Atelier:** keine Hülle, flache Seitenleiste auf dem Grund, Licht der Fachfarbe und zwei schräge Lichtbänder (im Chat still), runde Karten mit Schatten.
- **Bewegung:** an die Effektstufen gebunden, nur `transform` und `opacity`. Die Parallaxe des Fensterlichts in „Raum“ (`ui/parallax.ts`, `--px` und `--py` über das CSSOM) läuft nur mit Maus oder Stift (`(hover: hover) and (pointer: fine)`), nur in Stufe „Voll“ und bei sichtbarem Tab. Eine 3D-Neigung des ganzen Ordners ist **bewusst nicht gebaut**: Ein `transform` am Vorfahren würde `position: fixed` (Dialoge) und die iPad-Tastatur (D-028) gefährden.
- **Nicht übernommen aus Mockup C:** Staubpartikel, Lineal und Bleistift, Register-Reiter, Ringe „in n Tagen“, Befehlsleiste. Zierde oder später; die Tokens tragen es, sobald es gewünscht wird.
- **Kontrast:** Die neuen Tokens (`--desk-a`, `--desk-b`, `--edge-1…3`, `--cover-*`, `--heft-shadow`) tragen keinen Text. Text steht auf `--sheet`, `--surface` und `--paper`, geprüft je Darstellung (WCAG AA).
- **Nicht geprüft:** Messung am iPad (nur Chromium am Rechner). Ältere iPadOS-Versionen: wie D-043.

## D-046 Moleküle: eigene Valenzstrichformeln für Schulmoleküle (4. Oktober 2026)

- **Anforderung** (Pflichtenheft Abschnitt 5): Valenzstriche, freie Elektronenpaare, Winkel, Summenformel. Skelettformeln reichen nicht.
- **Geprüft** (npm, 4. Oktober 2026): SmilesDrawer 2.4.1 (MIT, ohne `eval`), OpenChemLib 9.25.0 und RDKit.js 2026.9.1 (BSD-3). Gemessen wurde nur SmilesDrawer; es zeichnet Ethanol als Skelettformel ohne freie Elektronenpaare. OpenChemLib und RDKit.js sind nicht eingebaut: RDKit.js braucht WebAssembly, und die CSP erlaubt das nicht (`wasm-unsafe-eval` fehlt). Dass beide keine Valenzstriche zeichnen, ist Annahme, nicht gemessen.
- **Entscheidung:** `packages/render/src/mol/` mit eigenem SVG-Renderer und einer Tabelle von 17 Schulmolekülen (H₂, O₂, N₂, Cl₂, F₂, HCl, HF, H₂O, H₂S, NH₃, CH₄, CO₂, SO₂, CH₂O, HCN, C₂H₂, C₂H₄). Das Modell nennt nur die Summenformel (` ```mol ` mit `H2O`); die Geometrie steht in der Tabelle (Winkel, Elektronenpaare, Keil und gestrichelte Bindung). Alles andere, vor allem Organisches, geht als `smiles: CCO` an SmilesDrawer. Unbekannte Summenformel: Fehlercode `unknown_formula` mit der bereinigten Formel als Hinweis.
- **Begründung:** Modelle liefern Koordinaten und SMILES für größere Moleküle oft falsch (erwartet, nicht gemessen). Deshalb keine Koordinaten im Block und keine erfundene Zeichnung. Ob echte Modelle die Syntax einhalten, prüft der Maintainer.
- **Grenzen:** keine Ionen, Ladungen oder Mesomerie. NH₃ und CH₄ sind Lehrbuch-Schema, nicht maßstäblich.

## D-047 Funktionsgraphen: eigener Plotter ohne `eval` (4. Oktober 2026)

- `function-plot` 1.25.4 enthält im Paket zweimal `new Function` und scheitert unter `script-src 'self'`. JSXGraph 1.13.3 ist mit 77 MB entpackt zu groß.
- **Entscheidung:** `packages/render/src/graph/` mit eigenem Ausdrucks-Parser (rekursiver Abstieg, kein `eval`) und eigenem SVG-Plotter. Erlaubt: Zahlen, `x`, `pi`, `e`, `+ - * / ^`, Klammern, `sin cos tan asin acos atan sinh cosh tanh sqrt cbrt abs ln log exp floor ceil sign`; das Malzeichen darf fehlen (`2x`). Grenzen: 200 Zeichen, 200 Knoten, Tiefe 40, höchstens sechs Funktionen, 20 Punkte, Bereiche bis 10⁶.
- Die Zeichnung ist deterministisch, damit PDF und PPTX (Phase 1d) dasselbe zeigen. Kurven brechen an Polstellen ab. Ab der vierten Funktion sind Linien gestrichelt, damit nicht nur die Farbe unterscheidet.
- **Fund:** `constructor`, `toString` und `__proto__` trafen Einträge des Objekt-Prototyps. Behoben mit `Map`, abgesichert durch Tests.
- Die Prüfung der JSON-Angabe ist von Hand geschrieben: zod 4 erzeugt beim Start `new Function` und verletzt damit die CSP. Das Graph-Paket schrumpfte dadurch von 94 auf 8,5 kB.

## D-048 Formeln, Noten und Zeichnungen unter der strengen CSP (4. Oktober 2026)

- **Ausgangslage:** KaTeX, abcjs und SmilesDrawer schreiben `style`-Attribute und Stilelemente, die die CSP blockiert. Schon das Parsen eines Elements mit `style` meldet einen Verstoß. Vite bettete KaTeX-Schriften als `data:` ein.
- **Entscheidung: die CSP bleibt streng.** Gemessen am Ende: 0 Verstöße und 0 Konsolenmeldungen für Chat und Hefteintrag, in allen Darstellungen, hell und dunkel.
  - **KaTeX** (`math-dom.ts`): `trust: false`, `strict: 'ignore'`, `maxExpand: 500`, `maxSize: 20`. Stilangaben werden **aus dem Text** herausgelöst (`data-pgs="n"`), nur 19 bekannte Eigenschaften (Höhe, Breite, Abstände, Ränder, Farbe) mit Werten aus Zahl und Einheit, Wort oder Hexfarbe, und danach per `element.style.setProperty` gesetzt (CSSOM).
  - **Schriften** als Dateien: `build.assetsInlineLimit` ist für woff2, woff, ttf und otf aus.
  - **abcjs:** zeichnet in ein unsichtbares Element; für die Dauer des Aufrufs wird das Stilelement über einen Eintrag an `createElementNS` zu einem leeren `g`. Keine Wiedergabe in 1b.
  - **SmilesDrawer:** zeichnet außerhalb des Dokuments; `style` wird für die Dauer des Zeichnens zu `transform`, danach zugeschnitten.
- **Bereinigung** (Abschnitt 12.4): DOMPurify 3.4.16 in `sanitize.ts`, eine Konfiguration für alle SVG-Ausgaben. Verboten: `script`, `style`, `foreignObject`, `use`, `image`, `a`, Animationen, Formulare, `iframe`, `object`, `embed`; Attribute `style`, `href`, `xlink:href`, `src`, `on…`. KaTeX hat eine eigene Konfiguration (HTML, SVG, MathML; `annotation` fällt samt Inhalt weg). 18 XSS-Fälle sind getestet.
- **Struktur-Test** (`structure.test.ts`): kein `style`-Attribut, `cssText`, `eval`, `new Function`, `dangerouslySetInnerHTML`; `innerHTML =` nur in `math-dom.ts` nach der Bereinigung.
- **Formeln im Chat** werden gezeichnet (`remark-math` 6.0.0, `katex` 0.19.0, beide MIT). Eine Formel allein in `$$…$$` wird durch `normalizeDisplayMath` zur Anzeigeformel.
- **Größe:** Hauptpaket 338 kB, Chat 192 kB. KaTeX, Graph, Moleküle, SmilesDrawer, abcjs und Bereinigung werden nur bei Bedarf geladen.
- **Nicht geprüft:** iPad und Safari (nur Chromium am Rechner). Die Stilangaben über das CSSOM sind dort nach Spezifikation erlaubt, aber nicht getestet.

## D-049 Hefteinträge: Daten, Schnittstelle, Chat-Übernahme, Korrektur (4. Oktober 2026)

- **Daten** (Migration 0011), Tabelle `notes`: Fach (`ON DELETE CASCADE`), optionale Untergruppe (`SET NULL`), Titel, Markdown-Text (höchstens 100.000 Zeichen, erst beim Anzeigen bereinigt), angeheftet, Stichwörter (höchstens 10 × 30 Zeichen), Herkunft (`source_chat_id` mit `SET NULL`; `source_message_id` **ohne** Fremdschlüssel, weil Nachrichten beim Wiederholen neu entstehen). Obergrenze 5.000. Die Oberfläche sagt „Hefteintrag“, nie „Note“ (D-044). „Alles löschen“ leert die Tabelle.
- **Schnittstelle** `/api/notes` (strikt, Fehlercodes): Liste je Ansicht mit Suche (`LIKE` mit maskierten Platzhaltern, höchstens 200, Angeheftete zuerst) und Auszug; Anlegen, Lesen, Ändern, Löschen. Keine Dateien, daher keine Assets.
- **Aus dem Chat:** `POST /api/chats/:id/messages/:messageId/note`. Der Server liest den Text **selbst** aus der Nachricht; nur Antworten des Modells mit Status `complete`, `stopped` oder `interrupted`. Bewusst **kein Werkzeug** (D-044 bleibt nur lesend).
- **Technische Prompt-Ebene:** nennt Blöcke und Schreibweise, bleibt unter 1.500 Zeichen. Die Summenformeln stammen aus derselben Tabelle wie die Zeichnung; ein Test hält das gleich. Block-Syntax steht **nicht** in den Standard-Prompts je Fach (D-034).
- **Korrektur bei Renderfehlern** (Pflichtenheft Abschnitt 5; der Worker dafür kommt mit 1d): Lässt sich ein Block nicht zeichnen, geht **einmal** eine Nachricht an das Modell. Sie beginnt mit „Automatische Prüfung:“ und nennt je Block nur Art, Nummer, einen festen Text und den Fehlercode, nie Text aus dem Block oder einer Bibliothek. Die zweite Antwort wird nicht erneut geprüft; geprüft wird nur, was in der offenen Ansicht gerade fertig wurde. **Abschaltbar** in den Einstellungen („Antworten“, Standard an, nur in diesem Browser); dabei geht der Verlauf erneut an den Anbieter. Ohne Korrektur bleibt der Block mit Meldung und Quelltext stehen.
- **Oberfläche:** Reiter „Chats | Hefteinträge“ auf Fach- und Untergruppenseite (`/subjects/:id/notes`, `/subjects/:id/groups/:gid/notes`). Editor mit Markdown links und Vorschau rechts (ab 1024 px); Speichern 1,2 s nach der letzten Eingabe und beim Verlassen; der Zustand steht als Text da. Chat-Antworten haben „Als Hefteintrag speichern“.
- **Nicht gebaut:** Untergruppe eines Eintrags ändern, Hefteintrag aus Foto (1c), Export (1d), Vorlage je Fach (`note_template_prompt`), Werkzeug `get_notes`, Wiedergabe der Noten.

## D-050 Mac-App: Electron (4. Oktober 2026)

- **Entscheidung:** `Pagewise.app` mit Electron. iPhone und iPad bleiben PWA über Tailscale Serve; der Mac ist der Server.
- **Nicht-Ziele:** Oberfläche in SwiftUI, Server in Swift oder Rust, Mac App Store (die Sandbox verträgt sich nicht mit `claude` und dessen eigener Sandbox), native iOS-App, `tailscale funnel`, Telemetrie, stilles Auto-Update.
- **Gründe:** eine Sprache für Server, Oberfläche und Hülle; der Hono-Server bleibt unverändert; Chromium ist die Engine der Echtbrowser-Prüfungen; `powerSaveBlocker`, Tray, Einzelinstanz und Login-Item sind eingebaut.
- **Verworfen:** Tauri (Rust als dritte Sprache; Node müsste als Sidecar separat signiert werden; Stand laut Auftrag, von mir nicht erneut geprüft). Reines Swift (WKWebView-Delegates für Dateiwahl und Downloads; Swift als dritte Sprache; ohne macOS-CI nicht prüfbar).
- **Versionen** (npm, 4. Oktober 2026): `electron` 44.5.1 (MIT), `@electron-forge/cli` 8.0.1 (MIT).
- **Spike im Container** (Linux, Xvfb, `--no-sandbox` nur wegen Root; die App selbst hat `sandbox: true`). Befunde: (1) `--ozone-platform=headless` stürzt mit SIGSEGV ab; für Tests gilt Xvfb. (2) `utilityProcess` lädt den `tsx`-Quelltext nicht (`ERR_MODULE_NOT_FOUND`); der Server muss gebündelt werden (D-051). (3) Mit dem Bundle laufen Server, Einrichtung, Cookie, Service Worker und der Neustart der App ohne Fehler.
- **Nicht geprüft** (nur der Maintainer am Mac, [acceptance-mac.md](acceptance-mac.md)): alles auf macOS, `darwin-arm64.node` unter Electron, Streaming im App-Fenster, Agent-Downloads, `target=_blank`, Drucken.
- **Aufbau:** `apps/desktop`. Das Fenster **lädt** `http://127.0.0.1:3000`; es gibt keine gebündelte Oberfläche. Die Herkunft binden `originGuard` (D-031), CSP `connect-src 'self'`, Cookie und Service Worker. **Port fest 3000**, bei Belegung klare Meldung: `localStorage` hängt an Herkunft samt Port, und Serve zeigt auf den Port. Der Server läuft als `utilityProcess` mit zusammengestellter Umgebung (nie `process.env` erben). Das Datenverzeichnis bleibt unverändert; Electrons `userData` liegt in einem eigenen Unterordner.
- **Status und Steuerung nie über HTTP, nur über IPC** (`apps/server/src/control/protocol.ts`). Hinter Serve kommen alle Anfragen von 127.0.0.1 (D-021); ein „nur lokaler“ Endpunkt wäre im ganzen Tailnet erreichbar.
- **Entscheidungstor:** Zeigt sich am Mac, dass Electron grundlegend nicht trägt, meldet der Maintainer das mit Begründung, bevor die Technik gewechselt wird.

## D-051 Server bündelbar (4. Oktober 2026)

- **Ressourcen:** `paths.ts` kennt den Repo-Aufbau und den flachen Aufbau des Bundles. `PAGEWISE_RESOURCES_DIR` (absoluter Pfad, sonst `ConfigError`) schaltet um; betroffen sind Migrationen, Katalog, Standard-Prompts, Oberfläche und die Prüfung aus D-005.
- **`startServer(opts)`** (`server.ts`): Konfiguration, Sperre, Dienste, Lauschen; Fehler kommen mit Erklärung. `RunningServer` hat `url`, `port`, `status()`, `setupCode()`, `stop()`. Port 0 gibt es nur im Aufruf, nicht über die Umgebung (`PAGEWISE_PORT` bleibt 1 bis 65535).
- **Portkonflikt** (`EADDRINUSE`): `PortInUseError` mit klarem Text, kein Ausweichen. Datenbank und Sperre werden wieder freigegeben.
- **Instanzsperre** `server.lock` (Rechte 600, atomar angelegt, mit Prozessnummer). Eine verwaiste Sperre wird nur übernommen, wenn die Datei seit dem Lesen unverändert ist. Grenzen: Eine wiederverwendete Prozessnummer kann eine verwaiste Sperre lebend erscheinen lassen; `flock` gibt es in Node nicht. Die Sperre schützt auch `reset-passcode`.
- **Geordnetes Beenden** `stop()`: laufende Antworten werden als **`interrupted`** gespeichert (Teiltext bleibt, „Erneut versuchen“ ist möglich); ein „Stopp“ des Nutzers bleibt `stopped`. Danach Verbindungen, Datenbank und Sperre schließen.
- **Einrichtungscode ohne Konsole:** `setupCode()` und IPC `setup-code`. Der Code steht weder in Logs noch in der Ausgabe des eingebetteten Servers noch in einem HTTP-Endpunkt. Die Befehlszeile zeigt ihn weiter (D-021).
- **`reset-passcode`** als Bibliotheksfunktion, die bei laufendem Server verweigert; im eingebetteten Server per IPC (stoppt, setzt zurück, startet neu).
- **Bundle** (`pnpm --filter @pagewise/server bundle --out <Ordner>`, `scripts/bundle.ts`): esbuild (neue Entwicklungsabhängigkeit `esbuild` ^0.28.2, MIT) erzeugt `pagewise-server.mjs` und `pagewise-embedded.mjs`, je rund 1,3 MB. Die Binärdatei `better_sqlite3.node` liegt daneben und wird über `nativeBinding` mit absolutem Pfad geladen (`PAGEWISE_SQLITE_BINDING`). Bei Electron liegen Bundle und `.node` neben der Datei, nicht im Archiv (`asarUnpack`).
- **Offen:** Lizenzhinweise der gebündelten Pakete (D-055). `darwin-x64.node` ist ungetestet; `darwin-arm64` ist in der macOS-CI geprüft (D-055).
- **Tests:** Pfade, Sperre, Serverstart, Portkonflikt, Steuerkanal, Zurücksetzen, `interrupted`; `bundle.test.ts` baut das Bundle in einen fremden Ordner und startet es mit Allowlist-Umgebung durch einen vollen Ablauf (Einrichtung, Anmeldung, Fach, zweiter Start, belegter Port, SIGTERM).

## D-052 iPad und iPhone robuster: Zeitlimit, Banner, Icons, Safe-Areas, Tastatur (4. Oktober 2026)

- **Anlass:** Schläft der Mac, hängt die Verbindung bisher, statt zu scheitern. Das Banner sagt das ehrlich: Was der Mac nicht kann, kann auch die PWA nicht.
- **Service Worker** (`public/sw.js`): Seiten zuerst aus dem Netz, höchstens **3 s**, danach die gemerkte Startseite. `boot.js` bekommt **1,5 s**. Antwortet Tailscale Serve mit **502 bis 504**, gilt ebenfalls die gemerkte Seite. 500 und andere App-Fehler werden nicht überdeckt; Fehlerseiten werden nie gemerkt. Vorabspeichern bei der Installation (`/` und `/boot.js`). Speichername v2.
- **Zeitlimit:** `SessionProvider` und `WorkspaceProvider` warten höchstens **8 s** (`connection/timeout.ts`), dann „Der Server antwortet nicht“ mit „Erneut versuchen“.
- **Verbindungs-Banner** (`connection/monitor.ts`): `GET /api/health` mit **4 s** Zeitlimit; die Antwort muss `{"status":"ok"}` sein, ein WLAN-Portal mit 200 zählt nicht. Die Prüfung läuft bei Sichtbarkeit, `pageshow`, `online`, `offline`, nach Netzfehlern und alle 30 s. Im Ausfall wiederholt sie sich nach 2, 5, 10 und 30 s, dann alle 30 s. Das Banner blockiert nichts; kommt der Mac zurück, holen Sitzung und Arbeitsbereich ihren Stand **ohne Neuaufbau** der Ansicht.
- **Manifest:** Laut Vorrecherche aus dem Auftrag (**nicht erneut geprüft**; Safari 27) werten iOS nur `display`, `name`, `short_name`, `start_url`, `scope`, `id`, `theme_color` und die Icons aus. Neu: `icon-maskable-1024.png` (1024 × 1024, RGB ohne Alpha). Ein Test sichert, dass `any` und `maskable` nie in einem Eintrag gemischt sind.
- **Safe-Areas** links und rechts (`env(safe-area-inset-left/right)` mit `max(…)`) in Shell, Dialogen, Anmeldung und Banner. Das Blatt (`Sheet`) bleibt unverändert.
- **Tastatur** (`ui/keyboard.ts`): Der Abstand `innerHeight − visualViewport.height − offsetTop` wird als `--kb` über das CSSOM gesetzt; Eingabezeile und Dialoge heben sich darüber. Kein `interactive-widget`, keine VirtualKeyboard-API. **Nur mit gefälschtem `visualViewport` getestet, nicht auf einem Gerät.**
- **Belegt, nicht geändert** (Vorrecherche): Home-Bildschirm-Apps sind von der 7-Tage-Löschung ausgenommen. iOS hat kein Background Sync, kein `beforeinstallprompt`, kein Share-Target. Push gibt es nur in der installierten App (ab 16.4).

## D-053 Mac-Hülle `apps/desktop`: Aufbau, Sicherheit, Verhalten (4. Oktober 2026)

- **Aufbau:** Die Hülle lädt Server und Oberfläche (D-050). Die Logik liegt in Modulen ohne Electron-Abhängigkeit; `main.ts` verdrahtet sie. esbuild erzeugt `dist/main.cjs` und `dist/preload.cjs`, der Server liegt in `dist/server` (D-051).
- **Fenster** (per Test festgenagelt): `contextIsolation`, `sandbox` und `webSecurity` an; `nodeIntegration` (auch in Workern und Frames), `webviewTag`, `allowRunningInsecureContent`, `experimentalFeatures` aus. Das Hauptfenster hat **keinen Preload**; im echten Electron sind `require` und `process` in der Seite `undefined`. Navigation nur innerhalb der eigenen Herkunft; fremdes `http(s)` geht in den Standardbrowser, alles andere (`file:`, `javascript:`, `data:`) wird abgelehnt. `window.open` öffnet **nie** ein App-Fenster. **Alle** Berechtigungen (Kamera, Mikrofon, Benachrichtigungen, Standort, Zwischenablage) werden abgelehnt. `app.enableSandbox()` ist bewusst nicht aufgerufen; der Sandkasten gilt je Fenster.
- **Hüllen-Fenster** (Meilenstein M3): derselbe Sandkasten, eigener Preload mit festen Funktionen, lokale Seiten mit `default-src 'none'`. IPC nur von Seiten des eigenen Hüllen-Ordners (`isTrustedSender`), nie vom Server-Inhalt.
- **Umgebung des Servers** (`buildServerEnv`): nur `HOME USER LOGNAME LANG LC_ALL LC_CTYPE TZ TMPDIR`, ein erweiterter `PATH` (Homebrew, `/usr/local/bin`, `~/.local/bin`, `~/.claude/local`, npm, Volta, Bun) und die ausdrücklich gesetzten `PAGEWISE_*`. Schlüssel anderer Anbieter, Proxy-Einstellungen, `NODE_OPTIONS`, `DYLD_*` kommen nie an. Der Prozess startet mit **leerer Argumentliste** (Strukturtest).
- **Überwacher** (`ServerSupervisor`): `ready` innerhalb von 20 s; `/api/health` alle 15 s, nach dreimal ausbleibender Antwort Neustart; Neustart nach Pausen von 0,5, 1, 2, 4 und 8 s. **Fünf Abstürze innerhalb einer Minute beenden die Schleife mit Fehlermeldung.** Dauerhafte Fehler (Port belegt, Konfiguration, Datenverzeichnis, Datenbank) werden nicht wiederholt.
- **Fenster schließen** versteckt nur; der Server läuft weiter. **Beenden** fragt bei laufenden Antworten oder bestehenden Anmeldungen (gezählt werden Anmeldungen, nicht Geräte) und erklärt, dass iPhone und iPad dann nichts erreichen. **Einzelinstanz:** Ein zweiter Start holt das Fenster nach vorn.
- **Menü** (deutsch): Ablage (Cmd+N, Cmd+P, Cmd+W), Darstellung (Cmd+R, Cmd+Plus bzw. Cmd+=, Cmd+−, Cmd+0), Hilfe (Verbinden, Einrichtungscode, Mac wach halten, Bei Anmeldung starten, Server neu starten, Passcode zurücksetzen, Anleitung). Navigation nur über `/`, `/chat`, `/settings` per `loadURL`, nie per `executeJavaScript`. **Menüleisten-Symbol:** Status, Fenster öffnen, Wachhalten, Adresse kopieren, Verbinden, Beenden.
- **Wachhalten:** `powerSaveBlocker('prevent-app-suspension')`, Voreinstellung an und schaltbar; zusätzlich immer, solange Antworten laufen. **Ehrlich:** Bei zugeklapptem Deckel ohne externes Display schläft ein MacBook trotz der Zusicherung („forced sleep“, nicht geprüft). Power Nap und „Wake for network access“ helfen für Tailscale nicht.
- **Start bei Anmeldung:** Unter macOS hat `setLoginItemSettings` in Electron 44 **keine Argumente**; „Versteckt starten“ erkennt die App an `wasOpenedAtLogin` oder `--hidden`. Der Status `requires-approval` wird erklärt. Die Adresse der Systemeinstellungs-Seite ist **nicht verifiziert**, nur auf dem Mac prüfbar.
- **Einrichtungscode:** beim ersten Start (und nach „Passcode zurücksetzen“) in einem Dialog mit „Kopieren“, später unter Hilfe; nur über IPC.
- **Downloads** nach `~/Downloads` (sicherer Name, bei Dopplung „ (1)“), danach Benachrichtigung „Im Finder zeigen“. Drucken über `webContents.print()`.
- **Daten des Fensters:** `userData` in `<Datenverzeichnis>/Fenster` (Rechte 700). „Alles löschen“ leert Cache, Speicher und Service Worker des Fensters (`session.clearData`), **nicht die Cookies**: Passcode und Anmeldung bleiben (D-032).
- **Keine Telemetrie:** Eine ungeschützte Electron-App fragt im Hintergrund bei Google an. `privacy.ts` setzt deshalb vor `ready` Schalter (`disable-background-networking`, `disable-component-update`, `disable-sync`, `no-pings` u. a.). Unter Linux bleibt danach nur der Download des Rechtschreib-Wörterbuchs; das betrifft die Mac-App nicht. **Auf dem Mac ungeprüft** (der Maintainer kann es mit `nettop` oder Little Snitch prüfen).
- **`--smoke-test`:** ohne Fenster, mit eigenem Temp-Ordner und freiem Port; prüft Health, Steuerkanal und Oberfläche; Exit 0 oder 1.
- **Packen:** Electron Forge verlangt bei pnpm `node-linker=hoisted` für den ganzen Workspace; das würde Web und Server umbauen. Deshalb ruft `pnpm --filter @pagewise/desktop package` den Packager `@electron/packager` 20.3.0 (BSD-2-Clause) direkt auf. Der Server liegt als `Resources/server` neben dem Archiv. Die Ad-hoc-Signatur kommt ohne Hardened Runtime, damit die Binärdatei von better-sqlite3 lädt; geprüft mit `--verify --deep --strict`.
- **Electron-Binärdatei** (rund 280 MB) wird nicht bei `pnpm install` geladen, sondern von `scripts/ensure-electron.mjs` bei Bedarf (`@electron/get`, GitHub-Releases). Scheitert der Download, wird nichts umgangen.
- **`claude` finden:** Einstellung „Pfad zu claude“ (`PUT /api/engines/cli-path`, `settings` mit Schlüssel `agent.cliPath`), mit Vorrang vor `PAGEWISE_CLAUDE_PATH` und der Suche. Absolut, ohne `..`, Dateiname genau `claude`. Die Zusatzorte `~/.volta/bin`, `~/.asdf/shims` und `~/.local/share/mise/shims` sind **nicht für jeden Installer verifiziert**. **Kein** Login-Shell-Aufruf (`zsh -ilc`): Er führt Benutzerdateien aus und ist nicht deterministisch.
- **Tests:** 112 Tests in `apps/desktop`, dazu Läufe im echten Electron unter Xvfb (Playwright im Scratchpad, nicht im Repo). **Nicht geprüft** (nur der Maintainer am Mac): Menüleisten-Symbol, Start bei Anmeldung, Wachhalten bei geschlossenem Deckel, Benachrichtigungen, Finder.

## D-054 Tailscale-Modul und „Mit iPhone und iPad verbinden“ (4. Oktober 2026)

- **Quellen** (Quelltext `tailscale/tailscale`, Hauptzweig, gelesen am 4. Oktober 2026; die Doku-Seiten nicht neu geprüft): `cmd/tailscale/cli/serve_v2.go` (`serve [--bg] [--https=<Port>] [--yes] <Ziel>`, `serve status [--json]`, `serve reset`), `ipn/serve.go` (`TCP`, `Web`, `Handlers`, `Proxy`, `AllowFunnel`), `ipn/ipnstate/ipnstate.go` (`BackendState`, `Self.DNSName`, `CertDomains`), `cmd/tailscale/cli/set.go` (`tailscale set --hostname=`). **Nicht verifiziert** (nur am Mac): ob `/Applications/Tailscale.app/Contents/MacOS/Tailscale` als Befehlszeile taugt, und wie sich Standalone- und App-Store-Variante unterscheiden.
- **Programm finden:** feste Orte vor dem `PATH`, weil Apps aus Finder und Anmeldung nur einen knappen `PATH` haben. Jeder Kandidat muss bei `status --json` JSON liefern. Aufruf mit `execFile` **ohne Shell**, 20 s Zeitlimit, 4 MiB Ausgabe, Umgebung nur `PATH HOME USER LANG TMPDIR`. Die Seite kann keine Argumente oder Pfade vorgeben.
- **Ausgabe nie vertrauen:** unbekannte Felder werden ignoriert; kaputte Ausgabe gilt als „gestoppt“.
- **Zustände:** nicht installiert, nicht angemeldet, wartet auf Freigabe im Admin-Bereich (`NeedsMachineAuth`), gestoppt, startet, HTTPS im Tailnet aus (`CertDomains` leer), läuft. Je Zustand ein Satz und der nächste Schritt.
- **Freigabe einrichten:** `tailscale serve --bg --yes [--https=<Port>] 3000`, danach Prüfung durch erneutes Lesen (`verify-failed`, nie „klappt schon“). Idempotent. Eine **fremde** Freigabe wird nie überschrieben; ist 443 belegt, gibt es nur auf Knopfdruck den Ausweichport 8443 oder 10000. `serve reset` entfernt **alle** Freigaben und fragt deshalb vorher nach. Die Adresse kommt aus `Self.DNSName`, nie aus Eingaben.
- **Nie `tailscale funnel`** (Strukturtest). Bei jeder Prüfung wird `AllowFunnel` gelesen: Ist eine Freigabe öffentlich erreichbar, zeigt das Fenster eine **rote Warnung** mit „Freigabe zurücksetzen“, und die App warnt einmal pro Start. Funnel schaltet die App nie selbst ab, ohne zu fragen.
- **Rechnername:** Mit HTTPS erscheint er im öffentlichen Zertifikatsverzeichnis (D-030). `hostname.ts` erkennt ohne Namensliste die macOS-Benennung („<Name>s MacBook Pro“, „MacBook Pro von <Name>“) und Wörter mit Schulbezug. Das ist eine Warnung, kein Verbot. Vorschlag: `pagewise-mac` (`tailscale set --hostname=`, nach Rückfrage). Mit neuem Namen ändert sich die Adresse und damit die Herkunft der installierten iOS-App. Die Erkennung ist eine Näherung, kein Beweis.
- **Automatische Wiederherstellung** nur, wenn die Freigabe früher über die App eingerichtet wurde und jetzt fehlt, und nur, solange kein fremder Eintrag im Weg ist. Der Zustand wird beim Start und alle 60 s gelesen (Menüleisten-Symbol).
- **QR-Code:** `uqr` 0.1.3 (MIT, ohne Abhängigkeiten). Nur der Pfad `d` (Zeichen `MhvzHVZ0-9 .-`) kommt in die Seite; das SVG entsteht über `createElementNS`, ohne `style`. Der QR enthält nur die Adresse.
- **Fenster:** Hüllen-Fenster mit festen Preload-Funktionen (`getView`, `getStatus`, `setupServe`, `useAltPort`, `resetServe`, `renameHost`, `copyAddress`, `openTailscale`, `openDownload`, `openAdmin`) und CSP `default-src 'none'`. Jeder IPC-Aufruf prüft `event.sender` **und** die URL des sendenden Frames.
- **Im echten Electron geprüft** (Xvfb, Fake-`tailscale` mit Zustandsdatei): Einrichten, Rechnernamen-Warnung, Funnel-Warnung mit Zurücksetzen, 0 CSP-Verstöße, keine Brücke.
- **Nicht geprüft** (nur der Maintainer am Mac mit echtem Tailscale): die echte Ausgabe von `status --json` und `serve status --json`, das Verhalten von `serve --bg` über einen Neustart, die Erreichbarkeit vom iPhone, `serve --bg` bei belegtem 443.

## D-055 Bauen, macOS-CI und Verteilung Stufe 1, Lizenzhinweise (4. Oktober 2026)

- **Stufe 1 (aktiv):** `pnpm app:mac` (`scripts/app-mac.mjs`) baut, packt, signiert **ad hoc** (`codesign --sign -`) und installiert nach `~/Applications` (`--dest`, `--no-install`). Das Skript bricht ab, wenn Pagewise läuft. Es kopiert mit `ditto` und prüft danach `codesign --verify --deep --strict`; es führt nur feste Programme ohne Shell aus. Lokal gebaute Apps tragen keine Quarantäne-Markierung (Erfahrungswert, **nicht verifiziert**: `xattr -l ~/Applications/Pagewise.app`).
- **macOS-CI** (`desktop-mac` in `ci.yml`): `macos-latest` ist laut `actions/runner-images` (gelesen am 4. Oktober 2026) macOS 26 auf Apple Silizium. Der Job baut `darwin-arm64`, prüft Signatur und Aufbau, führt `--smoke-test` an der **gepackten** App aus und lädt das `ditto`-Zip als Artefakt `Pagewise-mac-arm64` mit **3 Tagen** Aufbewahrung hoch (`actions/upload-artifact@v7`). Läuft bei Push auf `main`, bei Pull Requests (Dependabot-Anhebungen von Electron) und von Hand. Bei einem privaten Repository zählen macOS-Minuten mehrfach; dann den Auslöser einschränken. **Unter Linux nicht ausprobierbar.**
- **Erster Lauf** (Commit `716276f`, 4. Oktober 2026, `macos-latest`): alle Schritte grün, darunter der Rauchtest der gepackten App. Die Logs waren nicht lesbar (der Blob-Speicher von GitHub ist im Container gesperrt; umgangen wird nichts). Gelesen wurden nur die Ergebnisse der einzelnen Schritte über die API.
- **Herunterladen und starten:** Ein heruntergeladenes Zip trägt die Quarantäne-Markierung; die App ist nur ad hoc signiert und nicht notarisiert, macOS blockiert sie beim ersten Start. Laut Auftrag gibt es seit macOS 15 kein „Control-Klick → Öffnen“ mehr; der Weg ist: einmal öffnen, dann Systemeinstellungen → Datenschutz & Sicherheit → „Trotzdem öffnen“. **Nicht verifiziert** (`support.apple.com` ist aus dem Container gesperrt); [self-hosting.md](self-hosting.md) markiert die Anleitung als ungeprüft.
- **Mindestversion:** `LSMinimumSystemVersion` 13.0 ist die Vorgabe von Electron 44.5.1 (gelesen im gepackten `Info.plist`), **keine eigene Entscheidung**. Eine eigene Festlegung folgt nach Angabe von Mac-Modell und macOS-Version.
- **`Info.plist`:** Bundle-ID `io.github.kaytm93.pagewise` (öffentlicher GitHub-Name). Anmeldeobjekt, Einstellungen und Berechtigungen hängen daran: **nach Stufe 2 nicht mehr ändern**. Kategorie „Bildung“, `appCopyright` „Pagewise, MIT-Lizenz“, deutsche Zugriffstexte (macOS fragt nie, D-053).
- **Lizenzhinweise:** MIT, BSD und Apache verlangen den Hinweis bei Weitergabe. `scripts/licenses.ts` läuft die **Laufzeitabhängigkeiten** (nie `devDependencies`) ab und schreibt `THIRD-PARTY-LICENSES.txt` (128 Pakete, rund 200 KB). Stand 4. Oktober 2026: 121 × MIT, 2 × OFL-1.1 (Schriften), 2 × ISC, je einmal Apache-2.0, `MPL-2.0 OR Apache-2.0` (DOMPurify, verwendet als Apache-2.0) und `BSD-3-Clause AND Apache-2.0`. Nichts Unfreies (Test). **Offen:** `drizzle-orm` und `remark-math` liefern keine Lizenzdatei; der Urheberhinweis fehlt (im Quelltext der Pakete nachsehen). Die Datei liegt in `Contents/Resources/licenses/`. `Electron-LICENSE` und `LICENSES.chromium.html` liegen **neben** `Pagewise.app`; das Packskript kopiert sie vor der Signatur hinein und bricht ab, wenn sie fehlen.
- **Größe:** `Pagewise.app` für `darwin-arm64` rund 325 MB entpackt; das CI-Artefakt (Zip im Zip) 134.653.167 Byte.
- **Nicht gebaut (Absicht):** `.dmg`, Auto-Update, Homebrew. Stufe 2 siehe D-056.
- **Nicht geprüft** (nur der Maintainer am Mac): alles mit Oberfläche und Sitzung (Fenster, Menü, Symbol, Anmeldeobjekt, Benachrichtigungen, Finder), Gatekeeper, der Start einer selbst gebauten App aus `~/Applications`, `pnpm app:mac` selbst.

## D-056 Verteilung Stufe 2: Entscheidungsvorlage (4. Oktober 2026)

**Nichts davon ist aktiv.** Stufe 1 (D-055) genügt für den eigenen Mac. Stufe 2 lohnt sich erst, wenn die App an andere gehen soll oder Gatekeeper ohne Warnung und Updates gewünscht sind. **Die Entscheidung trifft der Maintainer.** Im Repo ist nichts vorbereitet außer einem Kommentar in `apps/desktop/scripts/package.ts`.

- **Voraussetzungen** (geprüft am 4. Oktober 2026 auf `developer.apple.com/programs/enroll` und in der Electron-Doku `docs/tutorial/code-signing.md`): Apple Developer Program, **99 USD pro Mitgliedsjahr**; Apple-Konto mit Zwei-Faktor-Anmeldung; **volljährig** nach dem Recht der Region (Jüngere melden sich über einen Erziehungsberechtigten an; die Fußnote ist nur sinngemäß gelesen); Klarname. Electron: nur ad hoc signierte Apps „may behave inconsistently“. **Auto-Update über Squirrel.Mac braucht eine signierte App.**
- **Technik** (nicht verifiziert, vor dem Bauen gegen `developer.apple.com` und die Electron-Doku prüfen): Zertifikat „Developer ID Application“, Signatur mit `@electron/osx-sign`, Notarisierung mit `@electron/notarize`, Hardened Runtime mit Entitlements (bei Electron üblich `com.apple.security.cs.allow-jit`). Für `better_sqlite3.node` ist es **bevorzugt**, mit demselben Zertifikat mitzusignieren; `disable-library-validation` wäre schwächer. Reihenfolge: notarisieren, heften (`stapler`), prüfen (`spctl --assess`, `codesign --verify`).
- **Zugangsdaten nur als GitHub-Actions-Secrets** (Zertifikat `.p12` base64, Kennwort, `notarytool`-Zugang). Nie im Repo, in Logs, Job-Daten oder Prozess-Argumenten. Geplant: Zertifikat in eine temporäre Schlüsselbundsammlung des Läufers importieren und am Ende löschen. Der Job läuft nur auf `main` oder Tags, **nie bei Pull Requests von Forks**. Der Secret-Scan bleibt an.
- **DMG:** `hdiutil create` (Bordmittel) oder `create-dmg` (eine Abhängigkeit, Prüfung nach D-035). Notarisiert wird das DMG oder die App darin. **Offen.**
- **Auto-Update:** bleibt Nicht-Ziel. Falls jemals: nur ein Hinweis mit Klick auf die Release-Seite, standardmäßig aus, ohne Telemetrie.
- **Mac App Store** ausgeschlossen (D-050). **Homebrew-Cask:** nur erwähnt; ob er eine notarisierte App verlangt, ist nicht geprüft.
- **Kosten und Aufwand:** 99 USD pro Jahr, ein halber Tag Einrichtung, danach pro Fassung ein Lauf mit Wartezeit der Notarisierung (meist Minuten, nicht verifiziert). Nutzen: keine „nicht verifiziert“-Warnung, Weitergabe ohne Anleitung, Grundlage für Updates.
- **Abbruchkriterium:** Solange Pagewise nur auf dem Mac des Maintainers läuft und dort per `pnpm app:mac` gebaut wird, ist Stufe 2 überflüssig.
