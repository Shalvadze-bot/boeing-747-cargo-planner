import {initialCargo,slots,place} from './engine.mjs';

export const AIRCRAFT_STORE='cargo-demo-v1';
export const RECOVERY_STORE='cargo-demo-recovery-v1';
const copy=value=>JSON.parse(JSON.stringify(value));
const snapshot=state=>({cargo:state.cargo,plan:state.plan,locked:state.locked||[]});
const sameRecord=(a,b)=>!!a&&!!b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(b).every(key=>Object.hasOwn(a,key)&&Object.is(a[key],b[key]));

// IDs alone are never enough: edited records and every PMC/custom extension stay.
export function isStarterDemo(item){
 const original=initialCargo.find(demo=>demo.id===item?.id);
 return sameRecord(item,original);
}
export function starterDemos(cargo){return cargo.filter(isStarterDemo);}

export function readDemoRecovery(storage){
 const raw=storage.getItem(RECOVERY_STORE);
 if(raw===null)return [];
 let records;
 try{records=JSON.parse(raw);}catch{throw new Error('Silme yedeği okunamıyor. Mevcut yedeğin üzerine yazılmadı.');}
 const valid=Array.isArray(records)&&records.every(record=>
  record?.version===1&&typeof record.id==='string'&&typeof record.createdAt==='string'&&typeof record.restored==='boolean'&&
  Array.isArray(record.deletedCargo)&&record.deletedCargo.length>0&&record.deletedCargo.every(isStarterDemo)&&
  new Set(record.deletedCargo.map(item=>item.id)).size===record.deletedCargo.length&&
  record.placements&&typeof record.placements==='object'&&!Array.isArray(record.placements)&&
  Object.entries(record.placements).every(([sid,id])=>slots.some(slot=>slot.id===sid)&&record.deletedCargo.some(item=>item.id===id))&&
  Array.isArray(record.locked)&&record.locked.every(sid=>Object.hasOwn(record.placements,sid)));
 if(!valid)throw new Error('Silme yedeği doğrulanamadı. Mevcut yedeğin üzerine yazılmadı.');
 return records;
}
function writeVerified(storage,key,value,message){
 const encoded=JSON.stringify(value);
 try{storage.setItem(key,encoded);if(storage.getItem(key)!==encoded)throw new Error('Readback mismatch');}
 catch{throw new Error(message);}
}
function assertCurrent(storage,state){
 const raw=storage.getItem(AIRCRAFT_STORE);
 if(raw===null)return;
 let current;
 try{current=JSON.parse(raw);}catch{throw new Error('Kaydedilmiş plan okunamıyor; işlem yapılmadı.');}
 if(JSON.stringify(snapshot(current))!==JSON.stringify(snapshot(state)))
  throw new Error('Plan başka bir sekmede değişmiş. Verileri korumak için sayfayı yenileyin.');
}
export function prepareDemoRemoval(state){
 const deletedCargo=starterDemos(state.cargo).map(item=>({...item}));
 const ids=new Set(deletedCargo.map(item=>item.id));
 const placements=Object.fromEntries(Object.entries(state.plan).filter(([,id])=>ids.has(id)));
 return {
  next:{cargo:state.cargo.filter(item=>!ids.has(item.id)),plan:Object.fromEntries(Object.entries(state.plan).filter(([,id])=>!ids.has(id))),locked:(state.locked||[]).filter(sid=>!Object.hasOwn(placements,sid))},
  recovery:{version:1,id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,createdAt:new Date().toISOString(),restored:false,deletedCargo,placements,locked:(state.locked||[]).filter(sid=>Object.hasOwn(placements,sid))}
 };
}
export function removeDemosWithRecovery(storage,state){
 assertCurrent(storage,state);
 const history=readDemoRecovery(storage),{next,recovery}=prepareDemoRemoval(state);
 if(!recovery.deletedCargo.length)throw new Error('Silinecek değişmemiş demo paleti yok.');
 const nextHistory=[...history,recovery];
 // Backup must exist and match byte-for-byte before changing the saved plan.
 writeVerified(storage,RECOVERY_STORE,nextHistory,'Kurtarma yedeği kaydedilip doğrulanamadı. Demo paletler silinmedi.');
 writeVerified(storage,AIRCRAFT_STORE,next,'Plan kaydı doğrulanamadı. Kurtarma yedeği korunuyor; sayfayı yenileyip kontrol edin.');
 return {next,history:nextHistory,removed:recovery.deletedCargo.length};
}
export function prepareDemoRestore(state,recovery){
 const conflicts=[],added=[],existing=new Map(state.cargo.map(item=>[item.id,item]));
 for(const item of recovery.deletedCargo){
  const found=existing.get(item.id);
  if(!found)added.push(copy(item));
  else if(!sameRecord(found,item))conflicts.push(item.id);
 }
 const cargo=[...state.cargo,...added],plan={...state.plan},locked=[...(state.locked||[])],addedIds=new Set(added.map(item=>item.id)),unplaced=[];
 for(const [sid,id] of Object.entries(recovery.placements)){
  if(!addedIds.has(id))continue; // Never move or relock a record already in the user's current plan.
  if(plan[sid]||locked.includes(sid)||Object.values(plan).includes(id)){unplaced.push(id);continue;}
  const result=place(plan,cargo,id,sid);
  if(result.error){unplaced.push(id);continue;}
  Object.assign(plan,result.plan);
  if(recovery.locked.includes(sid)&&!locked.includes(sid))locked.push(sid);
 }
 return {next:{cargo,plan,locked},added:added.length,conflicts,unplaced};
}
export function undoDemoRemoval(storage,state){
 assertCurrent(storage,state);
 const history=readDemoRecovery(storage),index=history.findLastIndex(record=>!record.restored);
 if(index<0)throw new Error('Geri alınacak demo silme işlemi yok.');
 const restored=prepareDemoRestore(state,history[index]);
 writeVerified(storage,AIRCRAFT_STORE,restored.next,'Geri alma kaydı doğrulanamadı. Kurtarma yedeği korunuyor; sayfayı yenileyip kontrol edin.');
 // Keep every backup, including restored entries. Undo never erases recovery data.
 const nextHistory=history.map((record,i)=>i===index?{...record,restored:restored.conflicts.length===0}:record);
 let warning='';
 try{writeVerified(storage,RECOVERY_STORE,nextHistory,'Kurtarma durumu kaydedilemedi.');}
 catch{warning='Paletler geri alındı; yedek durum kaydı güncellenemedi. Yedek korunuyor.';}
 return {...restored,history:warning?history:nextHistory,warning};
}
