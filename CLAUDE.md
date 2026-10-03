# CLAUDE.md

Konventionen für die Arbeit an Pagewise (mit Claude Code oder von Hand).

## Harte Regeln

1. **Keine persönlichen Daten im Repo.** Weder Schulen, Lehrkräfte, Stundenpläne, Fächerlisten, echte Prompts, Schulinhalte noch Namen von Personen. Als Autor erscheint nur der öffentliche GitHub-Name.
2. **Keine Secrets im Repo.** Keine API-Keys, Tokens, Passcodes. `.env.example` enthält nur Platzhalter.
3. **Beispiele und Tests nutzen ausschließlich erfundene Daten**, die offensichtlich erfunden sind (z. B. „Beispiel-Lehrkraft“). Fake-Schlüssel in Tests werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
4. **Nutzerdaten liegen im Datenverzeichnis außerhalb des Repos.** Nie `data/`, `uploads/`, `workspaces/` o. Ä. im Repo anlegen.
5. **Nie Flags verwenden, die alle Berechtigungsabfragen überspringen** (z. B. `--dangerously-skip-permissions`), weder im Code noch in Skripten.
6. Fach-Prompts werden nicht erfunden oder vorbelegt. Vorlagen enthalten nur Platzhalter.

## Befehle

```bash
pnpm install      # installiert Abhängigkeiten und richtet den Git-Hook ein
pnpm dev          # Server und Web-Oberfläche mit Neuladen
pnpm start        # Produktionsstart (baut die Oberfläche)
pnpm lint         # Biome (Lint und Format-Prüfung)
pnpm format       # Biome, schreibt Korrekturen
pnpm typecheck    # TypeScript in allen Paketen
pnpm test         # Tests aller Pakete plus Repo-Tests (Scan, Hook)
pnpm scan         # Secret-Scan und Privacy-Check über alle getrackten Dateien
pnpm --filter @pagewise/server db:generate   # neue Migration aus dem Schema erzeugen, danach lesen und einchecken
```

## Aufbau

- `apps/server`: Hono-Server (API, später Worker, Jobs, Provider, Engines)
- `apps/web`: Vite, React, Tailwind v4 (Oberfläche, später PWA)
- `packages/`: gemeinsame Pakete, sobald sie gebraucht werden (z. B. `render` ab Phase 1b)
- `scripts/`: Repo-Werkzeuge (Secret-Scan, Privacy-Check, Hook-Installation)
- `tests/`: Repo-weite Tests (Hook, Scanner)
- `docs/`: Architektur, Entscheidungen, Sicherheit, Self-Hosting
- `config/examples/` und `prompts/`: neutrale Vorlagen

## Arbeitsweise

- Arbeit in Phasen (siehe `docs/architecture.md`). Pro Phase ein lauffähiges Inkrement in kleinen, sauberen Commits.
- Abweichungen und Begründungen kommen in `docs/decisions.md`.
- Zeitabhängiges (Modellnamen, Preise, Versionen, Syntax von Tailscale, OpenRouter, Z.ai, Regeln der Anbieter) vor dem Einbauen gegen aktuelle Quellen prüfen und die Quelle nennen.
- Die UI ist deutsch. Strings gehören in die i18n-Dateien, nicht in Komponenten. Code, Commits und Dateinamen dürfen englisch sein.
- Modell-Ausgaben und importierte Dateien sind nicht vertrauenswürdig: bereinigen, nie `eval`.
- Secrets nie in Logs, Fehlermeldungen, Job-Daten oder Prozess-Argumenten.
- `.gitignore` ignoriert Namen wie `secrets*`, `backups/`, `workspaces/`, `uploads/`, `exports/`, `*.db`, `*.log`. Quelltext darf nicht so heißen, sonst wird er still nicht eingecheckt (D-019).

## Vor jedem Commit

Der Pre-Commit-Hook (`.githooks/pre-commit`) führt den Secret-Scan und den Privacy-Check aus. Er wird beim `pnpm install` aktiviert. Wenn er anschlägt, die Fundstelle entfernen, nicht den Hook umgehen.

Der Privacy-Check liest zusätzlich eine lokale, nicht eingecheckte Liste mit eigenen Suchbegriffen aus `config/privacy-blacklist.local.txt` (ein Begriff oder regulärer Ausdruck pro Zeile, `#` für Kommentare). Wer private Begriffe schützen will, legt diese Datei selbst an.
