#!/usr/bin/env node
// Einfacher, abhängigkeitsfreier Secret-Scan für den Pre-Commit-Hook.
// Gibt gefundene Werte NIE aus, nur Regel, Datei und Zeile.
//
//   node scripts/secret-scan.mjs --staged        gestagte Dateien (Index)
//   node scripts/secret-scan.mjs --all           alle getrackten und nicht ignorierten Dateien
//   node scripts/secret-scan.mjs --files a b c   bestimmte Dateien
//
// Einzelne Zeilen lassen sich mit dem Marker "secret-scan:allow" ausnehmen.
// Exit-Codes: 0 sauber, 1 Fund, 2 Aufruf- oder Laufzeitfehler.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collectFiles, parseArgs } from './lib/files.mjs';

const ALLOW_MARKER = 'secret-scan:allow';
const SKIPPED_FILES = new Set(['pnpm-lock.yaml']);

export const RULES = [
  {
    id: 'private-key',
    description: 'privater Schlüssel',
    regex: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/,
  },
  {
    id: 'github-token',
    description: 'GitHub-Token',
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b/,
  },
  {
    id: 'openrouter-key',
    description: 'OpenRouter-API-Key',
    regex: /\bsk-or-v1-[A-Za-z0-9]{32,}\b/,
  },
  {
    id: 'anthropic-key',
    description: 'Anthropic-API-Key',
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: 'openai-key',
    description: 'OpenAI-artiger API-Key',
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
  },
  {
    id: 'google-key',
    description: 'Google-API-Key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    id: 'slack-token',
    description: 'Slack-Token',
    regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    id: 'aws-access-key',
    description: 'AWS-Access-Key',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'zai-key',
    description: 'Z.ai-API-Key (Format id.geheimnis)',
    regex: /\b[0-9a-f]{32}\.[A-Za-z0-9]{12,}\b/,
  },
];

// Allgemeine Zuweisungen wie  api_key = "…",  PASSWORD: …,  token=…
const ASSIGNMENT =
  /(?:api[_-]?key|secret(?:[_-]?key)?|(?:access|auth|bearer|refresh)?[_-]?token|passcode|passwort|password|private[_-]?key)["']?\s*[:=]\s*["']?([A-Za-z0-9_\-+/=.]{20,})["']?/i;

const PLACEHOLDER_HINTS = [
  'your',
  'example',
  'beispiel',
  'placeholder',
  'platzhalter',
  'changeme',
  'xxxx',
  'process.env',
  '${',
  '<',
];

function looksLikePlaceholder(value) {
  const lower = value.toLowerCase();
  if (PLACEHOLDER_HINTS.some((hint) => lower.includes(hint))) return true;
  if (/^(.)\1+$/.test(value)) return true;
  // Reine Bezeichner ohne Ziffern sind fast immer Code, kein Geheimnis.
  return !/\d/.test(value) || !/[A-Za-z]/.test(value);
}

/** Prüft einen Text und liefert Funde ohne den gefundenen Wert. */
export function scanText(text, path = '(text)') {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const rule of RULES) {
      if (rule.regex.test(line)) {
        findings.push({ rule: rule.id, description: rule.description, path, line: index + 1 });
      }
    }
    const match = ASSIGNMENT.exec(line);
    if (match?.[1] && !looksLikePlaceholder(match[1])) {
      findings.push({
        rule: 'generic-assignment',
        description: 'Zuweisung, die wie ein Geheimnis aussieht',
        path,
        line: index + 1,
      });
    }
  });
  return findings;
}

export function scanEntries(entries) {
  const findings = [];
  for (const entry of entries) {
    const name = entry.path.split('/').pop() ?? entry.path;
    if (SKIPPED_FILES.has(name)) continue;
    findings.push(...scanText(entry.content, entry.path));
  }
  return findings;
}

function main() {
  const parsed = parseArgs(process.argv);
  if (!parsed) {
    console.error('Aufruf: secret-scan.mjs --staged | --all | --files <Datei…>');
    return 2;
  }
  let collected;
  try {
    collected = collectFiles(parsed.mode, parsed.files);
  } catch (error) {
    console.error(`secret-scan: Dateien konnten nicht ermittelt werden (${error.message}).`);
    return 2;
  }

  const findings = scanEntries(collected.entries);
  if (findings.length === 0) {
    if (parsed.mode !== 'staged') {
      console.log(`secret-scan: ${collected.entries.length} Dateien geprüft, nichts gefunden.`);
    }
    return 0;
  }

  console.error('secret-scan: Mögliche Geheimnisse gefunden (Werte werden nicht angezeigt):');
  for (const finding of findings) {
    console.error(`  ${finding.path}:${finding.line}  ${finding.rule} (${finding.description})`);
  }
  console.error(
    [
      '',
      'Entferne den Wert aus der Datei und rotiere ihn, falls er echt war.',
      'Bei einem Fehlalarm in Test- oder Beispieldaten: Wert zur Laufzeit zusammensetzen',
      `oder die Zeile mit dem Marker "${ALLOW_MARKER}" versehen.`,
    ].join('\n'),
  );
  return 1;
}

const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main());
