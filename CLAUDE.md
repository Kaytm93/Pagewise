# CLAUDE.md

Konventionen für die Arbeit an Pagewise (mit Claude Code oder von Hand).

## Harte Regeln

1. **Keine persönlichen Daten im Repo.** Weder Schulen, Lehrkräfte, Stundenpläne, Fächerlisten, echte Prompts, Schulinhalte noch Namen von Personen. Als Autor erscheint nur der öffentliche GitHub-Name.
2. **Keine Secrets im Repo.** Keine API-Keys, Tokens, Passcodes. `.env.example` enthält nur Platzhalter.
3. **Beispiele und Tests nutzen ausschließlich erfundene Daten**, die offensichtlich erfunden sind (z. B. „Beispiel-Lehrkraft“). Fake-Schlüssel in Tests werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
4. **Nutzerdaten liegen im Datenverzeichnis außerhalb des Repos.** Nie `data/`, `uploads/`, `workspaces/` o. Ä. im Repo anlegen.
5. **Nie Flags verwenden, die alle Berechtigungsabfragen überspringen** (z. B. `--dangerously-skip-permissions`), weder im Code noch in Skripten.
6. Prompts von Nutzern (Fach-Prompts, allgemeiner Schul-Prompt) gehören nie ins Repo, Vorlagen dafür enthalten nur Platzhalter. Ausnahme seit D-034: neutrale **Standard-Prompts je Fach**, die für alle Nutzer gleich sind, standardmäßig gelten und in der App bearbeitet werden können. Sie enthalten keine personenbezogenen Daten, Schulnamen, Lehrkräfte, Bundesland- oder Lehrplanangaben.

## Befehle

```bash
pnpm install      # installiert Abhängigkeiten und richtet den Git-Hook ein
pnpm dev          # Server und Web-Oberfläche mit Neuladen
pnpm start        # Produktionsstart (baut die Oberfläche)
pnpm lint         # Biome (Lint und Format-Prüfung)
pnpm format       # Biome, schreibt Korrekturen
pnpm typecheck    # TypeScript in allen Paketen
pnpm test         # Tests aller Pakete plus Repo-Tests (Scan, Hook)
pnpm app:mac      # baut Pagewise.app für diesen Mac und installiert sie nach ~/Applications (nur auf macOS)
pnpm scan         # Secret-Scan und Privacy-Check über alle getrackten Dateien
pnpm --filter @pagewise/desktop start      # Mac-Hülle im Entwicklungsmodus (Electron wird bei Bedarf geladen)
pnpm --filter @pagewise/desktop smoke      # Rauchtest der Hülle (ohne Fenster)
pnpm --filter @pagewise/desktop package    # packt Pagewise.app (--platform darwin --arch arm64|x64)
pnpm --filter @pagewise/server db:generate   # neue Migration aus dem Schema erzeugen, danach lesen und einchecken
pnpm --filter @pagewise/server reset-passcode   # Passcode vergessen: entfernt Passcode und Sitzungen, Daten bleiben
```

## Aufbau

- `apps/server`: Hono-Server (API, später Worker, Jobs, Provider, Engines)
- `apps/desktop`: Mac-App (Electron-Hülle: Fenster, Menü, Menüleiste, Server-Überwacher, Tailscale-Modul, Packen), siehe D-050 bis D-056 und [docs/acceptance-mac.md](docs/acceptance-mac.md)
- `apps/web`: Vite, React, Tailwind v4 (Oberfläche, später PWA)
- `packages/render`: gemeinsamer Kern für Hefteinträge (Blöcke prüfen, Graph, Moleküle, Formeln, Noten, Bereinigung), siehe D-046 bis D-048; weitere Pakete erst, wenn sie gebraucht werden
- `scripts/`: Repo-Werkzeuge (Secret-Scan, Privacy-Check, Hook-Installation)
- `tests/`: Repo-weite Tests (Hook, Scanner)
- `docs/`: Architektur, Entscheidungen, Sicherheit, Self-Hosting
- `config/` (`subject-catalog.json`: Katalog der Fachvorlagen, `examples/`: Beispieldatei) und `prompts/` (`defaults/`: Standard-Prompts je Fach, Platzhalter): neutrale Vorlagen

