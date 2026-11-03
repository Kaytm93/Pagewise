import { execFileSync } from 'node:child_process';
import { delimiter } from 'node:path';

/**
 * Hilfe für Tests: findet ein Python, mit dem sich die Sandbox prüfen lässt. `PAGEWISE_TEST_PYTHON` hat Vorrang,
 * sonst das erste `python3` im `PATH`. Gibt `null` zurück, wenn keines läuft; die Tests werden dann übersprungen.
 */

export interface TestPython {
  python: string;
  readOnly: string[];
}

const PROGRAM =
  'import os, sys; print(os.path.realpath(sys.executable)); print(os.path.realpath(sys.base_prefix)); print(os.path.realpath(sys.prefix))';

function inspect(candidate: string): TestPython | null {
  try {
    const lines = execFileSync(candidate, ['-c', PROGRAM], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n');
    const [python, base, prefix] = lines;
    if (!python || !base || !prefix) return null;
    return { python, readOnly: [...new Set([base, prefix])] };
  } catch {
    return null;
  }
}

export function findTestPython(): TestPython | null {
  const configured = process.env.PAGEWISE_TEST_PYTHON;
  if (configured) return inspect(configured);
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const found = inspect(`${dir}/python3`);
    if (found) return found;
  }
  return null;
}
