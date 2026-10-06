// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate, parseRoute, pathFor, type Route } from './router';

describe('Router', () => {
  it.each<[string, Route]>([
    ['/', { name: 'home' }],
    ['', { name: 'home' }],
    ['/settings', { name: 'settings' }],
    ['/chat', { name: 'default-chat' }],
    ['/chat/', { name: 'default-chat' }],
    ['/timetable', { name: 'timetable' }],
    ['/exams/', { name: 'exams' }],
    ['/subjects/abc-123', { name: 'subject', subjectId: 'abc-123', groupId: null }],
    ['/subjects/abc/groups/xyz', { name: 'subject', subjectId: 'abc', groupId: 'xyz' }],
    ['/subjects/abc/', { name: 'subject', subjectId: 'abc', groupId: null }],
    ['/subjects/abc/chats/c-1', { name: 'chat', subjectId: 'abc', chatId: 'c-1' }],
    ['/subjects/abc/notes', { name: 'subject', subjectId: 'abc', groupId: null, tab: 'notes' }],
    ['/subjects/abc/notes/n-1', { name: 'note', subjectId: 'abc', noteId: 'n-1' }],
    [
      '/subjects/abc/groups/xyz/notes',
      { name: 'subject', subjectId: 'abc', groupId: 'xyz', tab: 'notes' },
    ],
  ])('liest %j', (path, route) => {
    expect(parseRoute(path)).toEqual(route);
  });

  it.each([
    '/unbekannt',
    '/settings/mehr',
    '/chat/abc',
    '/timetable/1',
    '/exams/neu',
    '/subjects',
    '/subjects/abc/groups',
    '/subjects/abc/chats',
    '/subjects/abc/chats/<x>',
    '/subjects/abc/chats/1/mehr',
    '/subjects/abc/notizen/1',
    '/subjects/abc/notes/n-1/mehr',
    '/subjects/abc/notes/<x>',
    '/subjects/abc/groups/xyz/notes/1',
    '/subjects/abc/groups/xyz/chats',
    '/subjects/a%20b',
    '/subjects/<script>',
    `/subjects/${'x'.repeat(65)}`,
  ])('erkennt %j als unbekannt', (path) => {
    expect(parseRoute(path)).toEqual({ name: 'not-found' });
  });

  it('baut Pfade, die sich wieder lesen lassen', () => {
    const routes: Route[] = [
      { name: 'home' },
      { name: 'settings' },
      { name: 'default-chat' },
      { name: 'timetable' },
      { name: 'exams' },
      { name: 'subject', subjectId: 'f1', groupId: null },
      { name: 'subject', subjectId: 'f1', groupId: 'g1' },
      { name: 'chat', subjectId: 'f1', chatId: 'c1' },
      { name: 'subject', subjectId: 'f1', groupId: null, tab: 'notes' },
      { name: 'subject', subjectId: 'f1', groupId: 'g1', tab: 'notes' },
      { name: 'note', subjectId: 'f1', noteId: 'n1' },
    ];
    for (const route of routes) expect(parseRoute(pathFor(route))).toEqual(route);
  });

  describe('Seitenwechsel', () => {
    beforeEach(() => {
      window.history.replaceState(null, '', '/');
      // Der Rahmen der App (AppShell) hat diesen Hauptbereich; navigate() legt ihm den Fokus.
      const main = document.createElement('main');
      main.id = 'main';
      main.tabIndex = -1;
      document.body.append(main);
    });

    afterEach(() => {
      document.getElementById('main')?.remove();
      cleanup();
    });

    it('scrollt nach oben und fokussiert den Inhalt (Spy auf scrollTo)', () => {
      const calls: string[] = [];
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation((x, y) => {
        calls.push('scrollTo');
        expect([x, y]).toEqual([0, 0]);
      });
      navigate({ name: 'settings' });

      expect(window.location.pathname).toBe('/settings');
      expect(calls).toEqual(['scrollTo']);
      scrollTo.mockRestore();
      expect(document.activeElement).toBe(document.getElementById('main'));
    });

    it('ändert zuerst die Chronik, dann den Scroll (Zurück behält die alte Position)', () => {
      const reihenfolge: string[] = [];
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {
        reihenfolge.push('scrollTo');
      });
      const push = vi.spyOn(window.history, 'pushState').mockImplementation((...args) => {
        reihenfolge.push('pushState');
        History.prototype.pushState.apply(window.history, args as Parameters<History['pushState']>);
      });

      navigate('/settings');
      expect(reihenfolge).toEqual(['pushState', 'scrollTo']);

      push.mockRestore();
      scrollTo.mockRestore();
    });

    it('fokussiert ohne die Scrollposition zu verschieben (preventScroll)', () => {
      const focus = vi.spyOn(HTMLElement.prototype, 'focus');
      navigate('/chat');

      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      focus.mockRestore();
    });

    it('macht nichts bei gleich bleibendem Pfad (Reiterwechsel im Fach)', () => {
      window.history.replaceState(null, '', '/subjects/abc');
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
      const focus = vi.spyOn(HTMLElement.prototype, 'focus');

      navigate(
        { name: 'subject', subjectId: 'abc', groupId: null, tab: 'notes' },
        { replace: true },
      );

      expect(window.location.pathname).toBe('/subjects/abc/notes');
      expect(scrollTo).not.toHaveBeenCalled();
      expect(focus).not.toHaveBeenCalled();
      scrollTo.mockRestore();
      focus.mockRestore();
    });

    it('rührt scrollTo und Fokus bei Zurück/Vor nicht an (popstate)', () => {
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
      const focus = vi.spyOn(HTMLElement.prototype, 'focus');

      window.history.pushState(null, '', '/settings');
      window.dispatchEvent(new PopStateEvent('popstate'));

      expect(window.location.pathname).toBe('/settings');
      expect(scrollTo).not.toHaveBeenCalled();
      expect(focus).not.toHaveBeenCalled();
      scrollTo.mockRestore();
      focus.mockRestore();
    });
  });
});
