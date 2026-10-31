import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from './core.mjs';
const source=fs.readFileSync(new URL('./app.mjs',import.meta.url),'utf8');
function home(db){const app={innerHTML:''};const from=source.indexOf('function renderHome()'),to=source.indexOf('function renderLists()');const context=vm.createContext({...core,db,app,escape:String,heading:()=>'',art:'',progressMarkup:()=>'',rail:()=>'',batchCards:()=>''});vm.runInContext(source.slice(from,to)+';renderHome()',context);return app.innerHTML;}
function fixture(){const db=core.fresh();const a=core.createBatch(db,'apple','older A'),b=core.createBatch(db,'book','newer B');const [sa,sb]=db.sessions;sa.status=sb.status='active';sa.startedAt='2026-10-30T10:00:00Z';sb.startedAt='2026-10-30T11:00:00Z';db.events.push({id:'ea',sessionId:sa.id,type:'next',at:'2026-10-30T13:15:00Z'},{id:'eb',sessionId:sb.id,type:'next',at:'2026-10-30T12:00:00Z'});return{db,a,b,sa,sb};}
test('首页指向最近真正学习的旧词表，标题和按钮一致',()=>{const {db,sa}=fixture();const html=home(db);assert(html.includes('older A'));assert(html.includes(`data-resume="${sa.id}"`));});
test('首页始终提供已学词入口，无已学批次时说明条件',()=>{const {db}=fixture();assert.match(home(db),/已学词表|再练已学词/);assert.match(home(db),/完成.*词表/);});
test('异步反馈和较晚建立的未学词表不抢占最近学习',()=>{const {db,sa,sb}=fixture();core.createBatch(db,'chair','new but unstarted');db.events.push({sessionId:sb.id,type:'sentenceFeedback',at:'2026-10-31T00:00:00Z'});assert.equal(core.selectContinueSession(db).session.id,sa.id);});
test('最近会话完成后准确标注继续未完成，缺时间的旧记录可用',()=>{const {db,sa,sb}=fixture();sa.status='completed';assert.equal(core.selectContinueSession(db).label,'继续未完成');db.events=[];sa.startedAt=sb.startedAt=null;assert.equal(core.selectContinueSession(db).session.id,sb.id);});
test('再练连续点击复用同一会话，首次记录保留；明确另开才新建',()=>{const {db,a}=fixture();a.completedAt='2026-10-30T00:00:00Z';const original=JSON.stringify(a),before=db.sessions.length;const first=core.getOrCreateReplay(db,a.id);const second=core.getOrCreateReplay(db,a.id);assert.equal(first.session.id,second.session.id);assert.equal(second.created,false);assert.equal(db.sessions.length,before+1);assert.equal(JSON.stringify(a),original);assert.notEqual(core.getOrCreateReplay(db,a.id,true).session.id,first.session.id);assert.equal(db.events.length,2);});
test('首次未完成不能新开完整再练',()=>{const {db,a}=fixture();assert.throws(()=>core.getOrCreateReplay(db,a.id));});
