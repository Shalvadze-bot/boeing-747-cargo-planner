import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessResearchPlan } from '../src/pmc-research-review.mjs';

function integrationCases(assess,assert) {
 const settings={gapMm:'0',offsetMm:'34.2',verticalMm:'0'};
 const rows=[{id:'a',width:100,length:123,height:140,quantity:1,allowRotation:true}];
 const placement={id:'a:1',palletIndex:0,x:8.5,y:8.5,z:0,w:100,l:123,h:140,orientationFace:'upright',touchedPallets:[0]};
 const result={config:{mirrored:false,maxPallets:6},placements:[placement],unplaced:[]};
 const inspect=(overrides={})=>assess({rows,result,settings,...overrides});
 return [
 {name:'current A330 plan checked independently without changing original rows or result',run(){
   const before=JSON.stringify({rows,result});const a=inspect();
   assert.equal(a.status,'PASS');assert.equal(a.report.operationalStatus,'UNKNOWN');
   assert.equal(a.report.complete,true);assert.equal(JSON.stringify({rows,result}),before);
 }},
 {name:'high-side datum research change identifies offending part',run(){
   const a=inspect({settings:{...settings,offsetMm:'1400'}});
   assert.equal(a.status,'FAIL');assert.equal(a.violationIds.join(','),'a:1');
   assert.ok(a.report.issues.some(i=>i.code==='CONTOUR_WIDTH_EXCEEDED'));
 }},
 {name:'busy, stale and absent plan cannot show old verdict',run(){
   for(const o of [{busy:true},{stale:true},{result:null}]){
     const a=inspect(o);assert.equal(a.status,'UNKNOWN');assert.equal(a.report,null);assert.equal(a.violationIds.length,0);
   }
 }},
 {name:'long cargo, empty plan, and invalid settings are not accepted',run(){
   for(const o of [{result:{...result,config:{...result.config,longCargo:true}}},
     {result:{...result,placements:[],unplaced:[{id:'a:1'}]}},
     {settings:{...settings,gapMm:''}},{settings:{...settings,verticalMm:'-1'}}]){
     assert.equal(inspect(o).status,'UNKNOWN');
   }
 }},
 {name:'orientation permission remains unknown if missing',run(){
   const a=inspect({rows:[{...rows[0],allowRotation:undefined}]});assert.equal(a.status,'UNKNOWN');
   assert.ok(a.report.issues.some(i=>i.code==='ORIENTATION_PERMISSION_UNKNOWN'));
 }},
 {name:'mirroring follows current plan, and gap is distinct from tolerance',run(){
   const a=inspect({result:{...result,config:{...result.config,mirrored:true}},settings:{...settings,gapMm:'2.5'}});
   assert.equal(a.model.contour.mirrored,true);assert.equal(a.model.minHorizontalGapMm,2.5);
   assert.equal(a.status,'FAIL');
 }},
 {name:'elevated cargo is not mechanically approved',run(){
   const a=inspect({result:{...result,placements:[{...placement,z:20}]}});
   assert.equal(a.status,'UNKNOWN');assert.ok(a.report.issues.some(i=>i.code==='ELEVATED_SUPPORT_OUTSIDE_V1'));
 }}
 ];
}

for(const {name,run} of integrationCases(assessResearchPlan,assert))test(name,run);
