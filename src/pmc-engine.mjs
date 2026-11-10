/** Upright-box heuristic simulator. All dimensions and world coordinates are cm.
 * runPacking(rows, config) never mutates inputs. Validation failures return errors.
 * Rows: {id,name,length,width,height,quantity,weight?,stackable?,allowRotation?,color?}.
 * weight is per item in kg; missing weights remain unknown, never certified zero.
 * y is global: pallet p starts at p * PMC.length. Overhang is forward-only.
 * Heuristic output is feasible under this simplified model, not an optimum or load approval.
 */
export const PMC = Object.freeze({width:243.84,length:317.5,margin:8.5,usableWidth:226.84,usableLength:300.5,maxHeight:243.84,shoulderX:100.33,lowHeight:104.14});
export const DEFAULT_CONFIG = Object.freeze({maxPallets:6,mirrored:false,allowOverhang:false,maxOverhangCm:null,minOverhangHeightCm:null});
export const SAMPLE_CARGO = Object.freeze([
  {id:'a',name:'Koli A',length:100,width:70,height:60,quantity:8,weight:25,stackable:true,allowRotation:true,color:'#f4c44e'},
  {id:'b',name:'Koli B',length:80,width:50,height:45,quantity:10,weight:15,stackable:true,allowRotation:true,color:'#60a5fa'},
  {id:'c',name:'Dik yük',length:90,width:65,height:180,quantity:2,weight:90,stackable:false,allowRotation:true,color:'#c084fc'},
]);
const EPS=1e-6, COLORS=['#f4c44e','#60a5fa','#c084fc','#34d399','#fb7185','#fb923c'];
const PROFILE=Object.freeze({name:'ZX-11',source:'Kullanıcının sağladığı kontur görseli: 96 / 39,5 / 56,5 / 41 inç',status:'Doğrulanmamış simülasyon geometrisi; sertifikalı operasyon limiti değildir.',points:[[0,243.84],[100.33,243.84],[243.84,104.14]]});
export function contourHeight(x,mirrored=false){const t=mirrored?PMC.width-x:x;return t<=PMC.shoulderX?PMC.maxHeight:PMC.maxHeight-(t-PMC.shoulderX)*(PMC.maxHeight-PMC.lowHeight)/(PMC.width-PMC.shoulderX);}
const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const between=(a,b)=>a<=b+EPS;
const overlaps=(a,b)=>a.x<b.x+b.w-EPS&&a.x+a.w>b.x+EPS&&a.y<b.y+b.l-EPS&&a.y+a.l>b.y+EPS&&a.z<b.z+b.h-EPS&&a.z+a.h>b.z+EPS;
const orientations=r=>r.allowRotation&&r.width!==r.length?[[r.width,r.length],[r.length,r.width]]:[[r.width,r.length]];
const unique=a=>[...new Set(a.map(n=>Math.round(n*1e6)/1e6))];
function validate(rows,config){
 const errors=[], c={...DEFAULT_CONFIG,...config};
 if(!Number.isInteger(c.maxPallets)||c.maxPallets<1||c.maxPallets>30)errors.push('Palet sınırı 1–30 arasında tam sayı olmalı.');
 for(const k of ['mirrored','allowOverhang'])if(typeof c[k]!=='boolean')errors.push(`${k}: doğru/yanlış değeri gerekli.`);
 if(c.allowOverhang&&(!positive(c.maxOverhangCm)||!positive(c.minOverhangHeightCm)))errors.push('Taşma için pozitif azami taşma ve asgari yükseklik değerlerini girin.');
 for(const k of ['maxOverhangCm','minOverhangHeightCm'])if(c[k]!=null&&!positive(c[k]))errors.push(`${k}: pozitif sonlu sayı gerekli.`);
 if(c.allowOverhang&&c.maxOverhangCm>PMC.length)errors.push('Bu prototip yalnızca bir sonraki palete taşmayı destekler (en fazla 317,5 cm).');
 if(!Array.isArray(rows)||rows.length>100){errors.push('En fazla 100 yük satırı girin.');return {errors,c,rows:[]};}
 let count=0; const ids=new Set();const normalized=[];
 rows.forEach((r,i)=>{
 if(!r||typeof r!=='object'){errors.push(`${i+1}. satır geçersiz.`);return;}
 const id=String(r.id??`row-${i+1}`);if(ids.has(id))errors.push(`${i+1}. satır: yük kimliği tekrarlanıyor.`);ids.add(id);
 for(const k of ['length','width','height'])if(!positive(r[k]))errors.push(`${i+1}. satır ${{length:'uzunluk',width:'genişlik',height:'yükseklik'}[k]}: pozitif sonlu sayı gerekli.`);
 if(!Number.isInteger(r.quantity)||r.quantity<1||r.quantity>200)errors.push(`${i+1}. satır: adet 1–200 arasında tam sayı olmalı.`);else count+=r.quantity;
 if(r.weight!=null&&!positive(r.weight))errors.push(`${i+1}. satır: birim ağırlık pozitif sonlu sayı olmalı.`);
 for(const k of ['stackable','allowRotation'])if(r[k]!=null&&typeof r[k]!=='boolean')errors.push(`${i+1}. satır ${k}: doğru/yanlış değeri gerekli.`);
 normalized.push({...r,id,name:String(r.name||`Yük ${i+1}`),stackable:r.stackable??true,allowRotation:r.allowRotation??true,color:r.color||COLORS[i%COLORS.length]});
 });
 if(count>200)errors.push('Bu etkileşimli prototip tek hesapta en fazla 200 parça destekler.');
 return {errors,c,rows:normalized};
}
/** Geometric contact only: union of stackable, coplanar top faces must cover
 * the whole footprint. This does not establish carton strength or load capacity.
 * Sweep each x strip and merge y intervals, so holes and overlapping rectangles
 * cannot be mistaken for complete support by an area sum or corner-only test.
 */
