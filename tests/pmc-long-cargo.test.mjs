import test from 'node:test';import assert from 'node:assert/strict';
import {longCargoCandidates,runLongCargo} from '../src/pmc-long-cargo.mjs';
const row={id:'long',name:'400 cm parça',length:400,width:88,height:166,quantity:1,weight:120,allowRotation:false,color:'#fb923c'};
test('one physical support, centered two edges, three schematic positions',()=>{const r=runLongCargo([row],{longCargoAlignment:'center'}),b=r.placements[0];assert.equal(r.summary.physicalPmcCount,1);assert.equal(b.positionCount,3);assert.equal(b.overhang.front,41.25);assert.equal(b.overhang.rear,41.25);assert.deepEqual(b.touchedPallets,[0]);assert.equal(r.pallets.length,1);assert.equal(b.flightApproved,false);});
test('offset uses two positions, no phantom plate or weight duplication',()=>{const r=runLongCargo([row],{longCargoAlignment:'left'}),b=r.placements[0];assert.equal(b.positionCount,2);assert.equal(b.overhang.rear,91);assert.equal(b.overhang.front,0);assert.equal(r.summary.knownWeightKg,120);assert.equal(r.placements.length,1);assert.equal(b.blockedPositions.length,1);});
test('auto compares candidates, rotation follows permission',()=>{const r=runLongCargo([row]);assert.equal(r.placements[0].positionCount,2);assert.equal(longCargoCandidates(row).length,5);assert.equal(longCargoCandidates({...row,allowRotation:true}).length,10);});
test('very long cargo can block more than two positions',()=>{const b=runLongCargo([{...row,length:1100}],{longCargoAlignment:'left'}).placements[0];assert.equal(b.positionCount,4);assert.equal(b.blockedPositions.length,3);});
test('unknown weights never become approved and each instance is counted once',()=>{const r=runLongCargo([{...row,weight:null,quantity:2}]);assert.equal(r.summary.physicalPmcCount,2);assert.equal(r.summary.unknownWeightCount,2);assert.equal(r.summary.knownWeightKg,0);assert.ok(r.placements.every(b=>!b.flightApproved));assert.equal(r.warnings.length,8);});
test('physical edge clearance does not subtract height',()=>{const b=runLongCargo([row]).placements[0];assert.equal(b.h,166);assert.equal(b.overhang.rear,91);});
test('invalid data and limits rejected',()=>{for(const bad of [0,-1,NaN,Infinity])assert.ok(runLongCargo([{...row,length:bad}]).errors.length);assert.ok(runLongCargo([row],{maxPallets:0}).errors.length);assert.ok(runLongCargo([row],{longCargoAlignment:'bad'}).errors.length);});
test('physical PMC limit preserves unplaced accounting',()=>{const r=runLongCargo([{...row,quantity:3}],{maxPallets:1});assert.equal(r.summary.requestedCount,3);assert.equal(r.summary.placedCount,1);assert.equal(r.unplaced.length,2);});

test('wide cargo uses one-sided transverse placement without rotating',()=>{const b=runLongCargo([{...row,length:88,width:400,height:60}]).placements[0];assert.equal(b.positionCount,2);assert.equal(b.rotated,false);assert.ok(Math.abs(b.overhang.right-164.66)<1e-6);});

import {preparePmcTransfer} from '../src/pmc-aircraft.mjs';
test('test mode cannot bypass transfer protection even without overhang',()=>{assert.throws(()=>preparePmcTransfer(runLongCargo([{...row,length:100}])),/test senaryosu/);});

test('front/rear align opposite LONG edges with inset and distinct x coordinates',()=>{const shortHeight={...row,height:60};const front=runLongCargo([shortHeight],{longCargoAlignment:'front'}).placements[0],rear=runLongCargo([shortHeight],{longCargoAlignment:'rear'}).placements[0];assert.equal(front.x,8.5);assert.equal(rear.x,147.34);assert.equal(rear.x+rear.w,235.34);assert.equal(front.localY,rear.localY);assert.equal(front.overhang.front,41.25);assert.equal(rear.overhang.rear,41.25);assert.notEqual(front.x,rear.x);});
test('short edge options retain8.5cm inset and longitudinal overhang',()=>{const l=runLongCargo([row],{longCargoAlignment:'left'}).placements[0],r=runLongCargo([row],{longCargoAlignment:'right'}).placements[0];assert.equal(l.localY,8.5);assert.equal(r.localY+r.l,309);assert.equal(l.overhang.rear,91);assert.equal(r.overhang.front,91);});
test('high edge preserves longitudinal overhang and rotation in both contour directions',()=>{
 const before=runLongCargo([row],{longCargoAlignment:'right'}).placements[0];
 const highEdgeAnchors={[before.id]:{y:before.localY,w:before.w,l:before.l,h:before.h,rotated:before.rotated}};
 for(const mirrored of [false,true]){
  const after=runLongCargo([row],{longCargoAlignment:'right',highEdgeAnchors,mirrored}).placements[0];
  assert.equal(after.x,mirrored?147.34:8.5);assert.equal(after.localY,-91);assert.equal(after.overhang.front,91);assert.equal(after.overhang.rear,0);assert.equal(after.rotated,before.rotated);assert.equal(after.physicalPmcCount,1);assert.equal(after.flightApproved,false);assert.equal(after.alignment,'high');
 }
});
test('changed dimensions invalidate high-edge snapshot instead of retaining stale shape',()=>{
 const result=runLongCargo([{...row,width:90}],{highEdgeAnchors:{'long:1':{y:-91,w:88,l:400,h:166,rotated:false}}});
 assert.equal(result.placements[0].w,90);assert.notEqual(result.placements[0].alignment,'high');assert.ok(result.warnings.some(w=>w.includes('yeniden uygulanmalı')));
});

