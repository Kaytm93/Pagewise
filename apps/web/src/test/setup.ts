import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Nur in Dateien mit jsdom gibt es ein `document`, die übrigen Tests laufen in Node.
afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});
