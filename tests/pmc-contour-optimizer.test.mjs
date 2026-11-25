import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runContourPacking } from '../src/pmc-contour-optimizer.mjs';
import { assessResearchPlan, DEFAULT_RESEARCH_SETTINGS } from '../src/pmc-research-review.mjs';

const row = (overrides={}) => ({id:'case',name:'Sentetik kasa',quantity:1,
  width:113,length:150,height:90,allowRotation:false,stackable:false,...overrides});
const config = {maxPallets:2,mirrored:false};
const withGap = gapMm => ({...DEFAULT_RESEARCH_SETTINGS,gapMm});
const check = (rows,result,settings=DEFAULT_RESEARCH_SETTINGS) =>
  assessResearchPlan({rows,result,settings});

test('area-proven two-pallet floor fixture fits with 5 mm gap and explicit yaw', () => {
  const rows=[row({quantity:'5',weight:10})], settings=withGap('5');
  const result=runContourPacking(rows,{...config,researchSettings:settings});
  assert.deepEqual([result.summary.placedCount,result.summary.palletCount],[5,2]);
  assert.equal(result.optimizer.areaLowerBound,2);
  assert.equal(result.optimizer.outcome,'complete');
  assert.equal(result.validation.operationalApproval,false);
  const independent=check(rows,result,settings);
  assert.equal(independent.status,'PASS');
  assert.equal(independent.report.minVerticalMarginMm,result.validation.minVerticalMarginMm);
  assert.ok(result.placements.every(box=>box.z===0 && !box.rotated));

  const inadequate=runContourPacking(rows,{...config,maxPallets:1,researchSettings:settings});
  assert.equal(inadequate.optimizer.outcome,'proven-infeasible');
  assert.equal(inadequate.summary.placedCount,4);
  assert.equal(inadequate.validation.complete,false);
});

test('invalid inputs, unverified permissions and provably unfit pieces have distinct outcomes', () => {
  const invalid=runContourPacking([row({quantity:'1.5'})],config);
  assert.equal(invalid.optimizer.outcome,'missing-input');
  assert.ok(invalid.errors.length);
  const permission=runContourPacking([row({allowRotation:undefined})],config);
  assert.equal(permission.optimizer.outcome,'missing-input');
  assert.equal(permission.validation.status,'UNKNOWN');
  assert.equal(permission.unplaced.length,1);
  const oversized=runContourPacking([row({width:250})],config);
  assert.equal(oversized.optimizer.outcome,'proven-infeasible');
  assert.equal(oversized.optimizer.individuallyUnfit,1);
  assert.equal(oversized.validation.status,'UNKNOWN');
  const excluded=runContourPacking([row()],{...config,longCargo:true});
  assert.ok(excluded.errors.length);
});

test('yaw90 is used only if permitted, and mirrors to the other high side', () => {
  const rows=[row({width:260,length:86,height:130,allowRotation:true})];
  const standard=runContourPacking(rows,config);
  const mirrored=runContourPacking(rows,{...config,mirrored:true});
  assert.equal(standard.placements[0].rotated,true);
  assert.equal(mirrored.placements[0].rotated,true);
  assert.equal(standard.placements[0].x,8.5);
  assert.ok(Math.abs(mirrored.placements[0].x-149.34)<1e-7);
  assert.ok(Math.abs(standard.validation.minVerticalMarginMm-mirrored.validation.minVerticalMarginMm)<1e-7);
  assert.equal(check(rows,mirrored).status,'PASS');
  assert.equal(runContourPacking([row({width:260,length:86,height:130})],config).optimizer.individuallyUnfit,1);
});

test('operation budget and elapsed-time budget return audited partial results', () => {
  const rows=[row({quantity:4})];
  const short=runContourPacking(rows,config,{candidateLimit:1});
  assert.equal(short.optimizer.stopReason,'candidate-limit');
  assert.equal(short.optimizer.outcome,'candidate-limit');
  assert.ok(short.optimizer.generatedCandidates<=1);
  assert.equal(short.validation.status,'PASS');
  assert.equal(short.validation.complete,false);
  const deadline=runContourPacking(rows,config,{timeLimitMs:Number.MIN_VALUE});
  assert.equal(deadline.optimizer.outcome,'time-limit');
  assert.equal(deadline.validation.status,'UNKNOWN');
  assert.equal(deadline.summary.placedCount,0);
});

test('mixed synthetic placements are reproducible for mirrored profiles and multiple gaps', () => {
  let seed=94213;
  const sample=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  const rows=Array.from({length:30},(_,i)=>row({id:'t'+i,width:40+Math.round(sample()*80),
    length:60+Math.round(sample()*102),height:70+Math.round(sample()*90),allowRotation:i%3===0}));
  const snapshot=JSON.stringify(rows);
  for(const gapMm of ['0','2.6','8']) for(const mirrored of [false,true]){
    const settings=withGap(gapMm), draft={maxPallets:12,mirrored,researchSettings:settings};
    const a=runContourPacking(rows,draft), b=runContourPacking(rows,draft);
    assert.deepEqual(a.placements,b.placements);
    assert.deepEqual(a.validation,b.validation);
    assert.equal(check(rows,a,settings).status,'PASS');
    assert.equal(a.summary.placedCount+a.summary.unplacedCount,rows.length);
  }
  assert.equal(JSON.stringify(rows),snapshot);
});
