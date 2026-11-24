import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { runPacking } from '../src/pmc-engine.mjs';
import { runLongCargo } from '../src/pmc-long-cargo.mjs';
import { improvesPlan, validatePmcCandidate } from '../src/pmc-ai-validation.mjs';
import { syntheticRows, syntheticConfig } from '../scripts/ai-preview-fixture.mjs';
import { handleAi } from '../worker/ai-route.mjs';

const origin = 'https://test.example';
const model = 'gpt-5.4-mini-2026-03-17';
const project = 'c0eb6741-2461-4c38-88a3-9d188828fb31';
const owners = ['a@example.invalid','b@example.invalid'];
const metric = [8,4,2,735,0,11.5885,null,true];
const payload = () => ({
  runId:crypto.randomUUID(), projectId:project, step:0, current:null,
  manifest:syntheticRows.map(r => [r.length,r.width,r.height,r.quantity,r.weight,0,true,r.stackable,null,[]]),
  settings:[2,false,false,false,null,null,'auto',0,Array(10).fill(null)],
  aircraft:[0,0,0,.5,0], baseline:metric, trials:[],
});
const request = (body, {email=owners[0], who=email, source=origin, signal}={}) => new Request(
  origin + (body ? '/api/ai/propose' : '/api/ai/status'), {
    method:body?'POST':'GET', body:body?JSON.stringify(body):undefined, signal,
    headers:{ origin:source,'content-type':'application/json',
      ...(email ? {'oai-authenticated-user-id':who,'oai-authenticated-user-email':email}:{}),
    },
  });
function environment(settings={}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../drizzle/0001_ai_usage.sql',import.meta.url),'utf8'));
  const ledger = { prepare: text => ({ bind: (...args) => ({
    first: async () => sql.prepare(text).get(...args) ?? null,
    run: async () => sql.prepare(text).run(...args),
  }) }) };
  return { sql, env:{ OPENAI_API_KEY:'unit-test-placeholder', OPENAI_MODEL:model,
    CARGO_AI_LEDGER:ledger, CARGO_AI_ALLOWED_EMAILS:owners.join(','), ...settings } };
}
const response = (strategy='narrow_first', extra={}) => Response.json({
  model, id:'resp_test', status:'completed',
  output:[{type:'function_call',name:'evaluate_packing_strategy',arguments:JSON.stringify({strategy})}],
  usage:{input_tokens:205,output_tokens:32}, ...extra,
});
const allowed = { canEdit:async () => true };

test('standard result remains deterministic; a gated strategy improves synthetic shipment', () => {
  const baseline = runPacking(syntheticRows,syntheticConfig);
  assert.deepEqual(baseline, runPacking(syntheticRows,syntheticConfig));
  const v1 = validatePmcCandidate(syntheticRows,syntheticConfig,baseline);
  const v2 = validatePmcCandidate(syntheticRows,syntheticConfig,runPacking(syntheticRows,syntheticConfig,'narrow_first'));
  assert.equal(v1.valid,true);
  assert.equal(v2.valid,true);
  assert.deepEqual([v1.stats.placed,v2.stats.placed,v1.stats.pmcs,v2.stats.pmcs],[8,9,2,2]);
  assert.ok(improvesPlan(v2,v1));
  assert.ok(!improvesPlan(v1,v1));
});

test('invalid coordinates, wrong orientation, and missing identities are rejected', () => {
  const create = () => structuredClone(runPacking(syntheticRows,syntheticConfig,'narrow_first'));
  const corrupt = [
    r => {r.placements[0].x=-30;},
    r => {r.placements[0].orientationFace='side-width';},
    r => {r.placements[0].z=10;},
    r => {const a=r.placements[0], b=r.placements.find((p,i)=>i>0&&p.palletIndex===a.palletIndex);
      for(const k of ['x','y','z'])b[k]=a[k];},
    r => {r.unplaced.pop();},
  ];
  for(const alter of corrupt) {
    const plan=create();
    alter(plan);
    assert.equal(validatePmcCandidate(syntheticRows,syntheticConfig,plan).valid,false);
  }
});

test('known max gross is enforced and long cargo manual anchors stay fixed', () => {
  const limits = {...syntheticConfig,pmcBalance:{maxGross:100}};
  assert.equal(validatePmcCandidate(syntheticRows,limits,runPacking(syntheticRows,syntheticConfig)).valid,false);
  const pieces=[{...syntheticRows[0],id:'anchor',quantity:1,width:70,length:120,height:90}];
  const long={...syntheticConfig,longCargo:true,manualXAnchors:{'anchor:1':{x:25,y:30,w:70,l:120,h:90,rotated:false}}};
  const candidate=runLongCargo(pieces,long,'small_first');
  assert.equal(validatePmcCandidate(pieces,long,candidate).valid,true);
  candidate.placements[0].x+=10;
  assert.equal(validatePmcCandidate(pieces,long,candidate).valid,false);
});

test('missing key, unknown model, no edit permission, extra pilot members and unauthorized origins block API', async () => {
  const f=()=>assert.fail('should not call OpenAI');
  for(const [settings, options, code] of [
    [{OPENAI_API_KEY:''},{},503],
    [{OPENAI_MODEL:'unknown'},{},503],
    [{},{email:null},401],
    [{},{email:'other@example.invalid'},403],
    [{CARGO_AI_ALLOWED_EMAILS:owners.join(',')+',c@example.invalid'},{},403],
    [{},{source:'https://other.example'},403],
  ]) {
    const {env}=environment(settings);
    assert.equal((await handleAi(request(payload(),options),env,{...allowed,fetchOpenAI:f})).status,code);
  }
  const {env}=environment();
  assert.equal((await handleAi(request(payload()),env,{canEdit:async()=>false,fetchOpenAI:f})).status,403);
});

