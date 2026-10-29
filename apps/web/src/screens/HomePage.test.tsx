// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { ApiClient } from '../api/client';
import { messages } from '../i18n';
import { FakeServer, json } from '../test/fake-server';

/*
 * Der Startbereich wartet auf Planer und „Zuletzt genutzt“ (M4-T034, Entscheidung „Warten mit Zeitgrenze,
 * 2 Sekunden“): vorher nur die Kopfzeile, danach alles auf einmal. Nach 2 s ohne diese Daten erscheint er ohne
 * „Als Nächstes“ und „Zuletzt genutzt“; bei einem Planer-Fehler sofort so. Die Namen sind erfunden.
 */

const LISTE = '#home-subjects';
const ALS_NAECHSTES = '#next-up-heading';
const ZULETZT = '#recent-chats-heading';
const TAGESPLAN = '.rm-plan';

function createServer() {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach');
  server.addChat(subject.id, { title: 'Testchat' });
  return server;
}

/**
 * Hält Stundenplan, Tests und Chatlisten zurück, bis `release` aufgerufen wird. Mit `plannerFails` antwortet der
 * Stundenplan sofort mit einem Fehler. Mit `plannerOpen` kommen Stundenplan und Tests sofort, nur die Chatlisten
 * bleiben zurück.
 */
function gatedFetch(
  server: FakeServer,
  options: { plannerFails?: boolean; plannerOpen?: boolean } = {},
) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const path = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && /\/api\/(timetable|exams|chats)(\?|$)/.test(path)) {
      if (options.plannerFails && /\/api\/timetable$/.test(path))
        return json(500, { error: 'nicht erreichbar' });
      if (options.plannerOpen && /\/api\/(timetable|exams)(\?|$)/.test(path))
        return server.fetch(input, init);
      await gate;
    }
    return server.fetch(input, init);
  };
  return { fetch, release };
}

function renderHome(fetch: typeof globalThis.fetch) {
  window.history.replaceState(null, '', '/');
  return render(<App client={new ApiClient({ fetch })} />);
}

/** Lässt Zeit vergehen und die Promise-Ketten der Anwendung weiterlaufen. */
async function run(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await run(0);
}

beforeEach(() => {
  // `performance` gehört dazu, damit die Zeit seit dem Seitenaufruf in den Tests feststeht.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
  });
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-design');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-design');
  window.history.replaceState(null, '', '/');
});

