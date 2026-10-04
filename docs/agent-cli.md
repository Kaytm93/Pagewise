# Agent-CLI-Adapter

Stand: 4. Oktober 2026, Phase 1e gebaut. Alle Messwerte stammen von Claude Code 2.1.220 auf macOS. Was nur mit einem echten Konto zu prüfen ist (GLM Coding Plan, Claude-Abo), steht unter „Was nur du prüfen kannst“.

## Idee

Pagewise startet das Programm `claude` (Claude Code) auf deinem Rechner als Unterprozess in einem eigenen Arbeitsordner je Fach oder Untergruppe. Der Agent liest und schreibt dort Dateien (PDF, PPTX, Bilder, Text), Pagewise übernimmt neue Dateien als Downloads im Chat. Weitere Programme (OpenCode, Codex, Gemini CLI) kämen später als zusätzliche Adapter. Das Programm bringt Pagewise nicht mit: Du installierst es selbst und meldest dich selbst an.

## Wie ein Chat zum Agenten kommt

Unter Einstellungen, „Agent-CLI“, legst du Zugänge an (siehe unten). Danach wählst du im Dialog „Modell“ eines Fachs oder Chats statt eines Modells einen Zugang. Es gilt der Reihenfolge nach: Zugang des Chats, Modell des Chats, Zugang des Fachs, Modell des Fachs, Standardmodell. Ein Chat hat nie beides, wer das eine wählt, hebt das andere auf.

- **Sitzung.** Der erste Auftrag startet eine neue Sitzung, jeder weitere setzt sie fort (`--resume`). Der Agent kennt den Verlauf dann aus seiner eigenen Sitzung. Ist sie weg (anderer Zugang, gelöschter Ordner), beginnt Pagewise neu und legt den bisherigen Verlauf dem Auftrag als Text bei.
- **Ein Agent je Arbeitsordner.** Zwei Chats desselben Fachs (und derselben Untergruppe) teilen sich einen Ordner. Damit sich erzeugte Dateien nicht vermischen, arbeitet dort immer nur ein Agent, ein zweiter Auftrag wartet mit der Meldung „In diesem Fach arbeitet schon ein Agent“. Insgesamt laufen höchstens zwei Agenten gleichzeitig.
- **Rückfall.** Schlägt der Agent fehl, bietet die Antwort „Erneut versuchen“ und, wenn ein Modell eines Anbieters eingerichtet ist, „Mit API-Modell erneut“. Das gilt nur für diesen Versuch, nie automatisch: Ein Auftrag geht nicht ungefragt an einen anderen Anbieter.
- **Anzeige.** Während der Arbeit stehen die neuesten Schritte (Werkzeug und Ziel, zum Beispiel „Geschrieben: bericht.pdf“) unter der Antwort, danach eingeklappt als „Was der Agent getan hat“. Es werden nie Inhalte der Werkzeuge gezeigt oder gespeichert.

## Zugänge

| Art | Anmeldung | Umgebung des Programms |
| --- | --- | --- |
| Claude-Abo | Du meldest dich selbst in der CLI an. Pagewise fasst keine Tokens an und speichert nichts. | echtes Benutzerverzeichnis, kein eigener Schlüssel |
| GLM Coding Plan | Schlüssel im Secret-Speicher (`engine.<id>.token`) | `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`, `ANTHROPIC_AUTH_TOKEN` (Bearer), alle drei Modellstufen auf `glm-5.3-flash` oder deine Wahl, `API_TIMEOUT_MS=3000000`, eigenes Benutzerverzeichnis |
| Anthropic-API-Schlüssel | Schlüssel im Secret-Speicher | `ANTHROPIC_API_KEY`, eigenes Benutzerverzeichnis |

Das GLM-Profil ist nach der Entscheidung des Kontoinhabers zulässig (D-011), mit Auflagen: nur Konto und Schlüssel des Instanz-Besitzers (nie teilen), nur die unveränderte Binary, Warnhinweis bleibt. Die Regeln von Anthropic und Z.ai wurden am 3. Oktober 2026 erneut gelesen und waren unverändert. Rest-Risiko: Ob ein von Pagewise gestartetes Claude Code als „unterstütztes Tool“ gilt, hat Z.ai nicht schriftlich bestätigt (D-036).

