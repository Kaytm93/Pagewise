import { messages as m } from '../../i18n';

/**
 * Rahmen der Fachseite in der Richtung „Raum“ (D-045): Register am rechten Blattrand und Ringe hinter
 * dem Fachmotiv. Beides ist reine Darstellung.
 *
 * Das Register zeigt dieselbe Wahl wie die Reiterleiste (`ui/Tabs`), ist aber keine Bedienfläche: es
 * trägt keine Links und keine Schaltflächen, ist `aria-hidden`, lässt Zeiger und Tasten durch
 * (`pointer-events: none`) und steht nicht in der Tabulatorfolge. Die Zungen tragen die vorhandenen
 * Beschriftungen der Reiter; kein neuer Text.
 *
 * Die Ringe sind Zier ohne Aussage: kein Fortschritt, kein Wert, keine Zahl. Sie blenden über
 * `mo-fade` ein; bei `fx-off` überstimmt motion.css jede Animation, sie stehen dann sofort.
 */

/** Vier Zungen; nur „Chats“ und „Hefteinträge“ sind auch Reiter der Fachseite. */
const TONGUES = [
  { id: 'chats', label: m.notes.chats },
  { id: 'notes', label: m.notes.notes },
  { id: 'tests', label: m.sidebar.exams },
  { id: 'hours', label: m.subject.hours },
] as const;

export function SheetRegister({ active }: { active: 'chats' | 'notes' }) {
  return (
    <div className="rm-reg" aria-hidden="true">
      {TONGUES.map((tongue) => (
        <span
          key={tongue.id}
          className="rm-reg-tab"
          data-active={tongue.id === active ? 'true' : 'false'}
        >
          {tongue.label}
        </span>
      ))}
    </div>
  );
}

export function SubjectRings() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 120 120" className="rm-rings mo-fade">
      <circle cx="60" cy="60" r="58" />
      <circle cx="60" cy="60" r="44" />
    </svg>
  );
}