describe('Startbereich wartet auf Planer und „Zuletzt genutzt“', () => {
  // Der Tagesplan erscheint nur in „Raum“ (StartPlan prüft die Richtung ausdrücklich), daher hier festgelegt.
  beforeEach(() => {
    document.documentElement.setAttribute('data-design', 'raum');
  });

  it('zeigt vor ready nur die Kopfzeile und nach ready den ganzen Startbereich', async () => {
    const server = createServer();
    const { fetch, release } = gatedFetch(server);
    renderHome(fetch);
    await settle();

    expect(document.querySelector('h1')).not.toBeNull();
    expect(document.querySelector(LISTE)).toBeNull();
    expect(document.querySelector(ALS_NAECHSTES)).toBeNull();
    expect(document.querySelector(ZULETZT)).toBeNull();

    await run(1000);
    expect(document.querySelector(LISTE)).toBeNull();
    expect(document.querySelector(ALS_NAECHSTES)).toBeNull();

    release();
    await settle();
    expect(document.querySelector(LISTE)).not.toBeNull();
    expect(document.querySelector(TAGESPLAN)).not.toBeNull();
    expect(document.querySelector(ALS_NAECHSTES)).not.toBeNull();
    expect(document.querySelector(ZULETZT)).not.toBeNull();
  });

  it('zeigt nach 2 s den Startbereich ohne „Als Nächstes“ und „Zuletzt genutzt“ und lässt sie auch später weg', async () => {
    const server = createServer();
    const { fetch, release } = gatedFetch(server);
    renderHome(fetch);
    await settle();

    await run(1500);
    expect(document.querySelector(LISTE)).toBeNull();

    await run(600);
    expect(document.querySelector(LISTE)).not.toBeNull();
    expect(document.querySelector(ALS_NAECHSTES)).toBeNull();
    expect(document.querySelector(ZULETZT)).toBeNull();

    release();
    await settle();
    expect(document.querySelector(LISTE)).not.toBeNull();
    expect(document.querySelector(ALS_NAECHSTES)).toBeNull();
    expect(document.querySelector(ZULETZT)).toBeNull();
    expect(document.querySelector(TAGESPLAN)).toBeNull();
  });

  it('zeigt bei einem Planer-Fehler sofort den Startbereich ohne die beiden Bereiche', async () => {
    const server = createServer();
    const { fetch } = gatedFetch(server, { plannerFails: true });
    renderHome(fetch);
    await settle();

    expect(document.querySelector(LISTE)).not.toBeNull();
    expect(document.querySelector(ALS_NAECHSTES)).toBeNull();
    expect(document.querySelector(ZULETZT)).toBeNull();
    expect(document.querySelector(TAGESPLAN)).toBeNull();

    await run(2500);
    expect(document.querySelector(ALS_NAECHSTES)).toBeNull();
    expect(document.querySelector(ZULETZT)).toBeNull();
    expect(document.querySelector(TAGESPLAN)).toBeNull();
  });

  it('zählt die Zeitgrenze ab dem Seitenaufruf, wenn die Startseite erst später erscheint', async () => {
    const server = createServer();
    const { fetch } = gatedFetch(server);
    await run(1500); // Die Seite ist schon 1,5 s offen, bevor die Startseite erscheint.
    renderHome(fetch);
    await settle();

    await run(300);
    expect(document.querySelector(LISTE)).toBeNull();

    await run(300);
    expect(document.querySelector(LISTE)).not.toBeNull();
    expect(document.querySelector(ALS_NAECHSTES)).toBeNull();
  });

  it('wartet in „Lagen“ genauso und zeigt danach „Zuletzt genutzt“', async () => {
    document.documentElement.setAttribute('data-design', 'lagen');
    const server = createServer();
    const { fetch, release } = gatedFetch(server);
    renderHome(fetch);
    await settle();

    await run(1000);
    expect(document.querySelector(LISTE)).toBeNull();
    expect(document.querySelector(ZULETZT)).toBeNull();

    release();
    await settle();
    expect(document.querySelector(LISTE)).not.toBeNull();
    expect(document.querySelector(ZULETZT)).not.toBeNull();
  });

  it('zeigt den Tagesplan mit dem übrigen Startbereich, wenn der Planer vor 2 s kommt', async () => {
    const server = createServer();
    const { fetch, release } = gatedFetch(server, { plannerOpen: true });
    renderHome(fetch);
    await settle();
    expect(document.querySelector(TAGESPLAN)).toBeNull();

    await run(2000);
    expect(document.querySelector(LISTE)).not.toBeNull();
    expect(document.querySelector(TAGESPLAN)).not.toBeNull();
    expect(document.querySelector(ZULETZT)).toBeNull();

    release();
    await settle();
    expect(document.querySelector(TAGESPLAN)).not.toBeNull();
    expect(document.querySelector(ZULETZT)).toBeNull();
  });

  it('lässt den Tagesplan weg, wenn der Planer nach 2 s kommt, und verschiebt die Fächerliste nicht', async () => {
    const server = createServer();
    const { fetch, release } = gatedFetch(server);
    renderHome(fetch);
    await settle();

    await run(2100);
    expect(document.querySelector(LISTE)).not.toBeNull();
    expect(document.querySelector(TAGESPLAN)).toBeNull();
    const liste = document.querySelector(LISTE);

    release();
    await settle();
    expect(document.querySelector(TAGESPLAN)).toBeNull();
    expect(document.querySelector(ALS_NAECHSTES)).toBeNull();
    expect(document.querySelector(ZULETZT)).toBeNull();
    expect(document.querySelector(LISTE)).toBe(liste);
    // Die Überschrift kommt aus dem Plan und bleibt deshalb beim festen Text.
    expect(document.querySelector('h1')?.textContent).toBe(messages.home.heading);
  });
});
