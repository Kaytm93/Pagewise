# Agent-CLI-Adapter

Stand: Entwurf für Phase 1e. Noch nicht umgesetzt. Alle Flags unten stammen aus der Doku vom 3. Oktober 2026 und werden vor dem Bauen erneut geprüft.

## Idee

Die App startet ein lokales Coding-Agent-Programm als Subprozess in einem eigenen Workspace-Ordner. Der Agent erzeugt Dateien (PDF, PPTX, Bilder), die App übernimmt sie als Assets. Pflicht-Engine ist Claude Code (`claude`), weitere Programme (OpenCode, Codex, Gemini CLI) kommen später als zusätzliche Adapter.

## Engine-Interface

`start(job)`, ein Strom von Ereignissen (Text, Werkzeug-Aktivität, Dateien), `cancel`, Ergebnis-Dateien. Zeit- und Ausgabelimits pro Lauf. Ohne gefundene CLI zeigt die App einen klaren Hinweis und bietet einen API-Provider als Ausweg an.

## Profile

| Profil | Auth | Umgebung |
| --- | --- | --- |
| Claude-Abo | Du meldest dich selbst in der CLI an. Die App fasst keine Tokens an. | keine Zusatzvariablen |
| GLM Coding Plan | Token aus der Secrets-Konfiguration | `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`, `ANTHROPIC_AUTH_TOKEN`, `API_TIMEOUT_MS`, Modell-Mapping auf `glm-5.3-flash` |
| Anthropic-API-Key | Key aus der Secrets-Konfiguration | `ANTHROPIC_API_KEY` |

Das GLM-Profil bleibt deaktiviert, bis die offene Frage aus [decisions.md](decisions.md) (D-011) geklärt ist.

## Aufruf (Entwurf)

```bash
claude -p "<Auftrag>" \
  --output-format stream-json --verbose --include-partial-messages \
  --allowedTools "<Whitelist>" \
  --permission-mode dontAsk
```

- Secrets nie als Argument, nur über Umgebung oder Stdin.
- Der Prozess bekommt nur eine Allowlist von Umgebungsvariablen.
- **Niemals** Flags, die alle Berechtigungsabfragen überspringen.
- `--bare` nur für Profile mit API-Key. Das Abo-Profil kann es nicht nutzen, weil `--bare` keine OAuth-Anmeldung liest.

## Workspace und Isolation

Ein Ordner pro Fach oder Untergruppe unter `<Datenverzeichnis>/workspaces/…`. Das Arbeitsverzeichnis des Prozesses ist dieser Ordner. Die Sandbox von Claude Code schützt nur Shell-Befehle, die Datei-Werkzeuge folgen den Berechtigungsregeln. Deshalb braucht es beides:

1. Sandbox-Einstellungen: `sandbox.enabled`, `failIfUnavailable: true`, `allowUnsandboxedCommands: false`, Lesen im Home-Verzeichnis sperren und nur den Workspace freigeben
2. Berechtigungsregeln, die Read, Edit und Write auf den Workspace begrenzen
3. Docker zusätzlich, wenn praktikabel

Ein Test beweist, dass Zugriffe auf Secrets, Datenbank und andere Workspaces scheitern, über Shell **und** Datei-Werkzeuge.

## Verbindliche Regeln

- Nur die unveränderte Binary starten. Keine Anmeldemethode entfernen oder umgehen.
- Die Anmeldung mit dem Claude-Abo macht ausschließlich der Nutzer selbst in der CLI. Die App liest, speichert, kopiert oder vermittelt keine Claude.ai-Tokens oder Sitzungsdaten.
- Abo-Profile laufen nur lokal auf dem Rechner des Kontoinhabers und nur für dessen eigene Nutzung, nicht im Cloud-Fallback, nicht für andere.
- „Claude Code“ und „Anthropic“ erscheinen nicht im Produktnamen oder Logo, nur als Hinweis im Text.
- Wenn Regeln unklar oder geändert sind: stoppen und nachfragen.

Quellen: <https://code.claude.com/docs/en/legal-and-compliance>, <https://docs.z.ai/devpack/usage-policy>, <https://docs.z.ai/legal-agreement/subscription-terms>