export function supportCoverage(box, placements) {
 const contacts=placements.filter(b=>b.stackable&&Math.abs(b.z+b.h-box.z)<=EPS&&box.x<b.x+b.w-EPS&&box.x+box.w>b.x+EPS&&box.y<b.y+b.l-EPS&&box.y+box.l>b.y+EPS)
  .map(b=>({id:b.id,x0:Math.max(box.x,b.x),x1:Math.min(box.x+box.w,b.x+b.w),y0:Math.max(box.y,b.y),y1:Math.min(box.y+box.l,b.y+b.l)}))
  .filter(r=>r.x1-r.x0>EPS&&r.y1-r.y0>EPS);
 const supportIds=contacts.map(r=>r.id);
 const xs=[...new Set([box.x,box.x+box.w,...contacts.flatMap(r=>[r.x0,r.x1])])].sort((a,b)=>a-b);
 for(let i=0;i<xs.length-1;i++){
  if(xs[i+1]-xs[i]<=EPS)continue;
  const intervals=contacts.filter(r=>r.x0<=xs[i]+EPS&&r.x1>=xs[i+1]-EPS).sort((a,b)=>a.y0-b.y0);
  let covered=box.y;
  for(const r of intervals){if(r.y0>covered+EPS)break;covered=Math.max(covered,r.y1);}
  if(covered<box.y+box.l-EPS)return {fullySupported:false,supportIds};
 }
 return {fullySupported:contacts.length>0,supportIds};
}
function* candidatePoints(grids,z){
 const ys=[...new Set(grids.flatMap(g=>[...g.ys]))].sort((a,b)=>a-b);
 const xOrders=new Map();
 for(const y of ys){
  const mask=grids.reduce((m,g,i)=>g.ys.has(y)?m|(1<<i):m,0);
  const active=grids.filter((g,i)=>mask&(1<<i));
  if(!xOrders.has(mask))xOrders.set(mask,[...new Set(active.flatMap(g=>[...g.xs]))].sort((a,b)=>a-b));
  const xs=xOrders.get(mask);
  for(const x of xs)for(const g of active)if(g.xs.has(x))yield {x,y,z,w:g.w,l:g.l};
 }
}
function pack(items,c){
 const placements=[],unplaced=[];let allocated=0;
 for(const item of items){
 let chosen=null;
 for(let p=0;p<c.maxPallets&&!chosen;p++){
  const start=p*PMC.length+PMC.margin,end=(p+1)*PMC.length-PMC.margin;
  const local=placements.filter(b=>b.touchedPallets.includes(p));
  const supports=local.filter(b=>b.stackable&&b.palletIndex===p);
  const levels=unique([0,...supports.map(b=>b.z+b.h)]).sort((a,b)=>a-b);
  // Try low levels first, then front/left positions. At each level, combine
  // support and obstacle edges rather than anchoring only to one carton.
  for(const z of levels){
   if(chosen)break;
   const surface=supports.filter(b=>Math.abs(b.z+b.h-z)<=EPS);
   const edges=local.filter(b=>Math.abs(b.z+b.h-z)<=EPS||(b.z<z+item.height-EPS&&b.z+b.h>z+EPS));
   const blockers=local.filter(b=>b.z<z+item.height-EPS&&b.z+b.h>z+EPS);
   const rowBlockers=new Map(),rowSupports=new Map();
   const grids=[];
   for(const [w,l] of orientations(item)){
    const xs=unique([PMC.margin,PMC.width-PMC.margin-w,...edges.flatMap(b=>z===0?[b.x+b.w,b.x-w]:[b.x,b.x+b.w-w,b.x+b.w,b.x-w])])
     .filter(x=>between(PMC.margin,x)&&between(x+w,PMC.width-PMC.margin));
    const ys=unique([start,end-l,...edges.flatMap(b=>z===0?[b.y+b.l,b.y-l]:[b.y,b.y+b.l-l,b.y+b.l,b.y-l])])
     .filter(y=>between(start,y)&&(c.allowOverhang||between(y+l,end)));
    grids.push({w,l,xs:new Set(xs),ys:new Set(ys)});
   }
   // Walk ordered coordinates lazily: allocating and sorting every x/y pair
   // is costly for the supported 200-piece mixed-dimension workload.
   for(const a of candidatePoints(grids,z)){
    if(!between(a.z+item.height,Math.min(contourHeight(a.x,c.mirrored),contourHeight(a.x+a.w,c.mirrored))))continue;
    // Most edge combinations are occupied. Reject them before the more
    // expensive union-of-supports calculation, using every neighboring box.
    const rowKey=`${a.y}:${a.l}`;
    if(!rowBlockers.has(rowKey))rowBlockers.set(rowKey,blockers.filter(b=>a.y<b.y+b.l-EPS&&a.y+a.l>b.y+EPS));
    if(rowBlockers.get(rowKey).some(b=>a.x<b.x+b.w-EPS&&a.x+a.w>b.x+EPS))continue;
    const overhang=Math.max(0,a.y+a.l-end);let touched=[p],supportIds=[];
    if(overhang>EPS){
     if(!c.allowOverhang||a.z<c.minOverhangHeightCm-EPS||overhang>c.maxOverhangCm+EPS||p+1>=c.maxPallets)continue;
     // Preserve the existing, explicit partial-support prototype exception.
     // It must reach the next usable deck and have one original support whose
     // full width contains it, using its original corner anchors. Shared
     // support does not relax overhang rules or add partial-support starts.
     if(a.y+a.l<=(p+1)*PMC.length+PMC.margin+EPS||a.y>=end-EPS||a.y+a.l>(p+2)*PMC.length-PMC.margin+EPS)continue;
     const b=surface.find(b=>(Math.abs(a.x-b.x)<=EPS||Math.abs(a.x-(b.x+b.w-a.w))<=EPS)&&(Math.abs(a.y-b.y)<=EPS||Math.abs(a.y-(b.y+b.l-a.l))<=EPS)&&a.x>=b.x-EPS&&a.x+a.w<=b.x+b.w+EPS&&a.y>=b.y-EPS&&Math.min(b.y+b.l,a.y+a.l,end)>a.y+EPS);
     if(!b)continue;
     supportIds=[b.id];touched=[p,p+1];
    }else if(a.z>EPS){
     if(!rowSupports.has(rowKey))rowSupports.set(rowKey,surface.filter(b=>a.y<b.y+b.l-EPS&&a.y+a.l>b.y+EPS));
     const support=supportCoverage(a,rowSupports.get(rowKey));
     if(!support.fullySupported)continue;
     supportIds=support.supportIds;
    }
    const box={id:item.instanceId,rowId:item.id,name:item.name,color:item.color,x:a.x,y:a.y,z:a.z,w:a.w,l:a.l,h:item.height,weight:item.weight??null,stackable:item.stackable,palletIndex:p,touchedPallets:touched,overhangCm:overhang,reviewRequired:overhang>EPS,supportIds,supportId:supportIds.length===1?supportIds[0]:null,rotated:Math.abs(a.w-item.width)>EPS};
    if(overhang>EPS&&placements.some(b=>overlaps(box,b)))continue;
    chosen=box;break;
   }
  }
 }
 if(chosen){placements.push(chosen);allocated=Math.max(allocated,...chosen.touchedPallets.map(p=>p+1));}
 else unplaced.push({id:item.instanceId,rowId:item.id,name:item.name,quantity:1,reason:'Kontur, taban, destek veya palet sınırları içinde bu sezgisel sırada yer bulunamadı; imkânsızlık kanıtı değildir.'});
 }
 return {placements,unplaced,allocated};
}
/** Returns placements in global cm coordinates; pallet.items references all intersecting
 * items, including incoming overhang reservations. summary counts each item once.
 * Pallet volume metrics clip incoming/outgoing overhang at physical deck boundaries;
 * weight is NOT apportioned to pallets: structural load distribution is unknown.
 */
