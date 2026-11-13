'use strict';

/**
 * Adds a stub entry for a new model to a models .yml file, e.g. _marts__models.yml:
 *
 *   models:
 *     - name: fct_orders
 *       description: ...
 *     - name: mart_new        ← added
 *       description: ""
 *
 * Text-only and careful: it follows the file's own indentation, appends at the end
 * of the `models:` list (before the next top-level key), and changes nothing when
 * the file has no block-style `models:` list or already lists the model.
 * No VS Code imports (test/modelsyml.test.js).
 */

const MODELS_KEY = /^models\s*:\s*(#.*)?$/;

/** True when the YAML text has a top-level `models:` key. */
function hasModelsKey(text) {
  return /^models\s*:/m.test(String(text || ''));
}

/** → { text, changed, reason } */
function addModelEntry(text, name) {
  const src = String(text || '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  const start = lines.findIndex((l) => MODELS_KEY.test(l));
  if (start < 0) return { text: src, changed: false, reason: 'no models: list' };

  // The block runs until the next line at column 0 that is not a list item or a comment.
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' || /^[\s#-]/.test(lines[end]))) end++;
  while (end > start + 1 && lines[end - 1].trim() === '') end--;

  const block = lines.slice(start + 1, end);
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const listed = new RegExp(`^\\s*-\\s+name\\s*:\\s*(['"]?)${esc}\\1\\s*(#.*)?$`);
  if (block.some((l) => listed.test(l))) return { text: src, changed: false, reason: 'already listed' };

  const items = block.map((l) => /^(\s*)-\s+name\s*:/.exec(l)).filter(Boolean);
  const dash = items.length ? items[0][1] : '  ';
  // Blank lines between entries in this file? Then the new one gets one too.
  const spaced = block.some((l, i) => i > 0 && /^\s*-\s+name\s*:/.test(l) && block[i - 1].trim() === '');
  const entry = [`${dash}- name: ${name}`, `${dash}  description: ""`];
  const insert = spaced && items.length ? ['', ...entry] : entry;
  const out = [...lines.slice(0, end), ...insert, ...lines.slice(end)];
  let result = out.join(eol);
  if (!result.endsWith(eol)) result += eol;
  return { text: result, changed: true };
}

module.exports = { addModelEntry, hasModelsKey };
