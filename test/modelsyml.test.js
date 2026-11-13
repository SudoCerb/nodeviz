'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { addModelEntry, hasModelsKey } = require('../src/modelsyml');
const { FlowModel } = require('../src/model');
const { createNodeIO } = require('../src/nodeio');

const MARTS_YML = [
  'version: 2',
  '',
  'models:',
  '  - name: fct_orders',
  '    description: Orders',
  '    columns:',
  '      - name: order_id',
  '        tests: [unique]',
  '',
  '  - name: dim_customers',
  '    description: Customers',
  '',
  'sources: []',
  '',
].join('\n');

test('adds the entry at the end of the models: list, in the file\'s own style', () => {
  const r = addModelEntry(MARTS_YML, 'mart_new');
  assert.ok(r.changed);
  assert.equal(
    r.text,
    MARTS_YML.replace(
      "    description: Customers\n",
      '    description: Customers\n\n  - name: mart_new\n    description: ""\n'
    )
  );
  // Again: already listed, nothing changes.
  assert.equal(addModelEntry(r.text, 'mart_new').changed, false);
});

test('follows other indentation, keeps CRLF, and leaves odd files alone', () => {
  const flat = 'models:\n- name: a\n  description: A\n';
  assert.equal(addModelEntry(flat, 'b').text, 'models:\n- name: a\n  description: A\n- name: b\n  description: ""\n');
  const crlf = 'models:\r\n  - name: a\r\n';
  assert.equal(addModelEntry(crlf, 'b').text, 'models:\r\n  - name: a\r\n  - name: b\r\n    description: ""\r\n');
  assert.equal(addModelEntry('version: 2\nsources:\n  - name: raw\n', 'b').changed, false);
  assert.equal(addModelEntry('models: []\n', 'b').changed, false);
  assert.equal(addModelEntry("models:\n  - name: 'b'\n", 'b').changed, false);
  assert.ok(hasModelsKey('version: 2\nmodels:\n'));
  assert.ok(!hasModelsKey('sources:\n  - name: models\n'));
});

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeviz-yml-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

test('Create file adds the model to the folder\'s models .yml, in the same undo step', () => {
  const root = fixture({
    'dbt_project.yml': 'name: shop\n',
    'models/marts/fct_orders.sql': 'select 1 as id\n',
    'models/marts/_marts__models.yml': MARTS_YML,
    // Two models .yml files in staging: NodeViz does not guess.
    'models/staging/stg_a.sql': 'select 1 as id\n',
    'models/staging/_a.yml': 'models:\n  - name: stg_a\n',
    'models/staging/_b.yml': 'models:\n  - name: stg_x\n',
  });
  const m = new FlowModel(createNodeIO());
  m.open(root);
  m.createBox('mart_new', { modelDir: 'models', folder: 'marts' }, 0, 0);
  m.createBox('stg_new', { modelDir: 'models', folder: 'staging' }, 0, 100);
  const r = m.createFiles(['mart_new', 'stg_new'], { modelsYml: true });
  assert.ok(r.ok, r.message);
  assert.deepEqual(r.yml, ['models/marts/_marts__models.yml']);
  const yml = fs.readFileSync(path.join(root, 'models/marts/_marts__models.yml'), 'utf8');
  assert.match(yml, /- name: mart_new\n {4}description: ""\n/);
  assert.equal(fs.readFileSync(path.join(root, 'models/staging/_a.yml'), 'utf8'), 'models:\n  - name: stg_a\n');

  assert.ok(m.undo().ok);
  assert.equal(fs.readFileSync(path.join(root, 'models/marts/_marts__models.yml'), 'utf8'), MARTS_YML);
  assert.ok(!fs.existsSync(path.join(root, 'models/marts/mart_new.sql')));

  // Off: the .yml is not touched.
  assert.ok(m.createFiles(['mart_new']).ok);
  assert.equal(fs.readFileSync(path.join(root, 'models/marts/_marts__models.yml'), 'utf8'), MARTS_YML);
});
