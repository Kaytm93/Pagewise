// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { ApiClient } from '../../api/client';
import { FakeServer } from '../../test/fake-server';

/*
 * N2 (B-08, D-093): Im Kopf des Editors waren „Anheften“ und „Löschen“ auf dem iPhone nur 31 px breit (Soll 44 px),
 * weil die Knöpfe in einer zu engen Zeile schrumpften. Jetzt schrumpft keiner der Knöpfe, und die Gruppe bricht
 * um, wenn die Zeile nicht reicht. jsdom misst keine Breiten: der Test nagelt die Klassen fest, die das bewirken;
 * die Breiten sind im Browser gemessen (Belege unter shots/N2/). Alle Namen erfunden.
 */

beforeAll(async () => {
  await import('./NotePage');
}, 30_000);

afterEach(cleanup);

async function openEditor() {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach A');
  const note = server.addNote(subject.id, { title: 'Mein Eintrag', markdown: 'Start' });
  window.history.replaceState(null, '', `/subjects/${subject.id}/notes/${note.id}`);
  render(<App client={new ApiClient({ fetch: server.fetch })} />);
  await screen.findByRole('textbox', { name: 'Text (Markdown)' });
}

describe('Editor-Kopf: Bedienelemente schrumpfen nicht', () => {
  it('Anheften und Löschen sind 44 px groß und behalten die Größe (size-11, shrink-0)', async () => {
    await openEditor();
    for (const name of ['Anheften', 'Löschen']) {
      const knopf = screen.getByRole('button', { name });
      expect(knopf.classList.contains('size-11'), `${name}: 44 × 44 px`).toBe(true);
      expect(knopf.classList.contains('shrink-0'), `${name}: schrumpft nicht`).toBe(true);
    }
  });

  it('„Speichern“, Anheften, Löschen bleiben beisammen und schrumpfen als Gruppe nicht', async () => {
    await openEditor();
    const speichern = screen.getByRole('button', { name: 'Speichern' });
    const aktionen = speichern.parentElement as HTMLElement;
    expect(aktionen.contains(screen.getByRole('button', { name: 'Anheften' }))).toBe(true);
    expect(aktionen.contains(screen.getByRole('button', { name: 'Löschen' }))).toBe(true);
    expect(aktionen.classList.contains('shrink-0')).toBe(true);
  });

  it('Umschalter und Aktionen liegen in einer Gruppe, die umbricht statt zu quetschen', async () => {
    await openEditor();
    const umschalter = screen.getByRole('group', { name: 'Ansicht' });
    const huelle = umschalter.parentElement as HTMLElement;
    // Der Umschalter behält seine Breite (kein Zusammenschieben von „Schreiben“ und „Vorschau“).
    expect(huelle.classList.contains('shrink-0')).toBe(true);
    // Unter 1024 px zeigt ihn der Kopf, darüber nicht (Vorschau steht dort daneben).
    expect(huelle.classList.contains('lg:hidden')).toBe(true);
    const gruppe = huelle.parentElement as HTMLElement;
    expect(gruppe.classList.contains('flex-wrap')).toBe(true);
    expect(gruppe.classList.contains('ml-auto')).toBe(true);
  });

  it('umgebrochene Zeilen der Gruppe beginnen links, nicht rechts (D-117, Kay am 7. November 2026)', async () => {
    await openEditor();
    const umschalter = screen.getByRole('group', { name: 'Ansicht' });
    const gruppe = (umschalter.parentElement as HTMLElement).parentElement as HTMLElement;
    expect(gruppe.classList.contains('justify-start')).toBe(true);
    expect(gruppe.classList.contains('justify-end')).toBe(false);
    // In einer Zeile (Mac, iPad, iPhone quer) sitzt die Gruppe unverändert rechts: über ml-auto, nicht über justify.
    expect(gruppe.classList.contains('ml-auto')).toBe(true);
  });
});
