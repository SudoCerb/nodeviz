'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { bump, applyChangelog, setVersion, main } = require('../scripts/release/prepare');

const CHANGELOG = [
  '# Changelog',
  '',
  '## Unreleased',
  '',
  '- Fixed a thing.',
  '',
  '## 0.3.1 (preview)',
  '',
  '- Older thing.',
  '',
].join('\n');

test('bump: patch, minor, major, none', () => {
  assert.equal(bump('0.3.1', 'patch'), '0.3.2');
  assert.equal(bump('0.3.1', 'minor'), '0.4.0');
  assert.equal(bump('0.3.1', 'major'), '1.0.0');
  assert.equal(bump('0.3.1', 'none'), '0.3.1');
  assert.throws(() => bump('0.3.1', 'huge'), /Unknown bump/);
  assert.throws(() => bump('0.3.1-beta', 'patch'), /not x\.y\.z/);
});

test('changelog: Unreleased becomes the new version, notes are its section only', () => {
  const { changelog, notes } = applyChangelog(CHANGELOG, '0.3.2', true);
  assert.match(changelog, /^## 0\.3\.2 \(preview\)$/m);
  assert.doesNotMatch(changelog, /Unreleased/);
  assert.match(changelog, /^## 0\.3\.1 \(preview\)$/m);
  assert.equal(notes, '- Fixed a thing.');
  assert.equal(applyChangelog(CHANGELOG, '1.0.0', false).changelog.includes('## 1.0.0\n'), true);
});

test('changelog: an existing section for the version is used as is (bump none)', () => {
  const text = CHANGELOG.replace('## Unreleased\n\n- Fixed a thing.\n\n', '');
  const { changelog, notes } = applyChangelog(text, '0.3.1', true);
  assert.equal(changelog, text);
  assert.equal(notes, '- Older thing.');
});

test('changelog: refuses to release without notes', () => {
  const none = '# Changelog\n\n## 0.3.1 (preview)\n\n- Older thing.\n';
  assert.throws(() => applyChangelog(none, '0.3.2', true), /no "## Unreleased" section/);
  const empty = '# Changelog\n\n## Unreleased\n\n## 0.3.1 (preview)\n\n- Older thing.\n';
  assert.throws(() => applyChangelog(empty, '0.3.2', true), /is empty/);
  assert.throws(() => applyChangelog(CHANGELOG, '0.3.1', true), /both "## Unreleased" and "## 0\.3\.1"/);
});

test('changelog: 0.3.1 does not match a 0.3.10 heading', () => {
  const text = '# Changelog\n\n## 0.3.10\n\n- Later.\n';
  assert.throws(() => applyChangelog(text, '0.3.1', true), /no "## Unreleased"/);
});

test('setVersion keeps the rest of package.json byte for byte', () => {
  const pkg = '{\n  "name": "nodeviz",\n  "version": "0.3.1",\n  "engines": { "vscode": "^1.85.0" }\n}\n';
  assert.equal(setVersion(pkg, '0.3.2'), pkg.replace('0.3.1', '0.3.2'));
});

test('main: writes package.json, CHANGELOG.md, notes and GITHUB_ENV', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeviz-release-'));
  const envFile = path.join(dir, 'github_env');
  fs.writeFileSync(path.join(dir, 'package.json'), '{\n  "version": "0.3.1",\n  "preview": true\n}\n');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), CHANGELOG);
  const saved = { env: process.env.GITHUB_ENV, tmp: process.env.RUNNER_TEMP, log: console.log };
  process.env.GITHUB_ENV = envFile;
  process.env.RUNNER_TEMP = dir;
  console.log = () => {};
  try {
    const { version, notesFile } = main(['patch'], dir);
    assert.equal(version, '0.3.2');
    assert.match(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), /"version": "0\.3\.2"/);
    assert.match(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'), /^## 0\.3\.2 \(preview\)$/m);
    assert.equal(fs.readFileSync(notesFile, 'utf8'), '- Fixed a thing.\n');
    assert.equal(fs.readFileSync(envFile, 'utf8'), `RELEASE_VERSION=0.3.2\nRELEASE_NOTES=${notesFile}\n`);
  } finally {
    for (const [k, v] of [['GITHUB_ENV', saved.env], ['RUNNER_TEMP', saved.tmp]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    console.log = saved.log;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
