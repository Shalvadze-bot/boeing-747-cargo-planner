import {makeResearchModel,validatePmcGeometry,fromLegacyPmcPlan,readPmcDecimal} from './pmc-geometry-validator.mjs';

export const DEFAULT_RESEARCH_SETTINGS = Object.freeze({gapMm:'0',offsetMm:'34.2',verticalMm:'0'});
export const RESEARCH_PROFILE_LABEL = 'Avianca Contour 1';
export const CONTOUR_OPTIMIZER = 'contour-v2';

export function researchModelFor(config, settings = DEFAULT_RESEARCH_SETTINGS) {
  const [gap,offset,vertical] = ['gapMm','offsetMm','verticalMm'].map(key=>readPmcDecimal(settings?.[key]));
  const maxPallets = readPmcDecimal(config?.maxPallets);
  if (![gap,offset,vertical].every(value=>Number.isFinite(value)&&value>=0) ||
      !Number.isSafeInteger(maxPallets) || maxPallets<1 || maxPallets>30 ||
      typeof config?.mirrored!=='boolean') return null;
  const base = makeResearchModel();
  return makeResearchModel({minHorizontalGapMm:gap,maxPallets,
    contour:{...base.contour,highEdgeOffsetMm:offset,verticalOffsetMm:vertical,mirrored:config.mirrored}});
}

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
  const model=researchModelFor(result.config,settings);
  if(!model)return pending('settings','Araştırma girdileri sıfır veya pozitif sayılar olmalı.');
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
