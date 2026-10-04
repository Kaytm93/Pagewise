import { describe, expect, it } from 'vitest';
import { ROUTES } from './config';
import { decideNavigation, decideWindowOpen, isKnownRoute, routeUrl } from './navigation';

const ORIGIN = 'http://127.0.0.1:3000';

describe('Navigation im Hauptfenster', () => {
  it('erlaubt nur die eigene Herkunft', () => {
    expect(decideNavigation(`${ORIGIN}/subjects/1`, ORIGIN)).toEqual({ action: 'allow' });
    expect(decideNavigation(`${ORIGIN}/`, ORIGIN)).toEqual({ action: 'allow' });
  });

  it('schickt fremdes http und https in den Standardbrowser', () => {
    expect(decideNavigation('https://example.org/x', ORIGIN)).toEqual({
      action: 'external',
      url: 'https://example.org/x',
    });
    expect(decideNavigation('http://example.org/', ORIGIN)).toMatchObject({ action: 'external' });
    // Gleicher Rechner, anderer Port oder anderer Name ist fremd.
    expect(decideNavigation('http://127.0.0.1:3001/', ORIGIN)).toMatchObject({
      action: 'external',
    });
    expect(decideNavigation('http://localhost:3000/', ORIGIN)).toMatchObject({
      action: 'external',
    });
    expect(decideNavigation('http://127.0.0.1.example.org:3000/', ORIGIN)).toMatchObject({
      action: 'external',
    });
  });

  it('lehnt alles andere ab (file, javascript, data, ftp, kaputte Adressen)', () => {
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'ftp://example.org/',
      'x-apple.systempreferences:com.apple.preference',
      'vbscript:x',
      'about:blank',
      'kein url',
      '',
    ]) {
      expect(decideNavigation(url, ORIGIN), url).toEqual({ action: 'deny' });
    }
  });
});

describe('Neue Fenster (target=_blank)', () => {
  it('öffnet fremdes http(s) im Standardbrowser und nie als neues App-Fenster', () => {
    expect(decideWindowOpen('https://example.org/', ORIGIN)).toEqual({
      action: 'external',
      url: 'https://example.org/',
    });
    expect(decideWindowOpen('mailto:a@example.org', ORIGIN)).toEqual({ action: 'deny' });
    expect(decideWindowOpen('file:///x', ORIGIN)).toEqual({ action: 'deny' });
    expect(decideWindowOpen('javascript:1', ORIGIN)).toEqual({ action: 'deny' });
  });

  it('lädt Dateien der eigenen API herunter, statt sie ohne Cookies im Browser zu öffnen', () => {
    expect(decideWindowOpen(`${ORIGIN}/api/assets/abc/download`, ORIGIN)).toEqual({
      action: 'download',
      url: `${ORIGIN}/api/assets/abc/download`,
    });
  });

  it('öffnet Seiten der eigenen Oberfläche im selben Fenster', () => {
    expect(decideWindowOpen(`${ORIGIN}/subjects/1`, ORIGIN)).toEqual({
      action: 'navigate',
      url: `${ORIGIN}/subjects/1`,
    });
  });
});

describe('Bekannte Routen', () => {
  it('kennt genau Start, neuen Chat und Einstellungen', () => {
    expect(ROUTES).toEqual({ home: '/', newChat: '/chat', settings: '/settings' });
    for (const path of Object.values(ROUTES)) expect(isKnownRoute(path)).toBe(true);
    for (const path of ['/api/data/erase', '/chat/', '//example.org', 'javascript:1', '']) {
      expect(isKnownRoute(path), path).toBe(false);
    }
  });

  it('baut Adressen nur für bekannte Routen', () => {
    expect(routeUrl(ORIGIN, '/chat')).toBe('http://127.0.0.1:3000/chat');
    expect(() => routeUrl(ORIGIN, '/api/data/erase')).toThrow('Unbekannte Route');
    expect(() => routeUrl(ORIGIN, '//example.org')).toThrow();
  });
});
