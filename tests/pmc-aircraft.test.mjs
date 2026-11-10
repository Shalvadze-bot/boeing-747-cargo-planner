import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePmcTransfer,importPmcPallets,pmcBoxTransforms} from '../src/pmc-aircraft.mjs';
import {runPacking,DEFAULT_CONFIG,SAMPLE_CARGO} from '../src/pmc-engine.mjs';
import {initialCargo,initialPlan} from '../src/engine.mjs';
const result=runPacking(SAMPLE_CARGO,DEFAULT_CONFIG);
const base=()=>({cargo:structuredClone(initialCargo),plan:{...initialPlan},locked:['M01','M07'],result,weights:preparePmcTransfer(result).map(p=>p.knownWeight+100)});
test('import appends actual geometry without overwriting existing cargo, positions or locks',()=>{
 const input=base(),before=JSON.stringify(input);const next=importPmcPallets(input);
 assert.equal(JSON.stringify(input),before);
 assert.deepEqual(next.cargo.slice(0,initialCargo.length),initialCargo);
 assert.equal(next.plan.M07,initialPlan.M07);assert.equal(next.plan.M10,initialPlan.M10);assert.equal(next.plan.M01,undefined);
 assert.ok(next.added.length);assert.ok(next.added[0].pmc.items.length);
 assert.equal(next.added[0].pmc.items[0].color,result.pallets[0].items[0].color);
 assert.equal(new Set(next.cargo.map(p=>p.id)).size,next.cargo.length);
 assert.throws(()=>importPmcPallets({...input,cargo:next.cargo,plan:next.plan}),/zaten/);
 assert.deepEqual(JSON.parse(JSON.stringify(next)).cargo.at(-1).pmc,next.cargo.at(-1).pmc);
});
test('weights are explicit; unknown weights are not silently counted as zero',()=>{
 const input=base();assert.throws(()=>importPmcPallets({...input,weights:[]}),/brüt/);
 for(const w of [0,NaN,-1,Infinity])assert.throws(()=>importPmcPallets({...input,weights:input.weights.map(()=>w)}),/brüt/);
 const unknown=runPacking([{...SAMPLE_CARGO[0],weight:null,quantity:1}],DEFAULT_CONFIG);
 assert.equal(preparePmcTransfer(unknown)[0].unknownWeight,true);
 const next=importPmcPallets({...input,result:unknown,weights:[123]});assert.equal(next.added[0].weight,123);
});
test('overhang is blocked instead of disconnected or double-counted',()=>{
 const changed=structuredClone(result);changed.placements[0].touchedPallets=[0,1];
 assert.throws(()=>preparePmcTransfer(changed),/taşan/);
 assert.throws(()=>preparePmcTransfer(null),/geçerli/);
});
test('unplaceable weight stays in list and no original plan is lost',()=>{
 const input=base();const next=importPmcPallets({...input,weights:input.weights.map(()=>10000)});
 assert.equal(next.waiting.length,next.added.length);assert.deepEqual(next.plan,input.plan);
});
test('3D uses local pallet coordinates, original colors and one uniform scale',()=>{
 const next=importPmcPallets(base()),item=next.added[0];const boxes=pmcBoxTransforms(item,{x:10,y:2,z:-2});
 assert.equal(boxes.length,item.pmc.items.length);const a=boxes[0],b=item.pmc.items[0];
 assert.equal(a.color,b.color);assert.ok(Math.abs(a.size[0]/b.l-a.size[1]/b.h)<1e-9);assert.ok(Math.abs(a.size[1]/b.h-a.size[2]/b.w)<1e-9);
 assert.deepEqual(pmcBoxTransforms(initialCargo[0],{x:0,y:0,z:0}),[]);
});
