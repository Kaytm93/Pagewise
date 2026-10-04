# Gestaltung („Lagen“)

Stand: 4. Oktober 2026 (D-043). Die Richtung ist bewusst begründet gewählt und lässt sich ändern: Tokens, Bewegungssystem und Hülle sind getrennt von den Bildschirmen.

## Idee

Pagewise ist ein Heft: Der Schreibtisch trägt Fensterlicht und Papierkörnung, links liegt der **Heftrücken** (Seitenleiste mit Lochung und Heftfaden), daneben der **Blattstapel**. Wer tiefer in die App geht, legt ein Blatt mehr auf den Stapel (Start und Einstellungen 1, Fach 2, Chat 3). Das neue Blatt wird beim Wechsel aufgelegt. Jedes Fach hat eine gedämpfte **Fachfarbe** (Washi-Streifen, Balken, Punkt, Licht auf dem Schreibtisch) und ein hauchdünnes **Linienmotiv** (sein Symbol, groß). Der Lesebereich im Chat bleibt ruhig: keine Bewegung hinter dem Text, nur Papier.

Was bleibt (Identität aus Abschnitt 10 des Pflichtenhefts): warme, papierartige Flächen, Graphit als Bedienfarbe, Instrument Sans und Inter (selbst gehostet), Research Blue nur für Links und kleine Akzente, warme Graphit-Töne im Dunkelmodus. Kein Neon, kein „KI-Look“.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `apps/web/src/styles/tokens.css` | Palette, semantische Tokens hell und dunkel, die acht Fachfarben |
| `apps/web/src/styles/motion.css` | Bewegungssystem: `--m`, Dauern, Federn, Effektstufen, Keyframes, Hilfsklassen `mo-*` |
| `apps/web/src/styles/lagen.css` | Hülle: Schreibtisch, Heftrücken, Blattstapel, Blatt, Zettel, Washi, Zeilen, Umschalter |
| `apps/web/src/ui/fx.ts`, `public/boot.js` | Effektstufe lesen, setzen, folgen; `boot.js` setzt Darstellung und Stufe vor dem ersten Anstrich |
| `apps/web/src/ui/Sheet.tsx` | Das Blatt (`prose`, `wide`, `flush` für den Chat) |
| `apps/web/src/shell/AppShell.tsx` | Schreibtisch, Seitenleiste, Blattstapel, Tiefe je Ansicht |
| `apps/web/src/ui/subject-color.ts`, `ColorPicker.tsx` | Fachfarbe (Nummer 0 bis 7) als Attribut `data-subj`, Auswahl im Fach-Dialog |

## Tokens

- **Ebenen:** `--desk` (Schreibtisch), `--sheet` (Blatt), `--ply-1…3` (Blätter darunter), `--slip` (Zettel), dazu `--paper`, `--surface`, `--canvas` wie bisher. Im Hellen ist `--sheet` gleich `--canvas`.
- **Licht und Schatten:** `--light` (Fensterlicht), `--shadow` (RGB-Tripel, damit sich eigene Deckkraft setzen lässt) und `--shadow-a` (Stärke), `--rim` (Lichtkante), `--hole`, `--hole-shade`, `--stitch`, `--grain` (Körnung als SVG, wird eingebettet).
- **Fachfarbe:** `--subj`, gesetzt durch `data-subj="0"…"7"` an einem Element (Schreibtisch, Zeile der Seitenleiste, Listenzeile). Acht gedämpfte Töne (Petrol, Terrakotta, Olivgrün, Ocker, Schieferblau, Rosenholz, Staubviolett, Stahlgrau), im Dunkeln heller. **Nie als Textfarbe**: sie färben Flächen, Linien und Punkte, und die Information steckt immer auch im Namen des Fachs.
- **Kontrast:** `tokens.test.ts` prüft alle Textfarben auf allen Flächen mit WCAG AA (4,5 : 1), Bedienelement-Ränder und die Fachfarben gegen das Blatt mit mindestens 3 : 1, hell und dunkel.

