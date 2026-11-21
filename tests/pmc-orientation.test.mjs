import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runPacking, orientations} from '../src/pmc-engine.mjs';
import {runLongCargo} from '../src/pmc-long-cargo.mjs';
const base={id:'a',name:'Koli',length:4,width:20,height:20,quantity:5,weight:25,stackable:true,allowRotation:true};
test('default stays upright; group and individual permissions choose allowed face',()=>{
 const original=runPacking([base]);assert.equal(original.placements.length,5);assert.ok(original.placements.every(x=>x.h===20));
 const mixed=runPacking([{...base,orientationMode:'all',pieceOrientations:{2:'upright'}}]);
 assert.equal(mixed.placements.length,5);assert.equal(mixed.placements.find(x=>x.id==='a:2').h,20);
 assert.ok(mixed.placements.filter(x=>x.id!=='a:2').every(x=>x.h===4));
});
test('permissions enumerate only permitted faces and yaw remains independent',()=>{
 const x={...base,length:10,width:20,height:30,allowRotation:false};
 assert.deepEqual(orientations(x).map(v=>v.slice(0,3)),[[20,10,30]]);
 assert.deepEqual(orientations({...x,orientationMode:'side-width'}).map(v=>v.slice(0,3)),[[30,10,20],[20,10,30]]);
 assert.deepEqual(orientations({...x,orientationMode:'all'}).map(v=>v[2]),[10,20,30]);
});
test('new orientations remain collision free and fit contour in mixed heights',()=>{
 const r=runPacking([{...base,quantity:15,orientationMode:'all',pieceOrientations:{2:'upright',3:'upright'}}]);
 assert.equal(r.placements.length,15);
 for(const [i,a] of r.placements.entries())for(const b of r.placements.slice(i+1))assert.ok(!(a.x<b.x+b.w-1e-6&&a.x+a.w>b.x+1e-6&&a.y<b.y+b.l-1e-6&&a.y+a.l>b.y+1e-6&&a.z<b.z+b.h-1e-6&&a.z+a.h>b.z+1e-6));
});
test('long cargo candidates respect each piece permission and manual selected height',()=>{
 const row={...base,length:400,width:125,height:60,quantity:2,orientationMode:'all',pieceOrientations:{2:'upright'}};
 const r=runLongCargo([row],{maxPallets:2});assert.equal(r.placements.length,2);
 assert.ok(r.placements[0].candidates.some(c=>c.h===125));assert.ok(r.placements[1].candidates.every(c=>c.h===60));
});
