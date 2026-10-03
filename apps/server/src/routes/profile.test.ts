import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type Session } from '../test-harness';

describe('Profil und Onboarding', () => {
  let harness: Harness;
  let session: Session;

  beforeEach(async () => {
    harness = createHarness();
    session = await harness.signIn();
  });
  afterEach(() => harness.close());

  it.each([
    ['GET', '/api/profile'],
    ['PATCH', '/api/profile'],
    ['POST', '/api/onboarding/complete'],
  ])('verlangt für %s %s eine Anmeldung', async (method, path) => {
    const reply = await harness.call(method, path, { body: {} });
    expect(reply.status).toBe(401);
    expect(reply.body).toEqual({ error: 'unauthorized' });
  });

  it('startet leer und nicht abgeschlossen', async () => {
    const reply = await session.call('GET', '/api/profile');
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      federalState: null,
      schoolType: null,
      gradeLevel: null,
      onboardingCompleted: false,
    });
  });

  it('speichert Angaben getrimmt und ändert nur die übergebenen Felder', async () => {
    await session.call('PATCH', '/api/profile', {
      federalState: '  Beispielland  ',
      gradeLevel: '11',
    });
    const reply = await session.call('PATCH', '/api/profile', { schoolType: 'Beispielschule' });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      federalState: 'Beispielland',
      schoolType: 'Beispielschule',
      gradeLevel: '11',
      onboardingCompleted: false,
    });
    expect((await session.call('GET', '/api/profile')).body).toEqual(reply.body);
  });

  it('löscht ein Feld mit leerem Text oder null', async () => {
    await session.call('PATCH', '/api/profile', { federalState: 'Beispielland', gradeLevel: '11' });
    const reply = await session.call('PATCH', '/api/profile', {
      federalState: '   ',
      gradeLevel: null,
    });
    expect(reply.body.federalState).toBeNull();
    expect(reply.body.gradeLevel).toBeNull();
  });

  it.each([
    [{ federalState: 'x'.repeat(81) }, 'federalState'],
    [{ schoolType: 'zwei\nZeilen' }, 'schoolType'],
    [{ gradeLevel: 11 }, 'gradeLevel'],
    [{ unbekannt: 'Feld' }, null],
  ])('lehnt die Eingabe %j mit 400 ab', async (body, field) => {
    const reply = await session.call('PATCH', '/api/profile', body);
    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: 'invalid_input', field });
  });

  it('verlangt das CSRF-Token', async () => {
    const reply = await harness.call('PATCH', '/api/profile', {
      cookie: session.cookie,
      body: { federalState: 'Beispielland' },
    });
    expect(reply.status).toBe(403);
    expect(reply.body).toEqual({ error: 'csrf' });
  });

  it('schließt das Onboarding ab, mehrfaches Aufrufen schadet nicht', async () => {
    const first = await session.call('POST', '/api/onboarding/complete');
    expect(first.status).toBe(200);
    expect(first.body.onboardingCompleted).toBe(true);
    const second = await session.call('POST', '/api/onboarding/complete');
    expect(second.body.onboardingCompleted).toBe(true);
    expect((await session.call('GET', '/api/profile')).body.onboardingCompleted).toBe(true);
  });

  it('behält das Onboarding auch bei späteren Profiländerungen als abgeschlossen', async () => {
    await session.call('POST', '/api/onboarding/complete');
    const reply = await session.call('PATCH', '/api/profile', { gradeLevel: '12' });
    expect(reply.body.onboardingCompleted).toBe(true);
  });
});
