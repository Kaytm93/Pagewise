// Hilfen für die Repo-Tests. Fake-Schlüssel werden zur Laufzeit zusammengesetzt,
// damit der Secret-Scan den Quelltext dieser Tests nicht trifft.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const fakeKeys = {
  'private-key': `${'-'.repeat(5)}BEGIN ${'RSA '}PRIVATE KEY${'-'.repeat(5)}`,
  'github-token': `${'gh'}${'p_'}${'Ab1'.repeat(14)}`,
  'openrouter-key': `${'sk-or'}${'-v1-'}${'a1b2c3d4'.repeat(8)}`,
  'anthropic-key': `${'sk-'}${'ant-'}${'api03-'}${'Zy9x'.repeat(8)}`,
  'openai-key': `${'sk-'}${'proj-'}${'Qw3r'.repeat(10)}`,
  'google-key': `${'AI'}${'za'}${'Sy'}${'A1b2C3d4'.repeat(4)}${'x'}`,
  'slack-token': `${'xo'}${'xb-'}${'1234567890-'}${'AbCdEfGh'}`,
  'aws-access-key': `${'AK'}${'IA'}${'ABCDEFGH12345678'}`,
  'zai-key': `${'0123456789abcdef'.repeat(2)}${'.'}${'Ab12Cd34Ef56Gh78'}`,
};

export const genericAssignment = `${'api_'}${'key'} = "${'Ab12'.repeat(8)}"`;

export function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

export function runNode(script, args, options = {}) {
  return run(process.execPath, [resolve(options.cwd ?? root, script), ...args], options);
}
