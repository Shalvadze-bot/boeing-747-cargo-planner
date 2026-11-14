import {PMC} from './pmc-engine.mjs';
import {slots, place} from './engine.mjs';

export function preparePmcTransfer(result) {
  if (result?.config?.longCargo) throw new Error('Uzun yük test senaryosu gerçek uçak pozisyonlarına aktarılmaz; teknik eşleme ve doğrulama bekleniyor.');
  if (!result || result.errors?.length || !result.placements?.length) throw new Error('Önce geçerli bir PMC yerleşimi hesaplayın.');
  if (result.placements.some(p => p.overhangCm > 0 || p.touchedPallets?.length > 1)) throw new Error('Komşu palete taşan yükler bağımsız uçak pozisyonlarına aktarılamaz. Taşmayı kapatıp yeniden hesaplayın.');
  return result.pallets.filter(p => p.items.length).map(p => ({
    index:p.index, knownWeight:p.items.reduce((sum,item)=>sum+(item.weight??0),0),
    unknownWeight:p.items.some(item=>item.weight==null),
    items:p.items.map(item=>({...item,y:item.y-p.index*PMC.length})),
    height:Math.max(1,...p.items.map(item=>item.z+item.h)),
  }));
}

export function importPmcPallets({cargo,plan,locked=[],result,weights}) {
  const pallets=preparePmcTransfer(result);
  const sourceKey=JSON.stringify({config:result.config,placements:result.placements});
  if(cargo.some(item=>item.pmc?.sourceKey===sourceKey)) throw new Error('Bu PMC hesaplaması zaten uçak yük listesinde. Mevcut PMC paletlerini seçin.');
  if(weights.length!==pallets.length || weights.some((w,i)=>!Number.isFinite(Number(w)) || Number(w)<=0 || Number(w)<pallets[i].knownWeight)) throw new Error('Her palet için bilinen yük ağırlığından az olmayan, sıfırdan büyük brüt ağırlık girin.');
  let nextId=Math.max(0,...cargo.map(c=>Number(c.id.match(/^PAL-(\d+)$/)?.[1])||0));
  const added=pallets.map((p,i)=>({id:`PAL-${String(++nextId).padStart(2,'0')}`,name:`PMC ${String(p.index+1).padStart(2,'0')} · ${p.items.length} parça`,weight:Number(weights[i]),l:PMC.length,w:PMC.width,h:p.height,priority:1,pmc:{version:1,sourceKey,index:p.index,items:p.items,mirrored:!!result.config?.mirrored}}));
  const nextCargo=[...cargo,...added];
  let nextPlan={...plan};
  for(const item of added) for(const slot of slots){
    if(nextPlan[slot.id] || locked.includes(slot.id))continue;
    const attempt=place(nextPlan,nextCargo,item.id,slot.id);
    if(!attempt.error){nextPlan=attempt.plan;break;}
  }
  return {cargo:nextCargo,plan:nextPlan,added,waiting:added.filter(item=>!Object.values(nextPlan).includes(item.id))};
}

// Uniform scale keeps each imported pallet's real aspect ratios; aircraft bays are schematic.
export function pmcBoxTransforms(item,{x,y,z,maxLength=6.5,maxWidth=2.05,maxHeight=1.85}) {
  if(!Array.isArray(item.pmc?.items))return [];
  const scale=Math.min(maxLength/item.l,maxWidth/item.w,maxHeight/Math.max(item.h,1));
  return item.pmc.items.map(box=>({id:box.id,color:box.color,size:[box.l*scale,box.h*scale,box.w*scale],position:[x+(box.y+box.l/2-item.l/2)*scale,y+.06+(box.z+box.h/2)*scale,z+(box.x+box.w/2-item.w/2)*scale]}));
}
