import { PMC } from './pmc-engine.mjs';
import { toAiManifest, measuredEngine, unmarkedConfig } from './use-ai-packing.mjs';
import { STRATEGY_NAMES } from './pmc-search-strategies.mjs';
import { sortAlternatives } from './pmc-plan-options.mjs';
import { samePieceSet } from './pmc-chat-search.mjs';

export function pmcContext({rows,config,result,stale,selectedItemId,selectedPallet,outcome}) {
  const selected = result?.placements.find(item=>item.id===selectedItemId);
  return {
    profile:{width:PMC.width,length:PMC.length,edgeCm:PMC.margin,maxHeight:PMC.maxHeight,
      shoulderX:PMC.shoulderX,lowHeight:PMC.lowHeight,mirrored:!!config.mirrored,longCargo:!!config.longCargo,maxPallets:Number(config.maxPallets)},
    manifest:toAiManifest(rows).map((values,i)=>[rows[i].id,rows[i].name,...values]),
    manifestColumns:'reference, name, length cm, width cm, height cm, quantity, kg per piece, orientation code, rotate allowed, support allowed, stack kg, per-piece orientation overrides',
    placementColumns:'reference, PMC (1-based), X cm, Y cm (global), Z cm, width cm, length cm, height cm, face, support ids',
    placements:!stale?result?.placements.map(p=>[p.id,p.palletIndex+1,p.x,p.y,p.z,p.w,p.l,p.h,p.orientationFace,p.supportIds]):null,
    selection:{pallet:selectedPallet==null?null:selectedPallet+1,reference:selected?.id??null,name:selected?.name??null},
    unplaced:!stale?result?.unplaced.map(item=>[item.id,item.reason]):null,
    validation:!stale&&result?{engineErrors:result.errors??[],warnings:result.warnings??[],independent:outcome?.current?.validation?.valid??null}:null,
    alternatives:outcome?.alternatives.map((item,i)=>[i,item.validation.stats,item.elapsedMs])??[],
    stale:!!stale,
  };
}

export async function searchChatPlans({rows,config,current,singlePallet,objective='capacity',aircraft},signal,progress) {
  const clean = unmarkedConfig(config);
  const single = singlePallet !== null && singlePallet !== undefined;
  if (single && !current?.pallets.some(p=>p.index===singlePallet)) throw new Error('Önce geçerli bir PMC hesaplayın ve seçin.');
  const started = performance.now();
  progress('Karşılaştırma planı doğrulanıyor');
  const standard = await measuredEngine({rows,config:clean,baseline:current},signal);
  if (!standard.validation.stats) throw new Error(standard.validation.errors[0] ?? 'Yük veya PMC ayarı geçersiz.');
  const candidates = [];
  for (const [index,strategy] of STRATEGY_NAMES.entries()) {
    signal.throwIfAborted();
    progress(`Motor denemesi ${index+1}/${STRATEGY_NAMES.length} · hesaplama ve doğrulama`);
    const candidate = await measuredEngine({rows,config:clean,strategy,
      ...(single?{current,singlePmc:{index:singlePallet}}:{})},signal);
    if (candidate.validation.valid && candidate.validation.stats.placed >= standard.validation.stats.placed &&
        (!single || samePieceSet(candidate.result,current))) candidates.push({...candidate,strategy,canApply:true});
  }
  return {standard,alternatives:sortAlternatives(candidates,standard,objective),objective,aircraft,
    elapsedMs:performance.now()-started,singlePallet:single?singlePallet:undefined};
}
