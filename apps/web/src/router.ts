import { useSyncExternalStore } from 'react';

/** Die Ansichten der Oberfläche. Die Adresse im Browser spiegelt sie, damit Neuladen und Zurück funktionieren. */
export type Route =
  | { name: 'home' }
  | { name: 'subject'; subjectId: string; groupId: string | null }
  | { name: 'settings' }
  | { name: 'not-found' };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'settings' && parts.length === 1) return { name: 'settings' };
  if (parts[0] === 'subjects') {
    const subjectId = parts[1];
    if (subjectId && ID.test(subjectId)) {
      if (parts.length === 2) return { name: 'subject', subjectId, groupId: null };
      const groupId = parts[3];
      if (parts.length === 4 && parts[2] === 'groups' && groupId && ID.test(groupId)) {
        return { name: 'subject', subjectId, groupId };
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
    case 'subject':
      return route.groupId
        ? `/subjects/${route.subjectId}/groups/${route.groupId}`
        : `/subjects/${route.subjectId}`;
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
