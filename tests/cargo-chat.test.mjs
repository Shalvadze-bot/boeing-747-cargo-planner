import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleAi } from '../worker/ai-route.mjs';
import { checkChatRow, extractTable, parseCsv } from '../src/chat-manifest-parser.mjs';
import { runPacking } from '../src/pmc-engine.mjs';
import { repackOnePmc, samePieceSet } from '../src/pmc-chat-search.mjs';
import { validatePmcCandidate } from '../src/pmc-ai-validation.mjs';
import { syntheticRows, syntheticConfig } from '../scripts/ai-preview-fixture.mjs';

const model = 'gpt-5.4-mini-2026-03-17';
const origin = 'https://test.example';
const owner = 'pilot@example.invalid';
const project = 'cab55c9a-7502-4727-a50b-1582c3050196';
const request = ({signal,user=owner,source=origin}={}) => new Request(origin+'/api/ai/chat',{
  method:'POST',signal,headers:{Origin:source,'Content-Type':'application/json','oai-authenticated-user-id':user,'oai-authenticated-user-email':user},
  body:JSON.stringify({runId:crypto.randomUUID(),projectId:project,messages:[{role:'user',text:'Kartı aç'}],context:{selection:{reference:'demo-1:1'}}}),
});
function setup(settings={}) {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(new URL('../drizzle/0001_ai_usage.sql',import.meta.url),'utf8'));
  const env = {OPENAI_MODEL:model,OPENAI_API_KEY:'test-placeholder',CARGO_AI_ALLOWED_EMAILS:owner,...settings,
    CARGO_AI_LEDGER:{prepare:sql=>({bind:(...args)=>({
      first:async()=>database.prepare(sql).get(...args),run:async()=>database.prepare(sql).run(...args),
    })})}};
  return {env,database};
}
const data = (type, value) => 'data: '+JSON.stringify({type,...value})+'\n\n';
const parse = text => text.trim().split('\n').map(line=>JSON.parse(line));
const allow = async id => id===project;

function provider(action) {
  const event=action?{type:'function_call',name:'show_cargo_result',arguments:JSON.stringify({action})}:null;
  return data('response.output_text.delta',{delta:'Ağırlık '})+
    data('response.output_text.delta',{delta:'verisi'})+
    data('response.completed',{response:{id:'resp_test',status:'completed',model,output:event?[event]:[],usage:{input_tokens:100,output_tokens:11}}});
}

test('chat checks existing project permission and origin before contacting OpenAI',async()=>{
  const {env}=setup();
  const fail=()=>assert.fail('provider must not be called');
  assert.equal((await handleAi(request(),env,{canEdit:async()=>false,fetchOpenAI:fail})).status,403);
  assert.equal((await handleAi(request({user:'outside@example.invalid'}),env,{canEdit:allow,fetchOpenAI:fail})).status,403);
  assert.equal((await handleAi(request({source:'https://other.example'}),env,{canEdit:allow,fetchOpenAI:fail})).status,403);
});

test('chat forwards text across fragmented SSE, emits only allowlisted cards and settles shared ledger',async()=>{
  const {env,database}=setup();
  const response=await handleAi(request(),env,{canEdit:allow,fetchOpenAI:async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    const body=JSON.parse(options.body);
    assert.equal(body.store,false);
    assert.equal(body.stream,true);
    assert.equal(body.tools[0].strict,true);
    assert.ok(!options.body.includes(project));
    const encoded=new TextEncoder().encode(provider('balance'));
    return new Response(new ReadableStream({start(controller){
      for(let i=0;i<encoded.length;i+=23) controller.enqueue(encoded.slice(i,i+23));
      controller.close();
    }}));
  }});
  assert.match(response.headers.get('content-type'),/application\/x-ndjson/);
  const events=parse(await response.text());
  assert.deepEqual(events.map(x=>x.type),['progress','delta','delta','tool','done']);
  assert.equal(events[1].value,'Ağırlık ');
  assert.equal(events[3].value,'balance');
  const logged=database.prepare('SELECT * FROM cargo_ai_calls').get();
  assert.equal(logged.status,'completed');
  assert.equal(logged.input_tokens,100);
  assert.equal(logged.charge_nano,100*825+11*4950);
});

test('untrusted model actions and shared budget reject plan writes or additional calls',async()=>{
  const {env}=setup({CARGO_AI_BUDGET_NANO_USD:332_000_000});
  const accepted=await handleAi(request(),env,{canEdit:allow,fetchOpenAI:async()=>new Response(provider('apply_plan'))});
  const events=parse(await accepted.text());
  assert.equal(events.some(x=>x.type==='tool'),false);
  assert.equal(events.at(-1).type,'error');

  const insufficient = setup({CARGO_AI_BUDGET_NANO_USD:1});
  assert.equal((await handleAi(request(),insufficient.env,{canEdit:allow,fetchOpenAI:()=>assert.fail('budget bypass')})).status,429);
});

test('cancelling the chat stream aborts the provider and retains reserved cost with missing usage',async()=>{
  const {env,database}=setup();
  let stopped;
  const providerStarted=new Promise(resolve=>{stopped=resolve;});
  const response=await handleAi(request(),env,{canEdit:allow,fetchOpenAI:(_url,{signal})=>{
    stopped(signal);
    return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  }});
  const browserReader=response.body.getReader();
  await browserReader.read();
  const signal=await providerStarted;
  await browserReader.cancel();
  assert.equal(signal.aborted,true);
  for(let i=0;i<12;i++){
    const logged=database.prepare('SELECT status,charge_nano FROM cargo_ai_calls').get();
    if(logged.status==='cancelled'){assert.ok(logged.charge_nano>300_000_000);return;}
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.fail('reservation did not settle');
});

test('quoted CSV and Excel-shaped tables preserve explicit dimensions and per-piece weights',()=>{
  const csv='Name,L (cm),W (cm),H (cm),Qty,Gross Weight KGS\n"Crate, 1",120,80,60,1,42\nGroup,110,70,55,2,80';
  const rows=extractTable(parseCsv(csv,','));
  assert.equal(rows.length,2);
  assert.deepEqual(checkChatRow(rows[0]).row,{name:'Crate, 1',length:120,width:80,height:60,quantity:1,weight:42,allowRotation:false,stackable:false});
  assert.equal(checkChatRow(rows[1]).row.weight,null);
  const noUnit=extractTable([['L','W','H','Qty'],[5,5,5,1]])[0];
  assert.match(checkChatRow(noUnit).errors.join(' '),/Birimi seçin/);
  assert.equal(checkChatRow({...rows[0],weight:'-3'}).row,null);
});

test('a selected PMC can be repacked without changing cargo identity or positions elsewhere',()=>{
  const original=runPacking(syntheticRows,syntheticConfig);
  const result=repackOnePmc(syntheticRows,syntheticConfig,original,0,'narrow_first');
  assert.ok(result);
  assert.ok(samePieceSet(result,original));
  assert.deepEqual(result.pallets[1],original.pallets[1]);
  assert.notDeepEqual(result.pallets[0].items,original.pallets[0].items);
  assert.equal(validatePmcCandidate(syntheticRows,syntheticConfig,result).valid,true);
});
