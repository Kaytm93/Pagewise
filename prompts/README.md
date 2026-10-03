# Prompts im Repo

Hier liegen nur neutrale Texte, die für alle Nutzer gleich sind. Eigene Prompts schreibst du in der App, sie werden lokal im Datenverzeichnis gespeichert und gehören nie ins Repo.

- `base.md`, `subjects/_template.md`: Platzhalter, die zeigen, wie ein eigener Prompt aussehen kann.
- `defaults/`: **Standard-Prompts je Fach** (Entscheidung D-034). Sie gelten, solange du für ein Fach nichts eigenes einträgst. Du kannst sie in der App bearbeiten und jederzeit auf den Standard zurücksetzen.
  - `_generic.md`: für Fächer ohne eigenen Text.
  - `standard.md`: für das eingebaute Fach „Standard“.
  - `<key>.md`: ein Text pro Katalogfach (der Schlüssel steht in `config/subject-catalog.json`).

Regeln für Standardtexte: neutral und kurz (Richtwert 600 bis 1.500 Zeichen, nie über 3.000), Deutsch, keine Namen von Personen, Schulen oder Orten, keine Bundesland-, Schulform- oder Lehrplanangaben, keine echten Aufgaben. Erlaubte Variable: `{{fach}}`. Ein Test (`apps/server/src/prompts/defaults.test.ts`) prüft das.
