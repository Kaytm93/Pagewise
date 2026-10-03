#!/usr/bin/env node
// Privacy-Check: sucht in Dateinamen und Inhalten nach eigenen, privaten Begriffen.
//
// Die Begriffe stehen in einer LOKALEN, nicht eingecheckten Datei:
//   config/privacy-blacklist.local.txt   (oder Pfad in SCHULHEFT_PRIVACY_BLACKLIST)
// Pro Zeile ein Begriff (ohne Beachtung der Groß-/Kleinschreibung) oder ein regulärer Ausdruck
// mit Präfix "re:". Leere Zeilen und Zeilen mit "#" am Anfang werden ignoriert.
//
//   node scripts/check-privacy.mjs --staged | --all | --files <Datei…>
//
// Die gefundenen Begriffe werden nicht ausgegeben, nur die Nummer des Eintrags.
// Exit-Codes: 0 sauber oder keine Blacklist, 1 Fund, 2 Aufruf- oder Laufzeitfehler.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFiles, parseArgs, repoRoot } from './lib/files.mjs';

const DEFAULT_BLACKLIST = join(repoRoot, 'config', 'privacy-blacklist.local.txt');

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Liest die Blacklist-Datei und liefert [{ number, regex }]. */
export function loadBlacklist(path) {
  const patterns = [];
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const source = line.startsWith('re:') ? line.slice(3) : escapeRegex(line);
    try {
      patterns.push({ number: index + 1, regex: new RegExp(source, 'i') });
    } catch {
      throw new Error(`Ungültiger regulärer Ausdruck in Zeile ${index + 1} der Blacklist`);
    }
  });
  return patterns;
}

export function checkEntries(entries, patterns) {
  const findings = [];
  for (const entry of entries) {
    for (const pattern of patterns) {
      if (pattern.regex.test(entry.path)) {
        findings.push({ path: entry.path, line: 0, entry: pattern.number });
      }
    }
    const lines = entry.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        if (pattern.regex.test(line)) {
          findings.push({ path: entry.path, line: index + 1, entry: pattern.number });
        }
      }
    });
  }
  return findings;
}

function main() {
  const parsed = parseArgs(process.argv);
  if (!parsed) {
    console.error('Aufruf: check-privacy.mjs --staged | --all | --files <Datei…>');
    return 2;
  }

  const blacklistPath = process.env.SCHULHEFT_PRIVACY_BLACKLIST || DEFAULT_BLACKLIST;
  if (!existsSync(blacklistPath)) {
    if (parsed.mode !== 'staged') {
      console.log(
        'privacy-check: Keine lokale Blacklist gefunden (config/privacy-blacklist.local.txt), übersprungen.',
      );
    }
    return 0;
  }

  let patterns;
  let collected;
  try {
    patterns = loadBlacklist(blacklistPath);
    collected = collectFiles(parsed.mode, parsed.files);
  } catch (error) {
    console.error(`privacy-check: ${error.message}.`);
    return 2;
  }

  const findings = checkEntries(collected.entries, patterns);
  if (findings.length === 0) {
    if (parsed.mode !== 'staged') {
      console.log(`privacy-check: ${collected.entries.length} Dateien geprüft, nichts gefunden.`);
    }
    return 0;
  }

  console.error('privacy-check: Begriffe aus deiner lokalen Blacklist gefunden (nicht angezeigt):');
  for (const finding of findings) {
    const where =
      finding.line > 0 ? `${finding.path}:${finding.line}` : `${finding.path} (Dateiname)`;
    console.error(`  ${where}  Blacklist-Eintrag in Zeile ${finding.entry}`);
  }
  console.error('\nEntferne die Angaben oder ersetze sie durch offensichtlich erfundene Daten.');
  return 1;
}

const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main());
