import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ESLint} from 'eslint';
import {fileURLToPath} from 'node:url';

const eslint = new ESLint({cwd: fileURLToPath(new URL('../', import.meta.url))});

async function undefinedNames(source, filePath) {
  const [result] = await eslint.lintText(source, {filePath});
  return result.messages.filter(message => message.ruleId === 'no-undef');
}

test('lint rejects APIs from the wrong runtime', async () => {
  for (const [source, file] of [
    ['importScripts("./worker-util.js");', 'app.mjs'],
    ['process.exit(0);', 'app.mjs'],
    ['document.querySelector("body");', 'dictionary-worker.mjs'],
  ]) {
    assert.equal((await undefinedNames(source, file)).length, 1, `${file}: ${source}`);
  }
});

test('lint accepts legitimate browser, Worker and Node APIs', async () => {
  for (const [source, file] of [
    ['document.querySelector("body");', 'app.mjs'],
    ['new Response("ok");', 'dictionary-worker.mjs'],
    ['process.exitCode = 1;', 'scripts/check-build.mjs'],
  ]) {
    assert.deepEqual(await undefinedNames(source, file), [], `${file}: ${source}`);
  }
});
