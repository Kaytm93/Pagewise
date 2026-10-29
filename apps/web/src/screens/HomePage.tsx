import { MessageCircle, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { messages as m } from '../i18n';
import { NextUp } from '../planning/NextUp';
import { usePlanner } from '../planning/PlannerProvider';
import { navigate } from '../router';
import { Button } from '../ui/Button';
import { Link } from '../ui/Link';
import { Sheet } from '../ui/Sheet';
import { SubjectIcon } from '../ui/SubjectIcon';
import { subjectColorAttr } from '../ui/subject-color';
import { useDesign } from '../ui/useDesign';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { StartAtelier } from './atelier/StartAtelier';
import { AskForm } from './home/AskForm';
import { startHeadingFor } from './home/start-heading';
import { RecentChats, useRecentChats } from './lagen/RecentChats';
import { StartGrid } from './lagen/StartGrid';
import { StartPlan } from './raum/StartPlan';
import { SubjectDialog } from './SubjectDialog';
import { groupCount, subjectMeta } from './subject-meta';

const dateFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** Zeitgrenze für den Startbereich: „Warten mit Zeitgrenze, 2 Sekunden“ (Entscheidung von Kay, 29.10.). */
const START_WAIT_MS = 2000;

/**
 * Wann der Startbereich erscheint:
 * - `waiting`: nur die Kopfzeile, bis Planer und „Zuletzt genutzt“ geladen sind.
 * - `full`: alle Bereiche, mit „Als Nächstes“ und „Zuletzt genutzt“.
 * - `short`: ohne „Als Nächstes“ und „Zuletzt genutzt“. Das gilt nach der Zeitgrenze und sofort bei einem
 *   Planer-Fehler. Die Entscheidung bleibt für diesen Seitenaufruf, damit die Fächerliste nicht springt.
 */
type StartReveal = 'waiting' | 'full' | 'short';

function useStartReveal(
  plannerStatus: 'loading' | 'ready' | 'error',
  recentLoaded: boolean,
): StartReveal {
  const [reveal, setReveal] = useState<StartReveal>('waiting');

  // Die Zeitgrenze zählt ab dem Seitenaufruf: Beim ersten Einblenden der Startseite ist davon schon die Zeit
  // seit dem Seitenbeginn vergangen (Arbeitsbereich lädt davor). Später zählt sie ab dem Einblenden.
  // Sie ändert sich nicht, wenn Daten nachkommen.
  useEffect(() => {
    const elapsed = performance.now();
    const left = elapsed < START_WAIT_MS ? START_WAIT_MS - elapsed : START_WAIT_MS;
    const timer = setTimeout(
      () => setReveal((current) => (current === 'waiting' ? 'short' : current)),
      left,
    );
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (plannerStatus === 'error') {
      setReveal((current) => (current === 'waiting' ? 'short' : current));
    } else if (plannerStatus === 'ready' && recentLoaded) {
      setReveal((current) => (current === 'waiting' ? 'full' : current));
    }
  }, [plannerStatus, recentLoaded]);

  return reveal;
}

export function HomePage() {
  const { subjects } = useWorkspace();
  const { status, entries, exams, weekAnchor, now } = usePlanner();
  const design = useDesign();
  const recent = useRecentChats();
  const reveal = useStartReveal(status, recent !== null);
  const [creating, setCreating] = useState(false);
  const dialog = creating && <SubjectDialog onClose={() => setCreating(false)} />;

  if (subjects.length === 0) {
    return (
      <Sheet>
        <h1 className="font-heading text-[clamp(34px,6vw,52px)] leading-[1.1] tracking-[-0.025em] text-balance">
          {m.home.emptyTitle}
        </h1>
        <p className="mt-3 max-w-prose text-ink-secondary">{m.home.emptyLead}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setCreating(true)}>
            {m.subjectDialog.createTitle}
          </Button>
          <Button variant="secondary" onClick={() => navigate({ name: 'default-chat' })}>
            {m.home.startChat}
          </Button>
        </div>
        {dialog}
      </Sheet>
    );
  }

  // Die Überschrift nennt Stunden und Test von heute, sobald der Plan geladen ist; sonst der feste Text.
  const heading =
    status === 'ready'
      ? startHeadingFor({
          entries,
          exams,
          weekAnchor,
          now,
          subjectName: (id) => subjects.find((subject) => subject.id === id)?.name ?? null,
        })
      : null;

  // Ohne gesetzte Richtung (nur in Tests) gilt wie bisher der Aufbau von „Raum“, die Voreinstellung.
  const raum = design !== 'lagen' && design !== 'atelier';
  // „Raum“ setzt die Zeilen runder (Mockup C); die anderen Richtungen behalten ihre fast eckigen Zeilen.
  const rowRadius = raum ? 'rounded-[8px]' : 'rounded-[2px]';

  const head = (
    <>
      <p className="mo-rise text-sm text-ink-muted">{dateFormat.format(new Date())}</p>
      <h1 className="mo-rise mo-i-1 mt-2.5 max-w-[760px] font-heading text-[clamp(34px,5.4vw,56px)] leading-[1.12] tracking-[-0.025em] text-balance">
        {heading ?? m.home.heading}
      </h1>
    </>
  );

  // Die Frage an den Standard-Chat: in „Raum“ unten als feste Zeile (Mockup C), sonst unter der Überschrift.
  const ask = (
    <div className={raum ? 'rm-start-dock mo-rise mo-i-5' : 'mo-rise mo-i-2'}>
      <AskForm />
      <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-sm text-ink-muted">
        {m.home.or}
        <Link
          to={{ name: 'default-chat' }}
          className="inline-flex min-h-11 items-center underline underline-offset-[3px]"
        >
          {m.home.openDefault}
        </Link>
      </p>
    </div>
  );

  const subjectList = (
    <section className="mo-rise mo-i-4 mt-12" aria-labelledby="home-subjects">
      <h2
        id="home-subjects"
        className="mb-3.5 font-sans text-[15px] font-medium tracking-[0.06em] text-ink-muted uppercase"
      >
        {m.home.title}
      </h2>
      <ul className="border-t border-line-warm">
        <li className="border-b border-line-warm">
          <Link
            to={{ name: 'default-chat' }}
            className={`lg-row grid min-h-16 grid-cols-[auto_1fr_auto] items-center gap-4 ${rowRadius} px-2 py-3.5 text-ink no-underline`}
          >
            <MessageCircle
              aria-hidden="true"
              strokeWidth={1.6}
              className="size-6 text-ink-secondary"
            />
            <span className="min-w-0">
              <span className="block truncate font-heading text-xl tracking-[-0.2px]">
                {m.defaultSubject.homeTitle}
              </span>
              <span className="block truncate text-sm text-ink-muted">
                {m.defaultSubject.homeHint}
              </span>
            </span>
          </Link>
        </li>
        {subjects.map((subject) => {
          const meta = subjectMeta(subject);
          return (
            <li
              key={subject.id}
              data-subj={subjectColorAttr(subject.color)}
              className="border-b border-line-warm"
            >
              <Link
                to={{ name: 'subject', subjectId: subject.id, groupId: null }}
                className={`lg-row grid min-h-16 grid-cols-[auto_1fr_auto] items-center gap-4 ${rowRadius} px-2 py-3.5 text-ink no-underline`}
              >
                <SubjectIcon icon={subject.icon} className="size-6 text-ink-secondary" />
                <span className="min-w-0">
                  <span className="block truncate font-heading text-xl tracking-[-0.2px]">
                    {subject.name}
                  </span>
                  {meta && <span className="block truncate text-sm text-ink-muted">{meta}</span>}
                </span>
                {subject.groups.length > 0 && (
                  <span className="hidden shrink-0 text-sm text-ink-muted sm:block">
                    {groupCount(subject.groups.length)}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <Button variant="ghost" className="mt-3 -ml-3" onClick={() => setCreating(true)}>
        <Plus aria-hidden="true" className="size-4" />
        {m.shell.addSubject}
      </Button>
    </section>
  );

  if (raum) {
    // Zweispaltig, sobald das Blatt breit genug ist (raum.css, Container „blatt“): links der Tag als
    // Zeitachse, rechts Termine, „Zuletzt genutzt“ und Fächer. Die Eingabe sitzt unten am Blatt.
    return (
      <Sheet width="wide">
        <div className="rm-start">
          {head}
          {reveal !== 'waiting' && (
            <>
              <div className="rm-start-grid">
                <StartPlan />
                <div className="rm-start-side">
                  {reveal === 'full' && <NextUp />}
                  {/* „Zuletzt genutzt“ steht in allen Richtungen, sobald es Chats gibt (gleiche Klassen `lg-*`). */}
                  {reveal === 'full' && <RecentChats chats={recent} />}
                  {subjectList}
                </div>
              </div>
              {ask}
            </>
          )}
        </div>
        {dialog}
      </Sheet>
    );
  }

  return (
    <Sheet width="wide">
      {head}
      {reveal !== 'waiting' && (
        <>
          {ask}
          {design === 'lagen' ? <StartGrid /> : <StartAtelier />}
          {/* „Zuletzt genutzt“ steht in allen Richtungen, sobald es Chats gibt (gleiche Klassen `lg-*`). */}
          {reveal === 'full' && <RecentChats chats={recent} />}
          {subjectList}
        </>
      )}
      {dialog}
    </Sheet>
  );
}