Zugänge mit Schlüssel bekommen ein eigenes Benutzerverzeichnis unter `<Datenverzeichnis>/engine/<ID>/home` (mit `CLAUDE_CONFIG_DIR`), damit ihre Sitzungen getrennt von deinem eigenen Claude Code liegen und nicht mit dessen Anmeldung kollidieren. Das Abo-Profil muss dein echtes Benutzerverzeichnis benutzen, weil dort deine Anmeldung liegt.

## Aufruf (gemessen)

```text
claude -p --output-format stream-json --verbose --include-partial-messages
  --permission-mode dontAsk --safe-mode --setting-sources local --settings <Datei>
  --tools Read,Write,Edit,Glob,Grep,Bash --disable-slash-commands
  --append-system-prompt-file <Datei> --max-turns 40 [--model M] [--resume <Sitzung>]
```

- Der Auftrag kommt über stdin. Das System-Prompt kommt aus einer Datei (bei `--append-system-prompt` stünde der Text in der Prozessliste) und muss bei jedem Lauf neu übergeben werden, auch bei `--resume`. Beide Dateien liegen mit Rechten 600 in einem Ordner unter `<Datenverzeichnis>/engine/runs/` und werden nach dem Lauf gelöscht.
- **Nie** `--dangerously-skip-permissions` oder etwas Ähnliches. Secrets nie als Argument, nur über die Umgebung.
- `--safe-mode` und `--setting-sources local` sind Pflicht: ohne sie laufen Hooks aus dem Arbeitsordner und aus deinem Benutzerverzeichnis mit vollen Rechten, ebenso `CLAUDE.md`, Skills, Plugins und MCP-Server. Mit beiden Schaltern sind sie aus, die Rechte und die Sandbox aus `--settings` gelten weiter (gemessen mit Köderdateien).
- `--bare` ginge nur mit API-Schlüssel (liest keine OAuth-Anmeldung) und wird deshalb nicht genutzt.

## Rechte und Sandbox

Zwei Schichten, beide sind nötig: Die Sandbox schützt nur Shell-Befehle, die Datei-Werkzeuge folgen den Berechtigungsregeln.

- **Berechtigungen.** `Edit(//<Arbeitsordner>/**)` ist erlaubt, `Edit` auf `.claude/**`, `CLAUDE.md` und `.mcp.json` im Arbeitsordner ist gesperrt. Alles andere fragt nach, und weil es keine Rückfrage gibt (`dontAsk`), scheitert es. Die Zahl der verweigerten Zugriffe steht im Ergebnis, nie ihr Inhalt.
- **Sandbox.** `enabled`, `failIfUnavailable: true` (keine stille Rückfallstufe ohne Sandbox), `allowUnsandboxedCommands: false`, `autoAllowBashIfSandboxed: true`. Lesen gesperrt für dein echtes Benutzerverzeichnis, das Datenverzeichnis und `/Users`, `/home`, `/Volumes`, `/mnt`, `/media`; freigegeben sind nur der Arbeitsordner und die Ordner aus dem `PATH`, die unter deinem Benutzerverzeichnis liegen (damit installierte Werkzeuge starten). Netz: `allowedDomains: []`.
- **Pfade.** Alle Pfade in den Regeln beginnen mit `//` (absolut) und sind aufgelöst: ein Symlink im Weg (auf macOS ist `/var` ein Verweis auf `/private/var`) würde sonst die Regel verfehlen. Pfade mit Glob-Zeichen werden abgelehnt.
- **Umgebung.** Der Prozess bekommt nur eine Allowlist an Variablen des Servers (`PATH` samt Ordner des Programms, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `TMPDIR`, `USER`, `LOGNAME`) plus die Variablen des Zugangs (siehe Tabelle) und feste Schalter: `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_AUTOUPDATER=1`, `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_MAX_RETRIES=2`. Schlüssel und Passwörter des Servers (`ANTHROPIC_API_KEY`, `PAGEWISE_*`, Anbieter-Schlüssel) kommen nie an.
- **Abbruch.** Gestuft: SIGINT (das Programm beendet den Zug sauber), nach vier Sekunden SIGTERM, dann SIGKILL, jeweils an die ganze Prozessgruppe. Auch Zeitüberschreitung, zu große Ausgabe (64 MiB, höchstens 8 MiB je Zeile) und Abbruch durch dich laufen so.

