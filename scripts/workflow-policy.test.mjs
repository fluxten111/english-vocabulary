import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=name=>readFileSync(new URL(`../.github/workflows/${name}.yml`,import.meta.url),'utf8');
// These existing workflows intentionally use simple block YAML. Alternate forms
// need policy review; this is a guard for their event/permission contracts, not a YAML parser.
function block(source,key){
  const body=source.match(new RegExp(`^${key}:\\r?\\n((?:[ \\t]+[^\\n]*\\n|\\r?\\n)*)`,'m'))?.[1];
  assert.ok(body,`${key}必须有可审查的独立配置块`);
  return body.split(/\r?\n/).map(line=>line.replace(/#.*$/,'').trim()).filter(Boolean);
}

test('发布保留仅main推送自动部署及原手动入口，不直接响应PR',()=>{
  const source=workflow('publish');
  assert.deepEqual(block(source,'on'),['push:','branches: [main]','workflow_dispatch:']);
  assert.match(source,/uses: actions\/deploy-pages@/);
});

test('PR检查保持只读、更新触发和完整检查，不部署或吞掉失败',()=>{
  const source=workflow('ci');
  assert.deepEqual(block(source,'permissions'),['contents: read']);
  assert.deepEqual(block(source,'on'),['pull_request:','types: [opened, synchronize, reopened, ready_for_review]','workflow_dispatch:']);
  for(const command of ['npm run build','npm test','npm run lint'])assert.ok(source.includes(`- run: ${command}`),command);
  assert.doesNotMatch(source,/continue-on-error:\s*true|uses:\s*actions\/deploy-pages@|wrangler\s+deploy|secrets\./);
});
