import test from 'node:test';
import assert from 'node:assert/strict';
import {initialCargo,initialPlan} from '../src/engine.mjs';
import {AIRCRAFT_STORE,RECOVERY_STORE,isStarterDemo,starterDemos,readDemoRecovery,prepareDemoRemoval,removeDemosWithRecovery,undoDemoRemoval,saveAircraftState,withAircraftWriteLock} from '../src/demo-recovery.mjs';
const custom={id:'PAL-09',name:'My PMC',weight:120000,l:317.5,w:243.84,h:140,priority:1,pmc:{items:[{id:'c1',l:100,w:80,h:140,x:8.5,y:8.5,z:0,color:'#123456'}]}};
const base=()=>({cargo:structuredClone([...initialCargo,custom]),plan:{...initialPlan},locked:['M07','M03']});
function memory(state){
 const map=new Map([[AIRCRAFT_STORE,JSON.stringify(state)]]),writes=[];
 return {map,writes,getItem:key=>map.get(key)??null,setItem(key,value){writes.push(key);map.set(key,value);}};
}
test('only exact unchanged starter demos are candidates; ids and modified records alone are not',()=>{
 assert.equal(initialCargo.every(isStarterDemo),true);assert.equal(isStarterDemo(custom),false);
 for(const item of [{...initialCargo[0],name:'Edited'},{...initialCargo[0],weight:10},{...initialCargo[0],pmc:{}},{...initialCargo[0],note:'mine'}])assert.equal(isStarterDemo(item),false);
 const state=base(),before=JSON.stringify(state),result=prepareDemoRemoval(state);
 assert.equal(JSON.stringify(state),before);assert.equal(result.recovery.deletedCargo.length,8);
 assert.deepEqual(result.next,{cargo:[custom],plan:{},locked:['M03']});
 assert.deepEqual(result.recovery.placements,initialPlan);assert.deepEqual(result.recovery.locked,['M07']);
});
test('verified backup is written before deleting and never changes the custom PMC or its weight',()=>{
 const state=base(),storage=memory(state),before=structuredClone(state);
 const result=removeDemosWithRecovery(storage,state);
 assert.deepEqual(storage.writes,[RECOVERY_STORE,AIRCRAFT_STORE]);
 assert.deepEqual(state,before);assert.deepEqual(result.next.cargo,[custom]);
 assert.equal(result.next.cargo[0].weight,120000);
 assert.deepEqual(readDemoRecovery(storage)[0].deletedCargo,initialCargo);
 assert.deepEqual(JSON.parse(storage.getItem(AIRCRAFT_STORE)),result.next);
});
test('backup failures or readback mismatch block deletion; plan-write failure retains the backup',()=>{
 for(const mismatch of [false,true]){
  const state=base(),storage=memory(state),original=storage.getItem(AIRCRAFT_STORE);
  const set=storage.setItem.bind(storage);
  storage.setItem=(key,value)=>{if(key===RECOVERY_STORE){if(mismatch)set(key,'[]');else throw Error('quota');}else set(key,value);};
  assert.throws(()=>removeDemosWithRecovery(storage,state),/yedek|yedeği/);
  assert.equal(storage.getItem(AIRCRAFT_STORE),original);
 }
 const state=base(),storage=memory(state),set=storage.setItem.bind(storage);
 storage.setItem=(key,value)=>{if(key===AIRCRAFT_STORE)throw Error('quota');set(key,value);};
 assert.throws(()=>removeDemosWithRecovery(storage,state),/Kurtarma yedeği korunuyor/);
 assert.equal(readDemoRecovery(storage)[0].deletedCargo.length,8);
 assert.deepEqual(JSON.parse(storage.getItem(AIRCRAFT_STORE)),state);
});
test('undo restores demos but preserves newer custom records, occupied positions and locks',()=>{
 const state=base(),storage=memory(state),removed=removeDemosWithRecovery(storage,state);
 const later={id:'PAL-10',name:'Later custom',weight:100,l:100,w:80,h:50,priority:1};
 const current={cargo:[...removed.next.cargo,later],plan:{M07:later.id},locked:['M03','M07']};
 storage.setItem(AIRCRAFT_STORE,JSON.stringify(current));
 const restored=undoDemoRemoval(storage,current);
 assert.equal(restored.added,8);assert.deepEqual(restored.next.cargo.slice(0,2),[custom,later]);
 assert.equal(restored.next.plan.M07,later.id);assert.equal(restored.next.plan.M10,'PAL-02');
 assert.deepEqual(restored.next.locked,['M03','M07']);assert.deepEqual(restored.unplaced,['PAL-01']);
 assert.equal(readDemoRecovery(storage)[0].restored,true);
 assert.equal(readDemoRecovery(storage)[0].deletedCargo.length,8,'recovery data is retained after undo');
});
test('undo never replaces a new record that reuses a deleted id',()=>{
 const state=base(),storage=memory(state),removed=removeDemosWithRecovery(storage,state);
 const collision={...initialCargo[0],name:'New user record',weight:300};
 const current={...removed.next,cargo:[...removed.next.cargo,collision]};
 storage.setItem(AIRCRAFT_STORE,JSON.stringify(current));
 const restored=undoDemoRemoval(storage,current);
 assert.deepEqual(restored.next.cargo.find(item=>item.id===collision.id),collision);
 assert.deepEqual(restored.conflicts,['PAL-01']);assert.equal(readDemoRecovery(storage)[0].restored,false);
});
test('stale tabs and corrupt recovery data fail closed without overwriting saved data',()=>{
 const state=base(),storage=memory(state),later={...state,cargo:[...state.cargo,{...custom,id:'PAL-10'}]};
 storage.setItem(AIRCRAFT_STORE,JSON.stringify(later));
 assert.throws(()=>removeDemosWithRecovery(storage,state),/başka bir sekmede/);
 assert.equal(storage.getItem(RECOVERY_STORE),null);
 storage.setItem(AIRCRAFT_STORE,JSON.stringify(state));storage.setItem(RECOVERY_STORE,'broken');
 assert.throws(()=>removeDemosWithRecovery(storage,state),/üzerine yazılmadı/);
 assert.equal(storage.getItem(RECOVERY_STORE),'broken');
 assert.deepEqual(JSON.parse(storage.getItem(AIRCRAFT_STORE)),state);
});
test('inventory may hold more than thirty custom records; demo cleanup imposes no occupancy limit',()=>{
 const customs=Array.from({length:40},(_,i)=>({...structuredClone(custom),id:'PAL-'+(i+9)}));
 const state={cargo:[...initialCargo,...customs],plan:{},locked:[]},storage=memory(state);
 const removed=removeDemosWithRecovery(storage,state);
 assert.equal(removed.next.cargo.length,40);assert.deepEqual(removed.next.cargo,customs);
 assert.equal(starterDemos(removed.next.cargo).length,0);
});
test('an all-demo inventory may become empty and is recoverable',()=>{
 const state={cargo:structuredClone(initialCargo),plan:{},locked:[]},storage=memory(state);
 const removed=removeDemosWithRecovery(storage,state);
 assert.deepEqual(removed.next,{cargo:[],plan:{},locked:[]});
 const restored=undoDemoRemoval(storage,removed.next);assert.deepEqual(restored.next.cargo,initialCargo);
});

