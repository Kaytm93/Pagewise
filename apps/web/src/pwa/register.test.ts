import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './register';

function fakeRegistration() {
  return { update: vi.fn(async () => {}) } as unknown as ServiceWorkerRegistration;
}

function setup(overrides: Partial<Parameters<typeof registerServiceWorker>[0]> = {}) {
  const registration = fakeRegistration();
  const register = vi.fn(async () => registration);
  const listeners: (() => void)[] = [];
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
  };
  let time = 0;
  const env = {
    production: true,
    isSecureContext: true,
    navigator: { serviceWorker: { register } } as unknown as Navigator,
    document: doc as unknown as Document,
    now: () => time,
    ...overrides,
  };
  return {
    env,
    register,
    registration,
    listeners,
    doc,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('registerServiceWorker', () => {
  it('meldet /sw.js für die ganze App an', async () => {
    const { env, register, registration } = setup();
    expect(await registerServiceWorker(env)).toBe(registration);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('tut im Entwicklungsserver nichts', async () => {
    const { env, register } = setup({ production: false });
    expect(await registerServiceWorker(env)).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it('tut ohne sicheren Kontext (http außerhalb von localhost) nichts', async () => {
    const { env, register } = setup({ isSecureContext: false });
    expect(await registerServiceWorker(env)).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it('tut ohne Unterstützung des Browsers nichts', async () => {
    const { env } = setup({ navigator: {} as Navigator });
    expect(await registerServiceWorker(env)).toBeNull();
  });

  it('läuft weiter, wenn die Anmeldung fehlschlägt', async () => {
    const { env, register } = setup();
    register.mockRejectedValueOnce(new Error('abgelehnt'));
    expect(await registerServiceWorker(env)).toBeNull();
  });

  it('sucht beim Zurückkehren höchstens einmal pro Stunde nach einer neuen Version', async () => {
    const { env, registration, listeners, advance, doc } = setup();
    await registerServiceWorker(env);
    const update = registration.update as ReturnType<typeof vi.fn>;

    listeners[0]?.();
    expect(update).not.toHaveBeenCalled();

    advance(61 * 60 * 1000);
    listeners[0]?.();
    expect(update).toHaveBeenCalledTimes(1);
    listeners[0]?.();
    expect(update).toHaveBeenCalledTimes(1);

    advance(61 * 60 * 1000);
    doc.visibilityState = 'hidden';
    listeners[0]?.();
    expect(update).toHaveBeenCalledTimes(1);
    doc.visibilityState = 'visible';
    listeners[0]?.();
    expect(update).toHaveBeenCalledTimes(2);
  });
});
