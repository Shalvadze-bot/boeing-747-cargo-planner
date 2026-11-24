import { AIRCRAFT_MODEL } from './aircraft-profile.mjs';
import { fit, PROFILE, slots, stats, violations } from './engine.mjs';

export function aircraftContext({cargo,plan,locked,selected,focusedSlot}) {
  const slot = slots.find(item=>item.id===focusedSlot) ?? slots.find(item=>plan[item.id]===selected);
  const activeCargo = cargo.find(item=>item.id===(focusedSlot?plan[focusedSlot]:selected));
  return {
    aircraft:AIRCRAFT_MODEL, limits:PROFILE,
    manifestColumns:'reference, name, length cm, width cm, height cm, kg, priority',
    manifest:cargo.map(item=>[item.id,item.name,item.l,item.w,item.h,item.weight,item.priority]),
    positions:slots.map(s=>[s.id,s.label,s.deck,s.l,s.w,s.h,s.max,plan[s.id]??null,locked.includes(s.id)]),
    positionColumns:'id, label, deck, length cm, width cm, height cm, kg limit, assigned reference, locked',
    selection:{reference:activeCargo?.id??null,name:activeCargo?.name??null,position:slot?.label??null},
    selectedPmcItems:activeCargo?.pmc?.items?.map(item=>[item.id,item.name,item.w,item.l,item.h,item.weight])??null,
    summary:stats(plan,cargo), warnings:violations(plan,cargo),
  };
}

export function aircraftInspection({cargo,plan}, includeWaiting) {
  const summary = stats(plan,cargo);
  const taken = new Set(Object.values(plan));
  const waiting = includeWaiting?cargo.filter(item=>!taken.has(item.id)).map(item=>({
    id:item.id,reason:slots.some(s=>fit(item,s))?'Bu yerleşimde açık bir atama bulunmuyor. Uygunluk ve doluluk ayrı kontrol edilir.':'Hiçbir örnek pozisyonun ölçü ve ağırlık sınırlarına sığmıyor.',
  })):null;
  return {summary,free:slots.length-summary.count,warnings:violations(plan,cargo),waiting};
}

export function optimizeAircraftChat(input,signal) {
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker = new Worker(new URL('./chat-aircraft-worker.mjs',import.meta.url),{type:'module'});
    const finish = (callback,value)=>{
      clearTimeout(timer);
      signal.removeEventListener('abort',abort);
      worker.terminate();
      callback(value);
    };
    const abort=()=>finish(reject,signal.reason);
    const timer=setTimeout(()=>finish(reject,new Error('Uçak hesabı zaman aşımına uğradı.')),30000);
    signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>data.error?finish(reject,new Error(data.error)):finish(resolve,data);
    worker.onerror=()=>finish(reject,new Error('Uçak planı hesaplanamadı.'));
    worker.postMessage(input);
  });
}
