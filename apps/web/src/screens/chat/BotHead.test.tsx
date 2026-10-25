// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage, MessageStatus } from '../../api/types';
import { MessageItem } from './MessageItem';

/*
 * Kopfzeile je Antwort in „Atelier“ (Mockup B): Zeichen, Name „Pagewise“, Modell und der Zustand der Antwort.
 * In „Raum“ und „Lagen“ gibt es sie nicht. Die Zeile ist rein optisch (`aria-hidden`), der Zustand steht für
 * Hilfstechnik schon anderswo. Alle Namen sind erfunden.
 */

function antwort(status: MessageStatus, content = 'Ein Satz als Antwort.'): ChatMessage {
  return {
    id: 'n2',
    seq: 2,
    role: 'assistant',
    content,
    status,
    providerId: null,
    model: 'fake-modell',
    engineProfileId: null,
    errorCode: status === 'error' ? 'unknown' : null,
    activity: [],
    assets: [],
    createdAt: 0,
  };
}

function show(
  message: ChatMessage,
  { live = false, thinking = false }: { live?: boolean; thinking?: boolean } = {},
) {
  return (
    <MessageItem
      message={message}
      live={live}
      thinking={thinking}
      canRetry={false}
      onRetry={() => {}}
    />
  );
}

const kopf = (container: HTMLElement) => container.querySelector('.at-bot-head');
const zustand = (container: HTMLElement) => container.querySelector('.at-bot-status')?.textContent;

afterEach(() => {
  document.documentElement.removeAttribute('data-design');
});

describe('Kopfzeile je Antwort', () => {
  it('zeigt in „Atelier“ Zeichen, Namen, Modell und Zustand, rein optisch', () => {
    document.documentElement.setAttribute('data-design', 'atelier');
    const { container } = render(show(antwort('complete')));

    const head = kopf(container);
    expect(head?.getAttribute('aria-hidden')).toBe('true');
    expect(head?.querySelector('svg.at-bot-mark')?.getAttribute('focusable')).toBe('false');
    expect(head?.querySelector('.at-bot-name')?.textContent).toBe('Pagewise');
    expect(head?.querySelector('.at-bot-model')?.textContent).toBe('fake-modell');
    expect(zustand(container)).toBe('fertig');
    expect(head?.hasAttribute('style')).toBe(false);
    // Für Hilfstechnik bleibt es bei der Überschrift „Antwort“; die Zeile fügt nichts hinzu.
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.queryByText('fertig', { ignore: '[aria-hidden="true"] *' })).toBeNull();
  });

  it('lässt das Modell weg, wenn die Nachricht keines kennt', () => {
    document.documentElement.setAttribute('data-design', 'atelier');
    const { container } = render(
      show({ ...antwort('streaming', ''), model: null }, { live: true }),
    );

    expect(container.querySelector('.at-bot-model')).toBeNull();
    expect(container.querySelector('.at-bot-name')?.textContent).toBe('Pagewise');
  });

  it('gibt es in „Raum“, „Lagen“ und ohne Richtung nicht', () => {
    for (const design of ['raum', 'lagen', null] as const) {
      if (design) document.documentElement.setAttribute('data-design', design);
      else document.documentElement.removeAttribute('data-design');
      const { container, unmount } = render(show(antwort('complete')));
      expect(kopf(container), String(design)).toBeNull();
      unmount();
    }
  });

  it('gibt es nicht über der Nachricht der Nutzerin', () => {
    document.documentElement.setAttribute('data-design', 'atelier');
    const nutzerin: ChatMessage = { ...antwort('complete'), role: 'user', model: null };
    const { container } = render(show(nutzerin));
    expect(kopf(container)).toBeNull();
  });

  it('folgt dem Zustand der Antwort: denkt, schreibt, fertig, angehalten, fehlgeschlagen', () => {
    document.documentElement.setAttribute('data-design', 'atelier');
    const { container, rerender } = render(
      show(antwort('streaming', ''), { live: true, thinking: true }),
    );
    const head = () => kopf(container);
    expect(zustand(container)).toBe('denkt …');
    expect(head()?.getAttribute('data-state')).toBe('thinking');

    rerender(show(antwort('streaming', 'Ein Anfang'), { live: true }));
    expect(zustand(container)).toBe('schreibt …');
    expect(head()?.getAttribute('data-state')).toBe('writing');

    rerender(show(antwort('complete', 'Ein Anfang und ein Ende.')));
    expect(zustand(container)).toBe('fertig');
    expect(head()?.getAttribute('data-state')).toBe('done');

    rerender(show(antwort('stopped', 'Ein Anfang')));
    expect(zustand(container)).toBe('angehalten');
    expect(head()?.getAttribute('data-state')).toBe('stopped');

    rerender(show(antwort('interrupted', 'Ein Anfang')));
    expect(zustand(container)).toBe('angehalten');

    rerender(show(antwort('error', '')));
    expect(zustand(container)).toBe('fehlgeschlagen');
    expect(head()?.getAttribute('data-state')).toBe('failed');
  });

  it('bleibt beim Wechsel dieselbe Zeile: dieselben Knoten, nur der Zustand ändert sich', () => {
    document.documentElement.setAttribute('data-design', 'atelier');
    const { container, rerender } = render(show(antwort('streaming', 'Ein'), { live: true }));
    const vorher = kopf(container);
    rerender(show(antwort('complete', 'Ein Satz.')));
    expect(kopf(container)).toBe(vorher);
    expect(container.querySelectorAll('.at-bot-head')).toHaveLength(1);
  });
});