## Arbeitsweise

- Arbeit in Phasen (siehe `docs/architecture.md`). Pro Phase ein lauffähiges Inkrement in kleinen, sauberen Commits.
- Abweichungen und Begründungen kommen in `docs/decisions.md`.
- Zeitabhängiges (Modellnamen, Preise, Versionen, Syntax von Tailscale, OpenRouter, Z.ai, Regeln der Anbieter) vor dem Einbauen gegen aktuelle Quellen prüfen und die Quelle nennen.
- Die UI ist deutsch. Strings gehören in die i18n-Dateien, nicht in Komponenten. Code, Commits und Dateinamen dürfen englisch sein.
- Modell-Ausgaben und importierte Dateien sind nicht vertrauenswürdig: bereinigen, nie `eval`.
- Secrets nie in Logs, Fehlermeldungen, Job-Daten oder Prozess-Argumenten.
- Bibliotheken, die SVG oder HTML erzeugen (KaTeX, abcjs, SmilesDrawer), laufen nur über `packages/render` und die Bereinigung dort, nie direkt in Komponenten. Kein `eval`, kein `new Function`, auch nicht indirekt (zod prüft das beim Start: im Browser-Pfad der Blöcke nicht verwenden), D-047 und D-048.
- Mac-Hülle (`apps/desktop`): Fensteroptionen sind per Test festgenagelt (`contextIsolation`, `sandbox`, kein Node, Hauptfenster ohne Preload); Hüllen-Fenster nur mit festen Preload-Funktionen und IPC mit geprüftem Sender; **Status und Steuerung der App nie über HTTP, nur IPC**; Server-Unterprozess nur mit Allowlist-Umgebung und leerer Argumentliste; Tailscale nur per `execFile` ohne Shell, **nie `tailscale funnel`**. Echte Electron-Läufe gibt es nur unter Xvfb (`xvfb-run`) und nicht als Root ohne `--no-sandbox`; macOS-Dinge prüft nur Kay (`docs/acceptance-mac.md`, zwei Spalten „Agent getestet“ und „Kay prüft“).
- Die CSP erlaubt keine Inline-Styles: im Web-Code nie `style={…}` verwenden, nur Klassen (D-023). Dynamische Werte setzt das Skript über das CSSOM (`element.style.setProperty('--idx', …)`).
- Gestaltung (drei Richtungen „Raum“, „Lagen“, „Atelier“, wählbar in den Einstellungen, D-043 und D-045): Farben und Bewegung nur über die Tokens in `styles/tokens.css` und `styles/motion.css`, nie feste Werte. Alles Bewegte hängt an `--m`/`--t-*` (Effektstufen), animiert wird nur `transform` und `opacity`. Neue Bildschirme nutzen die gemeinsamen Klassen (`lg-*`), die Richtungen überschreiben sie in `raum.css` und `atelier.css`. Regeln und Aufbau stehen in [docs/design.md](docs/design.md).
- `.gitignore` ignoriert Namen wie `secrets*`, `backups/`, `workspaces/`, `uploads/`, `exports/`, `*.db`, `*.log`. Quelltext darf nicht so heißen, sonst wird er still nicht eingecheckt (D-019).

## Vor jedem Commit

Der Pre-Commit-Hook (`.githooks/pre-commit`) führt den Secret-Scan und den Privacy-Check aus. Er wird beim `pnpm install` aktiviert. Wenn er anschlägt, die Fundstelle entfernen, nicht den Hook umgehen.

Der Privacy-Check liest zusätzlich eine lokale, nicht eingecheckte Liste mit eigenen Suchbegriffen aus `config/privacy-blacklist.local.txt` (ein Begriff oder regulärer Ausdruck pro Zeile, `#` für Kommentare). Wer private Begriffe schützen will, legt diese Datei selbst an.
