import test from 'node:test';
import assert from 'node:assert/strict';
import { runPacking } from '../src/pmc-engine.mjs';
import { validatePmcCandidate } from '../src/pmc-ai-validation.mjs';
import { sortAlternatives, canApplyAlternative, layoutKey } from '../src/pmc-plan-options.mjs';
import { aircraftSnapshot, cargoKey, readHistory, writeHistory, makePmcSnapshot, expandPmcSnapshot, pmcRestoreConfig } from '../src/plan-history.mjs';
import { syntheticRows, syntheticConfig } from '../scripts/ai-preview-fixture.mjs';

const engine = strategy => {
  const result=runPacking(syntheticRows,syntheticConfig,strategy);
  return {strategy,result,validation:validatePmcCandidate(syntheticRows,syntheticConfig,result)};
};
const memoryStorage = () => {
  const values=new Map();
  return {getItem:key=>values.get(key) ?? null,setItem:(key,value)=>values.set(key,value)};
};

test('Plan A/B/C are distinct, valid, ordered by objective and never padded', ()=>{
  const standard=engine();
  const narrow=engine('narrow_first');
  const small=engine('small_first');
  const heavy=engine('heavy_first');
  const choices=sortAlternatives([narrow,small,heavy,narrow,standard,{...narrow,validation:{valid:false}}],standard,'capacity');
  assert.ok(choices.length > 0 && choices.length <= 3);
  assert.equal(new Set(choices.map(plan=>layoutKey(plan.result))).size,choices.length);
  assert.ok(choices.every(plan=>layoutKey(plan.result)!==layoutKey(standard.result)));
  assert.equal(choices[0].validation.stats.placed,Math.max(...choices.map(plan=>plan.validation.stats.placed)));
  assert.equal(sortAlternatives([narrow,narrow,standard],standard,'capacity').length,1);
  assert.ok(canApplyAlternative(choices[0],standard.validation,standard.validation,'capacity'));
  assert.equal(canApplyAlternative(standard,standard.validation,null,'capacity'),false);
  for(const plan of choices) {
    assert.ok(plan.validation.stats.remainingM3>=0);
    assert.ok(plan.validation.distribution.every(p=>p.remainingDeckM2>=0 && p.remainingKg===null));
  }
});

test('a PMC history snapshot round-trips exact geometry and user anchors', ()=>{
  const original=engine().result;
  const better=engine('small_first').result;
  const before=makePmcSnapshot(original,syntheticRows,syntheticConfig);
  const after=makePmcSnapshot(better,syntheticRows,syntheticConfig);
  const storage=memoryStorage();
  writeHistory(history=>({...history,pmc:[before],currentPmc:after}),storage);
  const saved=readHistory(storage);
  const restored=expandPmcSnapshot(saved.pmc[0]);
  assert.equal(layoutKey(restored),layoutKey(original));
  assert.deepEqual(restored.pallets.map(p=>p.items.map(item=>item.id)),original.pallets.map(p=>p.items.map(item=>item.id)));
  assert.ok(validatePmcCandidate(syntheticRows,syntheticConfig,restored).valid);
  assert.notEqual(cargoKey([{...syntheticRows[0],weight:1},...syntheticRows.slice(1)]),saved.pmc[0].cargoKey);
  const locks={'test:1':{x:10,y:20,w:30,l:40,h:50,rotated:false}};
  const config=pmcRestoreConfig({config:{manualXAnchors:locks}}, {...syntheticConfig,maxPallets:3,aiApplied:'ignored'});
  assert.deepEqual(config.manualXAnchors,locks);
  assert.equal(config.maxPallets,3);
  assert.equal(config.aiApplied,undefined);
});

test('aircraft history preserves positions, locks and selection', ()=>{
  const cargo=[{id:'C',w:75,l:90,h:55,weight:300}];
  const current=aircraftSnapshot(cargo,{M01:'C'},['M01'],'main','C');
  const storage=memoryStorage();
  writeHistory(history=>({...history,aircraft:[current]}),storage);
  const restored=readHistory(storage).aircraft[0];
  assert.deepEqual(restored.plan,{M01:'C'});
  assert.deepEqual(restored.locked,['M01']);
  assert.equal(restored.selected,'C');
  assert.equal(restored.cargoKey,cargoKey(cargo));
});
