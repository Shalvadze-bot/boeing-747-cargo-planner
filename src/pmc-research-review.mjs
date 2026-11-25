import {makeResearchModel,validatePmcGeometry,fromLegacyPmcPlan} from './pmc-geometry-validator.mjs';

export const DEFAULT_RESEARCH_SETTINGS = Object.freeze({gapMm:'0',offsetMm:'34.2',verticalMm:'0'});

export function assessResearchPlan({rows,result,stale=false,busy=false,settings}={}) {
  const pending=(phase,message)=>({phase,status:'UNKNOWN',message,report:null,model:null,violationIds:[],placedIds:[]});
  if(busy)return pending('busy','Yerleşim hesaplanıyor.');
  if(stale)return pending('stale','Girdiler değişti; yeni planı hesaplayın.');
  if(!result)return pending('idle','Önce bir yerleşim hesaplayın.');
  if(result.errors?.length || !Array.isArray(rows) || !Array.isArray(result.placements) ||
      !Array.isArray(result.unplaced) || typeof result.config?.mirrored!=='boolean' ||
      !Number.isSafeInteger(result.config?.maxPallets) || result.config.maxPallets<1 || result.config.maxPallets>30)
    return pending('invalid','Plan veya giriş ayarları eksik/geçersiz.');
  if(result.config.longCargo || result.placements.some(p=>p?.overhangCm>0||p?.touchedPallets?.length>1))
    return pending('unsupported','Uzun yük ve komşu palet taşması V1 kapsamı dışında.');
  if(!result.placements.length)return pending('empty','Yerleşmiş parça yok; geometrik uygunluk gösterilemez.');
  const number=value=>{
    if((typeof value!=='number'&&typeof value!=='string') || (typeof value==='string'&&!value.trim()))return null;
    const n=Number(value);
    return Number.isFinite(n)&&n>=0?n:null;
  };
  const gap=number(settings?.gapMm),offset=number(settings?.offsetMm),vertical=number(settings?.verticalMm);
  if([gap,offset,vertical].some(v=>v===null))return pending('settings','Araştırma girdileri sıfır veya pozitif sayılar olmalı.');
  const base=makeResearchModel();
  const model=makeResearchModel({minHorizontalGapMm:gap,maxPallets:result.config.maxPallets,
    contour:{...base.contour,highEdgeOffsetMm:offset,verticalOffsetMm:vertical,mirrored:result.config.mirrored}});
  let report;
  try {
    report=validatePmcGeometry(fromLegacyPmcPlan(rows,result,model));
  } catch {
    return pending('invalid','Yerleşim verisi bağımsız doğrulayıcıya aktarılamadı.');
  }
  const placed=new Set(result.placements.map(p=>p.id));
  const violationIds=[...new Set(report.issues.filter(i=>i.status==='FAIL').flatMap(i=>i.ids).filter(id=>placed.has(id)))];
  return {phase:'checked',status:report.status,model,report,violationIds,placedIds:[...placed],message:null};
}
