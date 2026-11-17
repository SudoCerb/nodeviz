#!/usr/bin/env node
// Prepares a release, run by .github/workflows/release.yml:
//   node scripts/release/prepare.js <patch|minor|major|none>
// - bumps "version" in package.json (none = keep it, e.g. to publish a version
//   that is already set but not yet released),
// - turns "## Unreleased" in CHANGELOG.md into "## <version> (preview)",
//   or uses an existing "## <version>" section,
// - fails when that section is missing or empty, so nothing is published
//   without notes,
// - writes the section to a notes file for the GitHub release.
// In GitHub Actions it sets RELEASE_VERSION and RELEASE_NOTES in $GITHUB_ENV.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const BUMPS = ['patch', 'minor', 'major', 'none'];

function bump(version, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`package.json version "${version}" is not x.y.z`);
  const [maj, min, pat] = m.slice(1).map(Number);
  switch (kind) {
    case 'major': return `${maj + 1}.0.0`;
    case 'minor': return `${maj}.${min + 1}.0`;
    case 'patch': return `${maj}.${min}.${pat + 1}`;
    case 'none': return version;
    default: throw new Error(`Unknown bump "${kind}". Use one of: ${BUMPS.join(', ')}`);
  }
}

// Returns { changelog, notes }. Throws when there is nothing to release.
function applyChangelog(text, version, preview) {
  const lines = text.split('\n');
  const esc = version.replace(/\./g, '\\.');
  const unreleased = lines.findIndex(l => /^## Unreleased\b/i.test(l));
  let start = lines.findIndex(l => new RegExp(`^## ${esc}(\\s|$)`).test(l));

  if (unreleased !== -1) {
    if (start !== -1) {
      throw new Error(`CHANGELOG.md has both "## Unreleased" and "## ${version}". Merge them into one.`);
    }
    lines[unreleased] = `## ${version}${preview ? ' (preview)' : ''}`;
    start = unreleased;
  }
  if (start === -1) {
    throw new Error(`CHANGELOG.md has no "## Unreleased" section and no "## ${version}" section. ` +
      'Write what changed under "## Unreleased" at the top, commit, and run the release again.');
  }

  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end === -1) end = lines.length;
  const notes = lines.slice(start + 1, end).join('\n').trim();
  if (!notes) throw new Error(`The CHANGELOG.md section for ${version} is empty.`);
  return { changelog: lines.join('\n'), notes };
}

function setVersion(pkgText, version) {
  return pkgText.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
}

function main(argv, root) {
  const kind = argv[0] || 'patch';
  const pkgPath = path.join(root, 'package.json');
  const clPath = path.join(root, 'CHANGELOG.md');

  const pkgText = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(pkgText);
  const version = bump(pkg.version, kind);
  const { changelog, notes } = applyChangelog(fs.readFileSync(clPath, 'utf8'), version, pkg.preview === true);

  if (version !== pkg.version) fs.writeFileSync(pkgPath, setVersion(pkgText, version));
  fs.writeFileSync(clPath, changelog);

  // Outside the repo, so vsce never packages it.
  const notesFile = path.join(process.env.RUNNER_TEMP || os.tmpdir(), `nodeviz-${version}-notes.md`);
  fs.writeFileSync(notesFile, notes + '\n');

  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV, `RELEASE_VERSION=${version}\nRELEASE_NOTES=${notesFile}\n`);
  }
  console.log(`Releasing ${pkg.version === version ? version : `${pkg.version} -> ${version}`}\n\n${notes}`);
  return { version, notesFile };
}

if (require.main === module) {
  try {
    main(process.argv.slice(2), path.resolve(__dirname, '..', '..'));
  } catch (err) {
    console.log(`::error::${err.message}`);
    process.exit(1);
  }
}

module.exports = { bump, applyChangelog, setVersion, main };
