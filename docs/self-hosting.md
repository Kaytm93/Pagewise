# Selbst hosten

Stand: Phase 0. Der Server läuft und beantwortet `GET /api/health`, die Oberfläche ist noch ein Gerüst. Die Tailscale-Schritte unten sind aus der Doku abgeleitet und werden in Phase 1a praktisch auf iPhone und iPad geprüft.

## Voraussetzungen

- Mac (oder Linux-Rechner), der dauerhaft läuft
- Node.js ab 22.18 und pnpm ab 10
- Tailscale auf dem Rechner und auf den Geräten, mit denen du zugreifen willst

## Starten

```bash
pnpm install
pnpm start
```

Der Server lauscht auf `127.0.0.1:3000`. Den Port änderst du mit `SCHULHEFT_PORT`, das Datenverzeichnis mit `SCHULHEFT_DATA_DIR`. Beim ersten Start wird das Datenverzeichnis mit Rechten `700` angelegt. Liegt es innerhalb eines Git-Arbeitsverzeichnisses, bricht der Start mit einer Erklärung ab.

## Zugriff von iPhone und iPad über Tailscale

1. Aktiviere im Admin-Bereich deines Tailnets MagicDNS und HTTPS-Zertifikate (Abschnitt „HTTPS certificates“ in der Tailscale-Doku).
2. Stelle den lokalen Server im Tailnet bereit:

   ```bash
   tailscale serve --bg 3000
   tailscale serve status
   ```

   `--bg` lässt die Freigabe im Hintergrund laufen, auch nach einem Neustart. Beenden: `tailscale serve reset`.
3. Öffne auf dem Gerät `https://<rechnername>.<tailnet-name>.ts.net` in Safari.
4. Ab Phase 1a: Teilen → „Zum Home-Bildschirm“ installiert die Web-App.

**Niemals `tailscale funnel` verwenden.** Funnel macht den Dienst öffentlich im Internet erreichbar. Schulheft ist nur für dein privates Tailnet gedacht.

Quelle: <https://tailscale.com/docs/reference/tailscale-cli/serve>

## Rechner wach halten

Der Rechner muss laufen, solange du von anderen Geräten zugreifst. Auf dem Mac stellst du in den Systemeinstellungen den Ruhezustand bei Netzbetrieb ab oder startest den Server mit `caffeinate -s pnpm start`. Ein Autostart über `launchd` kommt in Phase 1a.

## Docker (optional)

Wenn du den Server in einem Container betreibst, setze `SCHULHEFT_ALLOW_NON_LOOPBACK=1` im Container und veröffentliche den Port nur lokal (`127.0.0.1:3000:3000`). Das Datenverzeichnis kommt als Volume von außerhalb des Repos. Ein fertiges `docker compose`-Setup folgt mit Phase 1a.
