import { useSyncExternalStore } from 'react';

/** Die Ansichten der Oberfläche. Die Adresse im Browser spiegelt sie, damit Neuladen und Zurück funktionieren. */
export type Route =
  | { name: 'home' }
  /** Der fachunabhängige Standard-Chat (Klick auf „Pagewise“): öffnet einen Chat im eingebauten Fach „Standard“. */
  | { name: 'default-chat' }
  /** Ein Fach oder eine Untergruppe; `tab: 'notes'` öffnet den Reiter „Hefteinträge“ (sonst „Chats“). */
  | { name: 'subject'; subjectId: string; groupId: string | null; tab?: 'notes' }
  | { name: 'note'; subjectId: string; noteId: string }
  | { name: 'chat'; subjectId: string; chatId: string }
  | { name: 'settings' }
  /** Stundenplan und Testeinträge (Welle 3). */
  | { name: 'timetable' }
  | { name: 'exams' }
  | { name: 'not-found' };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'settings' && parts.length === 1) return { name: 'settings' };
  if (parts[0] === 'chat' && parts.length === 1) return { name: 'default-chat' };
  if (parts[0] === 'timetable' && parts.length === 1) return { name: 'timetable' };
  if (parts[0] === 'exams' && parts.length === 1) return { name: 'exams' };
  if (parts[0] === 'subjects') {
    const subjectId = parts[1];
    if (subjectId && ID.test(subjectId)) {
      if (parts.length === 2) return { name: 'subject', subjectId, groupId: null };
      if (parts.length === 3 && parts[2] === 'notes') {
        return { name: 'subject', subjectId, groupId: null, tab: 'notes' };
      }
      const other = parts[3];
      if (parts.length === 4 && other && ID.test(other)) {
        if (parts[2] === 'groups') return { name: 'subject', subjectId, groupId: other };
        if (parts[2] === 'chats') return { name: 'chat', subjectId, chatId: other };
        if (parts[2] === 'notes') return { name: 'note', subjectId, noteId: other };
      }
      if (parts.length === 5 && parts[2] === 'groups' && other && ID.test(other)) {
        if (parts[4] === 'notes')
          return { name: 'subject', subjectId, groupId: other, tab: 'notes' };
      }
    }
  }
  return { name: 'not-found' };
}

export function pathFor(route: Route): string {
  switch (route.name) {
    case 'home':
    case 'not-found':
      return '/';
    case 'settings':
      return '/settings';
    case 'default-chat':
      return '/chat';
    case 'timetable':
      return '/timetable';
    case 'exams':
      return '/exams';
    case 'subject': {
      const base = route.groupId
        ? `/subjects/${route.subjectId}/groups/${route.groupId}`
        : `/subjects/${route.subjectId}`;
      return route.tab === 'notes' ? `${base}/notes` : base;
    }
    case 'note':
      return `/subjects/${route.subjectId}/notes/${route.noteId}`;
    case 'chat':
      return `/subjects/${route.subjectId}/chats/${route.chatId}`;
  }
}

const NAVIGATE_EVENT = 'pagewise:navigate';

export function navigate(to: Route | string, options: { replace?: boolean } = {}): void {
  const path = typeof to === 'string' ? to : pathFor(to);
  if (path === window.location.pathname) return;
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAVIGATE_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAVIGATE_EVENT, listener);
  };
}

const getPath = (): string => window.location.pathname;

/** Aktuelle Ansicht. Ändert sich bei Klicks auf Links und beim Zurück-Button. */
export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, getPath, () => '/');
  return parseRoute(path);
}
