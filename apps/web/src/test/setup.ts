import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Warten auf Elemente: großzügig, damit langsame Rechner (CI) keine Tests kippen. Erfolgreiche Tests
// sind davon nicht langsamer, nur ein echter Fehler meldet sich später.
configure({ asyncUtilTimeout: 5000 });

// Nur in Dateien mit jsdom gibt es ein `document`, die übrigen Tests laufen in Node.
afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});