test('colliding ids protect every record with that id, including an unchanged-looking demo',()=>{
 const userCopy={...initialCargo[0],name:'My custom duplicate',weight:999};
 const state={cargo:[...initialCargo,userCopy,custom],plan:{},locked:[]},storage=memory(state);
 assert.equal(starterDemos(state.cargo).some(item=>item.id==='PAL-01'),false);
 const removed=removeDemosWithRecovery(storage,state);
 assert.deepEqual(removed.next.cargo,[initialCargo[0],userCopy,custom]);
 assert.equal(removed.removed,7);
});
test('guarded ordinary autosave cannot overwrite newer data from another tab',()=>{
 const state=base(),storage=memory(state),token=storage.getItem(AIRCRAFT_STORE);
 const later={...state,cargo:[...state.cargo,{...custom,id:'PAL-10',name:'Tab B record'}]};
 storage.setItem(AIRCRAFT_STORE,JSON.stringify(later));
 assert.throws(()=>saveAircraftState(storage,{...state,locked:['M03']},token),error=>error.code==='STALE');
 assert.deepEqual(JSON.parse(storage.getItem(AIRCRAFT_STORE)),later);
});
test('a change during backup verification is checked again before deleting the saved plan',()=>{
 const state=base(),storage=memory(state),set=storage.setItem.bind(storage),later={...state,cargo:[...state.cargo,{...custom,id:'PAL-10'}]};
 storage.setItem=(key,value)=>{set(key,value);if(key===RECOVERY_STORE)set(AIRCRAFT_STORE,JSON.stringify(later));};
 assert.throws(()=>removeDemosWithRecovery(storage,state),error=>error.code==='STALE');
 assert.deepEqual(JSON.parse(storage.getItem(AIRCRAFT_STORE)),later);
 assert.equal(readDemoRecovery(storage)[0].deletedCargo.length,8);
});

test('undo rechecks current data after reading recovery, before writing any restored plan',()=>{
 const state=base(),storage=memory(state),removed=removeDemosWithRecovery(storage,state),get=storage.getItem.bind(storage);
 const later={...removed.next,cargo:[...removed.next.cargo,{...custom,id:'PAL-10'}]};
 let inject=true;
 storage.getItem=key=>{const value=get(key);if(key===RECOVERY_STORE&&inject){inject=false;storage.map.set(AIRCRAFT_STORE,JSON.stringify(later));}return value;};
 assert.throws(()=>undoDemoRemoval(storage,removed.next),error=>error.code==='STALE');
 assert.deepEqual(JSON.parse(get(AIRCRAFT_STORE)),later);
});
test('aircraft write transactions use one exclusive cross-tab lock and fail closed without it',async()=>{
 const old=globalThis.window;
 const calls=[];let queue=Promise.resolve();
 globalThis.window={navigator:{locks:{request(name,options,fn){calls.push([name,options]);const next=queue.then(fn);queue=next.catch(()=>{});return next;}}}};
 try{
  const order=[];
  await Promise.all([withAircraftWriteLock(async()=>{order.push('a-start');await new Promise(resolve=>setTimeout(resolve,5));order.push('a-end');}),withAircraftWriteLock(()=>order.push('b'))]);
  assert.deepEqual(order,['a-start','a-end','b']);
  assert.ok(calls.every(([name,options])=>name==='cargo-demo-write-v1'&&options.mode==='exclusive'));
  globalThis.window={navigator:{}};
  await assert.rejects(withAircraftWriteLock(()=>assert.fail('must not run')),/kayıt kilidi/);
 }finally{if(old===undefined)delete globalThis.window;else globalThis.window=old;}
});
