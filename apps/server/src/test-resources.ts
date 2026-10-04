import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_ROOT, repoResources } from './paths';

/** Eine Seite, die nur in Tests vorkommt (die echte Oberfläche liegt in `apps/web/dist` und ist nicht immer gebaut). */
export const FAKE_INDEX =
  '<!doctype html><title>Beispiel-Oberfläche</title><p>Hallo aus dem Ressourcenordner</p>';

/** Baut einen Ressourcenordner im flachen Aufbau des gebündelten Servers, weit weg vom Repo (Tests mit fremdem Pfad). */
export function makeResourceDir(root: string, version = '9.9.9'): string {
  const source = repoResources(APP_ROOT);
  mkdirSync(join(root, 'web', 'assets'), { recursive: true });
  writeFileSync(join(root, 'web', 'index.html'), FAKE_INDEX);
  writeFileSync(join(root, 'web', 'assets', 'app-abc123.js'), 'console.log("beispiel");\n');
  cpSync(source.migrations, join(root, 'drizzle'), { recursive: true });
  mkdirSync(join(root, 'config'), { recursive: true });
  cpSync(source.catalogFile, join(root, 'config', 'subject-catalog.json'));
  cpSync(source.defaultsDir, join(root, 'prompts', 'defaults'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'beispiel', version }));
  return root;
}
