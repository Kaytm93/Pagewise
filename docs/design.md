# Gestaltung

Stand: 25. Oktober 2026 (D-043, D-045, D-058).

## Designrichtungen (D-045)

Es gibt drei Richtungen, wählbar in den Einstellungen („Darstellung“, Standard **Raum**): **Raum** (Ordner mit Rücken und Heftung, Tageslinie), **Lagen** (Heft mit Heftrücken und Blattstapel, unten beschrieben) und **Atelier** (keine Hülle, großes Licht der Fachfarbe, runde Karten). Das Attribut `data-design` am `<html>` wählt aus, `public/boot.js` setzt es vor dem ersten Anstrich, `ui/design.ts` wechselt es zur Laufzeit. Dateien: `styles/lagen.css` (Grundlage), `styles/raum.css`, `styles/atelier.css` (überschreiben nur Abweichungen). Neue Bildschirme benutzen dieselben Klassen und brauchen keine Fallunterscheidung; was nur in einer Richtung existiert (Tageslinie in Raum), prüft `useDesign()`. Alle Regeln unten (Tokens, Bewegung, Kontrast, CSP) gelten für alle drei.

## Angleichung an die Mockups (D-058, 25. Oktober 2026)

Die drei Mockups (A „Lagen“, B „Atelier“, C „Raum“) wurden mit dem Bau verglichen und die Abweichungen geschlossen; Fehler der Mockups (Inline-Skripte, feste Farben, Überlauf bei 375 px, Touch-Ziele unter 44 px, zu heller `--ink-muted`) sind bewusst nicht übernommen (Liste in D-058).

- **Maße je Richtung:** `--sidebar-w` und `--sheet-edge` stehen in der CSS-Datei der Richtung, `AppShell` und `Sheet` lesen sie. Seitenleiste Lagen 276 px (bis 1023 px Breite 248), Atelier 264 px (bis 1099 px 232), Raum 240 px (bis 1099 px 216). Blattrand Lagen 52 px (iPad 34), Atelier `clamp(20px, 5vw, 72px)`, Raum 52 px.
- **Dialoge (S-01):** Das Panel trägt `lg-dialog` (deckende Fläche, nicht mehr `lg-sheet`), `ui/modal.tsx` führt einen Stapel: Escape schließt nur die oberste Ebene, die Scrollsperre fällt erst mit der letzten, der Fokus kehrt zurück und bleibt im Dialog, `ModalFooter` hält die Knöpfe sichtbar.
- **Gemeinsame Bausteine** (`styles/screens.css`, alle Richtungen): `--subject-h1` (Fach-Überschrift fließend, je Richtung eigene Werte), Container-Query im Startraster, `.lg-composer`, `.lg-agent-head`, `.lg-tool-check` (gezeichneter Haken), `.lg-fx-list`. „Zuletzt genutzt“, Tagesgruppen im Chat und die Effektliste gelten für alle Richtungen. Die Startüberschrift entsteht aus Stundenplan und Tests (`screens/home/start-heading.ts`), ohne Daten gilt der feste Text.
- **Lagen:** Blattwechsel mit größerer Ankunft, Mappenreiter mit Fachbalken, Stundenliste mit Pausen und wachsender „Jetzt“-Linie, gezeichnetes Fachmotiv (`lg-motif-stroke`, Keyframe `draw`).
- **Atelier:** `--hue-ink` je Fach als AA-Textton, Licht über `--at-k`, Tagesliste mit „Jetzt“-Linie, Fachseite als Arbeitsplatz (`atelier-fach.css`, `screens/atelier/SubjectAtelier*`: Kennzahlenzeile, Untergruppen als Kacheln und Filter, großes gezeichnetes Motiv), Chat mit Randmotiv, Status im Kopf und Fachglühen am Composer, Zeigerlicht (`ui/pointer-glow.ts`: nur Atelier, Stufe „Voll“, Maus oder Stift, sichtbarer Tab).
- **Raum:** Tageslinie als Zeitachse mit wandernder Marke (`screens/raum/timeline.ts`, Pausenlogik unverändert), Dunkelton `--page-hi`, vier Fensterscheiben, Parallaxe mit zwei Ebenen und Glättung (`ui/parallax.ts`), Chat in Raum-Optik, Anmelde-Hülle ohne Fachkantenlinie (`lg-sheet-auth`). Hüllenfehler (S-02): Ordnerrücken, Randlinie und Eingabezeile sind korrigiert (Ursachen in den Commits).
- **Bewegung:** neue Ausnahme für Bedienelemente, siehe unten (`--t-color`).
- **Nachgetragen (25. Oktober, später):** feste Fußzeile (`ModalFooter`) auch in `ProviderDialog` und im Umbenennen-Dialog des Chats; Linienmotiv neben der Eingabe auf der Atelier-Startseite (`screens/atelier/StartMotif.tsx`, ab 820 px Breite); Kopfzeile je Antwort in Atelier (`screens/atelier/BotHead.tsx`: Zeichen in Fachfarbe, Name, Modell, Zustand; rein optisch, `aria-hidden`).
- **Offen:** Befehlsleiste, Zahlen für Chats und Hefteinträge im Atelier-Ledger (keine Daten ohne neue Abfrage), Zähler an den Lagen-Reitern.

