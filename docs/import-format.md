# Import-Format für Fächer

Du kannst deine Fächer beim Onboarding oder später in den Einstellungen aus einer **lokalen Datei** importieren. Die Datei bleibt auf deinem Rechner und gehört nicht ins Repo. Alle Beispiele unten sind erfunden.

Nur der Name ist Pflicht. Lehrkraft und Wochenstunden sind optional.

## JSON

```json
{
  "version": 1,
  "subjects": [
    { "name": "Beispielfach A" },
    { "name": "Beispielfach B", "teacher": "Beispiel-Lehrkraft", "hours_per_week": 3 }
  ]
}
```

## CSV

Kopfzeile mit den Spalten `name`, `teacher`, `hours_per_week`, UTF-8, Komma als Trennzeichen. Leere Felder sind erlaubt.

```csv
name,teacher,hours_per_week
Beispielfach A,,
Beispielfach B,Beispiel-Lehrkraft,3
```

## Regeln

- Höchstens 200 Einträge und 256 KiB pro Datei. Die App prüft beides.
- `name`: 1 bis 80 Zeichen, ohne Zeilenumbrüche. `teacher`: höchstens 80 Zeichen. `hours_per_week`: ganze Zahl von 1 bis 40.
- Einträge mit gleichem Namen (Groß- und Kleinschreibung egal) werden übersprungen, auch wenn es das Fach schon gibt. Ein erneuter Import ist deshalb harmlos und überschreibt nichts.
- Ungültige Einträge werden gezählt und nicht übernommen. Die übrigen Einträge werden trotzdem angelegt.
- Unbekannte Spalten und Schlüssel werden ignoriert. Der Import legt nur Fächer an, keine Prompts. Prompts schreibst du selbst, siehe `prompts/`.
- Importierte Inhalte gelten als nicht vertrauenswürdig: Sie werden nur als Text gespeichert und nie als HTML oder Code ausgeführt.

Eine neutrale Beispieldatei liegt unter `config/examples/subjects.example.json`.
