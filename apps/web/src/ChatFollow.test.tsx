// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer } from './test/fake-server';

/**
 * Mitlesen im Chat (S-04, D-115): jsdom misst kein Layout, darum stehen `document.scrollingElement` und der
 * ResizeObserver als Ersatz da. Die Ersatz-Seite rechnet wie ein Browser: `scrollTop` wird auf das Ende
 * begrenzt, und das Ereignis `scroll` löst der Test selbst aus (im Browser kommt es erst im nächsten Bild).
 *
 * Belege der Befunde: F-016 und F-023 (Blöcke laden nach, die Ansicht bleibt davor stehen), F-019 (Hochscrollen
 * während des Schreibens wird zurückgeholt), gemessen in Playwright-Chromium und -WebKit, siehe D-115.
 */

class FakeScroller {
  scrollHeight = 2000;
  clientHeight = 800;
  private top = 0;
  get scrollTop(): number {
    return this.top;
  }
  set scrollTop(value: number) {
    this.top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
  }
  /** Wird die Seite kürzer, klemmt der Browser die Position von selbst auf das neue Ende. */
  clamp(): void {
    this.scrollTop = this.top;
  }
  /** Das Ende, wie der Browser es begrenzt. */
  get end(): number {
    return this.scrollHeight - this.clientHeight;
  }
}

class MockResizeObserver {
  static all: MockResizeObserver[] = [];
  target: Element | null = null;
  constructor(private readonly callback: ResizeObserverCallback) {
    MockResizeObserver.all.push(this);
  }
  observe(target: Element) {
    this.target = target;
  }
  unobserve() {}
  disconnect() {
    MockResizeObserver.all = MockResizeObserver.all.filter((entry) => entry !== this);
  }
  fire() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

/** Meldet eine Größenänderung des Elements, wie der Browser es nach dem Layout täte. */
function resized(element: Element) {
  const observer = MockResizeObserver.all.find((entry) => entry.target === element);
  if (!observer) throw new Error('Das Element wird nicht beobachtet');
  act(() => observer.fire());
}

const scrollEvent = () => act(() => void window.dispatchEvent(new Event('scroll')));

/** Mausrad nach oben (oder unten) über dem Ziel. */
const wheel = (target: Element, deltaY: number) =>
  act(() => void target.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true })));

/** Eine Fingergeste: die Höhe (clientY) der Berührung zu Beginn und beim Verschieben. */
function touch(target: Element, from: number, to: number) {
  const fire = (type: string, y: number) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, 'touches', { value: [{ clientY: y }] });
    act(() => void target.dispatchEvent(event));
  };
  fire('touchstart', from);
  fire('touchmove', to);
}

const MODEL = { id: 'modell-a', vision: false, tools: false, reasoning: false, streaming: true };

function setup() {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach A');
  const provider = server.addProvider('Anbieter A', {
    models: [{ ...MODEL, free: false }],
    hasKey: true,
  });
  server.modelSettings = { default: { providerId: provider.id, model: 'modell-a' }, fallback: [] };
  const chat = server.addChat(subject.id);
  server.addMessage(chat.id, 'user', 'Erkläre quadratische Funktionen.');
  server.addMessage(chat.id, 'assistant', 'Eine **quadratische Funktion** hat die Form f(x).');
  return { server, subject, chat };
}

