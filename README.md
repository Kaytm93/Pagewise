# Pagewise

Ein selbst gehosteter Schul-Workspace für den Browser. Jede Person richtet ihre eigene Installation ein: eigene Fächer, eigene Prompts, eigene Modelle. Die Daten bleiben auf dem eigenen Rechner.

> **Status:** Phase 1a (Kern). Einrichtung, Fächer und Untergruppen, Prompt-Schichten, Anbieter, Chat mit Streaming und die installierbare Web-App laufen. Dazu die Agent-CLI-Anbindung (Phase 1e, siehe [docs/agent-cli.md](docs/agent-cli.md)). Hefteinträge, Fotos und Export kommen in den nächsten Phasen. Der Stand der Abnahme steht in [docs/acceptance-1a.md](docs/acceptance-1a.md) und [docs/acceptance-1e.md](docs/acceptance-1e.md).

## Was Pagewise werden soll

- **Fächer und Untergruppen**: aus einem Katalog von über 60 neutralen Vorlagen (Sprachen, Naturwissenschaften, Gesellschaft, Kunst, Sport …) mit Suche oder frei angelegt, dazu Untergruppen (z. B. „Referat“ oder „Schulaufgabe“). Chats gehören fest zu einem Fach.
- **Standard-Chat** für Fragen ohne Fach: ein Klick auf „Pagewise“. Er liegt im eingebauten Fach „Standard“.
- **Standard-Prompt je Fach**: ein neutraler, für alle gleicher Text, der gilt, solange du nichts Eigenes einträgst. Du kannst ihn ändern und jederzeit zurücksetzen.
- **Hefteinträge** mit Formeln, Funktionsgraphen, chemischen Strukturen und Noten, einzeln angelegt oder aus einem Chat oder Foto erzeugt.
- **Export als PDF und PPTX.**
- **Fotos von Heft und Tafel** als Eingabe für ein Vision-Modell.
- **Viele Modell-Anbieter** über eigene API-Keys, ohne Code-Änderung erweiterbar (Standard: OpenRouter).
- **Agent-CLI-Anbindung** für lokale Coding-Agenten (zuerst Claude Code), die in einem eigenen Workspace-Ordner arbeiten und Dateien wie PDF oder PPTX erzeugen, die du herunterladen kannst. Bei Fehlern gibt es einen Rückfall auf ein Modell eines Anbieters.
- **Erreichbar im eigenen Tailscale-Netz** vom iPhone, iPad und Mac, als installierbare Web-App.

Die Anwendung startet vollständig leer. Dieses Repository enthält keine Fächerlisten einzelner Personen und keine Lehrkräfte, Stundenpläne oder persönlichen Prompts, nur Code, neutrale Vorlagen (Fachnamen, neutrale Standardtexte) und erfundene Beispiele.

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
| macOS | `~/Library/Application Support/Pagewise` |
| Linux | `$XDG_DATA_HOME/pagewise` (sonst `~/.local/share/pagewise`) |

Mit `PAGEWISE_DATA_DIR` legst du einen anderen Ort fest. Liegt das Datenverzeichnis innerhalb eines Git-Arbeitsverzeichnisses, verweigert die App den Start. Es gibt keine Telemetrie, keine Analytics und keine Konten bei uns. Mehr dazu in [docs/security.md](docs/security.md).

## Hinweise zu Anbietern und Abos

- Wenn du Modelle über API-Keys nutzt, gehen deine Eingaben an den jeweiligen Anbieter. Free-Modelle können Prompts protokollieren, gib dort keine sensiblen Daten ein.
- Die Agent-CLI-Anbindung startet **unveränderte, offizielle Programme** (z. B. Claude Code) auf deinem Rechner, in einer Sandbox und nur im Arbeitsordner des Fachs. Du installierst das Programm selbst und meldest dich dort selbst an. Pagewise liest, speichert oder vermittelt keine Zugangsdaten deiner Abos. Nutzungslimits deines Abos gelten auch für Aufträge aus Pagewise; sie zählen wie deine eigene Nutzung.
- Abo-Kontingente (z. B. Claude-Abo oder GLM Coding Plan) gelten nur für die gewöhnliche, persönliche Nutzung des Kontoinhabers. Anbieter können ihre Regeln jederzeit ändern. Prüfe die aktuellen Bedingungen selbst, bevor du ein Abo-Profil nutzt.
- „Claude Code“ und „Anthropic“ sind Marken ihrer Inhaber. Pagewise ist kein Produkt dieser Firmen und wird von ihnen nicht unterstützt.

## Mitmachen

Sicherheitsmeldungen bitte privat, siehe [SECURITY.md](SECURITY.md). Konventionen für Entwicklung stehen in [CLAUDE.md](CLAUDE.md), Entscheidungen in [docs/decisions.md](docs/decisions.md).

## Lizenz

MIT, siehe [LICENSE](LICENSE).

---

## English summary

Pagewise is a self-hosted school workspace (PWA) that each person sets up for themselves: your own subjects, prompts and model providers, with all data kept on your own machine outside the repository. It is reachable from your own devices through Tailscale Serve only, never publicly. The project is in an early phase (foundation only) and is not usable yet. The UI is German; strings live in i18n files so other languages can be added. Security issues: see [SECURITY.md](SECURITY.md). License: MIT (provisional).