## Lagen (D-043)

Stand der Beschreibung: 4. Oktober 2026. Die Richtung ist bewusst begründet gewählt und lässt sich ändern: Tokens, Bewegungssystem und Hülle sind getrennt von den Bildschirmen.

## Idee

Pagewise ist ein Heft: Der Schreibtisch trägt Fensterlicht und Papierkörnung, links liegt der **Heftrücken** (Seitenleiste mit Lochung und Heftfaden), daneben der **Blattstapel**. Wer tiefer in die App geht, legt ein Blatt mehr auf den Stapel (Start und Einstellungen 1, Fach 2, Chat 3). Das neue Blatt wird beim Wechsel aufgelegt. Jedes Fach hat eine gedämpfte **Fachfarbe** (Washi-Streifen, Balken, Punkt, Licht auf dem Schreibtisch) und ein hauchdünnes **Linienmotiv** (sein Symbol, groß). Der Lesebereich im Chat bleibt ruhig: keine Bewegung hinter dem Text, nur Papier.

Was bleibt (Identität aus Abschnitt 10 des Pflichtenhefts): warme, papierartige Flächen, Graphit als Bedienfarbe, Instrument Sans und Inter (selbst gehostet), Research Blue nur für Links und kleine Akzente, warme Graphit-Töne im Dunkelmodus. Kein Neon, kein „KI-Look“.

Rahmen und Startfläche folgen der **gewählten** Darstellung, nicht nur dem Gerät: `index.html` hält drei `theme-color`-Metas (media-Zweige für Gerät hell/dunkel, dazu eine ohne media), die `public/boot.js` vor dem ersten Anstrich und `ui/theme.ts` beim Umschalten auf die Flächenfarbe setzt (`THEME_COLORS`: Eggshell `#fdfcfb`, Night Canvas `#191918` — die Flächen sind in allen drei Richtungen gleich). Das Manifest nennt dieselben Werte, dunkel als `color_scheme_dark` (W3C-Standard; Chrome setzt es um, Safari ignoriert es).

## Dateien

