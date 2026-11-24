import { optimize, stats, violations, slots } from './engine.mjs';

self.onmessage = ({data:{cargo,plan,locked}})=>{
  const start = performance.now();
  try {
    const result = optimize(cargo,plan,locked);
    if (result.error) return self.postMessage(result);
    if (violations(result.plan,cargo,true).length || locked.some(id=>plan[id]!==result.plan[id])) {
      return self.postMessage({error:'Aday örnek uçak kısıtlarını veya sabit pozisyonları geçemedi.'});
    }
    self.postMessage({...result,stats:stats(result.plan,cargo),total:cargo.length,elapsedMs:performance.now()-start,
      positions:slots.filter(slot=>result.plan[slot.id]).map(slot=>({label:slot.label,reference:result.plan[slot.id]}))});
  } catch {
    self.postMessage({error:'Uçak planı hesaplanamadı.'});
  }
};
