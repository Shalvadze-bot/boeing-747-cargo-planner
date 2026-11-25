import { readPmcDecimal, validatePmcGeometry } from './pmc-geometry-validator.mjs';
import { CONTOUR_OPTIMIZER, RESEARCH_PROFILE_LABEL, researchModelFor } from './pmc-research-review.mjs';
import { baseSpace, contourClearance, orientationCannotFit, placementRange, researchEnvelopeMm3, subtractPlacement } from './pmc-contour-space.mjs';

export const DEFAULT_CONTOUR_CANDIDATE_LIMIT = 120_000;
const positive = value => Number.isFinite(value) && value > 0;
const area = ({widthMm:w,lengthMm:l}) => w*l;
const maxSide = ({widthMm:w,lengthMm:l}) => Math.max(w,l);
const ascending = (a,b) => a.ordinal-b.ordinal;
const byArea = (a,b) => area(b)-area(a)||b.heightMm-a.heightMm||ascending(a,b);
const byHeight = (a,b) => b.heightMm-a.heightMm||area(b)-area(a)||ascending(a,b);
const byLongSide = (a,b) => maxSide(b)-maxSide(a)||byArea(a,b);
const byOptions = (a,b) => a.orientations.length-b.orientations.length||byHeight(a,b);
const strategies = [
  {name:'zor-parça',order:byOptions,spaceFirst:false},
  {name:'taban-alanı',order:byArea,spaceFirst:true},
  {name:'uzun-kenar',order:byLongSide,spaceFirst:false},
  {name:'yükseklik',order:byHeight,spaceFirst:true},
];

function orientationsFor(item) {
  const upright = {orientation:'yaw0',widthMm:item.widthMm,lengthMm:item.lengthMm,heightMm:item.heightMm};
  return item.allowedOrientations?.includes('yaw90') && item.widthMm!==item.lengthMm ?
    [upright,{orientation:'yaw90',widthMm:item.lengthMm,lengthMm:item.widthMm,heightMm:item.heightMm}] : [upright];
}

function normalizeItems(rows) {
  if (!Array.isArray(rows)||!rows.length||rows.length>100) return {errors:['1–100 yük grubu girin.']};
  const items=[], errors=[], ids=new Set();
  rows.forEach((row,index)=>{
    const quantity=readPmcDecimal(row?.quantity);
    const sizes=['width','length','height'].map(key=>readPmcDecimal(row?.[key])*10);
    const weight=row?.weight==null||row.weight==='' ? null : readPmcDecimal(row.weight);
    if (typeof row?.id!=='string'||!row.id.trim()||ids.has(row.id)||
        !sizes.every(positive)||!Number.isSafeInteger(quantity)||quantity<1||items.length+quantity>200||
        weight!==null&&!positive(weight)) {
      errors.push(`${index+1}. satırda kimlik, adet, ölçü veya ağırlık geçersiz.`);
      return;
    }
    ids.add(row.id);
    const [widthMm,lengthMm,heightMm]=sizes;
    const allowedOrientations=typeof row.allowRotation==='boolean' ? (row.allowRotation?['yaw0','yaw90']:['yaw0']) : undefined;
    for(let i=1;i<=quantity;i++){
      const item={id:`${row.id}:${i}`,ordinal:items.length,rowId:row.id,name:row.name||`Yük ${index+1}`,color:row.color,
        widthMm,lengthMm,heightMm,weight,allowedOrientations,stackable:row.stackable===true};
      item.orientations=orientationsFor(item);
      items.push(item);
    }
  });
  return {items,errors};
}

function createBudget(limit,timeLimitMs,started) {
  return {
    limit, checked:0, rejected:0, independentChecks:0, stop:null,
    take() {
      if (this.stop) return false;
      if (timeLimitMs && performance.now()-started>=timeLimitMs) this.stop='time-limit';
      else if (this.checked>=this.limit) this.stop='candidate-limit';
      if (this.stop) return false;
      this.checked++;
      return true;
    },
  };
}

const emptyBin = model => ({boxes:[], items:[], spaces:[baseSpace(model)], minClearance:Infinity});

function placeInBin(bin,index,item,model,budget,strategy) {
  const candidates=[], tried=new Set();
  for (const space of bin.spaces) {
    for (const direction of item.orientations) {
      const range = placementRange(space,direction,model,strategy.minClearance);
      if(!range) continue;
      for(const uMm of new Set(range)) for(const vMm of new Set([space.v,space.v+space.l-direction.lengthMm])){
        const key=[uMm,vMm,direction.orientation].join(',');
        if(tried.has(key)) continue;
        tried.add(key);
        if(!budget.take()) break;
        const placement={...direction,id:item.id,palletIndex:index,uMm,vMm,zMm:0};
        const margin=contourClearance(placement,model);
        if (margin < -model.numericalToleranceMm) {budget.rejected++;continue;}
        candidates.push({placement,margin,score:[Math.min(bin.minClearance,margin),space.w*space.l-area(item)]});
      }
      if(budget.stop) break;
    }
    if(budget.stop) break;
  }
  const highSide = model.contour.mirrored ? -1 : 1;
  candidates.sort((a,b)=>{
    const clearance=b.score[0]-a.score[0], residual=a.score[1]-b.score[1];
    const balance=strategy.spaceFirst ? residual||clearance : clearance||residual;
    return balance||a.placement.vMm-b.placement.vMm||highSide*(a.placement.uMm-b.placement.uMm);
  });
  for (const {placement,margin} of candidates) {
    const items=[...bin.items,item], boxes=[...bin.boxes,placement];
    budget.independentChecks++;
    const assessment=validatePmcGeometry({items,placements:boxes,model});
    if(assessment.status==='PASS') return {items,boxes,minClearance:Math.min(bin.minClearance,margin),
      spaces:subtractPlacement(bin.spaces,placement,model.minHorizontalGapMm,model.numericalToleranceMm)};
    budget.rejected++;
  }
  return null;
}

