import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const checker = fileURLToPath(new URL('./check-build.mjs', import.meta.url));

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'vocabulary-build-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const source = {
    'index.html': '<!doctype html><link rel="stylesheet" href="style.css?v=1"><img src="images/icon.svg"><script type="module" src="app.mjs?v=1"></script>',
    'style.css': 'body { color: green; }',
    'images/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'app.mjs': 'import "./nested/helper.mjs?v=1"; throw new Error("must not execute source");',
    'nested/helper.mjs': 'export const value = 1;',
    ...files,
  };
  for (const [name, content] of Object.entries(source)) {
    if (content === null) continue;
    const path = join(root, name);
    mkdirSync(join(path, '..'), {recursive: true});
    writeFileSync(path, content);
  }
  const result = spawnSync(process.execPath, [checker, root], {encoding: 'utf8'});
  return {status: result.status, output: result.stdout + result.stderr};
}

test('static build accepts versioned and nested local assets without executing app code', t => {
  const result = fixture(t, {});
  assert.equal(result.status, 0, result.output);
});

test('static build rejects a missing stylesheet referenced by the entry HTML', t => {
  const result = fixture(t, {'style.css': null});
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Missing local file.*style\.css/);
});

test('static build rejects a missing transitive browser module', t => {
  const result = fixture(t, {'nested/helper.mjs': 'export {value} from "./missing.mjs?v=2";'});
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Missing local file.*missing\.mjs/);
});

test('static build catches syntax errors in Worker files outside the browser import graph', t => {
  const result = fixture(t, {'dictionary-worker.mjs': 'export default { fetch( }'});
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Syntax check failed.*dictionary-worker\.mjs/);
});

test('static build rejects browser bare imports that have no bundler or import map', t => {
  const result = fixture(t, {'nested/helper.mjs': 'import "missing-package";'});
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Unresolved browser import.*missing-package/);
});

test('static build leaves interpolated dynamic imports to runtime instead of treating globs as filenames', t => {
  const result = fixture(t, {'nested/helper.mjs': 'const lang = "en"; export const load = () => import(`./locales/${lang}.mjs`);'});
  assert.equal(result.status, 0, result.output);
});
