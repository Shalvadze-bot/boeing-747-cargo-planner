import test from 'node:test';
import assert from 'node:assert/strict';
import {lateralBounds,runLongCargo} from '../src/pmc-long-cargo.mjs';
const row={id:'long',name:'Long',length:400,width:88,height:166,quantity:1,weight:120,allowRotation:false};
const anchor={x:80,y:-91,w:88,l:400,h:166,rotated:false};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('height-aware lateral range mirrors and preserves base inset',()=>{
 const a=lateralBounds({w:88,h:166}),b=lateralBounds({w:88,h:166},true);
 assert.equal(a.valid,true);close(a.min,8.5);close(a.max,92.2929090909);close(b.min,63.5470909091);close(b.max,147.34);close(a.max-a.min,83.7929090909);
 close(lateralBounds({w:88,h:100}).max,147.34);
 close(lateralBounds({w:88,h:100,z:66}).max,a.max);
});
test('impossible and invalid boxes have no falsely valid range',()=>{
 for(const box of [{w:88,h:245},{w:230,h:50},{w:200,h:200},{w:0,h:10},{w:NaN,h:166},{w:88,h:166,z:-1}])assert.equal(lateralBounds(box).valid,false);
});
test('manual X retains Y overhang orientation one PMC and weight',()=>{
 for(const mirrored of [false,true]){
  const result=runLongCargo([row],{longCargoAlignment:'right',mirrored,manualXAnchors:{'long:1':anchor}}),p=result.placements[0];
  assert.equal(p.x,80);assert.equal(p.localY,-91);assert.equal(p.overhang.front,91);assert.equal(p.overhang.rear,0);assert.equal(p.rotated,false);assert.equal(p.alignment,'manual');assert.equal(result.summary.physicalPmcCount,1);assert.equal(result.summary.knownWeightKg,120);assert.equal(p.flightApproved,false);assert.equal(p.status,'TECHNICAL_VALIDATION_PENDING');
 }
});
test('manual X clamps to contour and cannot override safety with coordinates',()=>{
 const result=runLongCargo([row],{manualXAnchors:{'long:1':{...anchor,x:1000}}});
 close(result.placements[0].x,92.2929090909);assert.ok(result.warnings.some(s=>s.includes('kısıtlandı')));
});
test('changed dimension or impossible anchor retains ordinary candidate with warning',()=>{
 for(const change of [{width:90},{height:300}]){
  const result=runLongCargo([{...row,...change}],{manualXAnchors:{'long:1':anchor}});
  assert.notEqual(result.placements[0].alignment,'manual');assert.ok(result.warnings.some(s=>s.includes('uygulanmadı')));
 }
 const result=runLongCargo([{...row,height:300}],{manualXAnchors:{'long:1':{...anchor,h:300}}});
 assert.notEqual(result.placements[0].alignment,'manual');assert.ok(result.warnings.some(s=>s.includes('kontur yüksekliğini')));
});
