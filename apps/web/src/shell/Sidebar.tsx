import {
  CalendarDays,
  ChevronRight,
  ClipboardList,
  House,
  MessageCircle,
  Plus,
  Settings,
} from 'lucide-react';
import { type Ref, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Subject } from '../api/types';
import { messages as m } from '../i18n';
import { type Route, useRoute } from '../router';
import { SubjectDialog } from '../screens/SubjectDialog';
import type { Design } from '../ui/design';
import { Link } from '../ui/Link';
import { SubjectIcon } from '../ui/SubjectIcon';
import { subjectColorAttr } from '../ui/subject-color';
import { useDesign } from '../ui/useDesign';
import { useWorkspace } from '../workspace/WorkspaceProvider';

// Ein Eintrag der Leiste. Der gewählte (aria-current) wird in lagen.css zum aufgelegten Streifen mit Balken
// in der Fachfarbe.
const rowBase =
  'lg-nav-item flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[10px] border border-transparent pr-3 pl-3.5 text-ink-secondary no-underline';
const rowActive = 'font-medium text-ink';

// Der Eintrag, hinter dem der Streifen liegt (M1-T4): die gewählte Seite oder — im Chat — das Fach,
// in dem er steht. Ohne Treffer (etwa Einstellungen in der festen Leiste) bleibt der Streifen unsichtbar.
const markerZiel = '.lg-nav-item[aria-current="page"], .lg-nav-item[data-current="true"]';

// Aufgeklappte Fächer der Leiste — bewusst außerhalb der Komponente (F-073): Die Schublade mountet
// die Leiste bei jedem Öffnen neu (AppShell), ein lokaler Zustand würde darum beim Schließen kippen.
// Das aktive Fach kommt hinzu, sobald eine Leisten-Instanz es sieht; zugeklappt wird nur per Knopf.
let openGroups = new Set<string>();

function isActive(route: Route, subjectId: string, groupId: string | null): boolean {
  return route.name === 'subject' && route.subjectId === subjectId && route.groupId === groupId;
}

/** Hebt das Aufklappen eines Fachs über die Instanz hinaus (Schublade aus/ein). */
function addOpenGroup(id: string) {
  openGroups = new Set(openGroups).add(id);
}

/**
 * Kleine Marke vor dem Wortzeichen, eine je Richtung (Mockups): Lagen ein Blatt mit Zeilen, Atelier ein
 * gefülltes Feld mit Blatt, Raum zwei aufgeschlagene Seiten mit Fachlinie. Reine Zier, daher aria-hidden;
 * der Name steht als Text daneben. Farben über Tokens (currentColor, Utility-Klassen), nie feste Werte.
 */
