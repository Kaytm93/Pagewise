// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { ApiClient } from '../../api/client';
import { FakeServer } from '../../test/fake-server';

/*
 * Rahmen der Fachseite in „Raum“ (D-045): Register am rechten Blattrand und zwei Ringe hinter dem
 * Fachmotiv. Beides ist Zier — das Register zeigt dieselbe Wahl wie die Reiterleiste, fängt aber
 * keinen Fokus und schaltet nichts um. „Lagen“, „Atelier“ und die Richtung ohne Attribut bleiben
 * unverändert. Alle Namen sind erfunden.
 */

function setup() {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach Rahmen', { icon: 'flask', color: 0 });
  return { server, subject };
}

function mount(server: FakeServer, path: string, design?: 'raum' | 'lagen' | 'atelier') {
  if (design) document.documentElement.setAttribute('data-design', design);
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

const zungen = (container: HTMLElement) =>
  [...container.querySelectorAll('.rm-reg-tab')].map((tab) => tab.getAttribute('data-active'));

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-design');
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  document.documentElement.removeAttribute('data-design');
});

describe('Fachseite in „Raum“: Register und Ringe', () => {
  it('zeigt das Register mit vier Zungen und die zwei Ringe hinter dem Motiv', async () => {
    const { server, subject } = setup();
    const { container } = mount(server, `/subjects/${subject.id}`, 'raum');
    await screen.findByRole('heading', { level: 1, name: 'Beispielfach Rahmen' });

    const register = container.querySelector('.rm-reg') as HTMLElement;
    expect(register).not.toBeNull();
    expect(register.getAttribute('aria-hidden')).toBe('true');

    const labels = [...register.querySelectorAll('.rm-reg-tab')].map((tab) => tab.textContent);
    expect(labels).toEqual(['Chats', 'Hefteinträge', 'Tests', 'Stunden']);
    // Der gewählte Reiter steht hervor, die anderen bleiben gedämpft.
    expect(zungen(container)).toEqual(['true', 'false', 'false', 'false']);

    const rings = container.querySelector('.rm-rings') as SVGElement;
    expect(rings?.tagName.toLowerCase()).toBe('svg');
    expect(rings.getAttribute('aria-hidden')).toBe('true');
    expect(rings.querySelectorAll('circle')).toHaveLength(2);
    // Keine Inline-Styles: Farbe, Strichstärke und Strichmuster kommen aus raum.css.
    expect(rings.querySelector('[style]')).toBeNull();
    expect(rings.getAttribute('style')).toBeNull();
    // Die Ringe treten zum bisherigen Symbol hinzu, sie ersetzen es nicht.
    expect(container.querySelector('.lg-motif')).toBeTruthy();
  });

  it('fängt keinen Fokus und enthält keine Bedienfläche', async () => {
    const { server, subject } = setup();
    const { container } = mount(server, `/subjects/${subject.id}`, 'raum');
    await screen.findByRole('heading', { level: 1, name: 'Beispielfach Rahmen' });

    const register = container.querySelector('.rm-reg') as HTMLElement;
    expect(
      register.querySelectorAll('button, a, input, select, textarea, [tabindex]'),
    ).toHaveLength(0);
    // Bedienbar bleibt allein die Reiterleiste; das Register ist für Hilfsmittel unsichtbar.
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('hebt die Zunge des Reiters hervor, der in der Leiste gewählt wird', async () => {
    const user = userEvent.setup();
    const { server, subject } = setup();
    const { container } = mount(server, `/subjects/${subject.id}`, 'raum');
    await screen.findByRole('heading', { level: 1, name: 'Beispielfach Rahmen' });

    await user.click(screen.getByRole('tab', { name: 'Hefteinträge' }));
    await waitFor(() => expect(zungen(container)).toEqual(['false', 'true', 'false', 'false']));
  });

  it('steht beim Öffnen des Reiters „Hefteinträge“ schon auf der zweiten Zunge', async () => {
    const { server, subject } = setup();
    const { container } = mount(server, `/subjects/${subject.id}/notes`, 'raum');
    await screen.findByRole('heading', { level: 1, name: 'Beispielfach Rahmen' });

    expect(zungen(container)).toEqual(['false', 'true', 'false', 'false']);
  });
});

describe.each([
  ['Lagen', 'lagen'],
  ['Atelier', 'atelier'],
  ['ohne Richtung', undefined],
] as const)('Fachseite in „%s“', (_name, design) => {
  it('bleibt ohne Register und ohne Ringe', async () => {
    const { server, subject } = setup();
    const { container } = mount(server, `/subjects/${subject.id}`, design);
    await screen.findByRole('heading', { level: 1, name: 'Beispielfach Rahmen' });

    expect(container.querySelector('.rm-reg')).toBeNull();
    expect(container.querySelector('.rm-rings')).toBeNull();
    expect(container.querySelector('.lg-motif')).toBeTruthy();
  });
});

describe('raum.css: Register und Ringe', () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'styles', 'raum.css'),
    'utf8',
  );

  /** Rumpf der ersten Regel, die mit `selector` beginnt. */
  function ruleBody(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    expect(start, `Regel fehlt: ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
  }

  it('blendet das Register unter 900 px Blattbreite aus, die Ringe bleiben', () => {
    const register = ruleBody('.rm-reg');
    expect(register).toContain('display: none');
    expect(register).toContain('pointer-events: none');

    const containerStart = css.indexOf('@container blatt (min-width: 900px)');
    expect(containerStart).toBeGreaterThanOrEqual(0);
    const containerBlock = css.slice(containerStart, css.indexOf('\n  }', containerStart));
    expect(containerBlock).toContain('.rm-reg');
    expect(containerBlock).toContain('display: flex');
    expect(containerBlock).not.toContain('.rm-rings');
  });

  it('zeichnet die Ringe dünn in der Fachfarbe, gestrichelt und ohne Wert', () => {
    const rings = ruleBody('.rm-rings circle');
    expect(rings).toContain('color-mix(in srgb, var(--subj) 40%, transparent)');
    expect(rings).toContain('stroke-dasharray');
    expect(rings).toContain('stroke-width: 1');
  });
});