| Datei | Inhalt |
| --- | --- |
| `apps/web/src/styles/tokens.css` | Palette, semantische Tokens hell und dunkel, die acht Fachfarben |
| `apps/web/src/styles/motion.css` | Bewegungssystem: `--m`, Dauern, Federn, Effektstufen, Keyframes, Hilfsklassen `mo-*` |
| `apps/web/src/styles/lagen.css` | Hülle: Schreibtisch, Heftrücken, Blattstapel, Blatt, Zettel, Washi, Zeilen, Umschalter |
| `apps/web/src/ui/fx.ts`, `public/boot.js` | Effektstufe lesen, setzen, folgen; `boot.js` setzt Darstellung, Stufe und `theme-color` vor dem ersten Anstrich |
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
- **Leistung:** Flächen bewegen sich nur per `transform` und `opacity`, dazu die Lichtfarbe auf dem Schreibtisch (`@property`). Ausnahme (D-058): an Bedienelementen (Knöpfe, Zeilen, Reiter, Schalter, Felder) dürfen Farbe, Rand und Schatten kurz wechseln, `transition` mit `var(--t-color)` (140 ms bei „Voll“, 0 ms bei „Reduziert“ und „Aus“), nie auf großen Flächen. Der Schreibtisch ist eine feste Fläche hinter allem (kein `background-attachment: fixed`). Dauerläufer (Schimmer, Schreibmarke) laufen nur auf kleinen Flächen und pausieren im Hintergrund-Tab (`tab-hidden`). Keine großen `backdrop-filter`.
- **Blattwechsel:** nicht mit der View-Transitions-API, sondern als Ankunftsanimation des neuen Blatts (`lg-arrive`). Der Grund: Die Seite scrollt als Ganzes (wichtig für die Tastatur auf dem iPad, siehe D-028), eine View Transition müsste die ganze, womöglich sehr hohe Seite abbilden.

## Regeln für neue Bildschirme

1. Ein Bildschirm ist ein Blatt: `Sheet` (`width="wide"` oder `"prose"`) und darin Abschnitte mit `sectionTitle` (`ui/styles.ts`). Listenzeilen nutzen `listRow` (Balken in Fachfarbe beim Darüberfahren).
2. Farben nur über Tokens (`bg-sheet`, `text-ink-muted`, `border-line-warm`, `bg-subj` …), keine festen Werte. Texte in `i18n/de.ts`.
3. Bewegung nur über die `mo-*`-Klassen oder Variablen aus `motion.css`. Neue Keyframes brauchen `--m`, damit „Reduziert“ greift. Kein `style={…}` (CSP, D-023); dynamische Werte per `element.style.setProperty` über das CSSOM.
4. Bedienflächen mindestens 44 px, sichtbarer Fokus (`:focus-visible`), Tastaturbedienung, Zielgröße auch bei Symbolen.
5. Neue Abhängigkeiten (Animationsbibliothek, Shader, Canvas) nur nach Prüfung von Version, Größe, Lizenz und CSP-Verträglichkeit.

## Interaktive Blöcke im Chat (D-059, 25. Oktober 2026)

- Das Quiz ist ein Bedienelement, kein Bild: Antwortfelder sind echte Optionsfelder in einer Gruppe mit Legende (Tastatur: Pfeiltasten, Leertaste), Mindesthöhe 44 px, Fokus sichtbar über `outline` der Bedienfläche.
- Richtig und Falsch stehen als Text mit Symbol da, nie nur als Farbe. Das Ergebnis erhält nach „Prüfen“ den Fokus.
- Fläche: `bg-paper` (Blatt in allen drei Richtungen), Rand über `control-edge` und die Akzentfarbe; Kanten wechseln nur nach dem Prüfen.
- Auswertung nur im Speicher der Ansicht: kein Netz, nichts wird gespeichert, „Noch einmal“ setzt alles zurück.

## Unterstützte Browser

Voll: Safari 17.2 und neuer (iOS und iPadOS 17.2+), Chrome und Firefox der letzten Jahre. Die Federn nutzen `linear()` (Safari 17.2), die Lichtfarbe `@property` (Safari 16.4), der Umschalter `:has()` (Safari 15.4), Mischfarben `color-mix()` (Safari 16.2). Ältere Geräte verlieren Bewegung und Licht, die Oberfläche bleibt benutzbar; Rückfälle sind vorgesehen (Feder als `cubic-bezier`, Licht ohne Übergang).

## Nicht gebaut (bewusst später)

- Beweglicher Streifen in der Seitenleiste (Markierung gleitet zwischen Einträgen): braucht Messung der Einträge, fehleranfällig bei aufklappenden Untergruppen.
- Startseite mit „Als Nächstes“, Stunden und „Jetzt“-Linie ist gebaut (siehe D-058 oben); Fortschritt je Test gibt es mangels Daten nicht.
- Befehlsleiste (Cmd/Strg + K).
