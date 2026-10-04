import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Sammelt die Lizenzhinweise der Pakete, die in der Mac-App stecken (Server-Bundle, Oberfläche, Hülle), und schreibt
 * sie in eine Textdatei, die als `Resources/licenses/THIRD-PARTY-LICENSES.txt` mitgeht. MIT, BSD und Apache verlangen,
 * dass der Hinweis mit der Software ausgeliefert wird. Das Bundle enthält den Code der Pakete, aber nicht ihre Dateien.
 *
 * Vorgehen: Ausgehend von den Laufzeitabhängigkeiten (`dependencies`, `optionalDependencies`, nie `devDependencies`)
 * der Pakete der App wird der Abhängigkeitsbaum im Dateisystem abgelaufen (pnpm legt ihn als Symlinks an). Das ist
 * eine **Obermenge** dessen, was wirklich im Bundle landet: lieber ein Hinweis zu viel als einer zu wenig. Die Suche
 * liest nur `package.json` und Dateien, deren Name nach Lizenz klingt, nie `exports`-Tabellen, und führt nichts aus.
 */

export interface Root {
  /** Ordner mit der `package.json`, von dem aus gesucht wird. */
  dir: string;
  /** Namen, mit denen die Suche beginnt. Standard: `dependencies` der `package.json`. */
  names?: string[];
}

export interface PackageLicense {
  name: string;
  version: string;
  license: string;
  source: string | null;
  texts: { file: string; text: string }[];
}

interface PackageJson {
  name?: string;
  version?: string;
  license?: unknown;
  licenses?: unknown;
  repository?: unknown;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const OWN_SCOPE = '@pagewise/';
const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)([._-].*)?$/i;
const MAX_TEXT_BYTES = 200_000;

/** Sucht `<name>` wie Node: in `node_modules` jedes übergeordneten Ordners, ohne `exports` zu beachten. */
export function findPackageDir(name: string, fromDir: string): string | null {
  let current = fromDir;
  for (;;) {
    const candidate = join(current, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readPackageJson(dir: string): PackageJson {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as PackageJson) : {};
  } catch {
    return {};
  }
}

function licenseId(pkg: PackageJson): string {
  const single = pkg.license;
  if (typeof single === 'string' && single.trim()) return single.trim();
  if (typeof single === 'object' && single !== null) {
    const type = (single as { type?: unknown }).type;
    if (typeof type === 'string' && type.trim()) return type.trim();
  }
  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses
      .map((entry) => (entry as { type?: unknown } | null)?.type)
      .filter((type): type is string => typeof type === 'string' && type.trim() !== '');
    if (types.length > 0) return types.join(' OR ');
  }
  return 'UNKNOWN';
}

function sourceOf(pkg: PackageJson): string | null {
  const repo = pkg.repository;
  const url = typeof repo === 'string' ? repo : (repo as { url?: unknown } | null | undefined)?.url;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

function licenseTexts(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (!LICENSE_FILE.test(entry)) continue;
    const path = join(dir, entry);
    const info = statSync(path);
    if (!info.isFile() || info.size > MAX_TEXT_BYTES) continue;
    out.push({ file: entry, text: readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trim() });
  }
  return out;
}

/** Läuft den Abhängigkeitsbaum ab. Pakete, die nicht installiert sind (optionale Plattformpakete), fehlen einfach. */
export function collectLicenses(roots: Root[]): PackageLicense[] {
  const found = new Map<string, PackageLicense>();
  const seenDirs = new Set<string>();
  const queue: { name: string; from: string }[] = [];
  for (const root of roots) {
    const names = root.names ?? Object.keys(readPackageJson(root.dir).dependencies ?? {});
    for (const name of names) queue.push({ name, from: root.dir });
  }

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || item.name.startsWith(OWN_SCOPE)) continue;
    const dir = findPackageDir(item.name, item.from);
    if (!dir || seenDirs.has(dir)) continue;
    seenDirs.add(dir);
    const pkg = readPackageJson(dir);
    const name = pkg.name ?? item.name;
    const version = pkg.version ?? '0.0.0';
    found.set(`${name}@${version}`, {
      name,
      version,
      license: licenseId(pkg),
      source: sourceOf(pkg),
      texts: licenseTexts(dir),
    });
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      queue.push({ name: dep, from: dir });
    }
  }

  return [...found.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

const RULE = '='.repeat(78);

/** Der Text der Datei. Gleiche Eingabe ergibt gleichen Text (sortiert, ohne Zeitstempel). */
export function renderLicenses(packages: PackageLicense[]): string {
  const lines = [
    'Pagewise: Lizenzen von Drittsoftware',
    '',
    'Pagewise selbst steht unter der MIT-Lizenz. Die App enthält außerdem die folgende Software. Die Liste umfasst die',
    'Laufzeitabhängigkeiten des Servers, der Oberfläche und der Mac-Hülle mit ihren Abhängigkeiten; nicht jedes Paket',
    'steckt vollständig in der App.',
    '',
    'Electron und Chromium bringen ihre eigenen Lizenzen mit: siehe „Electron-LICENSE“ und „LICENSES.chromium.html“',
    'im selben Ordner.',
    '',
    `Pakete: ${packages.length}`,
    '',
  ];
  for (const pkg of packages) {
    lines.push(RULE, `${pkg.name} ${pkg.version}`, `Lizenz: ${pkg.license}`);
    if (pkg.source) lines.push(`Quelle: ${pkg.source}`);
    if (pkg.texts.length === 0) {
      lines.push(
        '',
        '(Das Paket enthält keine Lizenzdatei; maßgeblich ist die oben genannte Lizenz.)',
      );
    }
    for (const { file, text } of pkg.texts) lines.push('', `--- ${file} ---`, '', text);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
