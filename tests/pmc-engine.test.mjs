import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {PMC,DEFAULT_CONFIG,SAMPLE_CARGO,contourHeight,runPacking,supportCoverage} from '../src/pmc-engine.mjs';
const row=(overrides={})=>({id:'a',name:'Test',width:60,length:80,height:40,quantity:1,...overrides});
const eps=1e-5;
function invariant(r){
 assert.deepEqual(r.errors,[]);
 for(const b of r.placements){
 assert.ok(b.x>=8.5-eps&&b.x+b.w<=235.34+eps);
 assert.ok(b.z+b.h<=Math.min(contourHeight(b.x,r.config.mirrored),contourHeight(b.x+b.w,r.config.mirrored))+eps);
 assert.ok(b.y>=b.palletIndex*PMC.length+8.5-eps);
 for(const p of b.touchedPallets)assert.ok(r.pallets[p].items.includes(b));
 if(b.z>0){
 const supports=(b.supportIds||[b.supportId]).map(id=>r.placements.find(x=>x.id===id));
 assert.ok(supports.length>0);
 for(const support of supports){assert.ok(support?.stackable);assert.ok(Math.abs(support.z+support.h-b.z)<eps);assert.equal(support.palletIndex,b.palletIndex);}
 if(!b.reviewRequired){
  // Independent oracle: every elementary footprint cell must sit on a face.
  const xs=[b.x,b.x+b.w,...supports.flatMap(s=>[Math.max(b.x,s.x),Math.min(b.x+b.w,s.x+s.w)])].sort((a,b)=>a-b);
  const ys=[b.y,b.y+b.l,...supports.flatMap(s=>[Math.max(b.y,s.y),Math.min(b.y+b.l,s.y+s.l)])].sort((a,b)=>a-b);
  for(let i=0;i<xs.length-1;i++)for(let j=0;j<ys.length-1;j++){
   if(xs[i+1]-xs[i]<eps||ys[j+1]-ys[j]<eps)continue;
   const x=(xs[i]+xs[i+1])/2,y=(ys[j]+ys[j+1])/2;
   assert.ok(supports.some(s=>x>=s.x-eps&&x<=s.x+s.w+eps&&y>=s.y-eps&&y<=s.y+s.l+eps),`unsupported cell ${b.id}`);
  }
 }else{const support=supports[0];assert.ok(b.x>=support.x-eps&&b.x+b.w<=support.x+support.w+eps&&b.y>=support.y-eps);assert.ok(Math.abs(b.x-support.x)<eps||Math.abs(b.x-(support.x+support.w-b.w))<eps);assert.ok(Math.abs(b.y-support.y)<eps||Math.abs(b.y-(support.y+support.l-b.l))<eps);}
 assert.equal(b.supportId,supports.length===1?supports[0].id:null);
}
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

const face=(id,x,y,w,l,extra={})=>({id,x,y,w,l,z:0,h:40,stackable:true,...extra});
const footprint={x:8.5,y:8.5,z:40,w:100,l:120};
test('coplanar support covers seams across width, length and four cartons',()=>{
 for(const faces of [
  [face('a',8.5,8.5,50,120),face('b',58.5,8.5,50,120)],
  [face('a',8.5,8.5,100,60),face('b',8.5,68.5,100,60)],
  [face('a',8.5,8.5,50,60),face('b',58.5,8.5,50,60),face('c',8.5,68.5,50,60),face('d',58.5,68.5,50,60)],
 ]){const s=supportCoverage(footprint,faces);assert.equal(s.fullySupported,true);assert.deepEqual(s.supportIds,faces.map(f=>f.id));}
});
test('shared support rejects gaps, uneven tops, nonstackable faces and partial edge contact',()=>{
 const left=face('left',8.5,8.5,50,120);
 const right=face('right',58.5,8.5,50,120);
 for(const faces of [
  [left,{...right,x:58.6}],
  [left,{...right,h:39.9}],
  [left,{...right,h:40.1}],
  [left,{...right,stackable:false}],
  [left,{...right,y:8.6}],
  [left,{...right,x:108.5}],
  // Same total area, but repeated coverage of only half the footprint.
  [left,{...left,id:'overlap'}],
  // Supported corners and edges do not hide an interior hole.
  [face('top',8.5,8.5,100,10),face('bottom',8.5,118.5,100,10),face('left',8.5,18.5,10,100),face('right',98.5,18.5,10,100)],
 ])assert.equal(supportCoverage(footprint,faces).fullySupported,false,JSON.stringify(faces));
});
test('orange sample cartons compact across adjacent bases without unsupported gaps',()=>{
 for(const mirrored of [false,true]){
  const r=runPacking(SAMPLE_CARGO,{mirrored});invariant(r);
  assert.equal(r.summary.placedCount,20);assert.equal(r.summary.palletCount,1);
  const oranges=r.placements.filter(b=>b.rowId==='b');
  assert.ok(oranges.some(b=>b.supportIds.length>1));
  assert.ok(oranges.filter(b=>b.z===60).length>=8,'at least eight fit on first shared layer, previously only six');
  assert.match(r.warnings.join(' '),/geometrik destektir/);
  assert.match(r.warnings.join(' '),/yük taşıma kapasitesi hesaplanmaz/);
 }
});
test('a wide carton bridges adjacent supported bases but never a nonstackable face',()=>{
 const rows=[row({id:'base',width:100,length:300.5,height:50,quantity:2,allowRotation:false}),row({id:'bridge',width:200,length:300.5,height:10,allowRotation:false,stackable:false})];
 for(const mirrored of [false,true]){
  const r=runPacking(rows,{maxPallets:1,mirrored});invariant(r);
  assert.equal(r.summary.placedCount,3);
  const bridge=r.placements.find(b=>b.rowId==='bridge');assert.equal(bridge.z,50);assert.equal(bridge.supportIds.length,2);assert.equal(bridge.supportId,null);assert.equal(bridge.reviewRequired,false);
 }
 const no=runPacking([{...rows[0],stackable:false},rows[1]],{maxPallets:1});invariant(no);assert.ok(no.summary.unplacedCount>0);assert.ok(no.placements.every(b=>b.z===0));
});
test('shared support preserves contour, collision and floor boundaries in varied mixed plans',()=>{
 let seed=1147;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
 for(let scenario=0;scenario<12;scenario++){
  const rows=Array.from({length:5},(_,i)=>row({id:`mixed-${i}`,width:25+Math.floor(random()*95),length:25+Math.floor(random()*140),height:20+Math.floor(random()*80),quantity:4,stackable:random()>.2,allowRotation:random()>.2}));
  invariant(runPacking(rows,{maxPallets:3,mirrored:scenario%2===1}));
 }
});

test('shared contact does not enable a new partial-support overhang',()=>{
 const rows=[row({id:'narrow-base',width:100,length:300.5,height:100,quantity:2,allowRotation:false}),row({id:'overhang',width:200,length:340,height:10,allowRotation:false})];
 const r=runPacking(rows,{allowOverhang:true,maxOverhangCm:50,minOverhangHeightCm:100,maxPallets:2});invariant(r);
 assert.equal(r.summary.placedCount,2);assert.equal(r.summary.overhangCount,0);
 assert.equal(r.unplaced[0].rowId,'overhang');
});
test('100 mixed rows / 200 small pieces return before the UI worker timeout',()=>{
 const source=`import {runPacking} from ${JSON.stringify(new URL('../src/pmc-engine.mjs',import.meta.url).href)};
 const rows=Array.from({length:100},(_,i)=>({id:'r'+i,width:10+(i*17)%30+i/101,length:10+(i*19)%40+i/103,height:10,quantity:2,stackable:true}));
 const result=runPacking(rows,{maxPallets:30});console.log(JSON.stringify(result.summary));`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:30000});
 assert.equal(child.error,undefined,child.error?.message);
 assert.equal(child.status,0,child.stderr);
 const summary=JSON.parse(child.stdout);assert.equal(summary.placedCount,200);assert.equal(summary.unplacedCount,0);
});