export function runPacking(inputRows,config={}){
 const invalidConfig=config===null||typeof config!=='object'||Array.isArray(config);
 const {errors,c,rows}=validate(inputRows,invalidConfig?{}:config);
 if(invalidConfig)errors.push('Ayarlar bir nesne olmalı.');
 const warnings=['SIMÜLASYON: ZX-11 görseli sertifikalı limit değildir. Uçak uyumu, ağırlık merkezi, dayanım, sabitleme ve operatör onayı ayrıca doğrulanmalıdır.','Sezgisel yerleşim: en az palet sayısı veya en iyi yerleşim garanti edilmez.','Palet taşıma kapasitesi ve taban yükü limiti uygulanmaz; ağırlık yalnızca bilgilendirme toplamıdır.','Üst üste yerleşimde aynı yükseklikteki bir veya birden fazla istiflenebilir kutunun ortak yüzeyi tam taban desteği sağlamalıdır. Bu yalnızca geometrik destektir; ezilme dayanımı ve yük taşıma kapasitesi hesaplanmaz.'];
 const result={config:c,profile:{...PROFILE,mirrored:c.mirrored},errors,warnings,placements:[],pallets:[],unplaced:[],summary:{requestedCount:0,placedCount:0,unplacedCount:0,palletCount:0,volumeM3:0,knownWeightKg:0,unknownWeightCount:0,overhangCount:0}};
 if(errors.length)return result;
 const items=rows.flatMap(r=>Array.from({length:r.quantity},(_,i)=>({...r,instanceId:`${r.id}:${i+1}`})));
 const orders=[(a,b)=>b.length*b.width*b.height-a.length*a.width*a.height,(a,b)=>b.height-a.height||b.width*b.length-a.width*a.length,(a,b)=>b.width*b.length-a.width*a.length||b.height-a.height];
 let best=null;
 for(const sort of orders){const run=pack([...items].sort(sort),c);if(!best||run.unplaced.length<best.unplaced.length||(run.unplaced.length===best.unplaced.length&&run.allocated<best.allocated))best=run;}
 const {placements,unplaced,allocated}=best;result.placements=placements;result.unplaced=unplaced;
 result.pallets=Array.from({length:allocated},(_,index)=>{const parts=placements.filter(b=>b.touchedPallets.includes(index));return {index,items:parts,metrics:{itemCount:parts.length,originatingCount:parts.filter(b=>b.palletIndex===index).length,maxHeight:Math.max(0,...parts.map(b=>b.z+b.h)),volumeM3:parts.reduce((s,b)=>s+b.w*b.h*Math.max(0,Math.min(b.y+b.l,(index+1)*PMC.length)-Math.max(b.y,index*PMC.length))/1e6,0),reviewRequired:parts.some(b=>b.reviewRequired)}};});
 result.summary={requestedCount:items.length,placedCount:placements.length,unplacedCount:unplaced.length,palletCount:allocated,volumeM3:placements.reduce((s,b)=>s+b.w*b.l*b.h/1e6,0),knownWeightKg:placements.reduce((s,b)=>s+(b.weight??0),0),unknownWeightCount:placements.filter(b=>b.weight===null).length,overhangCount:placements.filter(b=>b.reviewRequired).length};
 if(result.summary.unknownWeightCount)warnings.push('Bazı yerleşen yüklerin ağırlığı girilmedi; gösterilen ağırlık yalnızca bilinen kalemlerin toplamıdır.');
 if(c.allowOverhang)warnings.push('Taşma prototipi: kullanıcı sınırları operasyon onayı değildir. Kısmi destek, devrilme, sehim ve yük dağılımı doğrulanmaz; her taşan parça ayrıca inceleme gerektirir. Komşu palet hacmi ayrılmıştır.');
 return result;
}
