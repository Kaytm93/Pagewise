import { describe, expect, it } from 'vitest';
import { parseRoute, pathFor, type Route } from './router';

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
});
