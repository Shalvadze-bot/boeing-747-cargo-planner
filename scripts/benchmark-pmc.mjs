import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PMC, runPacking } from '../src/pmc-engine.mjs';
import { normalizePmcInput } from '../src/pmc-search-strategies.mjs';
import { runContourPacking, DEFAULT_CONTOUR_CANDIDATE_LIMIT } from '../src/pmc-contour-optimizer.mjs';
import { assessResearchPlan, DEFAULT_RESEARCH_SETTINGS, researchModelFor } from '../src/pmc-research-review.mjs';
import { fromLegacyPmcPlan } from '../src/pmc-geometry-validator.mjs';
import { baseSpace, contourRoof, researchEnvelopeMm3, subtractPlacement } from '../src/pmc-contour-space.mjs';

const {values}=parseArgs({options:{
  project:{type:'string'},engine:{type:'string'},runs:{type:'string',default:'9'},
  'candidate-limit':{type:'string',default:String(DEFAULT_CONTOUR_CANDIDATE_LIMIT)},
}});
const repetitions=Number(values.runs), candidateLimit=Number(values['candidate-limit']);
if (!Number.isSafeInteger(repetitions)||repetitions<1||repetitions>100||
    !Number.isSafeInteger(candidateLimit)||candidateLimit<1||
    values.engine&&!['legacy','v2'].includes(values.engine)) throw Error('Geçersiz karşılaştırma ayarı.');

const row=(id,values)=>({id,quantity:1,stackable:false,allowRotation:false,...values});
const exact=[row('area-proof',{width:113,length:150,height:90,quantity:5})];

// One cargo row per synthetic shipping package. The internal product quantity
// is descriptive and never used to multiply the packing units.
const groups=Array.from({length:50},(_,i)=>({
  id:'synthetic-'+(i+1),internalPieces:i===0?5:4,
  width:58+(i*17)%55,length:85+(i*29)%90,height:60+(i*37)%93,
  grossKg:i===19?650:700+(i*41)%350,netKg:i===19?700:620+(i*41)%350,
}));
const questionable=groups.filter(group=>group.grossKg<group.netKg);
const heavy=groups.map(({id,width,length,height,grossKg,netKg})=>
  row(id,{width,length,height,weight:grossKg>=netKg?grossKg:null,allowRotation:true}));

const cases=[
  {id:'exact-synthetic',rows:exact,maxPallets:2,gapMm:5},
  {id:'heavy-synthetic',rows:heavy,maxPallets:13,gapMm:2.5},
];
if(values.project){
  const copy=JSON.parse(readFileSync(values.project,'utf8'));
  const state=copy.payload?.pmc??copy.input;
  if(!Array.isArray(state?.rows)||!state.rows.every(r=>typeof r.allowRotation==='boolean')){
    throw Error('Proje satırları ya da açık yatay yön izinleri eksik.');
  }
  for(const gapMm of [0,2.5,2.6]) cases.push({id:'local-project-copy',rows:state.rows,
    maxPallets:Number(state.config?.maxPallets),mirrored:!!state.config?.mirrored,gapMm});
}

function matchedLegacy(rows,config,model){
  if(Math.abs(model.usable.widthMm-PMC.usableWidth*10)>model.numericalToleranceMm ||
      Math.abs(model.usable.lengthMm-PMC.usableLength*10)>model.numericalToleranceMm) {
    throw Error('Eski motor ve araştırma tabanı karşılaştırılamıyor.');
  }
  const normalized=normalizePmcInput(rows,config);
  const {points,verticalOffsetMm,highEdgeOffsetMm}=model.contour;
  const roofHeightCm=(physicalX,mirrored)=>{
    const u=physicalX*10-model.usable.xMm;
    const x=highEdgeOffsetMm+(mirrored?model.usable.widthMm-u:u);
    return (contourRoof(points,x)-verticalOffsetMm)/10;
  };
  return runPacking(normalized.rows,normalized.config,undefined,{
    roofHeightCm,gapCm:model.minHorizontalGapMm/10,candidateLimit,
  });
}

