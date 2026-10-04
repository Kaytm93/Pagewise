# Selbst hosten

Stand: Phase 1b, Mac-App gebaut. Der Server läuft, die Oberfläche ist als installierbare Web-App gebaut (Onboarding, Fächer, Chat, Hefteinträge). Auf dem Mac gibt es zusätzlich eine echte App (`Pagewise.app`, Abschnitt unten). Die Tailscale-Schritte sind aus der Doku abgeleitet und noch nicht auf iPhone und iPad geprüft; was nur auf dem Mac prüfbar ist, steht in [acceptance-mac.md](acceptance-mac.md).

## Voraussetzungen

- Mac (oder Linux-Rechner), der dauerhaft läuft
- Node.js ab 22.18 und pnpm ab 10
- Tailscale auf dem Rechner und auf den Geräten, mit denen du zugreifen willst

## Mac-App (`Pagewise.app`)

Der Mac ist der Server. Die App ist eine Hülle um denselben Server und dieselbe Oberfläche: eigenes Fenster ohne Adressleiste, Menüleiste mit Kürzeln, Symbol in der Menüleiste, Start bei der Anmeldung, hält den Mac wach, zeigt den Einrichtungscode, richtet Tailscale Serve ein und zeigt Adresse und QR-Code für iPhone und iPad ([D-050](decisions.md) bis [D-056](decisions.md)). iPhone und iPad bleiben Web-Apps im Browser (Teilen → „Zum Home-Bildschirm“).

**Selbst bauen (empfohlen, ohne Apple-Konto).** Auf dem Mac (macOS 13 oder neuer ist die Vorgabe von Electron, siehe D-055), mit Node ab 22.18 und pnpm:

```bash
pnpm install
pnpm app:mac            # baut und installiert nach ~/Applications/Pagewise.app
open ~/Applications/Pagewise.app
```

`pnpm app:mac --no-install` baut nur, `--arch x64` baut für Intel-Macs, `--dest <Ordner>` wählt einen anderen Zielordner. Läuft Pagewise gerade, bricht das Skript ab (erst beenden). Eine selbst gebaute App wird von macOS nicht blockiert. Sie ist nur „ad hoc“ signiert (ohne Apple-Konto), das reicht für den eigenen Mac.

**Fertige App aus der CI.** Der Job `desktop-mac` baut `Pagewise.app` für Apple-Silizium und legt sie drei Tage lang als Artefakt `Pagewise-mac-arm64` ab (Actions → Lauf → Artefakte). Sie ist nicht notarisiert, macOS blockiert sie deshalb beim ersten Start (Anleitung nach Apple, **von mir nicht geprüft**, die Seite von Apple ist aus meiner Umgebung nicht erreichbar):

1. Zip entpacken, `Pagewise.app` nach Programme (oder `~/Applications`) ziehen.
2. Einmal öffnen. macOS meldet, dass die App nicht überprüft werden konnte, und lässt sie nicht starten.
3. Systemeinstellungen → Datenschutz & Sicherheit → nach unten scrollen → bei Pagewise **„Trotzdem öffnen“**, Kennwort eingeben. Seit macOS 15 (Sequoia) gibt es dafür **kein** „Control-Klick → Öffnen“ mehr (laut Auftrag, nicht verifiziert).

Eine Entwicklerzertifikat-Signatur mit Notarisierung (damit die Warnung entfällt) kostet 99 USD pro Jahr und ist **nicht eingerichtet**: [D-056](decisions.md) beschreibt Aufwand und Voraussetzungen, die Entscheidung liegt bei dir.

**Was die App für dich übernimmt.**