test('successful Responses call uses a strict function and stores real usage without manifest or key', async () => {
  const {env,sql}=environment();
  const data=payload();
  const received=await handleAi(request(data),env,{...allowed,fetchOpenAI:async (url, options) => {
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization,'Bearer unit-test-placeholder');
    const body=JSON.parse(options.body);
    assert.equal(body.store,false);
    assert.equal(body.service_tier,'default');
    assert.equal(body.model,model);
    assert.ok(body.tools[0].strict);
    assert.ok(!options.body.includes(owners[0]));
    assert.ok(!options.body.includes(project));
    return response();
  }});
  assert.equal(received.status,200);
  assert.deepEqual(await received.json(),{strategy:'narrow_first',usage:{input:205,output:32},mock:false});
  const row=sql.prepare('select * from cargo_ai_calls').get();
  assert.equal(row.status,'completed');
  assert.equal(row.charge_nano,205*825 + 32*4950);
  assert.match(row.actor,/^[a-f0-9]{64}$/);
  assert.equal(row.input_tokens,205);
});

test('provider errors and invalid output use bounded, safe responses and never include provider content', async () => {
  for (const [providerStatus, providerCode, expected] of [
    [401,'invalid_api_key','api_key'], [429,'insufficient_quota','quota'],[429,'rate_limit_exceeded','provider_rate'],
  ]) {
    const {env,sql}=environment();
    const result=await handleAi(request(payload()),env,{...allowed,fetchOpenAI:async()=>Response.json(
      {error:{code:providerCode,message:'private provider detail'}}, {status:providerStatus})});
    assert.equal((await result.json()).code,expected);
    assert.ok(sql.prepare('select charge_nano from cargo_ai_calls').get().charge_nano>0);
  }
  const {env}=environment();
  const invalid=await handleAi(request(payload()),env,{...allowed,fetchOpenAI:async()=>response('coordinates_here')});
  assert.equal(invalid.status,502);
  assert.equal((await invalid.json()).code,'invalid_output');
});

test('cancellation and timeout abort the provider and conservatively retain their reservation', async () => {
  for(const abort of [true,false]) {
    const controller=new AbortController();
    const {env,sql}=environment({CARGO_AI_TIMEOUT_MS:'1000'});
    const hold=setInterval(()=>{},100);
    try {
      const res=await handleAi(request(payload(),{signal:controller.signal}),env,{...allowed,fetchOpenAI:async (_,{signal})=>{
        if(abort)controller.abort();
        if(signal.aborted)throw signal.reason;
        return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
      }});
      assert.equal(res.status,abort?499:504);
      const row=sql.prepare('select charge_nano,status from cargo_ai_calls').get();
      assert.ok(row.charge_nano>0);
      assert.equal(row.status,abort?'cancelled':'timeout');
    } finally {clearInterval(hold);}
  }
});

test('concurrent test-budget reservations cannot overspend across the two allowed users', async () => {
  const {env}=environment({CARGO_AI_BUDGET_NANO_USD:'340000000'});
  let unblock;
  const gate=new Promise(resolve=>{unblock=resolve;});
  let fired;
  const called=new Promise(resolve=>{fired=resolve;});
  const first=handleAi(request(payload()),env,{...allowed,fetchOpenAI:async()=>{fired();await gate;return response();}});
  await called;
  const second=await handleAi(request(payload(),{email:owners[1]}),env,{...allowed,fetchOpenAI:()=>assert.fail()});
  assert.equal(second.status,429);
  assert.equal((await second.json()).code,'budget');
  unblock();
  assert.equal((await first).status,200);
});

test('duplicate attempts, invalid sequence, and rate limits are enforced before provider usage', async () => {
  const {env}=environment({CARGO_AI_MAX_CALLS:'2'});
  const data=payload();
  const options={...allowed,fetchOpenAI:async()=>response()};
  assert.equal((await handleAi(request(data),env,options)).status,200);
  assert.equal((await handleAi(request(data),env,options)).status,409);
  assert.equal((await handleAi(request({...data,runId:crypto.randomUUID()}),env,options)).status,409);
  const second=await handleAi(request({...data,step:1,trials:[['narrow_first',metric]]}),env,
    {...allowed,fetchOpenAI:async()=>response('small_first')});
  assert.equal(second.status,200);
  assert.equal((await handleAi(request({...data,step:2,trials:[['narrow_first',metric],['small_first',metric]]}),env,options)).status,400);
  const hourly=environment({CARGO_AI_CALLS_PER_HOUR:'1'});
  assert.equal((await handleAi(request(data),hourly.env,options)).status,200);
  assert.equal((await handleAi(request(payload()),hourly.env,options)).status,429);
});

test('mock mode is loopback preview only and never contacts OpenAI', async () => {
  const {env,sql}=environment({CARGO_AI_LOCAL_PREVIEW:true,CARGO_AI_MOCK:true,OPENAI_API_KEY:''});
  const result=await handleAi(request(payload()),env,{fetchOpenAI:()=>assert.fail()});
  assert.equal(result.status,200);
  assert.equal((await result.json()).mock,true);
  assert.equal(sql.prepare('select charge_nano from cargo_ai_calls').get().charge_nano,0);
});
