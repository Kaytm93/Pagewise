# Abnahme Phase 1a

Stand: 3. Oktober 2026. Eine Phase gilt erst als abgenommen, wenn die berührten Punkte aus Abschnitt 12 des Pflichtenhefts erfüllt und getestet sind. **Abschnitt 12 liegt mir nicht mehr vor und ist noch nicht abgeglichen.** Diese Seite hält fest, was für die Kriterien aus Abschnitt 14 belegt ist.

## Kriterien Phase 1a (Abschnitt 14)

| Kriterium | Stand | Beleg |
| --- | --- | --- |
| Frische Installation startet leer | belegt | Lauf mit leerem Datenverzeichnis: Einrichtung nötig, Profil leer, keine Fächer, keine Anbieter, keine Chats |
| Nutzbar über Tailscale per HTTPS auf iPad und iPhone | **offen, Test durch Kay** | Anleitung in [self-hosting.md](self-hosting.md), Quellen und Grenzen in D-030 |
| Installierbar als Web-App | Technik belegt, **Installation offen, Test durch Kay** | Manifest, Icons, Service Worker in Chromium geprüft (D-029); „Zum Home-Bildschirm“ prüft Kay |
| Chats bleiben in ihrem Fach | belegt | Server-Tests und Lauf: ein Chat in Fach A erscheint nicht in Fach B; die Oberfläche zeigt einen Chat unter dem falschen Fach als „nicht gefunden“ (D-028) |
| Zweiter Anbieter ohne Codeänderung | belegt | Zwei Anbieter über die Oberfläche beziehungsweise API angelegt, Standard- und Ausweichmodell aus verschiedenen Anbietern gewählt |
| Nach einem Nutzungslauf zeigt `git status` keine neuen Dateien | belegt | Lauf mit Einrichtung, Fächern, Anbietern und Chat: `git status` leer, außer den ignorierten Ordnern `node_modules` und `dist` nichts im Repo |
| Schlüssel weder in Antworten noch in Logs | belegt | Erfundene Schlüssel wurden in keiner Antwort (Inhalt und Header), im Server-Log und in der Datenbank gefunden, nur im Secret-Speicher (`secrets/`, Rechte 600) |

Der Lauf nutzt einen erfundenen, lokalen Anbieter, der Antworten streamt. Mit einem echten OpenRouter-Schlüssel wurde nichts getestet (kein Netzzugang zu OpenRouter in der Entwicklungsumgebung): „Verbindung testen“ und eine echte Antwort muss Kay einmal ausprobieren.

## Was nur auf den Geräten geprüft werden kann

- Anmeldung über die `ts.net`-Adresse, Cookie mit `Secure` (D-030)
- Installation auf dem Home-Bildschirm und erneute Anmeldung in der installierten App (D-029)
- Eingabezeile bleibt mit eingeblendeter Tastatur sichtbar (D-028)
- Eine laufende Antwort läuft nach dem Aufwecken des Geräts weiter und hängt sich wieder an (D-027)
- Der Rechner bleibt wach, solange man zugreift

## Offene Punkte

- Abschnitt 12 abgleichen (siehe oben).
- Z.ai Coding Plan (D-011): Ob eine App, die das unveränderte `claude`-Programm startet, als unterstütztes Werkzeug gilt, ist unklar. Das GLM-Profil bleibt aus. Vor Phase 1e mit Kay klären.
- Autostart (`launchd`) und `docker compose` sind in [self-hosting.md](self-hosting.md) für Phase 1a angekündigt, aber noch nicht gebaut.
