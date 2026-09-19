#!/usr/bin/env node
// Baseline structural checks. Run: node tests/baseline-smoke.cjs
// These DO NOT test live SUBÜ / Drive or assert that download logic is correct.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, '2.0.1');
const paths = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_page,
  ...manifest.content_scripts.flatMap(s => [...s.js, ...s.css]),
  ...Object.values(manifest.icons),
  'popup.js','popup.css','drive-setup.js','drive-setup.css'
];
for (const p of new Set(paths)) assert.ok(fs.existsSync(path.join(root,p)), 'Missing '+p);
for (const [html,js] of [['popup.html','popup.js'],['drive-setup.html','drive-setup.js']]) {
 const ids = new Set([...read(html).matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]));
 const referenced = [...read(js).matchAll(/getElementById\(["']([^"']+)["']\)/g)].map(x=>x[1]);
 for (const id of referenced) assert.ok(ids.has(id), html+' missing #'+id);
}
console.log('PASS: manifest schema version, references, static HTML element IDs');
console.log('NOT TESTED: Chrome runtime, SUBÜ download completion, OAuth, Google Drive uploads');
