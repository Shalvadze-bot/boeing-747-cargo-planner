import test from 'node:test';
import assert from 'node:assert/strict';
import {runLongCargo} from '../src/pmc-long-cargo.mjs';
import {PMC} from '../src/pmc-engine.mjs';

const row=(id,width,height,weight=null)=>({id,name:id,length:400,width,height,weight,
  quantity:1,allowRotation:false,stackable:true});
const profile={tare:100,tareX:PMC.width/2,tareY:PMC.length/2,tareZ:-2,minX:121,maxX:123,minY:157,maxY:161};
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} differs from ${expected}`);
const centerX=boxes=>(Math.min(...boxes.map(box=>box.x))+Math.max(...boxes.map(box=>box.x+box.w)))/2;

test('geometry centers both the floor group and the supported upper group',()=>{
 const rows=[row('a',80,60),row('b',80,60),row('c',65,60),row('d',80,40),row('e',80,40)];
 const result=runLongCargo(rows,{maxPallets:1,longCargoAlignment:'center'});
 assert.equal(result.summary.placedCount,5);
 const floor=result.placements.filter(box=>box.z===0);
 const upper=result.placements.filter(box=>box.z===60);
 assert.equal(floor.length,3);
 assert.equal(upper.length,2);
 close(centerX(floor),PMC.width/2);
 close(centerX(upper),centerX(floor));
 assert.ok(result.placements.every(box=>box.overhang.front===41.25 && box.overhang.rear===41.25));
 assert.equal(result.pallets[0].balance.status,'geometry');
});

test('weight-based centering shifts two unequal pieces and includes the pallet tare',()=>{
 const rows=[row('heavy',80,60,200),row('light',80,60,100)];
 const result=runLongCargo(rows,{pmcBalance:profile,maxPallets:1,longCargoAlignment:'center'});
 const {balance}=result.pallets[0];
 assert.equal(result.summary.placedCount,2);
 assert.equal(balance.status,'within');
 assert.equal(balance.gross,400);
 close(balance.cg.x,122);
 close(balance.cg.y,PMC.length/2);
 close(balance.cg.z,22);
 assert.ok(Math.abs(centerX(result.placements)-PMC.width/2)>1);
});

test('missing weights or limits cannot produce a within-limits result',()=>{
 const rows=[row('heavy',80,60,200),row('unknown',80,60)];
 const result=runLongCargo(rows,{pmcBalance:profile,maxPallets:1});
 assert.equal(result.pallets[0].balance.status,'geometry');
 const {minX,...incomplete}=profile;
 const estimate=runLongCargo([rows[0]],{pmcBalance:incomplete,maxPallets:1});
 assert.equal(estimate.pallets[0].balance.status,'estimated');
});

test('entered gross and vertical limits constrain the evaluated layouts',()=>{
 const rows=[row('heavy',80,60,200),row('light',80,60,100)];
 const result=runLongCargo(rows,{pmcBalance:{...profile,maxGross:350},maxPallets:2,longCargoAlignment:'center'});
 assert.equal(result.summary.placedCount,2);
 assert.equal(result.pallets.length,2);
 assert.ok(result.pallets.every(pallet=>pallet.balance.gross<=350 && pallet.balance.status==='within'));
 const tooHigh=runLongCargo(rows,{pmcBalance:{...profile,maxZ:5},maxPallets:2,longCargoAlignment:'center'});
 assert.equal(tooHigh.summary.placedCount,0);
 assert.equal(tooHigh.unplaced.length,2);
 assert.ok(tooHigh.unplaced.every(piece=>/ağırlık merkezi/.test(piece.reason)));
});
