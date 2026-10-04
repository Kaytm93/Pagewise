# Abnahme Phase 1b (Hefteinträge)

Stand: 4. Oktober 2026. Eine Phase gilt erst als abgenommen, wenn die berührten Punkte aus Abschnitt 12 des Pflichtenhefts erfüllt und getestet sind. **Nicht abgenommen**, solange die Prüfungen aus dem letzten Abschnitt (echte Modelle, iPad) fehlen; sie kann nur der Maintainer machen.

## Kriterien Phase 1b (Abschnitt 14)

| Kriterium | Stand | Beleg |
| --- | --- | --- |
| Je ein Beispiel pro Block korrekt dargestellt (Formel, Graph, Molekül, Noten, Hinweis) | belegt | `Blocks.test.tsx` (jsdom) und Lauf im echten Chromium mit erfundenen Daten: Chat und Editor in „Raum“ und „Atelier“, hell und dunkel. Jede Vorlage des Editors lässt sich zeichnen (Test in `Notes.test.tsx`) |
| Retry bei Renderfehlern | belegt (im Browser, nicht im Worker) | `Notes.test.tsx` „Automatische Korrektur“: eine Anfrage mit den Fehlercodes, nie eine zweite, keine bei gültigen Blöcken, keine bei ausgeschalteter Einstellung, keine beim Öffnen eines alten Chats. Der Worker kommt mit 1d (D-049) |
| XSS-Testfälle werden neutralisiert | belegt | `packages/render/src/sanitize.test.ts` (18 Fälle), `math.test.ts`, `Blocks.test.tsx` (feindliche Beschriftungen, Beschriftung mit Markup, Fremdcode in Formeln), `Notes.test.tsx` (Skripte im Text eines Eintrags) |
| Hefteinträge pro Fach und Untergruppe, aus dem Nichts und aus dem Chat | belegt | `routes/notes.test.ts` (45 Tests, u. a. Untergruppe, Löschen, Obergrenze, Chat-Übernahme mit allen Fehlerfällen), `Notes.test.tsx` |
| Formeln im Chat (bisher Text, D-028) | belegt | `Blocks.test.tsx`, Lauf im Browser |

## Abschnitt 12, soweit berührt

| Punkt | Stand | Beleg |
| --- | --- | --- |
| 12.4 Markdown ohne rohes HTML, SVG und HTML bereinigen (DOMPurify strikt), kein `eval` | **erfüllt** | D-048, `sanitize.test.ts`, `structure.test.ts` (kein `eval`, `new Function`, `style`-Attribut im Quelltext von `packages/render`), eigener Parser ohne `eval` für Graphen (D-047), Browserlauf mit der App-CSP: 0 Verstöße, 0 Konsolenmeldungen |
| 12.4 Modell-Ausgaben sind nicht vertrauenswürdig: Fehler nur als Codes | erfüllt | `RenderErrorCode` in `packages/render/src/errors.ts`; Test: kein Text aus Blöcken in Befunden (`validate.test.ts`, `abc.test.ts`, `math.test.ts`, `graph.test.ts`); die Korrekturanfrage nennt nur Codes (`Notes.test.tsx`) |
| 12.3 Strenge CSP bleibt (kein `unsafe-inline`, kein `unsafe-eval`) | **erfüllt**, unverändert | D-048; `inline-styles.test.ts` (Oberfläche), `structure.test.ts` (Paket) |
| 12.6 Daten an Dritte: transparent, abschaltbar | erfüllt | Die automatische Korrektur schickt den Verlauf noch einmal an den Anbieter: Hinweis im Text der Einstellung, Schalter „Antworten“ (Standard an, nur in diesem Browser) |
| 12.7 Löschen von Fach, Chat, Hefteintrag entfernt Zeilen; „Alles löschen“ leert Hefteinträge | erfüllt (Zeilen) | `routes/notes.test.ts` (Fach löschen, „Alles löschen“, Untergruppe löschen lässt den Eintrag im Fach, Chat löschen lässt den Eintrag mit leerer Herkunft). Dateien fallen in 1b nicht an (Bilder kommen mit 1c) |
| 12.1, 12.2, 12.3 (Anmeldung), 12.5 | unberührt | `/api/notes` steht hinter `requireSession` und CSRF (Test: 401 ohne Anmeldung für jede Route) |

## Messwerte

- Tests: Server 959 bestanden bei 9 übersprungenen (opt-in Ende-zu-Ende; ein Test, `process.test.ts` „beendet auch Kindprozesse“, scheitert nur in der Cloud-Umgebung, weil dort beendete Kindprozesse nicht eingesammelt werden, nicht im Code), Web 491, `packages/render` 148, Repo 25. Lint, Typecheck, `pnpm scan` sauber.
- Hauptpaket der Oberfläche 338 kB (Grenze D-028: 340 kB), Chat 192 kB. Nachgeladen erst bei Bedarf: KaTeX 261 kB, abcjs 510 kB, SmilesDrawer 192 kB, Bereinigung 29 kB, Graph 8,5 kB, Moleküle 6,6 kB.
- Browser: Chromium (Cloud-Sitzung), Bildschirmfotos nur privat, nicht im Repo.

## Offen für den Maintainer

- **Echte Modelle:** Halten sie die Block-Syntax ein (Graph-JSON, Summenformeln, ABC)? Die Korrektur ist gebaut, aber nur mit einem erfundenen Anbieter geprüft.
- **iPad und iPhone:** Darstellung der Blöcke (vor allem abcjs und KaTeX), Editor mit Tastatur, Vorschau-Umschalter, Leistung in „Raum“ (Parallaxe läuft nur mit Maus).
- **Chemie:** Reicht die Tabelle der 17 Moleküle für den Unterricht? Welche fehlen?
- Noten: nur Darstellung, keine Wiedergabe.
