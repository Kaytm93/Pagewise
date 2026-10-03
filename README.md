# Schulheft

Ein selbst gehosteter Schul-Workspace für den Browser. Jede Person richtet ihre eigene Installation ein: eigene Fächer, eigene Prompts, eigene Modelle. Die Daten bleiben auf dem eigenen Rechner.

> **Status:** Phase 0 (Fundament). Das Projekt ist noch nicht benutzbar. Der Name „Schulheft“ ist ein Arbeitstitel.

## Was Schulheft werden soll

- **Fächer und Untergruppen**, die du selbst anlegst (z. B. „Referat“ oder „Schulaufgabe“). Chats gehören fest zu einem Fach.
- **Hefteinträge** mit Formeln, Funktionsgraphen, chemischen Strukturen und Noten, einzeln angelegt oder aus einem Chat oder Foto erzeugt.
- **Export als PDF und PPTX.**
- **Fotos von Heft und Tafel** als Eingabe für ein Vision-Modell.
- **Viele Modell-Anbieter** über eigene API-Keys, ohne Code-Änderung erweiterbar (Standard: OpenRouter).
- **Agent-CLI-Anbindung** für lokale Coding-Agenten (zuerst Claude Code), die in einem eigenen Workspace-Ordner Dateien erzeugen.
- **Erreichbar im eigenen Tailscale-Netz** vom iPhone, iPad und Mac, als installierbare Web-App.

Die Anwendung startet vollständig leer. Dieses Repository enthält weder Fächerlisten noch Lehrkräfte, Stundenpläne oder fertige Prompts, nur Code, neutrale Vorlagen und erfundene Beispiele.

## Schnellstart (Entwicklung)

Voraussetzungen: Node.js ab 22.18 und pnpm ab 10.

```bash
pnpm install
pnpm dev      # Server (Port 3000) und Web-Oberfläche (Port 5173)
```

Für den Betrieb:

```bash
pnpm start    # baut die Oberfläche und startet den Server auf 127.0.0.1:3000
```

Der Server bindet ausschließlich an die lokale Adresse. Den Zugriff von anderen Geräten richtest du über Tailscale Serve ein, siehe [docs/self-hosting.md](docs/self-hosting.md).

## Deine Daten

Alle Nutzerdaten (Datenbank, Uploads, Workspaces, Logs, Secrets, Backups) liegen im **Datenverzeichnis außerhalb des Repos**:

| System | Standardpfad |
| --- | --- |
| macOS | `~/Library/Application Support/Schulheft` |
| Linux | `$XDG_DATA_HOME/schulheft` (sonst `~/.local/share/schulheft`) |

Mit `SCHULHEFT_DATA_DIR` legst du einen anderen Ort fest. Liegt das Datenverzeichnis innerhalb eines Git-Arbeitsverzeichnisses, verweigert die App den Start. Es gibt keine Telemetrie, keine Analytics und keine Konten bei uns. Mehr dazu in [docs/security.md](docs/security.md).

## Hinweise zu Anbietern und Abos

- Wenn du Modelle über API-Keys nutzt, gehen deine Eingaben an den jeweiligen Anbieter. Free-Modelle können Prompts protokollieren, gib dort keine sensiblen Daten ein.
- Die geplante Agent-CLI-Anbindung startet **unveränderte, offizielle Programme** (z. B. Claude Code) auf deinem Rechner. Du meldest dich dort selbst an. Schulheft liest, speichert oder vermittelt keine Zugangsdaten deiner Abos.
- Abo-Kontingente (z. B. Claude-Abo oder GLM Coding Plan) gelten nur für die gewöhnliche, persönliche Nutzung des Kontoinhabers. Anbieter können ihre Regeln jederzeit ändern. Prüfe die aktuellen Bedingungen selbst, bevor du ein Abo-Profil nutzt.
- „Claude Code“ und „Anthropic“ sind Marken ihrer Inhaber. Schulheft ist kein Produkt dieser Firmen und wird von ihnen nicht unterstützt.

## Mitmachen

Sicherheitsmeldungen bitte privat, siehe [SECURITY.md](SECURITY.md). Konventionen für Entwicklung stehen in [CLAUDE.md](CLAUDE.md), Entscheidungen in [docs/decisions.md](docs/decisions.md).

## Lizenz

MIT, siehe [LICENSE](LICENSE). (Vorläufig, die Wahl ist noch zu bestätigen, siehe [docs/decisions.md](docs/decisions.md).)

---

## English summary

Schulheft is a self-hosted school workspace (PWA) that each person sets up for themselves: your own subjects, prompts and model providers, with all data kept on your own machine outside the repository. It is reachable from your own devices through Tailscale Serve only, never publicly. The project is in an early phase (foundation only) and is not usable yet. The UI is German; strings live in i18n files so other languages can be added. Security issues: see [SECURITY.md](SECURITY.md). License: MIT (provisional).
