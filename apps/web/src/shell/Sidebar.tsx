import { ChevronRight, Plus, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { messages as m } from '../i18n';
import { type Route, useRoute } from '../router';
import { SubjectDialog } from '../screens/SubjectDialog';
import { Link } from '../ui/Link';
import { SubjectIcon } from '../ui/SubjectIcon';
import { useWorkspace } from '../workspace/WorkspaceProvider';

const rowBase =
  'flex min-h-11 flex-1 items-center gap-2.5 rounded-control px-2.5 text-ink-secondary hover:bg-paper hover:text-ink';
const rowActive = 'bg-paper font-medium text-ink';

function isActive(route: Route, subjectId: string, groupId: string | null): boolean {
  return route.name === 'subject' && route.subjectId === subjectId && route.groupId === groupId;
}

/** Fächer als Liste, aufklappbar zu den Untergruppen. Wird fest (breit) und als Schublade (schmal) genutzt. */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { subjects } = useWorkspace();
  const route = useRoute();
  const activeSubjectId = route.name === 'subject' ? route.subjectId : null;
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

  return (
    <nav
      aria-label={m.shell.navigation}
      className="flex h-full flex-col pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      <div className="px-4 pb-4">
        <Link
          to={{ name: 'home' }}
          onClick={onNavigate}
          className="inline-flex min-h-11 items-center font-heading text-xl text-ink no-underline"
        >
          {m.app.name}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <h2 className="px-2.5 pb-1 text-meta font-medium text-ink-muted">{m.shell.subjects}</h2>
        <ul className="space-y-0.5">
          {subjects.map((subject) => {
            const expanded = open.has(subject.id);
            const panelId = `groups-${subject.id}`;
            const active = isActive(route, subject.id, null);
            return (
              <li key={subject.id}>
                <div className="flex items-center">
                  <Link
                    to={{ name: 'subject', subjectId: subject.id, groupId: null }}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`${rowBase} ${active ? rowActive : ''} no-underline`}
                  >
                    <SubjectIcon icon={subject.icon} className="size-[18px] shrink-0" />
                    <span className="truncate">{subject.name}</span>
                  </Link>
                  {subject.groups.length > 0 && (
                    <button
                      type="button"
                      onClick={() => toggle(subject.id)}
                      aria-expanded={expanded}
                      aria-controls={panelId}
                      aria-label={`${subject.name}: ${m.sidebar.groups}`}
                      className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink"
                    >
                      <ChevronRight
                        aria-hidden="true"
                        className={`size-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
                      />
                    </button>
                  )}
                </div>
                {expanded && subject.groups.length > 0 && (
                  <ul
                    id={panelId}
                    className="mt-0.5 ml-[1.625rem] space-y-0.5 border-l border-line pl-2"
                  >
                    {subject.groups.map((group) => {
                      const groupActive = isActive(route, subject.id, group.id);
                      return (
                        <li key={group.id}>
                          <Link
                            to={{ name: 'subject', subjectId: subject.id, groupId: group.id }}
                            onClick={onNavigate}
                            aria-current={groupActive ? 'page' : undefined}
                            className={`${rowBase} ${groupActive ? rowActive : ''} text-sm no-underline`}
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
          })}
        </ul>
        {subjects.length === 0 && (
          <p className="rounded-box bg-paper px-3 py-3 text-sm text-ink-secondary">
            {m.sidebar.empty}
          </p>
        )}
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="mt-1 flex min-h-11 w-full items-center gap-2.5 rounded-control px-2.5 text-ink-muted hover:bg-paper hover:text-ink"
        >
          <Plus aria-hidden="true" strokeWidth={1.6} className="size-[18px] shrink-0" />
          {m.shell.addSubject}
        </button>
      </div>

      <div className="border-t border-line p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <Link
          to={{ name: 'settings' }}
          onClick={onNavigate}
          aria-current={route.name === 'settings' ? 'page' : undefined}
          className={`${rowBase} ${route.name === 'settings' ? rowActive : ''} no-underline`}
        >
          <Settings aria-hidden="true" strokeWidth={1.6} className="size-[18px]" />
          {m.shell.settings}
        </Link>
      </div>
      {creating && <SubjectDialog onClose={() => setCreating(false)} />}
    </nav>
  );
}