function BrandMark({ design }: { design: Design | null }) {
  const stroke = {
    fill: 'none',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const;
  if (design === 'atelier') {
    return (
      <svg aria-hidden="true" viewBox="0 0 28 28" className="size-7 shrink-0">
        <rect width="28" height="28" rx="8" className="fill-current" />
        <g {...stroke} className="stroke-desk">
          <path d="M9 7.5h7l4 4V20.5H9z" />
          <path d="M16 7.5v4h4M11.5 15h6M11.5 17.8h4" />
        </g>
      </svg>
    );
  }
  if (design === 'raum') {
    return (
      <svg aria-hidden="true" viewBox="0 0 26 26" className="size-[26px] shrink-0">
        <g {...stroke} className="stroke-current">
          <path d="M4 6.5c3.2-1.6 6.3-1.4 9 .8v14c-2.7-2.2-5.8-2.4-9-.8z" />
          <path d="M22 6.5c-3.2-1.6-6.3-1.4-9 .8v14c2.7-2.2 5.8-2.4 9-.8z" />
        </g>
        <path d="M13 7.3v14" {...stroke} className="stroke-accent" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 26 26" className="size-[26px] shrink-0">
      <g {...stroke} className="stroke-current">
        <rect x="4" y="3.5" width="14" height="17" rx="2.2" />
        <path d="M21.5 7.5v13.3a2.2 2.2 0 0 1-2.2 2.2H8.5" />
        <path d="M8 9h6M8 12.5h6M8 16h3.5" />
      </g>
    </svg>
  );
}

/** Ein Fach als Zeile, aufklappbar zu den Untergruppen. Das eingebaute Fach „Standard“ bekommt ein eigenes Symbol. */
function SubjectRow({
  subject,
  route,
  expanded,
  onToggle,
  onNavigate,
  liRef,
}: {
  subject: Subject;
  route: Route;
  expanded: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  /** DOM der Zeile für den Bildlauf zum aktiven Eintrag (shell-home#09); nur die aktive Zeile bekommt ihn. */
  liRef?: Ref<HTMLLIElement>;
}) {
  const panelId = useId();
  const active = isActive(route, subject.id, null);
  const inChat = (route.name === 'chat' || route.name === 'note') && route.subjectId === subject.id;
  return (
    <li ref={liRef} data-subj={subjectColorAttr(subject.color)}>
      <div className="flex items-center">
        <Link
          to={{ name: 'subject', subjectId: subject.id, groupId: null }}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          data-current={inChat ? 'true' : undefined}
          className={`${rowBase} ${active || inChat ? rowActive : ''}`}
        >
          {subject.kind === 'default' ? (
            <MessageCircle aria-hidden="true" strokeWidth={1.6} className="size-5 shrink-0" />
          ) : (
            <SubjectIcon icon={subject.icon} className="size-5 shrink-0" />
          )}
          <span title={subject.name} className="truncate">
            {subject.name}
          </span>
          {subject.kind !== 'default' && <span aria-hidden="true" className="lg-dot ml-auto" />}
        </Link>
        {subject.groups.length > 0 ? (
          <button
            type="button"
            id={`${panelId}-knopf`}
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={`${subject.name}: ${m.sidebar.groups}`}
            className="mo-press inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-ink-muted hover:text-ink"
          >
            <ChevronRight
              aria-hidden="true"
              className={`size-4 transition-transform duration-[var(--t-med)] ease-[var(--spring-snap)] ${expanded ? 'rotate-90' : ''}`}
            />
          </button>
        ) : (
          /* Ohne Untergruppen bleibt die Pfeilspalte als gleicher Platz reserviert (M4-T001), damit der
             Fachpunkt (lg-dot, hängt am rechten Rand des Links) in allen Zeilen in einer Spalte steht. */
          <span aria-hidden="true" className="size-11 shrink-0" />
        )}
      </div>
      {/* Das Panel bleibt im Baum und klappt mit dem hidden-Attribut zu (F-073): aria-controls zeigt
          dauerhaft auf ein vorhandenes Ziel, und Wer-hier-was-Listen treffen die Untergruppen. Kein
          Autor-Stil färbt hier auf display ein (UL ohne lg-*), darum greift das UA-Versteck sicher. */}
      <ul
        id={panelId}
        aria-labelledby={`${panelId}-knopf`}
        hidden={!expanded}
        className="mt-0.5 ml-[1.625rem] space-y-0.5 border-l border-line-warm pl-2"
      >
        {subject.groups.map((group) => {
          const groupActive = isActive(route, subject.id, group.id);
          return (
            <li key={group.id}>
              <Link
                to={{ name: 'subject', subjectId: subject.id, groupId: group.id }}
                onClick={onNavigate}
                aria-current={groupActive ? 'page' : undefined}
                className={`${rowBase} ${groupActive ? rowActive : ''} text-sm`}
              >
                <span title={group.name} className="truncate">
                  {group.name}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/**
 * Navigation: der Name „Pagewise“ öffnet den fachunabhängigen Standard-Chat, darunter „Start“, das
 * eingebaute Fach „Standard“ und die Fächer des Nutzers. Wird fest (breit) und als Schublade (schmal) genutzt.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { subjects, defaultSubject } = useWorkspace();
  const route = useRoute();
  const design = useDesign();
  const lagen = design === 'lagen';
  const activeSubjectId =
    route.name === 'subject' || route.name === 'chat' || route.name === 'note'
      ? route.subjectId
      : null;
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => {
    // Frisch gemountete Leiste (Schublade): der gemerkte Zustand bleibt; das aktive Fach liegt offen,
    // der nachfolgende Effekt holt es nach, wenn diese Instanz es zuerst sieht.
    return new Set(activeSubjectId ? [...openGroups, activeSubjectId] : openGroups);
  });
  // Schlüssel des zuletzt in den Blick geholten Eintrags: Nur ein Wechsel des aktiven Eintrags scrollt
  // (shell-home#09), das erneute Rendern einer Instanz mit demselben Eintrag stört den Bildlauf nicht.
  const scrolledFor = useRef<string | null>(null);
  const listeRef = useRef<HTMLDivElement | null>(null);
  // Der eine Streifen hinter dem aktiven Eintrag (M1-T4). Er liegt im Scrollbereich der Liste, damit
  // er beim Scrollen mitwandert, und bekommt Versatz und Maße als CSS-Variablen (kein style-Attribut).
  const markerRef = useRef<HTMLSpanElement | null>(null);
  // Das DOM des aktiven Eintrags hängt am Fach („Standard“ ist immer da), nicht an der Route;
  // das umschließende <li> trägt es, damit Link (ohne ref-Prop) unberührt bleibt.
  const aktiveRef = useRef<HTMLLIElement | null>(null);

  /**
   * Streifen auf den aktiven Eintrag legen. Gemessen wird gegen die Liste (Versatz plus Scrollstand),
   * damit `translateY` im Inhalt der Liste gilt und der Streifen beim Scrollen von selbst folgt.
   * Ein eingeklappter oder ausgeblendeter Eintrag hat keine Höhe und zählt darum nicht.
   */
  const messeStreifen = useCallback(() => {
    const liste = listeRef.current;
    const marker = markerRef.current;
    if (!liste || !marker) return;
    let ziel: HTMLElement | null = null;
    for (const kandidat of liste.querySelectorAll<HTMLElement>(markerZiel)) {
      if (kandidat.getBoundingClientRect().height > 0) {
        ziel = kandidat;
        break;
      }
    }
    if (!ziel) {
      marker.style.setProperty('--lg-marker-o', '0');
      return;
    }
    const listeRect = liste.getBoundingClientRect();
    const zielRect = ziel.getBoundingClientRect();
    marker.style.setProperty(
      '--lg-marker-y',
      `${zielRect.top - listeRect.top + liste.scrollTop}px`,
    );
    marker.style.setProperty('--lg-marker-h', `${zielRect.height}px`);
    marker.style.setProperty('--lg-marker-x', `${zielRect.left - listeRect.left}px`);
    marker.style.setProperty('--lg-marker-w', `${zielRect.width}px`);
    marker.style.setProperty('--lg-marker-o', '1');
  }, []);

  // Das aktive Fach ist immer aufgeklappt, auch nach einem Sprung über einen Link — und es bleibt
  // über das Ende der Instanz hinaus gemerkt (Schublade schließen und wieder öffnen, F-073).
  useEffect(() => {
    if (activeSubjectId) addOpenGroup(activeSubjectId);
  }, [activeSubjectId]);

  // Aktiven Eintrag in den sichtbaren Bereich holen (shell-home#09): nur wenn der Schlüssel wechselt,
  // und erst nach dem Layout, damit die Zielposition stimmt. jsdom hat kein Layout; dort bleibt es
  // beim Aufruf, gemessen wird im Echtbrowser (shots/M4-T009/).
  useLayoutEffect(() => {
    const ziel = aktiveRef.current;
    const liste = listeRef.current;
    if (!ziel || !liste) return;
    const schlüssel = `${activeSubjectId ?? route.name}:${liste === document.querySelector('nav .overflow-y-auto') ? '' : 'schublade'}`;
    if (scrolledFor.current === schlüssel) return;
    scrolledFor.current = schlüssel;
    if (ziel.scrollIntoView) ziel.scrollIntoView({ block: 'nearest' });
  }, [activeSubjectId, route.name]);

  // Der Streifen folgt Ansicht, Aufklappzustand und Fächerliste: nach jedem Rendern neu messen (die
  // Werte ändern sich nur, wenn sich das Layout ändert). Erst nach dem ersten Anstrich wird der
  // Übergang freigegeben — die Schublade hängt die Leiste neu ein, der Streifen soll dort sofort
  // richtig stehen statt von oben einzufahren.
  useLayoutEffect(() => {
    if (!lagen) return;
    messeStreifen();
    const marker = markerRef.current;
    if (!marker || marker.dataset.ready === 'true') return;
    let zweiter = 0;
    const erster = requestAnimationFrame(() => {
      zweiter = requestAnimationFrame(() => {
        marker.dataset.ready = 'true';
      });
    });
    return () => {
      cancelAnimationFrame(erster);
      cancelAnimationFrame(zweiter);
    };
  });

  // Scrollen und Größenänderungen der Leiste (Fenster, Schublade) verschieben den aktiven Eintrag.
  useEffect(() => {
    if (!lagen) return;
    const liste = listeRef.current;
    if (!liste) return;
    const messen = () => messeStreifen();
    liste.addEventListener('scroll', messen, { passive: true });
    window.addEventListener('resize', messen);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => messeStreifen());
    observer?.observe(liste);
    return () => {
      liste.removeEventListener('scroll', messen);
      window.removeEventListener('resize', messen);
      observer?.disconnect();
    };
  }, [lagen, messeStreifen]);

  function toggle(id: string) {
    // Nächsten Zustand aus dem aktuellen berechnen (kein Nebeneffekt im Updater: Updater können
    // doppelt laufen, z. B. im StrictMode der Entwicklung).
    const next = new Set(open);
    if (!next.delete(id)) next.add(id);
    openGroups = next;
    setOpen(next);
  }

  const row = (subject: Subject) => (
    <SubjectRow
      key={subject.id}
      subject={subject}
      route={route}
      expanded={open.has(subject.id)}
      onToggle={() => toggle(subject.id)}
      onNavigate={onNavigate}
      liRef={activeSubjectId === subject.id ? aktiveRef : undefined}
    />
  );

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div aria-hidden="true" className="lg-spine" />
      <nav
        aria-label={m.shell.navigation}
        className={`flex h-full min-w-0 flex-1 flex-col pt-[max(1.125rem,env(safe-area-inset-top))] lg-compact`}
      >
        <div className="lg-kopf-wrap pr-3 pl-2 pb-3">
          <Link
            to={{ name: 'default-chat' }}
            onClick={onNavigate}
            aria-label={m.shell.defaultChat}
            title={m.shell.defaultChat}
            className="lg-kopf lg-brand mo-press inline-flex min-h-12 items-center gap-2.5 rounded-[10px] px-3 font-heading text-[22px] tracking-[-0.3px] text-ink no-underline"
          >
            <BrandMark design={design} />
            {m.app.name}
          </Link>
        </div>

        <div ref={listeRef} className="lg-liste flex-1 overflow-y-auto pr-3 pl-2 pb-4">
          {lagen && <span ref={markerRef} aria-hidden="true" className="lg-nav-marker" />}
          <ul className="space-y-0.5 pb-3">
            <li className="flex items-center">
              <Link
                to={{ name: 'home' }}
                onClick={onNavigate}
                aria-current={route.name === 'home' ? 'page' : undefined}
                className={`${rowBase} ${route.name === 'home' ? rowActive : ''}`}
              >
                <House aria-hidden="true" strokeWidth={1.6} className="size-5 shrink-0" />
                {m.sidebar.home}
              </Link>
            </li>
            {row(defaultSubject)}
            <li className="flex items-center">
              <Link
                to={{ name: 'timetable' }}
                onClick={onNavigate}
                aria-current={route.name === 'timetable' ? 'page' : undefined}
                className={`${rowBase} ${route.name === 'timetable' ? rowActive : ''}`}
              >
                <CalendarDays aria-hidden="true" strokeWidth={1.6} className="size-5 shrink-0" />
                {m.sidebar.timetable}
              </Link>
            </li>
            <li className="flex items-center">
              <Link
                to={{ name: 'exams' }}
                onClick={onNavigate}
                aria-current={route.name === 'exams' ? 'page' : undefined}
                className={`${rowBase} ${route.name === 'exams' ? rowActive : ''}`}
              >
                <ClipboardList aria-hidden="true" strokeWidth={1.6} className="size-5 shrink-0" />
                {m.sidebar.exams}
              </Link>
            </li>
          </ul>

          {/* Abschnittstitel, keine Überschrift: im DOM liegt die Seitenleiste vor dem Inhalt,
              ein H2 hier stünde darum vor der H1 der Ansicht (Befund a11y-keyboard #2). */}
          <p
            id="subjects-heading"
            role="presentation"
            className="px-3.5 pt-3 pb-1 font-sans text-[12.5px] font-medium tracking-[0.06em] text-ink-muted uppercase"
          >
            {m.shell.subjects}
          </p>
          <ul className="space-y-0.5">{subjects.map(row)}</ul>
          {subjects.length === 0 && (
            <p className="rounded-box bg-paper px-3 py-3 text-sm text-ink-secondary">
              {m.sidebar.empty}
            </p>
          )}
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mo-press mt-1 flex min-h-11 w-full items-center gap-3 rounded-[10px] pl-3.5 text-ink-muted hover:text-ink"
          >
            <Plus aria-hidden="true" strokeWidth={1.6} className="size-5 shrink-0" />
            {m.shell.addSubject}
          </button>

          {/* Zweite Fuß-Instanz für das Querformat (shell-home#09): im Compact-Modus zeigt die
              Medienabfrage in lagen.css nur diese an (der feste Fuß unten wird ausgeblendet) — die
              Einstellungen stehen dann als letzte Zeile in der Liste und sind mitgescrollt. */}
          <div className="lg-fuss-inliste mt-1 hidden border-t border-line-warm pt-2">
            <Link
              to={{ name: 'settings' }}
              onClick={onNavigate}
              aria-current={route.name === 'settings' ? 'page' : undefined}
              className={`${rowBase} ${route.name === 'settings' ? rowActive : ''}`}
            >
              <Settings aria-hidden="true" strokeWidth={1.6} className="size-5" />
              {m.shell.settings}
            </Link>
          </div>
        </div>

        <div className="lg-fuss border-t border-line-warm py-2 pr-3 pl-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Link
            to={{ name: 'settings' }}
            onClick={onNavigate}
            aria-current={route.name === 'settings' ? 'page' : undefined}
            className={`${rowBase} ${route.name === 'settings' ? rowActive : ''}`}
          >
            <Settings aria-hidden="true" strokeWidth={1.6} className="size-5" />
            {m.shell.settings}
          </Link>
        </div>
        {creating && (
          <SubjectDialog
            onClose={() => {
              // Nach dem Anlegen ist das neue Fach in der Liste: die Schublade macht zu.
              onNavigate?.();
              setCreating(false);
            }}
          />
        )}
      </nav>
    </div>
  );
}
