import {PMC} from './pmc-engine.mjs';
const EPS=1e-6;
export const TECHNICAL_CHECKS = ['Kapı açıklığı ve kapıdan geçiş','Uçak içinde dönüş ve yerleştirme yolu','Gerçek pozisyon aralıkları ve konturları','Yükün desteği ve sehim/dayanım','Ağırlık merkezi ve devrilme','PMC, pozisyon ve zemin yük limitleri','Bağlama ve operatör onayı'];
/** Allowed transverse origin for a rectangular box under the UNVERIFIED schematic profile.
 * z+h is used, never a height-cut display setting. No aircraft/structural approval. */
export function lateralBounds(box,mirrored=false) {
  const {w,h,z=0}=box??{};
  const bad=reason=>({valid:false,min:null,max:null,reason});
  if(![w,h,z].every(Number.isFinite)||w<=0||h<=0||z<0)return bad('Geçerli genişlik, yükseklik ve taban yüksekliği gerekli.');
  const top=z+h;
  if(top>PMC.maxHeight+EPS)return bad('Yükün üstü şematik kontur yüksekliğini aşıyor.');
  const limit=top<=PMC.lowHeight?PMC.width:PMC.shoulderX+(PMC.maxHeight-top)*(PMC.width-PMC.shoulderX)/(PMC.maxHeight-PMC.lowHeight);
  const min=Math.max(PMC.margin,mirrored?PMC.width-limit:0);
  const max=Math.min(PMC.width-PMC.margin-w,mirrored?PMC.width-w:limit-w);
  if(max<min-EPS)return bad('8,5 cm taban payı ve yük yüksekliğinde kontur içinde yan hareket alanı yok.');
  return {valid:true,min,max:Math.max(min,max),reason:null};
}
/** Schematic equal-pitch positions only, NOT aircraft loading approval. */
export function longCargoCandidates(row) {
  const variants=row.allowRotation?[[row.width,row.length,false],[row.length,row.width,true]]:[[row.width,row.length,false]];
  return variants.flatMap(([w,l,rotated])=>['center','front','rear','left','right'].map(alignment=>{
    const x=alignment==='front'?PMC.margin:alignment==='rear'?PMC.width-PMC.margin-w:(PMC.width-w)/2;
    const y=alignment==='left'?PMC.margin:alignment==='right'?PMC.length-PMC.margin-l:(PMC.length-l)/2;
    return placementGeometry(x,y,w,l,row.height,rotated,alignment);
  }));
}
function placementGeometry(x,y,w,l,h,rotated,alignment) {
    const x0=Math.floor((x+EPS)/PMC.width),x1=Math.ceil((x+w-EPS)/PMC.width)-1;
    const y0=Math.floor((y+EPS)/PMC.length),y1=Math.ceil((y+l-EPS)/PMC.length)-1;
    const positions=[];
    for(let iy=y0;iy<=y1;iy++)for(let ix=x0;ix<=x1;ix++)positions.push({x:ix,y:iy,id:`S(${ix},${iy})`,support:ix===0&&iy===0});
    const overhang={left:Math.max(0,-x),right:Math.max(0,x+w-PMC.width),front:Math.max(0,-y),rear:Math.max(0,y+l-PMC.length)};
    const usableBoundaryExcess={left:Math.max(0,PMC.margin-x),right:Math.max(0,x+w-(PMC.width-PMC.margin)),front:Math.max(0,PMC.margin-y),rear:Math.max(0,y+l-(PMC.length-PMC.margin))};
    return {usableBoundaryExcess,x,y,w,l,h,z:0,rotated,alignment,positions,overhang,physicalPmcCount:1,positionCount:positions.length,blockedPositions:positions.filter(p=>!p.support),status:'TECHNICAL_VALIDATION_PENDING',flightApproved:false};
}
export function runLongCargo(rows,config={}) {
  const result={config:{...config,longCargo:true},positionModel:'INDEPENDENT_SCENARIOS_EQUAL_PITCH_NOT_AIRCRAFT_ALLOCATION',errors:[],warnings:['YALNIZCA TEST / GEOMETRİK ÖNİZLEME — uçuş veya yükleme onayı değildir.',...TECHNICAL_CHECKS.map(s=>s+': teknik bilgi / doğrulama bekliyor.')],placements:[],pallets:[],unplaced:[],summary:{requestedCount:0,placedCount:0,palletCount:0,physicalPmcCount:0,positionCount:0,knownWeightKg:0,unknownWeightCount:0}};
  if(!Array.isArray(rows)||rows.length>100){result.errors.push('En fazla 100 yük satırı.');return result;}
  const count=rows.reduce((s,r)=>s+r.quantity,0);
  if(!Number.isInteger(count)||count>200||rows.some(r=>!Number.isInteger(r.quantity)||r.quantity<1||['width','length','height'].some(k=>!Number.isFinite(r[k])||r[k]<=0||r[k]>10000)||(r.weight!=null&&(!Number.isFinite(r.weight)||r.weight<=0)))){result.errors.push('Geçerli pozitif ölçüler (en fazla 10.000 cm), adet (toplam en fazla 200) ve varsa ağırlık girin.');return result;}
  if(new Set(rows.map(r=>r.id)).size!==rows.length){result.errors.push('Yük kimlikleri benzersiz olmalı.');return result;}
  const max=Number(config.maxPallets??6);
  if(!Number.isInteger(max)||max<1||max>30){result.errors.push('Fiziksel PMC sınırı 1–30 olmalı.');return result;}
  const alignment=config.longCargoAlignment??'auto';
  if(!['auto','center','front','rear','left','right'].includes(alignment)){result.errors.push('Yerleşim seçimi geçersiz.');return result;}
  for(const r of rows)for(let i=0;i<r.quantity;i++){
    const id=`${r.id}:${i+1}`;result.summary.requestedCount++;
    if(result.placements.length>=max){result.unplaced.push({id,name:r.name,reason:'Her parça için ayrı tek destek PMC test senaryosu: fiziksel PMC sınırına ulaşıldı.'});continue;}
    const candidates=longCargoCandidates(r);
    const pool=candidates.filter(c=>alignment==='auto'||c.alignment===alignment);
    pool.sort((a,b)=>a.positionCount-b.positionCount||Number(a.rotated)-Number(b.rotated)||(['center','front','rear','left','right'].indexOf(a.alignment)-['center','front','rear','left','right'].indexOf(b.alignment)));
    let c=pool[0];
    const anchor=config.highEdgeAnchors?.[id];
    if(anchor && Number.isFinite(anchor.y) && Math.abs(anchor.y)<=10000 && anchor.y<PMC.length && anchor.y+anchor.l>0 && anchor.h===r.height && candidates.some(v=>v.w===anchor.w && v.l===anchor.l && v.rotated===anchor.rotated)){
      c=placementGeometry(config.mirrored?PMC.width-PMC.margin-anchor.w:PMC.margin,anchor.y,anchor.w,anchor.l,r.height,anchor.rotated,'high');
    } else if(anchor) result.warnings.push(id+': ölçüler/yön değişti; yüksek kenar hizalaması yeniden uygulanmalı.');
    const manual=config.manualXAnchors?.[id];
    if(manual) {
      const snapshotValid=Number.isFinite(manual.x)&&Number.isFinite(manual.y)&&Math.abs(manual.y)<=10000&&manual.y<PMC.length&&manual.y+manual.l>0&&manual.h===r.height&&candidates.some(v=>v.w===manual.w&&v.l===manual.l&&v.rotated===manual.rotated);
      const bounds=snapshotValid?lateralBounds(manual,!!config.mirrored):null;
      if(bounds?.valid) {
        const x=Math.max(bounds.min,Math.min(bounds.max,manual.x));
        c=placementGeometry(x,manual.y,manual.w,manual.l,r.height,manual.rotated,'manual');
        if(Math.abs(x-manual.x)>EPS)result.warnings.push(id+': yan konum şematik kontur ve 8,5 cm taban sınırına kısıtlandı.');
      } else result.warnings.push(id+': elle yan konum uygulanmadı; '+(bounds?.reason||'ölçüler/yön değişti veya konum geçersiz; yeniden yerleştirin.'));
    }
    const p=result.placements.length;
    const box={...c,id,rowId:r.id,name:r.name,color:r.color,weight:r.weight??null,stackable:false,palletIndex:p,touchedPallets:[p],localY:c.y,y:c.y+p*PMC.length,overhangCm:Math.max(...Object.values(c.overhang)),reviewRequired:true,supportId:null,supportIds:[],candidates,rationale:`${c.positionCount} şematik pozisyon; ${c.alignment==='manual'?'elle yan konum; boyuna konum ve dönüş korundu, yalnızca şematik kontur kontrolü':c.alignment==='high'?'yüksek kontur kenarına hizalı; mevcut boyuna konum ve dönüş korundu':alignment==='auto'?'izin verilen dönüşlerde en az pozisyon, eşitlikte döndürmeden ve ortalı yerleşim':'kullanıcının seçtiği yerleşim'}. Ağırlık merkezi optimizasyonu yapılmadı.`};
    result.placements.push(box);result.pallets.push({index:p,items:[box]});
    result.summary.positionCount+=c.positionCount;result.summary.knownWeightKg+=r.weight??0;result.summary.unknownWeightCount+=r.weight==null?1:0;
  }
  Object.assign(result.summary,{placedCount:result.placements.length,palletCount:result.pallets.length,physicalPmcCount:result.pallets.length,unplacedCount:result.unplaced.length});
  return result;
}
