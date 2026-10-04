# Abnahme Phase 1e (Agent-CLI)

Stand: 4. Oktober 2026. Eine Phase gilt erst als abgenommen, wenn die berührten Punkte aus Abschnitt 12 des Pflichtenhefts erfüllt und getestet sind. **Nicht abgenommen**, solange die Prüfungen mit echten Zugängen aus dem letzten Abschnitt fehlen (nur der Maintainer kann sie machen) und die Tests auf iPhone und iPad aus [acceptance-1a.md](acceptance-1a.md) offen sind.

## Kriterien Phase 1e (Abschnitt 14)

| Kriterium | Stand | Beleg |
| --- | --- | --- |
| Ein Chat mit Engine „Agent-CLI“ erzeugt eine PDF- und eine PPTX-Datei im Workspace, beide erscheinen als Download | belegt mit Ersatz-CLI | `routes/chats-agent.test.ts` (PDF und PPTX aus einem Auftrag, Typ und `Content-Disposition`), Lauf im Browser mit erfundenen Daten: Datei als Kachel mit Download. Dass ein echter Agent PDF und PPTX erzeugen kann, hängt von seinen Werkzeugen ab und ist **offen** (Prüfung durch den Maintainer) |
| Zugriff außerhalb des Workspace scheitert (Test) | belegt mit dem echten Programm | `agents/e2e.test.ts` (opt-in): Schreiben außerhalb über Datei-Werkzeug und Shell scheitert, Lesen im Benutzerverzeichnis scheitert, Schreiben im Arbeitsordner klappt |
| Subprozess erhält nur die Umgebungs-Allowlist | belegt | `agents/env.test.ts`, `agents/engine.test.ts` (fremde Schlüssel und `PAGEWISE_*` kommen nicht an) |
| Das GLM-Profil startet `claude` mit der richtigen Umgebung | belegt mit Ersatz, **Echtlauf offen** | `agents/engine.test.ts` (Basis-Adresse, Bearer-Schlüssel, Modellstufen, eigenes Benutzerverzeichnis); gegen Z.ai nicht getestet |
| Ohne installierte CLI klarer Hinweis samt Fallback | belegt | `cli_missing` mit Erklärung und Link zu den Einstellungen, „Mit API-Modell erneut“ (Tests Oberfläche und Server), Anzeige in den Einstellungen mit „Erneut suchen“ |
| Streaming, Abbrechen, Zeit- und Ausgabelimits | belegt | `agents/process.test.ts`, `agents/engine.test.ts`, Abbruch auch im Chat und mit dem echten Programm (Prozessgruppe, SIGINT, SIGTERM, SIGKILL) |
| Löschen von Fach, Chat und Asset entfernt auch die Dateien (Test) | belegt | `routes/chats-agent.test.ts`: Chat, Fach (mit laufendem Agenten) und Untergruppe, „Alles löschen“ (`engine/`, `assets/`, `workspaces/`) |

## Abgleich mit Abschnitt 12

| Punkt | Stand | Beleg und Anmerkung |
| --- | --- | --- |
| 12.2 Secrets nie als Kommandozeilen-Argument | erfüllt | Schlüssel nur in der Umgebung, Auftrag über stdin, System-Prompt über Datei; Tests prüfen Argumente und Prozess-Umgebung |
| 12.2 Keys verlassen den Server nie (Fehler, Jobs, Logs) | erfüllt | Fehler nur als Codes, Aktivität ohne Inhalte; Schlüssel nur im Secret-Speicher |
| 12.4 Prompt-Injection löst keine Aktionen aus; Engine-Schutz | erfüllt für die Engine | Rechte und Sandbox (D-039), Werkzeuge nur Read/Write/Edit/Glob/Grep/Bash im Arbeitsordner, kein Netz, Hooks/Skills/MCP aus. Ausgaben des Programms werden nur als Text weitergegeben |
| 12.5 Umgebungs-Allowlist, Workspace-Isolation, keine Flags zum Überspringen aller Abfragen | erfüllt | `--permission-mode dontAsk` mit Regeln, Sandbox mit `failIfUnavailable`; ein Test prüft, dass kein Überspringen-Flag vorkommt |
| 12.7 Löschen entfernt auch Dateien | erfüllt | siehe oben; **Grenze:** Sitzungen des Claude-Abos liegen im echten Benutzerverzeichnis außerhalb von Pagewise |
| 12.7 Logs ohne Prompts, Antworten, Bildinhalte, Keys | erfüllt | Es gibt weiter keine Logdatei, Fehler enthalten nur Codes |
| 12.6 Was geht an welchen Anbieter | Hinweis in der Doku | Aufträge, Prompt-Schichten und gelesene Dateien gehen an Anthropic beziehungsweise Z.ai ([agent-cli.md](agent-cli.md)) |

## Was nur auf dem Gerät des Maintainers geprüft werden kann

- Der **GLM Coding Plan** mit dem echten Schlüssel: Antwort kommt an, und welche Nachricht Z.ai bei erschöpftem Kontingent liefert (D-039).
- Die **Anmeldung mit dem Claude-Abo** (inklusive möglichem Schlüsselbund-Dialog) und ein Auftrag.
- Ein echter Auftrag, der eine **PDF- und eine PPTX-Datei** erzeugt (je nach Werkzeugen des Agenten).
- Der Pfad des Datenordners (`PAGEWISE_DATA_DIR`) hat höchstens 10 Bestandteile, sonst meldet Pagewise `workspace_too_deep`.

## Offene Punkte

- Linux: Die Sandbox braucht `bubblewrap` und `socat`; hier nicht gemessen.
- Z.ai hat nicht schriftlich bestätigt, dass ein von Pagewise gestartetes Claude Code als „unterstütztes Tool“ gilt (D-011, D-036).