- **Einrichtungscode:** erscheint beim ersten Start (und nach „Passcode zurücksetzen“) in einem Dialog mit „Kopieren“, später unter Hilfe → „Einrichtungscode anzeigen …“. Die Konsole brauchst du nicht.
- **iPhone und iPad verbinden:** Hilfe → „Mit iPhone und iPad verbinden …“ (oder das Symbol in der Menüleiste) zeigt, ob Tailscale läuft, richtet `tailscale serve` ein, zeigt die Adresse mit QR-Code und warnt vor einem Rechnernamen, der nach einer Person klingt (Zertifikatsverzeichnis, siehe unten). **Funnel** richtet die App nie ein; ist es irgendwo an, warnt sie in Rot und bietet das Zurücksetzen an.
- **Mac wach halten:** an, solange die App läuft (das Display darf ausgehen). Bei **zugeklapptem Deckel ohne externes Display** schläft ein MacBook trotzdem; dann ist Pagewise auf iPhone und iPad nicht erreichbar, auch nicht mit der App.
- **Start bei Anmeldung:** Hilfe → „Bei Anmeldung starten“ (die App startet dann ohne Fenster, das Symbol in der Menüleiste zeigt den Zustand). Verlangt macOS eine Freigabe, steht sie in Systemeinstellungen → Allgemein → Anmeldeobjekte.
- **Fenster schließen** beendet nichts (der Server läuft weiter). **Beenden** (Cmd+Q) fragt nach, wenn Antworten laufen oder Geräte angemeldet sind, und beendet dann auch den Server.
- **`claude` nicht gefunden?** Programme aus dem Finder sehen nur einen knappen `PATH`: Einstellungen → Agent-CLI → „Pfad zu claude“ (`which claude` im Terminal zeigt ihn).

**Daten:** wie überall `~/Library/Application Support/Pagewise` (Server) und darin `Fenster` (Cookies, Einstellungen des Fensters). „Alles löschen“ leert beides, nicht den Passcode.

**Lizenzen:** `Pagewise.app/Contents/Resources/licenses/` enthält die Hinweise zu allen mitgelieferten Paketen sowie die Lizenzen von Electron und Chromium.

## Starten ohne App (Befehlszeile)

```bash
pnpm install
pnpm start
```

Der Server lauscht auf `127.0.0.1:3000`. Den Port änderst du mit `PAGEWISE_PORT`, das Datenverzeichnis mit `PAGEWISE_DATA_DIR`. Beim ersten Start wird das Datenverzeichnis mit Rechten `700` angelegt. Liegt es innerhalb eines Git-Arbeitsverzeichnisses, bricht der Start mit einer Erklärung ab.

## Erster Start und Passcode

Beim ersten Start zeigt die Konsole einen **Einrichtungscode** (`XXXXX-XXXXX`). Öffne Pagewise am besten direkt am Rechner unter `http://localhost:3000`, gib den Code ein und lege deinen Passcode fest (mindestens 8 Zeichen, ein Satz ist besser als ein Wort). Danach meldest du dich auf iPhone und iPad nur noch mit dem Passcode an. Nach fünf Fehlversuchen innerhalb von 15 Minuten ist die Anmeldung kurz gesperrt.

Passcode vergessen? Beende Pagewise und führe `pnpm --filter @pagewise/server reset-passcode` aus. Das entfernt nur Passcode und Anmeldungen, deine Fächer und Daten bleiben. Beim nächsten Start gibt es einen neuen Einrichtungscode.

## Was im Datenverzeichnis liegt

`pagewise.db` (SQLite, dazu `-wal` und `-shm`), `assets`, `workspaces`, `logs`, `secrets` (API-Schlüssel, nur für dich lesbar) und `backups`. Alles hat Rechte 600 beziehungsweise 700. Vor einer Datenbank-Migration legt Pagewise automatisch eine Kopie in `backups` an (die letzten fünf bleiben). Ein richtiges Backup ersetzt das nicht: Sichere das ganze Datenverzeichnis selbst, am besten verschlüsselt.

## Zugriff von iPhone und iPad über Tailscale

Pagewise lauscht nur auf dem eigenen Rechner (Loopback). Von iPhone und iPad aus erreichst du es über **Tailscale Serve**: Tailscale nimmt die Anfragen im privaten Tailnet per HTTPS an und reicht sie an den lokalen Server weiter.

**Vorher beachten:** Wenn du HTTPS-Zertifikate im Tailnet einschaltest, werden die **Namen deiner Geräte in einem öffentlichen Zertifikatsverzeichnis (Certificate Transparency) veröffentlicht**. Tailscale schreibt dazu: „Do not enable the HTTPS feature if any of your machine names contain sensitive information.“ Gib dem Rechner, auf dem Pagewise läuft, deshalb einen neutralen Namen (ohne Namen von Personen, Schule oder Ähnlichem), bevor du HTTPS einschaltest.