test('three 400 cm pieces share one PMC and reserve the same neighboring cell only once',()=>{
 const result=runLongCargo([{...row,width:70,height:60,quantity:3,weight:null}],{maxPallets:1});
 assert.equal(result.summary.placedCount,3);
 assert.equal(result.summary.physicalPmcCount,1);
 assert.equal(result.summary.positionCount,2);
 assert.equal(result.summary.unknownWeightCount,3);
 assert.equal(result.pallets[0].blockedPositions.length,1);
 const pieces=[...result.placements].sort((a,b)=>a.x-b.x);
 assert.ok(pieces.every(piece=>piece.palletIndex===0 && piece.z===0 && piece.overhang.rear===91 && !piece.flightApproved));
 assert.ok(pieces.slice(1).every((piece,i)=>piece.x>=pieces[i].x+pieces[i].w-1e-6));
});

test('selected centered alignment preserves both longitudinal overhangs while sharing a PMC',()=>{
 const result=runLongCargo([{...row,width:80,height:60,quantity:2}],{maxPallets:1,longCargoAlignment:'center'});
 assert.equal(result.summary.placedCount,2);
 assert.equal(result.summary.positionCount,3);
 assert.ok(result.placements.every(piece=>piece.overhang.front===41.25 && piece.overhang.rear===41.25));
});

test('centered repacking keeps three long pieces side by side even when rotation is allowed',()=>{
 const rows=[80,80,65].map((width,i)=>({...row,id:`long-${i}`,width,height:60,allowRotation:true}));
 for(const mirrored of [false,true]){
  const result=runLongCargo(rows,{maxPallets:1,longCargoAlignment:'center',mirrored});
  assert.equal(result.summary.physicalPmcCount,1);
  assert.equal(result.summary.placedCount,3);
  assert.equal(result.summary.positionCount,3);
  const pieces=[...result.placements].sort((a,b)=>a.x-b.x);
  assert.ok(pieces.every(piece=>!piece.rotated && piece.overhang.front===41.25 && piece.overhang.rear===41.25));
  assert.ok(pieces.slice(1).every((piece,i)=>piece.x>=pieces[i].x+pieces[i].w-1e-6));
 }
});

test('one shared group keeps both transverse and longitudinal overhang reservations',()=>{
 const result=runLongCargo([
  {...row,id:'wide',width:400,length:80,height:60},
  {...row,id:'small',width:80,length:90,height:60},
 ],{maxPallets:1});
 assert.equal(result.summary.placedCount,2);
 assert.equal(result.summary.positionCount,2);
 assert.ok(result.placements[0].overhang.right>0);
 assert.equal(result.placements[1].overhangCm,0);
});

test('the contour blocks wide high cargo and the low-side legacy alignment',()=>{
 for(const mirrored of [false,true]){
  const r=runLongCargo([{...row,length:88,width:400}],{mirrored});
  assert.equal(r.summary.placedCount,0);
  assert.match(r.unplaced[0].reason,/kontur/);
 }
 const legacy=runLongCargo([row],{longCargoAlignment:'rear'});
 assert.equal(legacy.summary.placedCount,0);
});

const stackingRows = [80,80,65,80].map((width,i) => ({
 ...row,id:'stack-'+i,width,height:i===3?40:60,stackable:true,allowRotation:true,
}));

test('fourth long piece stacks on fully supporting pieces and keeps the two-sided overhang',()=>{
 for(const mirrored of [false,true]){
  const result=runLongCargo(stackingRows,{longCargoAlignment:'center',maxPallets:1,mirrored});
  assert.equal(result.summary.placedCount,4);
  assert.equal(result.summary.physicalPmcCount,1);
  assert.equal(result.summary.positionCount,3);
  const upper=result.placements.find(b=>b.rowId==='stack-3');
  assert.equal(upper.z,60);
  assert.equal(upper.z+upper.h,100);
  assert.equal(upper.overhang.front,41.25);
  assert.equal(upper.overhang.rear,41.25);
  assert.ok(upper.supportIds.length>0);
  assert.ok(upper.supportIds.every(id=>result.placements.some(b=>b.id===id && b.stackable && b.z+b.h===upper.z)));
 }
});

test('stacking requires enough surface area with permission',()=>{
 for(const allowNarrow of [false,true]){
  const rows=stackingRows.map((piece,i)=>({...piece,stackable:allowNarrow && i===2}));
  const result=runLongCargo(rows,{longCargoAlignment:'center',maxPallets:1});
  assert.equal(result.summary.placedCount,3);
  assert.equal(result.unplaced[0].id,'stack-3:1');
  assert.ok(result.placements.every(b=>b.z===0));
 }
});

test('stacking cannot exceed the contour or extend beyond a supporting piece',()=>{
 const base={...row,width:225,height:60,stackable:true};
 for(const changes of [{height:70},{length:410,height:40}]){
  const upper={...base,id:'upper',stackable:false,...changes};
  const result=runLongCargo([base,upper],{maxPallets:1,longCargoAlignment:'center'});
  assert.equal(result.summary.placedCount,1);
  assert.equal(result.unplaced[0].id,'upper:1');
 }
});
