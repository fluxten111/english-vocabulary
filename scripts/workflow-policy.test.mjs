import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('发布只允许显式手动触发，且仅在main运行',()=>{
  const source=readFileSync(new URL('../.github/workflows/publish.yml',import.meta.url),'utf8');
  // Keep this trigger block deliberately simple: exactly one manual event.
  // Any new event or alternate YAML form needs an explicit policy review.
  const triggers=source.match(/^on:\r?\n((?:[ \t]+[^\n]*\n|\r?\n)*)/m)?.[1];
  assert.ok(triggers,'必须有可审查的独立on事件块');
  const events=triggers.split(/\r?\n/).map(line=>line.replace(/#.*$/,'').trim()).filter(Boolean);
  assert.deepEqual(events,['workflow_dispatch:'],'不得新增push等自动发布触发器');
  assert.match(source,/^    if: github\.ref == 'refs\/heads\/main'\r?$/m,'发布job必须限制main');
});
