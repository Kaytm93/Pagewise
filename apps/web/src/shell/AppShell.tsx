import { Menu } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { messages as m } from '../i18n';
import { type Route, useRoute } from '../router';
import { HomePage } from '../screens/HomePage';
import { NotFoundPage } from '../screens/NotFoundPage';
import { SettingsPage } from '../screens/SettingsPage';
import { SubjectPage } from '../screens/SubjectPage';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { Drawer } from './Drawer';
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
  const { subjects } = useWorkspace();
  if (route.name === 'settings') return m.settings.title;
  if (route.name === 'chat') {
    return subjects.find((entry) => entry.id === route.subjectId)?.name ?? m.app.name;
  }
  if (route.name === 'subject') {
    const subject = subjects.find((entry) => entry.id === route.subjectId);
    const group = subject?.groups.find((entry) => entry.id === route.groupId);
    return group?.name ?? subject?.name ?? m.app.name;
  }
  return m.app.name;
}

/** Rahmen der angemeldeten App: feste Seitenleiste ab „md“, darunter eine Kopfzeile mit Schublade. */
export function AppShell() {
  const route = useRoute();
  const title = useTitle(route);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    document.title = title === m.app.name ? m.app.name : `${title} · ${m.app.name}`;
  }, [title]);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[18rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-control focus:border focus:border-line focus:bg-canvas focus:px-3 focus:py-2"
      >
        {m.common.skipToContent}
      </a>

      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-canvas md:block">
        <Sidebar />
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-canvas pt-[env(safe-area-inset-top)] md:hidden">
          <div className="flex h-14 items-center gap-1 px-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label={m.common.openMenu}
              aria-expanded={drawerOpen}
              className="inline-flex size-11 items-center justify-center rounded-control text-ink-secondary hover:bg-paper hover:text-ink"
            >
              <Menu aria-hidden="true" className="size-5" />
            </button>
            <p className="truncate font-heading text-lg">{title}</p>
          </div>
        </header>

        <main
          id="main"
          tabIndex={-1}
          className={`flex-1 bg-workspace outline-none ${
            route.name === 'chat'
              ? 'md:px-10 md:py-8'
              : 'px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-10 md:py-12'
          }`}
        >
          <Page route={route} />
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
