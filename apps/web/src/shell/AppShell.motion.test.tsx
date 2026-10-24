// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { ApiClient } from '../api/client';
import { navigate } from '../router';
import { FakeServer } from '../test/fake-server';

/*
 * Der Blattwechsel bekommt eine Richtung (M4-T???): tiefer in die App (fwd), zurück (back) oder
 * gleiche Tiefe (same). Die Richtung steht als data-dir am Blatt; die Bewegung selbst liegt in
 * motion.css (sheet-under, sheet-arrive, page-rise, dive-in, rise-in). jsdom rechnet keine
 * Animationen, darum prüft der zweite Teil den Quelltext der Bewegung und den Füllstand bei „Aus“.
 */

function mount(server: FakeServer) {
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

// React 19 prüft act() an dieser Marke; zwischen zwei Aufrufen der Testbibliothek ist sie sonst aus.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Anmelde- und Einrichtungsschirme tragen ebenfalls .lg-arrive; das Blatt der Hülle hängt am Stapel.
const arrive = () => document.querySelector<HTMLElement>('.lg-stack > .lg-arrive');
const dirOf = () => arrive()?.dataset.dir;
const viewOf = () => document.querySelector<HTMLElement>('.lg-app')?.dataset.view;

/**
 * Wartet, bis React die neue Ansicht wirklich gezeichnet hat. Unter CI-Last kommt der Store-Update
 * nicht synchron mit `act()` an; die Richtung wird im selben Commit wie `data-view` gesetzt.
 */
async function movedTo(view: string) {
  await waitFor(() => expect(viewOf()).toBe(view));
}

async function ready() {
  await waitFor(() => expect(arrive()).not.toBeNull());
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  document.documentElement.className = '';
});

describe('Blattwechsel: Richtung am Blatt', () => {
  it('Start → Fach ist vorwärts (fwd)', async () => {
    const server = new FakeServer('unlocked');
    const subject = server.addSubject('Beispielfach A');
    mount(server);
    await ready();
    expect(dirOf()).toBe('same');

    act(() => navigate(`/subjects/${subject.id}`));
    await movedTo('subject');
    expect(dirOf()).toBe('fwd');
  });

  it('Fach → Start ist rückwärts (back)', async () => {
    const server = new FakeServer('unlocked');
    const subject = server.addSubject('Beispielfach A');
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    await ready();

    act(() => navigate('/'));
    await movedTo('home');
    expect(dirOf()).toBe('back');
  });

  it('Start → Einstellungen bleibt auf gleicher Tiefe (same)', async () => {
    mount(new FakeServer('unlocked'));
    await ready();

    act(() => navigate('/settings'));
    await movedTo('settings');
    expect(dirOf()).toBe('same');
  });

  it('die Richtung bleibt bei einem späteren Neuzeichnen stehen', async () => {
    const server = new FakeServer('unlocked');
    const subject = server.addSubject('Beispielfach A');
    mount(server);
    await ready();

    act(() => navigate(`/subjects/${subject.id}`));
    await movedTo('subject');
    expect(dirOf()).toBe('fwd');

    // Die Schublade öffnen zeichnet die Hülle neu, ohne die Seite zu wechseln.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Menü öffnen' }));
    expect(dirOf()).toBe('fwd');
  });

  it('das Blatt trägt keinen Inline-Stil (CSP)', async () => {
    mount(new FakeServer('unlocked'));
    await ready();
    expect(arrive()?.getAttribute('style')).toBeNull();
  });
});

describe('motion.css: Bewegung je Richtung', () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'motion.css'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll('"', "'")
    .replaceAll(/\s+/g, ' ');

  function body(selector: string): string {
    const start = css.indexOf(selector);
    if (start === -1) throw new Error(`Regel fehlt in motion.css: ${selector}`);
    return css.slice(start, css.indexOf('}', start) + 1);
  }

  it('enthält die vier Keyframes und animiert nur opacity und transform', () => {
    for (const name of ['sheet-under', 'page-rise', 'dive-in', 'rise-in']) {
      const keyframe = body(`@keyframes ${name} {`);
      expect(keyframe).toContain('opacity: 0');
      expect(keyframe).toContain('transform:');
      expect(keyframe).not.toMatch(/filter|box-shadow/);
    }
    expect(body('@keyframes sheet-under {')).toContain('var(--m)');
    expect(body('@keyframes dive-in {')).toContain('perspective(1600px)');
    expect(body('@keyframes rise-in {')).toContain('calc(var(--m) * -90px)');
  });

  it('ordnet die Grundrichtung zu', () => {
    expect(body(".lg-arrive[data-dir='fwd'] {")).toContain(
      'animation: sheet-under var(--t-slow) var(--spring) both',
    );
    expect(body(".lg-arrive[data-dir='back'] {")).toContain(
      'animation: sheet-arrive var(--t-slow) var(--spring) both',
    );
    expect(body(".lg-arrive[data-dir='same'] {")).toContain(
      'animation: page-rise var(--t-med) var(--ease) both',
    );
  });

  it('atelier geht immer ruhig auf, unabhängig von der Richtung', () => {
    expect(body(":root[data-design='atelier'] .lg-arrive {")).toContain(
      'animation: page-rise var(--t-slow) var(--ease) both',
    );
  });

  it('raum taucht vorwärts auf und tritt rückwärts zurück', () => {
    expect(body(":root[data-design='raum'] .lg-arrive[data-dir='fwd'] {")).toContain(
      'animation: dive-in',
    );
    expect(body(":root[data-design='raum'] .lg-arrive[data-dir='back'] {")).toContain(
      'animation: rise-in',
    );
    expect(body(":root[data-design='raum'] .lg-arrive[data-dir='same'] {")).toContain(
      'animation: page-rise',
    );
  });

  it('bei „Aus“ bleibt das Blatt vollständig sichtbar', () => {
    // Die globale Aus-Regel nimmt jede Animation samt Füllstand weg …
    expect(body(':root.fx-off *')).toContain('animation: none !important');
    // … und das Blatt steht ohne Versatz und deckend da.
    const off = body(':root.fx-off .lg-arrive {');
    expect(off).toContain('opacity: 1');
    expect(off).toContain('transform: none');
  });
});