function open(server: FakeServer, subjectId: string, chatId: string) {
  window.history.replaceState(null, '', `/subjects/${subjectId}/chats/${chatId}`);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

let scroller: FakeScroller;

beforeAll(async () => {
  await import('./screens/chat/ChatPage');
}, 30_000);

beforeEach(() => {
  MockResizeObserver.all = [];
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  scroller = new FakeScroller();
  Object.defineProperty(document, 'scrollingElement', { configurable: true, value: scroller });
});

afterEach(() => {
  Reflect.deleteProperty(document, 'scrollingElement');
  vi.unstubAllGlobals();
});

async function openAtEnd() {
  const { server, subject, chat } = setup();
  open(server, subject.id, chat.id);
  const messages = await screen.findByRole('region', { name: 'Nachrichten' });
  // Beim Öffnen steht die Ansicht am Ende.
  await waitFor(() => expect(scroller.scrollTop).toBe(scroller.end));
  const field = await screen.findByRole('textbox', { name: 'Nachricht' });
  const composer = field.closest('.sticky') as HTMLElement;
  return { server, chat, messages, composer };
}

/** Sendet eine Frage und lässt die Antwort mit einem ersten Textstück beginnen (Ansicht am Ende). */
async function startWriting(server: FakeServer, chatId: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('textbox', { name: 'Nachricht' }));
  await user.paste('Bitte sehr lange Antwort');
  await user.click(screen.getByRole('button', { name: 'Senden' }));
  await waitFor(() => expect(server.generations.has(chatId)).toBe(true));
  const generation = server.generation(chatId);
  act(() => generation.delta('Erstes Stück. '));
  await screen.findByText(/Erstes Stück/);
  expect(scroller.scrollTop).toBe(scroller.end);
  return generation;
}

describe('Chat: Mitlesen bei nachladenden Blöcken (F-016, F-023)', () => {
  it('folgt dem Ende, wenn der Verlauf ohne neue Nachricht wächst (Block lädt nach)', async () => {
    const { messages } = await openAtEnd();
    expect(scroller.scrollTop).toBe(1200);

    // Ein Graph bekommt seine Höhe erst nach dem Text; der Beobachter des Verlaufs scrollt nach.
    scroller.scrollHeight = 2600;
    resized(messages);
    expect(scroller.scrollTop).toBe(1800);
  });

  it('verliert das Mitlesen nicht, wenn die Seite wächst, bevor das Ereignis des eigenen Scrollens ankommt', async () => {
    const { composer } = await openAtEnd();

    // Eigenes Scrollen ans Ende, dann wächst die Seite, danach erst kommt das Ereignis: Abstand 600 px.
    scroller.scrollHeight = 2600;
    scrollEvent();
    expect(scroller.scrollTop).toBe(1200);

    // Die Position ging nicht nach oben, also ist das Mitlesen nicht aufgehoben.
    resized(composer);
    expect(scroller.scrollTop).toBe(1800);
  });

  it('bleibt am Ende, wenn die Seite kürzer wird und der Browser die Position klemmt', async () => {
    const { composer } = await openAtEnd();

    // Ein Platzhalter wird durch einen kleineren Block ersetzt: scrollTop geht von selbst nach oben, ganz unten.
    scroller.scrollHeight = 1500;
    scroller.clamp();
    expect(scroller.scrollTop).toBe(700);
    scrollEvent();

    scroller.scrollHeight = 2600;
    resized(composer);
    expect(scroller.scrollTop).toBe(1800);
  });

  it('bleibt dran, wenn die Seite kürzer wird und noch im selben Bild ein Stück nachwächst', async () => {
    const { composer } = await openAtEnd();

    // Platzhalter (160 px) wird zum Block, daneben wächst der Text um 23 px: Der Browser hat zwischendurch geklemmt,
    // die Position liegt nun 23 px über dem Ende. Das ist kein Hochscrollen der Person.
    scroller.scrollHeight = 1840;
    scroller.clamp();
    scroller.scrollHeight = 1863;
    scrollEvent();
    resized(composer);
    expect(scroller.scrollTop).toBe(scroller.end);
  });
});