1. **MagicDNS und HTTPS einschalten.** Im Admin-Bereich von Tailscale unter „DNS“ MagicDNS aktivieren und „Enable HTTPS“ wählen. Fehlt HTTPS noch, fragt der Befehl in Schritt 2 selbst danach und öffnet eine Seite, auf der du es erlaubst.
2. **Server bereitstellen** (auf dem Rechner, auf dem Pagewise läuft):

   ```bash
   tailscale serve --bg 3000
   tailscale serve status
   ```

   `3000` steht für `http://127.0.0.1:3000`, passe es an, wenn du `PAGEWISE_PORT` geändert hast. `--bg` lässt die Freigabe im Hintergrund laufen. Beenden: `tailscale serve reset`. Prüfe nach einem Neustart des Rechners mit `tailscale serve status`, ob die Freigabe noch da ist (ob sie einen Neustart übersteht, ist hier nicht geprüft). Wie die Befehlszeile auf dem Mac aufgerufen wird, hängt von der Tailscale-Variante ab, siehe die Quelle unten.
3. **Auf dem Gerät öffnen.** Auf iPhone oder iPad muss Tailscale verbunden sein. Öffne in Safari die Adresse, die `tailscale serve status` anzeigt (`https://<rechnername>.<tailnet-name>.ts.net`). Beim ersten Mal legst du den Passcode fest (Einrichtungscode aus der Konsole).
4. **Als App installieren.** Safari: Teilen → „Zum Home-Bildschirm“. Die App öffnet sich dann ohne Adressleiste. Auf iOS hat sie eigene Cookies, du meldest dich dort einmal neu mit dem Passcode an.

**Niemals `tailscale funnel` verwenden.** Funnel macht den Dienst öffentlich im Internet erreichbar. Pagewise ist nur für dein privates Tailnet gedacht. Hast du es versehentlich benutzt, setze die Konfiguration mit `tailscale serve reset` zurück und prüfe danach mit `tailscale serve status`.

### Was Serve an Pagewise weitergibt

- Tailscale hängt die Header `X-Forwarded-Proto: https`, `X-Forwarded-Host` und `X-Forwarded-For` an. Pagewise nutzt `X-Forwarded-Proto`, um das Sitzungs-Cookie mit `Secure` zu setzen. Fehlt der Header, funktioniert die Anmeldung trotzdem (das Cookie ist dann ohne `Secure`, bleibt aber `HttpOnly` und `SameSite=Strict`).
- Dazu kommen die Header `Tailscale-User-Login`, `Tailscale-User-Name` und `Tailscale-User-Profile-Pic` mit dem Konto, das die Anfrage stellt. Pagewise liest sie nicht. Der Zugang hängt allein am Passcode: Jedes Gerät in deinem Tailnet kann die Seite erreichen, aber nur mit Passcode hinein.

### Noch nicht auf einem echten Gerät geprüft

Alle Schritte stammen aus der Dokumentation und dem Quelltext von Tailscale und wurden hier **nicht** auf iPhone oder iPad ausprobiert. Zu prüfen sind: Anmeldung über die `ts.net`-Adresse (inklusive `Secure`-Cookie, wenn der Header ankommt), Installation auf dem Home-Bildschirm, Anmeldung in der installierten App, Eingabezeile mit eingeblendeter Tastatur (D-028) und ob eine laufende Antwort nach dem Aufwecken des Geräts weiterläuft (D-027).

Quellen (abgerufen am 3. Oktober 2026):

- Befehle und Optionen: <https://tailscale.com/docs/reference/tailscale-cli/serve>
- Funktionsweise, Hinweis zu HTTPS und Identitäts-Headern: <https://tailscale.com/docs/features/tailscale-serve>
- HTTPS-Zertifikate und Veröffentlichung der Gerätenamen: <https://tailscale.com/kb/1153/enabling-https>
- Weitergegebene Header (`addProxyForwardedHeaders` in `ipn/ipnlocal/serve.go`): <https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go>

## Rechner wach halten

Der Rechner muss laufen, solange du von anderen Geräten zugreifst. Auf dem Mac stellst du in den Systemeinstellungen den Ruhezustand bei Netzbetrieb ab oder startest den Server mit `caffeinate -s pnpm start`. Mit der Mac-App (siehe oben) übernimmt sie das (Hilfe → „Mac wach halten“, „Bei Anmeldung starten“).

## Docker (optional)

Wenn du den Server in einem Container betreibst, setze `PAGEWISE_ALLOW_NON_LOOPBACK=1` im Container und veröffentliche den Port nur lokal (`127.0.0.1:3000:3000`). Das Datenverzeichnis kommt als Volume von außerhalb des Repos. Ein fertiges `docker compose`-Setup folgt mit Phase 1a.
