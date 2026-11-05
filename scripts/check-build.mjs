// This site is served as static files: validate it without executing application code.
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {resolve, relative, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parse as parseHTML} from 'parse5';
import {init, parse as parseImports} from 'es-module-lexer';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url)));
const visited = new Set();
const javascript = /\.(?:mjs|cjs|js)$/;

function localFile(specifier, from) {
  const url = new URL(specifier, from);
  if (url.protocol !== 'file:') return null;
  url.search = '';
  url.hash = '';
  const path = fileURLToPath(url);
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith('..' + sep)) throw new Error(`Asset outside site root: ${specifier}`);
  if (!statSync(path, {throwIfNoEntry: false})?.isFile()) throw new Error(`Missing local file: ${path}`);
  return url;
}

function visitModule(url) {
  if (visited.has(url.href)) return;
  visited.add(url.href);
  const [imports] = parseImports(readFileSync(url, 'utf8'));
  for (const item of imports) {
    const specifier = item.specifier;
    if (typeof specifier !== 'string' || item.glob) continue; // import.meta or a computed dynamic import cannot be resolved statically.
    if (!/^(?:\.{1,2}\/|\/|[a-z][a-z0-9+.-]*:)/i.test(specifier)) {
      throw new Error(`Unresolved browser import: ${specifier} in ${fileURLToPath(url)}`);
    }
    const target = localFile(specifier, url);
    if (target) visitModule(target);
  }
}

function checkSyntax(dir) {
  let count = 0;
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) count += checkSyntax(path);
    else if (javascript.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', path], {encoding: 'utf8'});
      if (result.error || result.status !== 0) throw new Error(`Syntax check failed: ${path}\n${result.error?.message ?? result.stderr}`);
      count++;
    }
  }
  return count;
}

try {
  await init();
  const index = localFile('./index.html', pathToFileURL(root + sep));
  const html = parseHTML(readFileSync(index, 'utf8'));
  const scripts = [];
  function walk(node) {
    const attrs = Object.fromEntries((node.attrs ?? []).map(a => [a.name, a.value]));
    const resource = node.tagName === 'link' && attrs.rel?.split(/\s+/).includes('stylesheet') ? attrs.href
      : ['script', 'img', 'source'].includes(node.tagName) ? attrs.src : null;
    if (resource) {
      const url = localFile(resource, index);
      if (url && node.tagName === 'script' && attrs.type === 'module') scripts.push(url);
    }
    for (const child of node.childNodes ?? []) walk(child);
  }
  walk(html);
  if (scripts.length === 0) throw new Error('No local module script found in index.html');
  for (const script of scripts) visitModule(script);
  const count = checkSyntax(root);
  console.log(`Static build validation passed: ${visited.size} browser modules, ${count} JavaScript syntax checks; local HTML assets exist. No bundling or deployment performed.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