function residualRatio(result,rows,model){
  const {placements}=fromLegacyPmcPlan(rows,result,model);
  const [gap,tol]=[model.minHorizontalGapMm,model.numericalToleranceMm];
  const total=result.pallets.reduce((sum,pallet)=>{
    const spaces=placements.filter(box=>box.palletIndex===pallet.index)
      .reduce((free,box)=>subtractPlacement(free,box,gap,tol),[baseSpace(model)]);
    return sum+Math.max(0,...spaces.map(space=>space.w*space.l));
  },0);
  return total/1e6;
}

const median = numbers => {
  const sorted=[...numbers].sort((a,b)=>a-b);
  const center=Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[center] : (sorted[center-1]+sorted[center])/2;
};

function benchmark(engine,{id,rows,maxPallets,mirrored=false,gapMm}){
  const researchSettings={...DEFAULT_RESEARCH_SETTINGS,gapMm};
  const config={maxPallets,mirrored,allowOverhang:false,researchSettings};
  const model=researchModelFor(config,researchSettings);
  if(!model)throw Error('Karşılaştırma modeli oluşturulamadı.');
  const launch=()=>engine==='legacy'?matchedLegacy(rows,config,model):runContourPacking(rows,config,{candidateLimit});
  launch();
  launch();
  const elapsed=[], memory=[], layouts=new Set();
  let measurements;
  for(let i=0;i<repetitions;i++){
    globalThis.gc?.();
    const heap=process.memoryUsage().heapUsed, started=performance.now();
    const plan=launch();
    if(plan.errors.length)throw Error(plan.errors.join(' '));
    const audit=assessResearchPlan({rows,result:plan,settings:researchSettings});
    elapsed.push(performance.now()-started);
    memory.push((process.memoryUsage().heapUsed-heap)/1024);
    const signature=JSON.stringify(plan.placements.map(p=>[p.id,p.palletIndex,p.x,p.y,p.z,p.w,p.l,p.h]));
    layouts.add(signature);
    if(!measurements){
      const {placedCount:placed,unplacedCount:unplaced,palletCount:pmcs,volumeM3}=plan.summary;
      const footprint=pmcs*model.usable.widthMm*model.usable.lengthMm;
      const envelope=pmcs*researchEnvelopeMm3(model);
      const diagnostics=plan.optimizer??plan.comparison;
      measurements={id,gapMm,maxPallets,placed,unplaced,pmcs,validation:audit.status,
        complete:audit.report?.complete??false,clearanceMm:audit.report?.minVerticalMarginMm??null,
        footprintUtilization:footprint?plan.placements.reduce((sum,p)=>sum+p.w*p.l*100,0)/footprint:0,
        volumeUtilization:envelope?volumeM3*1e9/envelope:0,
        largestResidualAreaTotalM2:residualRatio(plan,rows,model),
        generatedCandidates:diagnostics.generatedCandidates,rejectedCandidates:diagnostics.rejectedCandidates};
    }
  }
  return {...measurements,reproducible:layouts.size===1,medianMs:median(elapsed),medianHeapDeltaKiB:median(memory)};
}

if(values.engine){
  const results=cases.map(scenario=>benchmark(values.engine,scenario));
  console.log(JSON.stringify({engine:values.engine,processPeakRssKiB:process.resourceUsage().maxRSS,results}));
}else{
  const script=fileURLToPath(import.meta.url);
  const args=['--runs',String(repetitions),'--candidate-limit',String(candidateLimit)];
  if(values.project)args.push('--project',values.project);
  const engines=['legacy','v2'].map(engine=>JSON.parse(execFileSync(process.execPath,
    ['--expose-gc',script,'--engine',engine,...args],{encoding:'utf8'})));
  console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,repetitions,candidateLimit,
    syntheticPackageHierarchy:{packages:groups.length,internalPieces:groups.reduce((sum,p)=>sum+p.internalPieces,0),
      disputedGrossCount:questionable.length,disputedGrossUsedAsWeight:false},engines},null,2));
}