## Bewegung und Effektstufen

- Alles Bewegte hängt an Variablen aus `motion.css`: `--m` (Wegfaktor, 1 = volle Wege, 0 = nur Überblenden), `--t-fast/med/slow`, `--stagger`, `--spring` (Feder als `linear()`-Easing mit Rückfall).
- **Stufen** als Klasse am `<html>`: `fx-full` (Voreinstellung), `fx-reduced` (nur kurze Überblendungen, nichts verschiebt, dreht oder skaliert sich) und `fx-off` (keine Bewegung, auch keine Übergänge). Wahl in den Einstellungen („Automatisch“ folgt `prefers-reduced-motion` und wird dann „Reduziert“). `public/boot.js` setzt sie vor dem ersten Anstrich, ohne Skript greift eine Medienabfrage.
- Bewegung transportiert nie allein eine Information: Zustände (Laden, Fehler, Fertig) sind immer auch ohne sie erkennbar (Text, Symbol, Rolle).
- **Leistung:** nur `transform` und `opacity` werden animiert, dazu die Lichtfarbe auf dem Schreibtisch (`@property`). Der Schreibtisch ist eine feste Fläche hinter allem (kein `background-attachment: fixed`). Dauerläufer (Schimmer, Schreibmarke) laufen nur auf kleinen Flächen und pausieren im Hintergrund-Tab (`tab-hidden`). Keine großen `backdrop-filter`.
- **Blattwechsel:** nicht mit der View-Transitions-API, sondern als Ankunftsanimation des neuen Blatts (`lg-arrive`). Der Grund: Die Seite scrollt als Ganzes (wichtig für die Tastatur auf dem iPad, siehe D-028), eine View Transition müsste die ganze, womöglich sehr hohe Seite abbilden.

## Regeln für neue Bildschirme

1. Ein Bildschirm ist ein Blatt: `Sheet` (`width="wide"` oder `"prose"`) und darin Abschnitte mit `sectionTitle` (`ui/styles.ts`). Listenzeilen nutzen `listRow` (Balken in Fachfarbe beim Darüberfahren).
2. Farben nur über Tokens (`bg-sheet`, `text-ink-muted`, `border-line-warm`, `bg-subj` …), keine festen Werte. Texte in `i18n/de.ts`.
3. Bewegung nur über die `mo-*`-Klassen oder Variablen aus `motion.css`. Neue Keyframes brauchen `--m`, damit „Reduziert“ greift. Kein `style={…}` (CSP, D-023); dynamische Werte per `element.style.setProperty` über das CSSOM.
4. Bedienflächen mindestens 44 px, sichtbarer Fokus (`:focus-visible`), Tastaturbedienung, Zielgröße auch bei Symbolen.
5. Neue Abhängigkeiten (Animationsbibliothek, Shader, Canvas) nur nach Prüfung von Version, Größe, Lizenz und CSP-Verträglichkeit.

## Unterstützte Browser

Voll: Safari 17.2 und neuer (iOS und iPadOS 17.2+), Chrome und Firefox der letzten Jahre. Die Federn nutzen `linear()` (Safari 17.2), die Lichtfarbe `@property` (Safari 16.4), der Umschalter `:has()` (Safari 15.4), Mischfarben `color-mix()` (Safari 16.2). Ältere Geräte verlieren Bewegung und Licht, die Oberfläche bleibt benutzbar; Rückfälle sind vorgesehen (Feder als `cubic-bezier`, Licht ohne Übergang).

## Nicht gebaut (bewusst später)

- Beweglicher Streifen in der Seitenleiste (Markierung gleitet zwischen Einträgen): braucht Messung der Einträge, fehleranfällig bei aufklappenden Untergruppen.
- Startseite mit „Als Nächstes“ (Stunde, Test, „Jetzt“-Linie): wartet auf Stundenplan und Tests (Welle 3).
- Befehlsleiste (Cmd/Strg + K).
