import { Menu } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { messages as m } from '../i18n';
import { pathFor, type Route, useRoute } from '../router';
import { DefaultChatPage } from '../screens/chat/DefaultChatPage';
import { HomePage } from '../screens/HomePage';
import { NotFoundPage } from '../screens/NotFoundPage';
import { SettingsPage } from '../screens/SettingsPage';
import { SubjectPage } from '../screens/SubjectPage';
import { subjectColorAttr } from '../ui/subject-color';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { Drawer } from './Drawer';
import { ErrorBoundary } from './ErrorBoundary';
import { Sidebar } from './Sidebar';

// Der Chat bringt die Markdown-Darstellung mit und wird erst beim Öffnen eines Chats geladen.
const ChatPage = lazy(() =>
  import('../screens/chat/ChatPage').then((module) => ({ default: module.ChatPage })),
);

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'settings':
      return <SettingsPage />;
    case 'default-chat':
      return <DefaultChatPage />;
    case 'subject':
      return <SubjectPage subjectId={route.subjectId} groupId={route.groupId} />;
    case 'chat':
      return (
        <Suspense
          fallback={
            <p role="status" className="mx-auto max-w-3xl px-4 py-8 text-ink-secondary">
              {m.chat.loading}
            </p>
          }
        >
          <ChatPage key={route.chatId} subjectId={route.subjectId} chatId={route.chatId} />
        </Suspense>
      );
    case 'not-found':
      return <NotFoundPage />;
  }
}

/** Titel der aktuellen Ansicht, für die Kopfzeile auf dem Handy und den Tab-Titel. */
function useTitle(route: Route): string {
  const { findSubject } = useWorkspace();
  if (route.name === 'settings') return m.settings.title;
  if (route.name === 'chat') {
    return findSubject(route.subjectId)?.name ?? m.app.name;
  }
  if (route.name === 'subject') {
    const subject = findSubject(route.subjectId);
    const group = subject?.groups.find((entry) => entry.id === route.groupId);
    return group?.name ?? subject?.name ?? m.app.name;
  }
  return m.app.name;
}

/** Fachfarbe der Ansicht: nur Fach und Chat haben eine, alles andere ist neutral. */
function useRouteColor(route: Route): string | undefined {
  const { findSubject } = useWorkspace();
  if (route.name !== 'subject' && route.name !== 'chat') return undefined;
  return subjectColorAttr(findSubject(route.subjectId)?.color);
}

/** Wie viele Blätter unter dem aktuellen liegen: Start und Einstellungen 1, Fach 2, Chat 3. */
function depthOf(route: Route): 1 | 2 | 3 {
  if (route.name === 'chat') return 3;
  if (route.name === 'subject' || route.name === 'default-chat') return 2;
  return 1;
}

/**
 * Rahmen der angemeldeten App (Gestaltung „Lagen“): ein Schreibtisch, links der Heftrücken als Seitenleiste
 * (ab „md“ fest, darunter als Schublade), daneben der Blattstapel. Wer tiefer in die App geht, legt ein Blatt
 * mehr auf den Stapel; das neue Blatt wird beim Wechsel aufgelegt.
 */
export function AppShell() {
  const route = useRoute();
  const title = useTitle(route);
  const color = useRouteColor(route);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    document.title = title === m.app.name ? m.app.name : `${title} · ${m.app.name}`;
  }, [title]);

  return (
    <div className="lg-app md:grid md:grid-cols-[17.25rem_1fr]" data-subj={color}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-control focus:border focus:border-line focus:bg-canvas focus:px-3 focus:py-2"
      >
        {m.common.skipToContent}
      </a>

      <aside className="sticky top-0 hidden h-dvh py-3.5 md:block">
        <div className="lg-binder">
          <Sidebar />
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="sticky top-0 z-30 bg-desk pt-[env(safe-area-inset-top)] md:hidden">
          <div className="flex h-14 items-center gap-1 px-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label={m.common.openMenu}
              aria-expanded={drawerOpen}
              className="mo-press inline-flex size-11 items-center justify-center rounded-[12px] text-ink hover:bg-paper"
            >
              <Menu aria-hidden="true" className="size-5" />
            </button>
            <p className="truncate font-heading text-xl tracking-[-0.2px]">{title}</p>
          </div>
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="flex-1 px-3 pt-1 pr-[1.75rem] pb-[max(1.75rem,env(safe-area-inset-bottom))] outline-none md:py-3.5 md:pr-12 md:pl-0"
        >
          <div className="lg-stack mx-auto max-w-[1180px]" data-depth={depthOf(route)}>
            <div aria-hidden="true" className="lg-ply lg-p1" />
            <div aria-hidden="true" className="lg-ply lg-p2" />
            <div aria-hidden="true" className="lg-ply lg-p3" />
            <div key={pathFor(route)} className="lg-arrive">
              <ErrorBoundary resetKey={pathFor(route)}>
                <Page route={route} />
              </ErrorBoundary>
            </div>
          </div>
        </main>
      </div>

      {drawerOpen && (
        <Drawer label={m.shell.navigation} onClose={() => setDrawerOpen(false)}>
          <Sidebar onNavigate={() => setDrawerOpen(false)} />
        </Drawer>
      )}
    </div>
  );
}
