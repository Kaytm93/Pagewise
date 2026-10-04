/**
 * Pagewise baut von sich aus keine Verbindung zu Fremden auf (keine Telemetrie, kein Hintergrund-Ping). Chromium tut
 * das ohne diese Schalter schon: Es fragt im Hintergrund bei Google nach Komponenten-Updates (`redirector.gvt1.com`)
 * und prüft die Verbindung (`www.google.com`), im Container mit dem Proxy-Protokoll gemessen (4. Oktober 2026).
 * Die Schalter müssen vor `app.whenReady()` gesetzt werden.
 */
export const PRIVACY_SWITCHES: ReadonlyArray<readonly [string, string?]> = [
  ['disable-background-networking'],
  ['disable-component-update'],
  ['disable-domain-reliability'],
  ['disable-client-side-phishing-detection'],
  ['disable-sync'],
  ['no-pings'],
  ['no-default-browser-check'],
  ['disable-breakpad'],
  [
    'disable-features',
    'OptimizationHints,OptimizationGuideModelDownloading,Translate,MediaRouter,AutofillServerCommunication,CertificateTransparencyComponentUpdater,SafeBrowsingEnhancedProtection',
  ],
];

export interface CommandLineLike {
  appendSwitch(name: string, value?: string): void;
}

export function applyPrivacySwitches(commandLine: CommandLineLike): void {
  for (const [name, value] of PRIVACY_SWITCHES) {
    if (value === undefined) commandLine.appendSwitch(name);
    else commandLine.appendSwitch(name, value);
  }
}
