import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSubjectCatalog } from '../domain/subject-templates';
import { APP_ROOT } from '../paths';
import { CourseResolver, courseCore } from './codes';

const catalog = loadSubjectCatalog(join(APP_ROOT, 'config', 'subject-catalog.json'));

describe('Kurscodes aus Stundenplänen', () => {
  it.each([
    ['2inf2_2', 'inf'],
    ['1W_INF_1', 'w_inf'],
    ['ev', 'ev'],
    ['2m1', 'm'],
    ['  Mvk ', 'mvk'],
  ])('kürzt %s auf den Kern %s', (raw, core) => {
    expect(courseCore(raw)).toBe(core);
  });

  it.each([
    ['ev', 'Evangelische Religion'],
    ['2ev2_2', 'Evangelische Religion'],
    ['2inf2_2', 'Informatik'],
    ['1inf1_1', 'Informatik'],
    ['W_Inf', 'W-Seminar Informatik'],
    ['P_Ph', 'P-Seminar Physik'],
    ['mvk', 'Vertiefungskurs Mathematik'],
    ['vkm', 'Vertiefungskurs Mathematik'],
    ['2m1_2', 'Mathematik'],
    ['2e3_1', 'Englisch'],
    ['2c2', 'Chemie'],
    ['Mathematik', 'Mathematik'],
  ])('deutet %s als %s', (raw, name) => {
    expect(new CourseResolver(catalog).resolve(raw)?.name).toBe(name);
  });

  it('lässt Unbekanntes und ausgeschriebene Namen ohne Vorlage stehen', () => {
    const resolver = new CourseResolver(catalog);
    expect(resolver.resolve('xyz')).toBeNull();
    expect(resolver.resolve('Beispielfach A')).toBeNull();
    expect(resolver.resolve(null)).toBeNull();
    expect(resolver.resolve('   ')).toBeNull();
  });

  it('eigene Kürzel gehen vor, auch mit Jahrgang und Kursnummer', () => {
    const resolver = new CourseResolver(catalog, [
      { code: 'bsp', subject: 'Beispielfach' },
      { code: 'm', subject: 'Beispielmathe' },
    ]);
    expect(resolver.resolve('2bsp1_2')?.name).toBe('Beispielfach');
    expect(resolver.resolve('2m1')?.name).toBe('Beispielmathe');
    expect(resolver.resolve('W_bsp')?.name).toBe('W-Seminar Beispielfach');
  });

  it('findet die Vorlage auch für Namen mit Zusatz', () => {
    const resolver = new CourseResolver(catalog);
    expect(resolver.templateFor('Vertiefungskurs Mathematik')?.name).toBe('Mathematik');
    expect(resolver.templateFor('W-Seminar Informatik')?.name).toBe('Informatik');
    expect(resolver.templateFor('Beispielfach')).toBeNull();
  });
});
