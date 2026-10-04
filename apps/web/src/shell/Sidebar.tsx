import { ChevronRight, House, MessageCircle, Plus, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Subject } from '../api/types';
import { messages as m } from '../i18n';
import { type Route, useRoute } from '../router';
import { SubjectDialog } from '../screens/SubjectDialog';
import { Link } from '../ui/Link';
import { SubjectIcon } from '../ui/SubjectIcon';
import { subjectColorAttr } from '../ui/subject-color';
import { useWorkspace } from '../workspace/WorkspaceProvider';

// Ein Eintrag der Leiste. Der gewählte (aria-current) wird in lagen.css zum aufgelegten Streifen mit Balken
// in der Fachfarbe.
const rowBase =
  'lg-nav-item flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[10px] border border-transparent pr-3 pl-3.5 text-ink-secondary no-underline';
const rowActive = 'font-medium text-ink';

function isActive(route: Route, subjectId: string, groupId: string | null): boolean {
  return route.name === 'subject' && route.subjectId === subjectId && route.groupId === groupId;
}

/** Ein Fach als Zeile, aufklappbar zu den Untergruppen. Das eingebaute Fach „Standard“ bekommt ein eigenes Symbol. */
function SubjectRow({
  subject,
  route,
  expanded,
  onToggle,
  onNavigate,
}: {
  subject: Subject;
  route: Route;
  expanded: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const panelId = `groups-${subject.id}`;
  const active = isActive(route, subject.id, null);
  const inChat = route.name === 'chat' && route.subjectId === subject.id;
  return (
    <li data-subj={subjectColorAttr(subject.color)}>
      <div className="flex items-center">
        <Link
          to={{ name: 'subject', subjectId: subject.id, groupId: null }}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          data-current={inChat ? 'true' : undefined}
          className={`${rowBase} ${active || inChat ? rowActive : ''}`}
        >
          {subject.kind === 'default' ? (
            <MessageCircle aria-hidden="true" strokeWidth={1.6} className="size-[18px] shrink-0" />
          ) : (
            <SubjectIcon icon={subject.icon} className="size-[18px] shrink-0" />
          )}
          <span className="truncate">{subject.name}</span>
          {subject.kind !== 'default' && <span aria-hidden="true" className="lg-dot ml-auto" />}
        </Link>
        {subject.groups.length > 0 && (
          <button
            type="button"
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
        )}
      </div>
      {expanded && subject.groups.length > 0 && (
        <ul
          id={panelId}
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
                  <span className="truncate">{group.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
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
  const activeSubjectId =
    route.name === 'subject' || route.name === 'chat' ? route.subjectId : null;
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(activeSubjectId ? [activeSubjectId] : []),
  );

  // Das aktive Fach ist immer aufgeklappt, auch nach einem Sprung über einen Link.
  useEffect(() => {
    if (activeSubjectId) setOpen((current) => new Set(current).add(activeSubjectId));
  }, [activeSubjectId]);

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  const row = (subject: Subject) => (
    <SubjectRow
      key={subject.id}
      subject={subject}
      route={route}
      expanded={open.has(subject.id)}
      onToggle={() => toggle(subject.id)}
      onNavigate={onNavigate}
    />
  );

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div aria-hidden="true" className="lg-spine" />
      <nav
        aria-label={m.shell.navigation}
        className="flex h-full min-w-0 flex-1 flex-col pt-[max(1.125rem,env(safe-area-inset-top))]"
      >
        <div className="pr-3 pl-2 pb-3">
          <Link
            to={{ name: 'default-chat' }}
            onClick={onNavigate}
            aria-label={m.shell.defaultChat}
            title={m.shell.defaultChat}
            className="mo-press inline-flex min-h-12 items-center rounded-[10px] px-3 font-heading text-[22px] tracking-[-0.3px] text-ink no-underline"
          >
            {m.app.name}
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto pr-3 pl-2 pb-4">
          <ul className="space-y-0.5 pb-3">
            <li className="flex items-center">
              <Link
                to={{ name: 'home' }}
                onClick={onNavigate}
                aria-current={route.name === 'home' ? 'page' : undefined}
                className={`${rowBase} ${route.name === 'home' ? rowActive : ''}`}
              >
                <House aria-hidden="true" strokeWidth={1.6} className="size-[18px] shrink-0" />
                {m.sidebar.home}
              </Link>
            </li>
            {row(defaultSubject)}
          </ul>

          <h2 className="px-3.5 pt-3 pb-1 font-sans text-[12.5px] font-medium tracking-[0.06em] text-ink-muted uppercase">
            {m.shell.subjects}
          </h2>
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
            <Plus aria-hidden="true" strokeWidth={1.6} className="size-[18px] shrink-0" />
            {m.shell.addSubject}
          </button>
        </div>

        <div className="border-t border-line-warm py-2 pr-3 pl-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Link
            to={{ name: 'settings' }}
            onClick={onNavigate}
            aria-current={route.name === 'settings' ? 'page' : undefined}
            className={`${rowBase} ${route.name === 'settings' ? rowActive : ''}`}
          >
            <Settings aria-hidden="true" strokeWidth={1.6} className="size-[18px]" />
            {m.shell.settings}
          </Link>
        </div>
        {creating && <SubjectDialog onClose={() => setCreating(false)} />}
      </nav>
    </div>
  );
}
