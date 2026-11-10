import test from 'node:test';
import assert from 'node:assert/strict';
import {PMC,DEFAULT_CONFIG,SAMPLE_CARGO,contourHeight,runPacking} from '../src/pmc-engine.mjs';
const row=(overrides={})=>({id:'a',name:'Test',width:60,length:80,height:40,quantity:1,...overrides});
const eps=1e-5;
function invariant(r){
 assert.deepEqual(r.errors,[]);
 for(const b of r.placements){
 assert.ok(b.x>=8.5-eps&&b.x+b.w<=235.34+eps);
 assert.ok(b.z+b.h<=Math.min(contourHeight(b.x,r.config.mirrored),contourHeight(b.x+b.w,r.config.mirrored))+eps);
 assert.ok(b.y>=b.palletIndex*PMC.length+8.5-eps);
 for(const p of b.touchedPallets)assert.ok(r.pallets[p].items.includes(b));
 if(b.z>0){const support=r.placements.find(x=>x.id===b.supportId);assert.ok(support?.stackable);assert.ok(Math.abs(support.z+support.h-b.z)<eps);assert.ok(b.x>=support.x-eps&&b.x+b.w<=support.x+support.w+eps);if(!b.reviewRequired)assert.ok(b.y>=support.y-eps&&b.y+b.l<=support.y+support.l+eps);}
 else assert.equal(b.overhangCm,0);
 }
 for(let i=0;i<r.placements.length;i++)for(let j=i+1;j<r.placements.length;j++){
 const a=r.placements[i],b=r.placements[j];
 assert.ok(a.x+a.w<=b.x+eps||b.x+b.w<=a.x+eps||a.y+a.l<=b.y+eps||b.y+b.l<=a.y+eps||a.z+a.h<=b.z+eps||b.z+b.h<=a.z+eps,`collision ${a.id}/${b.id}`);
 }
 assert.equal(r.summary.placedCount+r.summary.unplacedCount,r.summary.requestedCount);
}
test('physical dimensions, margins and explicit reference geometry',()=>{
 assert.equal(PMC.width,243.84);assert.equal(PMC.length,317.5);assert.equal(PMC.usableWidth,226.84);assert.equal(PMC.usableLength,300.5);
 assert.equal(contourHeight(0),243.84);assert.equal(contourHeight(100.33),243.84);assert.ok(Math.abs(contourHeight(243.84)-104.14)<eps);assert.equal(contourHeight(243.84,true),243.84);
});
test('sample packs deterministically without mutation; source is explicitly unverified',()=>{
 const before=JSON.stringify(SAMPLE_CARGO);const a=runPacking(SAMPLE_CARGO);invariant(a);assert.deepEqual(a,runPacking(SAMPLE_CARGO));assert.equal(JSON.stringify(SAMPLE_CARGO),before);assert.equal(a.summary.placedCount,20);assert.match(a.profile.status,/sertifikalı/);assert.ok(a.warnings.length>=3);
});
test('empty plan and invalid inputs are safe',()=>{
 assert.equal(runPacking([]).summary.palletCount,0);
 for(const input of [null,{},[null],[row({width:NaN})],[row({length:Infinity})],[row({height:0})],[row({quantity:1.5})],[row({quantity:201})],[row({weight:0})],[row({weight:''})],[row({stackable:'yes'})],[row(),row()],[row({quantity:200}),row({id:'b'})]])assert.ok(runPacking(input).errors.length,JSON.stringify(input));
 for(const cfg of [null,[],{maxPallets:0},{maxPallets:31},{mirrored:'false'},{allowOverhang:true},{allowOverhang:true,maxOverhangCm:20,minOverhangHeightCm:-1},{maxOverhangCm:Infinity}])assert.ok(runPacking([row()],cfg).errors.length);
});
test('both x top corners must fit, including mirrored direction',()=>{
 for(const mirrored of [false,true]){const r=runPacking([row({width:200,length:100,height:180,allowRotation:false})],{mirrored});invariant(r);assert.equal(r.summary.placedCount,0);const fit=runPacking([row({width:80,length:100,height:240,allowRotation:false})],{mirrored});invariant(fit);assert.equal(fit.summary.placedCount,1);}
});
test('yaw rotation allowed; height never rotated',()=>{
 const r=runPacking([row({width:280,length:70,height:40})]);invariant(r);assert.equal(r.placements[0].rotated,true);assert.equal(r.placements[0].h,40);
 assert.equal(runPacking([row({width:280,length:70,height:40,allowRotation:false})]).summary.placedCount,0);
 assert.equal(runPacking([row({width:30,length:30,height:280})]).summary.placedCount,0);
});
test('stacking honors stackable and multi-pallet boundaries',()=>{
 const r=runPacking([row({width:200,length:290,height:50,quantity:3,allowRotation:false})]);invariant(r);assert.equal(r.summary.palletCount,2);assert.ok(r.placements.some(b=>b.z>0));
 const no=runPacking([row({width:200,length:290,height:50,quantity:3,allowRotation:false,stackable:false})]);invariant(no);assert.equal(no.summary.palletCount,3);assert.ok(no.placements.every(b=>b.z===0));
 const capped=runPacking([row({width:200,length:290,height:50,quantity:3,allowRotation:false,stackable:false})],{maxPallets:2});invariant(capped);assert.equal(capped.summary.unplacedCount,1);
});
const overhangRows=[row({id:'base',width:200,length:300.5,height:100,allowRotation:false}),row({id:'top',width:200,length:340,height:10,allowRotation:false})];
test('optional upper overhang requires supplied limits and allocated neighbor',()=>{
 const c={allowOverhang:true,maxOverhangCm:50,minOverhangHeightCm:100,maxPallets:2};const r=runPacking(overhangRows,c);invariant(r);assert.equal(r.summary.placedCount,2);assert.equal(r.summary.palletCount,2);assert.equal(r.summary.overhangCount,1);const top=r.placements.find(b=>b.rowId==='top');assert.deepEqual(top.touchedPallets,[0,1]);assert.equal(top.reviewRequired,true);assert.ok(r.pallets[1].items.includes(top));assert.match(r.warnings.join(' '),/Kısmi destek/);
 for(const cfg of [{...c,maxPallets:1},{...c,minOverhangHeightCm:101},{...c,maxOverhangCm:30},DEFAULT_CONFIG])assert.equal(runPacking(overhangRows,cfg).summary.placedCount,1);
});
test('no floor bridge, no overhang that stops in gap, no nonstackable support',()=>{
 const c={allowOverhang:true,maxOverhangCm:60,minOverhangHeightCm:1,maxPallets:3};
 assert.equal(runPacking([row({width:200,length:340,height:10,allowRotation:false})],c).summary.placedCount,0);
 assert.equal(runPacking([overhangRows[0],{...overhangRows[1],length:310}],c).summary.placedCount,1);
 assert.equal(runPacking([{...overhangRows[0],stackable:false},overhangRows[1]],c).summary.placedCount,1);
});
test('weight accounting distinguishes unknowns and kilograms',()=>{
 const r=runPacking([row({weight:20,quantity:2}),row({id:'b',weight:null})]);assert.equal(r.summary.knownWeightKg,40);assert.equal(r.summary.unknownWeightCount,1);assert.match(r.warnings.join(' '),/ağırlığı girilmedi/);
});
test('mixed 200-piece plans remain collision-free in both directions',()=>{
 const rows=Array.from({length:20},(_,i)=>row({id:`r${i}`,width:25+(i*17)%80,length:30+(i*19)%120,height:15+(i*7)%65,quantity:10,stackable:i%4!==0}));
 for(const mirrored of [false,true])invariant(runPacking(rows,{maxPallets:30,mirrored}));
});