## Arbeitsordner und Pfadtiefe

Der Arbeitsordner liegt flach unter `<Datenverzeichnis>/workspaces/<Fach-ID>` beziehungsweise `<Untergruppen-ID>` (IDs, nie Namen). Das ist Absicht: Die Sandbox erzeugt für tiefe Pfade ein riesiges Profil. Gemessen: Bis 10 Pfadbestandteile startet jeder Befehl, ab 11 scheitern Befehle mit „E2BIG: the command line plus environment exceed the OS exec argument limit“ (das Profil ist dann über 1 MB groß). Pagewise prüft das vor dem Start und meldet `workspace_too_deep`, statt den Agenten ohne funktionierende Befehle laufen zu lassen. Der Standardpfad hat auf macOS 7 Bestandteile. Wer `PAGEWISE_DATA_DIR` auf einen tief verschachtelten Ort legt, sollte ihn näher an die Wurzel verlegen.

## Dateien

Neue und geänderte Dateien im Arbeitsordner werden nach dem Lauf als Downloads übernommen: PDF, PPTX, DOCX, XLSX, Bilder (PNG, JPG, GIF, WEBP, SVG) und Text (TXT, MD, CSV). Die Art bestimmt Pagewise nach der Endung, nie der Agent. Höchstens 25 MiB und 20 Dateien je Lauf, keine Verknüpfungen, nichts, was aus dem Ordner herausführt. Der Name wird bereinigt, die Datei nur als Anhang ausgeliefert (`Content-Disposition: attachment`, `nosniff`, strenge CSP). Dateien in Unterordnern zählen mit, versteckte Dateien nicht.

Löscht du einen Chat, ein Fach oder eine Untergruppe, verschwinden die Dateien und der Arbeitsordner mit (laufende Agenten werden vorher beendet). „Alles löschen“ entfernt zusätzlich `engine/`, wo die Sitzungen der Zugänge mit Schlüssel liegen.

**Grenze beim Claude-Abo:** Das Programm legt seine Sitzungen im echten Benutzerverzeichnis ab (`~/.claude/projects/…`), außerhalb von Pagewise. Sie enthalten den Verlauf der Aufträge. Pagewise löscht dort nichts; wer sie entfernen will, tut das selbst.

## Fehler

Die Oberfläche zeigt nie Text von Anbieter oder Programm, nur Codes mit eigenen Erklärungen.

| Code | Bedeutung |
| --- | --- |
| `cli_missing`, `cli_broken` | `claude` fehlt oder startet nicht. In den Einstellungen steht die Erkennung samt übersprungener Kandidaten. |
| `profile_missing`, `no_key` | Zugang gelöscht oder ohne Schlüssel. |
| `sandbox_unavailable` | Die Sandbox startet nicht (unter Linux fehlen eventuell `bubblewrap` und `socat`). |
| `workspace_too_deep` | Der Arbeitsordner hat zu viele Pfadbestandteile (siehe oben). |
| `auth_failed` | Abo nicht angemeldet beziehungsweise Schlüssel abgelehnt (Text je nach Art). |
| `rate_limited` | HTTP 429. Beim Abo ist das Nutzungslimit erreicht, bei Z.ai Anfragenrate oder Kontingent. |
| `no_package`, `quota_exhausted`, `plan_expired`, `model_not_allowed`, `model_not_found`, `content_blocked` | Fehlernummern von Z.ai (1113, 1308/1310, 1309, 1311, 1211, 1301), siehe unten. |
| `agent_failed`, `agent_limit`, `agent_timeout` | Kein Ergebnis, Limit von 40 Arbeitsschritten erreicht, Höchstdauer des Zugangs überschritten. |