function search(items,bins,model,budget,strategy) {
  const next=[...bins], unplaced=[];
  for (const item of [...items].sort(strategy.order)) {
    let inserted=false;
    for(let index=0;index<=next.length && index<model.maxPallets && !budget.stop;index++){
      const bin=placeInBin(next[index]??emptyBin(model),index,item,model,budget,strategy);
      if(!bin) continue;
      next[index]=bin;
      inserted=true;
      break;
    }
    if(!inserted) unplaced.push(item);
  }
  const residual=next.reduce((sum,bin)=>sum+Math.max(0,...bin.spaces.map(space=>space.w*space.l)),0);
  return {bins:next,unplaced,residual,strategy:strategy.name,clearance:Math.min(Infinity,...next.map(bin=>bin.minClearance))};
}

const compare = (a,b) => a.unplaced.length-b.unplaced.length||a.bins.length-b.bins.length||
  (a.bins.length?b.clearance-a.clearance:0)||b.residual-a.residual;

function checkPlan(attempt,items,omitted,model) {
  const placements=attempt.bins.flatMap(bin=>bin.boxes);
  const unplaced=[...attempt.unplaced,...omitted].map(item=>item.id);
  return validatePmcGeometry({items,placements,unplacedIds:unplaced,model});
}

function appPlacement(box,item,model) {
  const {usable,nominal}=model;
  return {id:box.id,rowId:item.rowId,name:item.name,color:item.color,
    x:(usable.xMm+box.uMm)/10,y:(usable.yMm+box.vMm+box.palletIndex*nominal.lengthMm)/10,z:0,
    w:box.widthMm/10,l:box.lengthMm/10,h:box.heightMm/10,palletIndex:box.palletIndex,
    orientationFace:'upright',rotated:box.orientation==='yaw90',touchedPallets:[box.palletIndex],
    weight:item.weight,stackable:item.stackable,overhangCm:0,reviewRequired:false,supportIds:[],supportId:null};
}

const warnings = [
  'SİMÜLASYON — Avianca Contour 1 araştırma geometrisi. Teknik veya operasyonel yükleme onayı yok.',
  'V2 dik, ortogonal ve tek kat yerleşim arar. Palet sayısının optimumluğu genel olarak kanıtlanmaz.',
];

