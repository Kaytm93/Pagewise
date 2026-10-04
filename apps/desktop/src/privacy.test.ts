import { describe, expect, it } from 'vitest';
import { applyPrivacySwitches, PRIVACY_SWITCHES } from './privacy';

describe('Hintergrundverbindungen von Chromium', () => {
  it('schaltet Hintergrundnetz, Komponenten-Updates und Rückmeldungen ab', () => {
    const calls: Array<[string, string | undefined]> = [];
    applyPrivacySwitches({ appendSwitch: (name, value) => calls.push([name, value]) });
    const names = calls.map(([name]) => name);
    for (const required of [
      'disable-background-networking',
      'disable-component-update',
      'disable-domain-reliability',
      'disable-client-side-phishing-detection',
      'disable-sync',
      'no-pings',
    ]) {
      expect(names, required).toContain(required);
    }
    expect(calls.length).toBe(PRIVACY_SWITCHES.length);
  });

  it('gibt Schalter mit Wert (disable-features) mit Wert weiter und die ohne Wert ohne', () => {
    const calls: Array<[string, string | undefined]> = [];
    applyPrivacySwitches({ appendSwitch: (...args) => calls.push([args[0], args[1]]) });
    const features = calls.find(([name]) => name === 'disable-features');
    expect(features?.[1]).toContain('OptimizationHints');
    const plain = calls.find(([name]) => name === 'disable-background-networking');
    expect(plain?.[1]).toBeUndefined();
  });
});
