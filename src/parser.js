'use strict';

/**
 * Reads dependencies out of dbt model files (.sql and .py) without running dbt.
 * Handles ref('m'), ref('pkg', 'm'), ref('m', v=2), source('s', 't'),
 * dbt.ref("m") / dbt.source("s", "t") in Python models, and config(materialized=...).
 */

function stripComments(text) {
  return text
    .replace(/\{#[\s\S]*?#\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

const REF_RE = /\bref\s*\(\s*(['"])([^'"]+)\1\s*(?:,\s*(['"])([^'"]+)\3)?/g;
const SOURCE_RE = /\bsource\s*\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]+)\3/g;
const MATERIALIZED_RE = /materialized\s*=\s*(['"])(\w+)\1/;
const SNAPSHOT_RE = /\{%-?\s*snapshot\s+(\w+)\s*-?%\}/g;

function parseModel(text, isPython = false) {
  const clean = isPython ? text.replace(/#[^\n]*/g, ' ') : stripComments(text);
  const refs = new Set();
  const sources = new Set();
  let m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(clean))) {
    // Two positional strings means ref('package', 'model').
    refs.add(m[4] ? m[4] : m[2]);
  }
  SOURCE_RE.lastIndex = 0;
  while ((m = SOURCE_RE.exec(clean))) {
    sources.add(m[2] + '.' + m[4]);
  }
  const mat = MATERIALIZED_RE.exec(clean);
  return {
    refs: [...refs],
    sources: [...sources],
    materialized: mat ? mat[2] : null,
  };
}

function parseSnapshots(text) {
  const out = [];
  const clean = stripComments(text);
  let m;
  SNAPSHOT_RE.lastIndex = 0;
  while ((m = SNAPSHOT_RE.exec(clean))) out.push(m[1]);
  return out;
}

/** Splits a snapshot file into named blocks so each snapshot gets its own refs. */
function parseSnapshotBlocks(text) {
  const blocks = [];
  const re = /\{%-?\s*snapshot\s+(\w+)\s*-?%\}([\s\S]*?)\{%-?\s*endsnapshot\s*-?%\}/g;
  let m;
  while ((m = re.exec(text))) {
    blocks.push({ name: m[1], ...parseModel(m[2]) });
  }
  return blocks;
}

/** Minimal YAML reader for a top-level list key such as model-paths. */
function readPathList(yml, key) {
  const inline = new RegExp('^' + key + '\\s*:\\s*\\[([^\\]]*)\\]', 'm').exec(yml);
  if (inline) {
    return inline[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  const block = new RegExp('^' + key + '\\s*:[ \\t]*\\r?\\n((?:[ \\t]+-[^\\n]*\\r?\\n?)+)', 'm').exec(yml);
  if (block) {
    return block[1]
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*-\s*/, '').replace(/#.*$/, '').trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  return null;
}

/**
 * Folder defaults for `materialized` from the `models:` block of dbt_project.yml:
 *
 *   models:
 *     shop:                     # the project's own name
 *       +materialized: view     # → { path: [], materialized: 'view' }
 *       marts:
 *         +materialized: table  # → { path: ['marts'], materialized: 'table' }
 *
 * `materialized:` without the + counts too. Keys under other names (packages)
 * are skipped, as are settings nested under other config keys (+meta: ...).
 * Paths are folders inside the model path. Minimal, indentation-based YAML.
 */
function readModelMaterializations(yml, projectName) {
  const lines = String(yml || '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^models\s*:\s*(#.*)?$/.test(l));
  if (start < 0) return [];
  const out = [];
  const stack = []; // { indent, key, folder }
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].replace(/\s+#.*$/, '');
    if (!line.trim() || /^\s*#/.test(line) || /^\s*-/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) break; // the next top-level key
    const m = /^\s*(['"]?)([^'":#][^:]*?)\1\s*:\s*(.*)$/.exec(line);
    if (!m) continue; // list items and anything else this reader does not need
    const key = m[2].trim();
    const value = m[3].trim().replace(/^['"]|['"]$/g, '');
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (!value) {
      stack.push({ indent, key, folder: !key.startsWith('+') && key !== 'config' });
      continue;
    }
    const plain = /^\w+$/.test(value); // skips Jinja such as "{{ 'table' if ... }}"
    if ((key === '+materialized' || key === 'materialized') && plain && stack.length && stack.every((s) => s.folder)) {
      if (stack[0].key !== projectName) continue;
      out.push({ path: stack.slice(1).map((s) => s.key), materialized: value });
    }
  }
  return out;
}

module.exports = { parseModel, parseSnapshots, parseSnapshotBlocks, readPathList, readModelMaterializations, stripComments };
