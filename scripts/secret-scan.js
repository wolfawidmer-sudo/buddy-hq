#!/usr/bin/env node
'use strict';

// Secret-Scan vor jedem Commit/Push und im CI.
// Prüft alle Dateien, die im Repo sind oder hineinkommen würden
// (getrackt, gestaged, neu und nicht ignoriert). Bricht mit Code 1 ab, wenn etwas gefunden wird.
// Gefundene Werte werden nie ganz ausgegeben, nur maskiert.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { PATTERNS } = require('../src/core/secret-patterns');

const FORBIDDEN_FILES = [/(^|\/)\.env(\..+)?$/, /\.(pem|key|p12|pfx)$/i, /(^|\/)secrets[^/]*\.json$/i];

function mask(value) {
  if (value.length <= 8) return '…';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function scanText(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) {
        findings.push({ line: i + 1, type: name, preview: mask(m[0]) });
      }
    }
  });
  return findings;
}

function listFiles(cwd) {
  const run = (args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  const files = new Set([
    ...run(['ls-files']),
    ...run(['diff', '--cached', '--name-only', '--diff-filter=ACMR']),
    ...run(['ls-files', '--others', '--exclude-standard']),
  ]);
  return [...files].sort();
}

function scanRepo(cwd = process.cwd()) {
  const results = [];
  for (const rel of listFiles(cwd)) {
    if (FORBIDDEN_FILES.some((re) => re.test(rel))) {
      results.push({ file: rel, line: 0, type: 'Verbotene Datei', preview: rel });
      continue;
    }
    const abs = path.join(cwd, rel);
    let buf;
    try {
      buf = fs.readFileSync(abs);
    } catch {
      continue; // gelöscht oder kein normales File
    }
    if (buf.includes(0)) continue; // Binärdatei
    for (const f of scanText(buf.toString('utf8'))) results.push({ file: rel, ...f });
  }
  return results;
}

if (require.main === module) {
  const results = scanRepo(process.cwd());
  if (results.length === 0) {
    console.log('Secret-Scan: nichts gefunden.');
    process.exit(0);
  }
  console.error('Secret-Scan: mögliche Secrets gefunden. Commit/Push abgebrochen.');
  for (const r of results) console.error(`  ${r.file}:${r.line}  ${r.type}  ${r.preview}`);
  process.exit(1);
}

module.exports = { scanText, scanRepo, mask, PATTERNS, FORBIDDEN_FILES };
