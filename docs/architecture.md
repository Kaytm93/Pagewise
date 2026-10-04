# Architektur

Stand: Phase 1a läuft. Gebaut sind Datenbank, Migrationen, Storage, Secret-Speicher, Anmeldung, Profil, Fächer und Untergruppen, Prompt-Schichten und die Provider-Registry (jeweils API und Oberfläche) sowie das Onboarding. Der Chat mit Streaming und die PWA (Manifest, Service Worker, Icons) sind gebaut. Noch offen in 1a: Anleitung für Tailscale Serve und die Abnahme. Der Rest ab Phase 1a ist Plan und kann sich beim Bauen ändern, Abweichungen stehen in [decisions.md](decisions.md).

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

`Profile`, `Subject`, `Group` (Untergruppe), `Chat`, `Message`, `Note` (Hefteintrag), `Asset`, `Job`, `ProviderConfig`, `EngineProfile`. Umgesetzt sind bisher `profile`, `subjects` (mit `kind` und `template_key`, D-038) und `subject_groups` (D-017), `providers` und `settings` (D-026) sowie `chats` und `messages` (D-027), der Rest kommt mit den Inkrementen, die ihn brauchen. Navigation: Fach → Untergruppe → Chats oder Hefteinträge, zusätzlich je Fach eine Ansicht „Allgemein“ ohne Untergruppe. Chats bleiben in ihrem Fach, es gibt keine fachübergreifende Chatliste. Secrets liegen nie im Klartext in der Datenbank.

## Chat

Ein Chat gehört zu einem Fach und optional zu einer Untergruppe und bleibt dort. Jede Antwort läuft im Server als eigener Vorgang (`apps/server/src/chats/generation.ts`), unabhängig von der Verbindung des Browsers, und wird als Strom (Server-Sent Events) ausgeliefert. Reißt die Verbindung ab, hängt sich die Oberfläche wieder an und übernimmt den Stand des Servers (`snapshot`). Die Modellwahl folgt der Reihenfolge Chat, Fach, Standardmodell, bei Fehlern greift die Kette der Ausweichmodelle, solange noch kein Text da ist. Details: D-027 (Server) und D-028 (Oberfläche).

```
Browser ── POST /api/chats/:id/messages ──► ChatService.send ──► Generation (läuft weiter, auch ohne Browser)
   ▲  SSE: start, snapshot, delta …                │                     │
   │                                               │                     ├─► ProviderService.chain (Modell, Ausweichmodelle)
   └── GET /api/chats/:id/generation (anhängen) ◄──┘                     └─► messages (Zwischenstand alle 2 s, am Ende gespeichert)
```

## Prompt-Schichten

In dieser Reihenfolge zusammengesetzt:

0. Technische Ebene (im Code, immer aktiv): erklärt dem Modell die Block-Syntax der Hefteinträge
1. Allgemeiner Schul-Prompt (vom Nutzer)
2. Fach-Prompt: eigener Text des Nutzers, sonst der mitgelieferte **Standardtext** des Fachs (D-034)
3. Untergruppen-Zusatz (optional, vom Nutzer)

Variablen wie `{{bundesland}}`, `{{schulform}}`, `{{jahrgangsstufe}}`, `{{fach}}` und `{{untergruppe}}` kommen aus dem lokalen Profil. Schicht 1 und 3 sind nie vorbelegt. Die Standardtexte liegen als neutrale Markdown-Dateien in `prompts/defaults/` und gelten für alle Nutzer gleich, solange nichts Eigenes eingetragen ist. Umgesetzt: `apps/server/src/prompts`, Details und Grenzen in [decisions.md](decisions.md), D-025 und D-034.

## Fächer, Katalog und das Fach „Standard“

Fächer entstehen aus einem Katalog neutraler Vorlagen (`config/subject-catalog.json`, D-037) oder von Hand. Daneben gibt es genau ein eingebautes Fach „Standard“ für den fachunabhängigen Chat, erreichbar über den Namen „Pagewise“ (D-038). Es ist nicht löschbar, hat Untergruppen, Modell und Prompt wie jedes Fach und wird nach „Alles löschen“ neu angelegt.

## Verzeichnisse im Repo

| Pfad | Inhalt |
| --- | --- |
| `apps/server` | Server, Konfiguration, Start-Check des Datenverzeichnisses, Datenbank (`src/db`), Storage und Secret-Speicher (`src/storage`), Prompt-Schichten (`src/prompts`), Anbieter-Clients und -Verwaltung (`src/providers`), Chats und Antworten im Strom (`src/chats`) |
| `apps/server/drizzle` | SQL-Migrationen der Datenbank |
| `apps/web` | Oberfläche (Chat unter `src/screens/chat`), Design-Tokens, i18n |
| `scripts` | Secret-Scan, Privacy-Check, Hook-Installation |
| `tests` | Repo-weite Tests |
| `config` | `subject-catalog.json` (Katalog der Fachvorlagen), `examples/` (Beispieldatei für den Import) |
| `prompts` | `defaults/` (Standard-Prompts je Fach), Platzhalter für eigene Prompts |
| `docs` | Dokumentation |

## Phasen

| Phase | Inhalt |
| --- | --- |
| 0 Fundament | Repo, Tokens, Health-Endpoint, Sicherheitsbasis |
| 1a Kern | Onboarding, Fächer, Chats, Prompt-Schichten, Secrets, Provider, Streaming, PWA |
| 1b Hefteinträge | Editor, Blöcke (Formeln, Graph, Molekül, Noten), Bereinigung |
| 1c Bildeingabe | Foto, Verkleinern, EXIF entfernen, Tafelbild → Hefteintrag |
| 1d Dateien | PDF- und PPTX-Export, Job-Status |
| 1e Agent-CLI | Claude-Code-Engine, Profile, Workspace, Streaming (gebaut, siehe [agent-cli.md](agent-cli.md)) |
| 2 | Cloud-Fallback und Backup (nicht jetzt bauen, aber nicht verbauen) |
| 3 | Agent-Modus für API-Modelle (Docker-Sandbox) |
