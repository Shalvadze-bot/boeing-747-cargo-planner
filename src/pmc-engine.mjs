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
function pack(items,c){
 const placements=[],unplaced=[];let allocated=0;
 for(const item of items){
 let chosen=null;
 for(let p=0;p<c.maxPallets&&!chosen;p++){
 const start=p*PMC.length+PMC.margin,end=(p+1)*PMC.length-PMC.margin;
 const local=placements.filter(b=>b.touchedPallets.includes(p));
 const candidates=[];
 for(const [w,l] of orientations(item)){
 const xs=unique([PMC.margin,PMC.width-PMC.margin-w,...local.flatMap(b=>[b.x+b.w,b.x-w])]);
 const ys=unique([start,end-l,...local.flatMap(b=>[b.y+b.l,b.y-l])]);
 for(const x of xs)for(const y of ys)candidates.push({x,y,z:0,w,l,support:null});
 for(const b of local.filter(b=>b.stackable&&b.palletIndex===p)){
 for(const x of unique([b.x,b.x+b.w-w]))for(const y of unique([b.y,b.y+b.l-l]))candidates.push({x,y,z:b.z+b.h,w,l,support:b});
 }
 }
 candidates.sort((a,b)=>a.z-b.z||a.y-b.y||a.x-b.x);
 for(const a of candidates){
 if(!between(PMC.margin,a.x)||!between(a.x+a.w,PMC.width-PMC.margin)||!between(start,a.y))continue;
 if(!between(a.z+item.height,Math.min(contourHeight(a.x,c.mirrored),contourHeight(a.x+a.w,c.mirrored))))continue;
 const overhang=Math.max(0,a.y+a.l-end);let touched=[p];
 if(overhang>EPS){
 if(!c.allowOverhang||a.z<c.minOverhangHeightCm-EPS||!a.support||overhang>c.maxOverhangCm+EPS||p+1>=c.maxPallets)continue;
 // Must actually reach the next usable deck, not stop inside its margin/gap.
 if(a.y+a.l<=(p+1)*PMC.length+PMC.margin+EPS||a.y>=end-EPS||a.y+a.l>(p+2)*PMC.length-PMC.margin+EPS)continue;
 touched=[p,p+1];
 }else if(!between(a.y+a.l,end))continue;
 if(a.z>EPS){
 const b=a.support;if(!b||a.x<b.x-EPS||a.x+a.w>b.x+b.w+EPS||a.y<b.y-EPS)continue;
 if(overhang<=EPS&&a.y+a.l>b.y+b.l+EPS)continue;
 // Explicit prototype exception: support must overlap the originating deck;
 // no stability or minimum support fraction is inferred from this geometry.
 if(overhang>EPS&&Math.min(b.y+b.l,a.y+a.l,end)<=a.y+EPS)continue;
 }
 const box={id:item.instanceId,rowId:item.id,name:item.name,color:item.color,x:a.x,y:a.y,z:a.z,w:a.w,l:a.l,h:item.height,weight:item.weight??null,stackable:item.stackable,palletIndex:p,touchedPallets:touched,overhangCm:overhang,reviewRequired:overhang>EPS,supportId:a.support?.id??null,rotated:Math.abs(a.w-item.width)>EPS};
 if(placements.some(b=>overlaps(box,b)))continue;
 chosen=box;break;
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
 const warnings=['SIMÜLASYON: ZX-11 görseli sertifikalı limit değildir. Uçak uyumu, ağırlık merkezi, dayanım, sabitleme ve operatör onayı ayrıca doğrulanmalıdır.','Sezgisel yerleşim: en az palet sayısı veya en iyi yerleşim garanti edilmez.','Palet taşıma kapasitesi ve taban yükü limiti uygulanmaz; ağırlık yalnızca bilgilendirme toplamıdır.','Üst üste yerleşimde tek bir istiflenebilir kutunun tam taban desteği aranır; ezilme dayanımı hesaplanmaz.'];
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