export function runContourPacking(rows, rawConfig={}, options={}) {
  const started=performance.now();
  const config={...rawConfig,maxPallets:readPmcDecimal(rawConfig?.maxPallets??6),
    mirrored:rawConfig?.mirrored??false,optimizer:CONTOUR_OPTIMIZER};
  const profile={name:RESEARCH_PROFILE_LABEL,status:warnings[0],mirrored:config.mirrored};
  const summary={requestedCount:0,placedCount:0,unplacedCount:0,palletCount:0,volumeM3:0,
    knownWeightKg:0,unknownWeightCount:0,overhangCount:0};
  const result={config,profile,warnings:[...warnings],errors:[],placements:[],pallets:[],unplaced:[],summary};
  const metadata={id:CONTOUR_OPTIMIZER,outcome:'missing-input',elapsedMs:0};
  result.optimizer=metadata;
  const finish=()=>{metadata.elapsedMs=performance.now()-started;return result;};
  const model=researchModelFor(config,config.researchSettings);
  if(!model) result.errors.push('V2 için palet sınırını, kontur yönünü, datumları ve paket aralığını kontrol edin.');
  if(config.longCargo||config.allowOverhang) result.errors.push('V2 tek kat, dik ve taşmasız yerleşimler içindir.');
  const normalized=normalizeItems(rows);
  result.errors.push(...normalized.errors);
  if(result.errors.length) return finish();
  result.researchModel=model;

  const {items}=normalized, base=baseSpace(model);
  const unknown=[], oversized=[], eligible=[];
  for(const item of items){
    if(!item.allowedOrientations) unknown.push(item);
    else if(item.orientations.every(direction=>orientationCannotFit(direction,model))) oversized.push(item);
    else eligible.push(item);
  }
  const omitted=[...oversized,...unknown];
  const limit=Number.isSafeInteger(options.candidateLimit)&&options.candidateLimit>0 ? options.candidateLimit : DEFAULT_CONTOUR_CANDIDATE_LIMIT;
  const budget=createBudget(limit,positive(options.timeLimitMs)?options.timeLimitMs:null,started);
  let best={bins:[],unplaced:eligible,residual:0,strategy:null};
  let report=checkPlan(best,items,omitted,model);
  const evaluate=(attempt)=>{
    const verified=checkPlan(attempt,items,omitted,model);
    if(verified.status==='FAIL') {budget.rejected++;return;}
    if(verified.status==='PASS'&&compare(attempt,best)<0){best=attempt;report=verified;}
  };
  for(const strategy of strategies){
    if(!eligible.length||budget.stop) break;
    evaluate(search(eligible,[],model,budget,strategy));
  }
  if(!budget.stop&&best.bins.length>1){
    const retained=best.bins.slice(0,Math.max(0,best.bins.length-3));
    const repack=[...best.bins.slice(retained.length).flatMap(bin=>bin.items),...best.unplaced];
    evaluate(search(repack,retained,model,budget,{name:'son-paleti-yeniden-yerleştir',order:byOptions,spaceFirst:true}));
  }
  // Try a stricter roof everywhere, while keeping the incumbent placement and
  // pallet count. A failed heuristic trial does not prove a clearance bound.
  if(best.bins.length){
    let low=best.clearance, high=model.contour.points[0][1]-model.contour.verticalOffsetMm;
    for(let step=0;step<9&&!budget.stop&&high-low>0.1;step++){
      const minClearance=(low+high)/2;
      const policy={name:'dikey-açıklık',order:byOptions,spaceFirst:false,minClearance};
      const attempt=search(eligible,[],{...model,maxPallets:best.bins.length},budget,policy);
      evaluate(attempt);
      if(best.clearance>=minClearance-model.numericalToleranceMm) low=best.clearance;
      else high=minClearance;
    }
  }

  const footprintBound=items.reduce((sum,item)=>sum+area(item),0)/
    ((base.w+2*model.numericalToleranceMm)*(base.l+2*model.numericalToleranceMm));
  // Numerical overlap tolerance permits minute interpenetration. Deduct a
  // perimeter strip per item before using this area bound as a proof.
  const toleranceArea=items.reduce((sum,item)=>sum+2*model.numericalToleranceMm*(item.widthMm+item.lengthMm),0);
  const floorBound=Number.isFinite(footprintBound)?
    Math.ceil(footprintBound-toleranceArea/(base.w*base.l)-1e-12):null;
  const individuallyUnfit=new Set(oversized.map(item=>item.id)), unknownIds=new Set(unknown.map(item=>item.id));
  const outcome=unknown.length?'missing-input':report.complete?'complete':
    oversized.length||floorBound>model.maxPallets?'proven-infeasible':budget.stop??'heuristic-exhausted';
  const pallets=best.bins.map((bin,index)=>{
    const parts=bin.boxes.map((box,i)=>appPlacement(box,bin.items[i],model));
    return {index,items:parts,metrics:{itemCount:parts.length,originatingCount:parts.length,
      maxHeight:Math.max(...parts.map(part=>part.h)),volumeM3:parts.reduce((sum,p)=>sum+p.w*p.l*p.h/1e6,0),reviewRequired:false}};
  });
  const placements=pallets.flatMap(pallet=>pallet.items);
  const unplaced=[...best.unplaced,...omitted].sort(ascending).map(item=>({
    id:item.id,rowId:item.rowId,name:item.name,quantity:1,
    reason:unknownIds.has(item.id)?'Yatay dönüş izni eksik.':
      individuallyUnfit.has(item.id)?'Bu parça izinli hiçbir dik yönde boş bir PMC’ye sığmıyor.':
      'Araştırma sınırlarında bu aramada yer bulunamadı.',
  }));
  const volumeM3=pallets.reduce((sum,pallet)=>sum+pallet.metrics.volumeM3,0);
  const envelope=researchEnvelopeMm3(model)/1e9*pallets.length;
  const footprint=base.w*base.l*pallets.length;
  Object.assign(result,{placements,pallets,unplaced,validation:report,summary:{
    ...summary,requestedCount:items.length,placedCount:placements.length,unplacedCount:unplaced.length,
    palletCount:pallets.length,volumeM3,knownWeightKg:placements.reduce((sum,p)=>sum+(p.weight??0),0),
    unknownWeightCount:placements.filter(p=>p.weight===null).length,
  }});
  Object.assign(metadata,{outcome,stopReason:budget.stop,strategy:best.strategy,areaLowerBound:floorBound,
    candidateLimit:limit,generatedCandidates:budget.checked,rejectedCandidates:budget.rejected,
    independentChecks:budget.independentChecks,individuallyUnfit:oversized.length,unknownPieces:unknown.length,
    footprintUtilization:footprint?best.bins.flatMap(bin=>bin.items).reduce((sum,item)=>sum+area(item),0)/footprint:0,
    volumeUtilization:envelope?volumeM3/envelope:0,largestResidualAreaM2:best.residual/1e6});
  return finish();
}