describe('Chat: Hochscrollen während des Schreibens (F-019)', () => {
  it('holt die Person nicht zurück, wenn ein Textstück vor dem Scroll-Ereignis eintrifft', async () => {
    const { server, chat } = await openAtEnd();
    const generation = await startWriting(server, chat.id);

    // Die Person scrollt um 700 px hoch; das Ereignis dazu ist noch nicht angekommen.
    scroller.scrollTop = scroller.end - 700;
    const hochgescrollt = scroller.scrollTop;
    act(() => generation.delta('Zweites Stück. '));
    await screen.findByText(/Zweites Stück/);
    expect(scroller.scrollTop).toBe(hochgescrollt);

    // Auch weitere Stücke und nachladende Blöcke ändern daran nichts, solange sie oben liest.
    scrollEvent();
    scroller.scrollHeight = 2800;
    act(() => generation.delta('Drittes Stück. '));
    await screen.findByText(/Drittes Stück/);
    expect(scroller.scrollTop).toBe(hochgescrollt);
  });

  it('lässt schon ein kurzes Hochscrollen mit dem Mausrad (unter 160 px) stehen, statt es zurückzuholen', async () => {
    const { server, chat, messages } = await openAtEnd();
    const generation = await startWriting(server, chat.id);

    // Weiches Scrollen (Mausrad in WebKit) beginnt mit wenigen Pixeln. Die Person ist dabei noch nah am Ende,
    // will aber hoch: Das Rad löst das Mitlesen, noch bevor sich die Seite bewegt hat.
    wheel(messages, -90);
    scroller.scrollTop = scroller.end - 40;
    const dort = scroller.scrollTop;
    act(() => generation.delta('Zweites Stück. '));
    await screen.findByText(/Zweites Stück/);
    expect(scroller.scrollTop).toBe(dort);
  });

  it('lässt auch eine Fingergeste nach oben stehen (Finger nach unten)', async () => {
    const { server, chat, messages } = await openAtEnd();
    const generation = await startWriting(server, chat.id);

    touch(messages, 300, 340);
    scroller.scrollTop = scroller.end - 25;
    const dort = scroller.scrollTop;
    act(() => generation.delta('Zweites Stück. '));
    await screen.findByText(/Zweites Stück/);
    expect(scroller.scrollTop).toBe(dort);
  });

  it('bleibt dran, wenn nur ein scrollbares Feld nach oben gescrollt wird oder das Rad nach unten dreht', async () => {
    const { server, chat, messages } = await openAtEnd();
    const generation = await startWriting(server, chat.id);

    // Ein Code-Block mit eigener Bildlaufleiste: Das Rad bewegt ihn, nicht die Seite.
    const inner = document.createElement('div');
    inner.style.overflowY = 'auto';
    Object.defineProperty(inner, 'scrollHeight', { value: 400 });
    Object.defineProperty(inner, 'clientHeight', { value: 100 });
    inner.scrollTop = 50;
    messages.append(inner);
    wheel(inner, -90);
    wheel(messages, 90);
    scroller.scrollHeight = 2300;
    act(() => generation.delta('Zweites Stück. '));
    await screen.findByText(/Zweites Stück/);
    expect(scroller.scrollTop).toBe(scroller.end);
  });

  it('folgt wieder, sobald die Person zurück nah ans Ende scrollt', async () => {
    const { messages } = await openAtEnd();

    scroller.scrollTop = 300;
    scrollEvent();
    scroller.scrollHeight = 2400;
    resized(messages);
    expect(scroller.scrollTop).toBe(300);

    // Wieder nah am Ende (weniger als 160 px): das Mitlesen setzt wieder ein.
    scroller.scrollTop = scroller.end - 100;
    scrollEvent();
    scroller.scrollHeight = 3000;
    resized(messages);
    expect(scroller.scrollTop).toBe(scroller.end);
  });

  it('folgt nach dem Senden wieder, auch wenn die Person vorher hochgescrollt hatte', async () => {
    const { server, chat } = await openAtEnd();
    scroller.scrollTop = 200;
    scrollEvent();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('textbox', { name: 'Nachricht' }));
    await user.paste('Noch eine Frage');
    await user.click(screen.getByRole('button', { name: 'Senden' }));
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    expect(scroller.scrollTop).toBe(scroller.end);
  });
});