**Zu den Fehlernummern von Z.ai.** Das Programm gibt vom Fehlerrumpf nur die Nachricht weiter („API Error: Request rejected (429) · …“), nicht den Code. Pagewise erkennt die Nummer, wenn sie in der Nachricht steht, sonst bleibt es beim Status. Bei Z.ai heißt 429 deshalb oft nur `rate_limited`; der Text für den Coding Plan nennt beides, Anfragenrate und Kontingent. Mit einem echten Plan bleibt zu prüfen, welche Nachricht Z.ai liefert (Rückfrage an den Maintainer).

## Betrieb und Grenzen

- Unterstützt sind macOS und Linux. Die Sandbox ist unter macOS eingebaut (Seatbelt), unter Linux braucht sie `bubblewrap` und `socat` (laut Dokumentation, hier nicht gemessen). Windows ist nicht vorgesehen.
- Das Abo-Profil kann auf macOS einen Schlüsselbund-Dialog auslösen, den nur du am Rechner bestätigen kannst. Nutzungslimits deines Abos gelten auch für Pagewise-Aufträge.
- Zeit- und Mengenlimits: Höchstdauer je Zugang (Voreinstellung 20 Minuten, höchstens 120), 40 Arbeitsschritte, zwei Agenten gleichzeitig.
- Was das Programm liest (Dateien im Arbeitsordner, dein Auftrag, die Prompt-Schichten des Fachs), geht an den Anbieter des Zugangs (Anthropic beziehungsweise Z.ai).

## Tests

- Unit: Umgebung, Erkennung, Prozess-Läufer (Abbruch, Zeitlimit, Prozessgruppe), Strom-Parser, Einstellungen, Engine (Argumente, Umgebung, Aufräumen), Dateiübernahme, Profile, Aufräumen.
- Integration (Ersatz-CLI `agents/testing/fake-claude.mjs`): Chat über Routen mit Sitzung und Rückfall, Dateien als Download (PDF und PPTX), Fehlercodes, Abbruch, ein Agent je Ordner, Löschen von Chat, Fach und Untergruppe, „Alles löschen“.
- Ende zu Ende mit dem **echten** Programm gegen einen Ersatz der Anthropic-API (`agents/e2e.test.ts`, nur mit `PAGEWISE_E2E_CLAUDE=<Pfad zu claude>`, in der CI übersprungen): Datei im Arbeitsordner ja, außerhalb nein (Datei-Werkzeug und Shell), Lesen im Benutzerverzeichnis verweigert, Sitzung wird fortgesetzt, Fehler werden Codes, Abbruch.

```bash
PAGEWISE_E2E_CLAUDE=$(which claude) pnpm --filter @pagewise/server exec vitest run src/agents/e2e.test.ts
```

## Was nur du prüfen kannst

- Der GLM Coding Plan mit deinem echten Schlüssel (Z.ai bestätigt das Verhalten nicht schriftlich, D-011).
- Die Anmeldung mit dem Claude-Abo, inklusive möglichem Schlüsselbund-Dialog.
- Ein echter Auftrag, der eine PDF- und eine PPTX-Datei erzeugt (hängt von den Werkzeugen des Agenten auf deinem Rechner ab, etwa Python-Bibliotheken).

## Verbindliche Regeln

- Nur die unveränderte Binary starten. Keine Anmeldemethode entfernen oder umgehen.
- Die Anmeldung mit dem Claude-Abo macht ausschließlich der Nutzer selbst in der CLI. Die App liest, speichert, kopiert oder vermittelt keine Claude.ai-Tokens oder Sitzungsdaten.
- Abo-Profile laufen nur lokal auf dem Rechner des Kontoinhabers und nur für dessen eigene Nutzung, nicht im Cloud-Fallback, nicht für andere.
- „Claude Code“ und „Anthropic“ erscheinen nicht im Produktnamen oder Logo, nur als Hinweis im Text.
- Wenn Regeln unklar oder geändert sind: stoppen und nachfragen.

Quellen: <https://code.claude.com/docs/en/legal-and-compliance>, <https://docs.z.ai/devpack/usage-policy>, <https://docs.z.ai/legal-agreement/subscription-terms>, <https://docs.z.ai/devpack/tool/claude>, <https://docs.z.ai/api-reference/api-code>
