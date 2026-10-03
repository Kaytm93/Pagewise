# Architektur

Stand: Phase 1a läuft (Datenbank, Migrationen, Storage und Secret-Speicher sind gebaut). Der Rest ab Phase 1a ist Plan und kann sich beim Bauen ändern, Abweichungen stehen in [decisions.md](decisions.md).

## Überblick

```
iPhone / iPad / Mac (Browser, PWA)
        │  HTTPS im Tailnet (Tailscale Serve)
        ▼
 127.0.0.1:3000  ── apps/server (Hono) ───────────────────────────────┐
                      │  API, SSE-Streaming, Auslieferung von apps/web │
                      │                                                │
                      ├── Provider-Registry (API-Anbieter)             │
                      ├── Engine-Adapter (Agent-CLI, Subprozesse)      │
                      ├── Job-Queue (SQLite) ◄── HTTP-Job-API ── Worker│
                      └── Storage-Abstraktion                          │
                              │                                        │
                              ▼                                        │
              Datenverzeichnis (außerhalb des Repos) ◄─────────────────┘
              SQLite, Assets, Workspaces, Logs, Secrets, Backups
```

In Phase 1 laufen Server und Worker als ein Prozess. Der Worker holt Aufträge trotzdem über eine HTTP-Job-API und nicht über direkte Funktionsaufrufe, damit er später an anderer Stelle laufen kann (Phase 2).

## Datenmodell (Vorschlag)

`Profile`, `Subject`, `Group` (Untergruppe), `Chat`, `Message`, `Note` (Hefteintrag), `Asset`, `Job`, `ProviderConfig`, `EngineProfile`. Umgesetzt sind bisher `profile`, `subjects` und `subject_groups` (D-017), der Rest kommt mit den Inkrementen, die ihn brauchen. Navigation: Fach → Untergruppe → Chats oder Hefteinträge, zusätzlich je Fach eine Ansicht „Allgemein“ ohne Untergruppe. Chats bleiben in ihrem Fach, es gibt keine fachübergreifende Chatliste. Secrets liegen nie im Klartext in der Datenbank.

## Prompt-Schichten

In dieser Reihenfolge zusammengesetzt:

0. Technische Ebene (im Code, immer aktiv): erklärt dem Modell die Block-Syntax der Hefteinträge
1. Allgemeiner Schul-Prompt (vom Nutzer)
2. Fach-Prompt (vom Nutzer)
3. Untergruppen-Zusatz (optional, vom Nutzer)

Variablen wie `{{bundesland}}`, `{{schulform}}`, `{{jahrgangsstufe}}`, `{{fach}}` und `{{untergruppe}}` kommen aus dem lokalen Profil. Nichts ist vorbelegt.

## Verzeichnisse im Repo

| Pfad | Inhalt |
| --- | --- |
| `apps/server` | Server, Konfiguration, Start-Check des Datenverzeichnisses, Datenbank (`src/db`), Storage und Secret-Speicher (`src/storage`) |
| `apps/server/drizzle` | SQL-Migrationen der Datenbank |
| `apps/web` | Oberfläche, Design-Tokens, i18n |
| `scripts` | Secret-Scan, Privacy-Check, Hook-Installation |
| `tests` | Repo-weite Tests |
| `config/examples`, `prompts` | neutrale Vorlagen |
| `docs` | Dokumentation |

## Phasen

| Phase | Inhalt |
| --- | --- |
| 0 Fundament | Repo, Tokens, Health-Endpoint, Sicherheitsbasis |
| 1a Kern | Onboarding, Fächer, Chats, Prompt-Schichten, Secrets, Provider, Streaming, PWA |
| 1b Hefteinträge | Editor, Blöcke (Formeln, Graph, Molekül, Noten), Bereinigung |
| 1c Bildeingabe | Foto, Verkleinern, EXIF entfernen, Tafelbild → Hefteintrag |
| 1d Dateien | PDF- und PPTX-Export, Job-Status |
| 1e Agent-CLI | Claude-Code-Engine, Profile, Workspace, Streaming |
| 2 | Cloud-Fallback und Backup (nicht jetzt bauen, aber nicht verbauen) |
| 3 | Agent-Modus für API-Modelle (Docker-Sandbox) |
