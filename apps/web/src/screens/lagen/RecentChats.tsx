import { useEffect, useState } from 'react';
import type { Chat } from '../../api/types';
import { messages as m } from '../../i18n';
import { useSession } from '../../session/SessionProvider';
import { Link } from '../../ui/Link';
import { SubjectIcon } from '../../ui/SubjectIcon';
import { sectionTitle } from '../../ui/styles';
import { subjectColorAttr } from '../../ui/subject-color';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { formatWhen } from '../chat/when';

const MAX_CHATS = 4;

/**
 * „Zuletzt genutzt“ auf der Startseite in allen Richtungen (M1-T1): die vier zuletzt geänderten
 * Chats über alle Fächer. In „Lagen“ trägt der Fachname die Zeile und der erste Eintrag ist groß (lagen.css,
 * `.lg-recent*`); die anderen Richtungen behalten das bisherige Bild. Die Liste entsteht aus den vorhandenen Chat-Endpunkten; ein Fach, dessen
 * Abfrage scheitert, wird übersprungen. Ohne Chats bleibt der Abschnitt ganz weg.
 */
export function RecentChats() {
  const { api } = useSession();
  const { subjects } = useWorkspace();
  const [chats, setChats] = useState<Chat[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (subjects.length === 0) {
      setChats([]);
      return;
    }
    setChats(null);
    Promise.all(
      subjects.map((subject) => api.chats(subject.id, null).catch(() => [] as Chat[])),
    ).then((lists) => {
      if (cancelled) return;
      setChats(
        lists
          .flat()
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, MAX_CHATS),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [api, subjects]);

  if (!chats || chats.length === 0) return null;

  return (
    <section className="mo-rise mo-i-4 mt-12" aria-labelledby="recent-chats-heading">
      <h2 id="recent-chats-heading" className={`mb-3.5 ${sectionTitle}`}>
        {m.planning.startGrid.recent}
      </h2>
      <ul className="lg-recent border-t border-line-warm">
        {chats.map((chat) => {
          const subject = subjects.find((entry) => entry.id === chat.subjectId);
          const title = chat.title === '' ? m.subject.chatUntitled : chat.title;
          return (
            <li
              key={chat.id}
              data-subj={subjectColorAttr(subject?.color)}
              className="border-b border-line-warm"
            >
              <Link
                to={{ name: 'chat', subjectId: chat.subjectId, chatId: chat.id }}
                className="lg-row grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-[2px] px-2 py-3.5 text-ink no-underline"
              >
                <SubjectIcon
                  icon={subject?.icon ?? null}
                  className="lg-recent-icon size-6 text-ink-secondary"
                />
                <span className="min-w-0">
                  <span className="lg-recent-subject block truncate text-sm text-ink-muted">
                    {subject?.name ?? m.planning.timetable.noSubject}
                  </span>
                  <span className="lg-recent-title block truncate font-heading text-lg tracking-[-0.1px]">
                    {title}
                  </span>
                </span>
                <span className="shrink-0 text-sm text-ink-muted tabular-nums">
                  {formatWhen(chat.updatedAt)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
