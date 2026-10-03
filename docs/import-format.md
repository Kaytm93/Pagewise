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

- Maximale Dateigröße und Anzahl der Einträge sind begrenzt, die App prüft beides.
- Importierte Inhalte gelten als nicht vertrauenswürdig und werden bereinigt.
- Der Import legt nur Fächer an. Prompts schreibst du selbst, siehe `prompts/`.

Eine neutrale Beispieldatei liegt unter `config/examples/subjects.example.json`.
