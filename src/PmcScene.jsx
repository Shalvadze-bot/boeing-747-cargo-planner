import { useId, useMemo, useRef, useState } from 'react';
import './pmc-scene.css';
import {lateralBounds} from './pmc-long-cargo.mjs';
import {contourHeight} from './pmc-engine.mjs';

const W = 243.84, L = 317.5, H = 243.84, M = 8.5;
const ISO = { yaw: -0.66, pitch: 0.48 };
const fmt = n => Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
const point = (x, y, z = 0) => [x, y, z];
const average = points => points.reduce((a, p) => a.map((v, i) => v + p[i] / points.length), [0, 0, 0]);
function shade(hex, factor) {
  if (!/^#[\da-f]{6}$/i.test(hex || '')) return hex || '#38bdf8';
  return '#' + [1, 3, 5].map(i => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * factor)).toString(16).padStart(2, '0')).join('');
}
function cuboid(x, y, z, w, l, h) {
  const p = [point(x,y,z),point(x+w,y,z),point(x+w,y+l,z),point(x,y+l,z),point(x,y,z+h),point(x+w,y,z+h),point(x+w,y+l,z+h),point(x,y+l,z+h)];
  return [
    { p: [p[0],p[1],p[5],p[4]], normal: [0,-1,0], light: .72 },
    { p: [p[1],p[2],p[6],p[5]], normal: [1,0,0], light: .87 },
    { p: [p[2],p[3],p[7],p[6]], normal: [0,1,0], light: .78 },
    { p: [p[3],p[0],p[4],p[7]], normal: [-1,0,0], light: .9 },
    { p: [p[4],p[5],p[6],p[7]], normal: [0,0,1], light: 1.13 },
  ];
}

export default function PmcScene({ onMoveCargo, placements = [], palletCount = 1, selectedPallet = null, selectedItemId, onSelectItem, mirrorContour = false, showContour = true, labels = true, showDimensions = true, heightCut = Infinity }) {
  const [moveMode,setMoveMode]=useState(false);
  const moveOrigins=useRef({});
  const id = useId().replace(/:/g, '');
  const [camera, setCamera] = useState(ISO);
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const moved = useRef(false);
  const count = Math.max(1, palletCount);
  const indices = selectedPallet == null ? Array.from({length: count}, (_, i) => i) : [selectedPallet];
  const visible = placements.filter(p => selectedPallet == null || p.palletIndex === selectedPallet || p.touchedPallets?.includes(selectedPallet) || (!p.overhang && p.y < (selectedPallet + 1) * L && p.y + p.l > selectedPallet * L));
  const selected = placements.find(p => p.id === selectedItemId);
  const limits=selected?lateralBounds(selected,mirrorContour):null;
  const validPosition=limits?.valid && selected.x>=limits.min-1e-6 && selected.x<=limits.max+1e-6;
  const units=n=>`${fmt(n)} cm / ${fmt(n/2.54)} in`;
  function moveTo(x){if(!selected || !limits?.valid || !Number.isFinite(x))return;if(moveOrigins.current[selected.id]==null)moveOrigins.current[selected.id]=selected.x;onMoveCargo?.(selected,Math.max(limits.min,Math.min(limits.max,x)));}
  const { project, depth, view } = useMemo(() => {
    const { yaw, pitch } = camera;
    const c = Math.cos(yaw), s = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const view = [cp*s,cp*c,sp];
    const raw = ([x,y,z]) => [c*x-s*y,sp*(s*x+c*y)-cp*z];
    const corners = [];
    indices.forEach(i => [0,W].forEach(x => [i*L,(i+1)*L].forEach(y => [0,H].forEach(z => corners.push(point(x,y,z))))));
    visible.forEach(p => [p.x,p.x+p.w].forEach(x => [p.y,p.y+p.l].forEach(y => [p.z,p.z+p.h].forEach(z => corners.push(point(x,y,z))))));
    const ps = corners.map(raw), xs = ps.map(p => p[0]), ys = ps.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min(740 / Math.max(1,maxX-minX), 355 / Math.max(1,maxY-minY)) * zoom;
    return { project: p => { const a = raw(p); return [450+(a[0]-(minX+maxX)/2)*scale,253+(a[1]-(minY+maxY)/2)*scale]; }, depth: p => p.reduce((a,v,i) => a+v*view[i],0), view };
  }, [camera, zoom, selectedPallet, count, placements]); // Scene framing also includes any real overhang.
  const pts = points => points.map(p => project(p).join(',')).join(' ');
  const faces = [];
  indices.forEach(i => {
    cuboid(0,i*L,-3,W,L,3).forEach((face,j) => faces.push({...face,key:`plate-${i}-${j}`,color:j===4?'#718096':'#38465c',plate:true}));
    // The amber area is physical edge clearance, not additional usable area.
    [[0,i*L,W,M],[0,(i+1)*L-M,W,M],[0,i*L+M,M,L-2*M],[W-M,i*L+M,M,L-2*M]].forEach(([x,y,w,l],j) => faces.push({p:[point(x,y,.12),point(x+w,y,.12),point(x+w,y+l,.12),point(x,y+l,.12)],normal:[0,0,1],light:1,color:'#e5ad36',key:`margin-${i}-${j}`,margin:true}));
  });
  visible.forEach(item => {
    const h = Math.min(item.h, heightCut-item.z);
    if (h <= 0) return;
    cuboid(item.x,item.y,item.z,item.w,item.l,h).forEach((face,j) => faces.push({...face,item,key:`${item.id}-${j}`,color:item.color || '#38bdf8'}));
  });
  const sorted = faces.filter(f => f.normal.reduce((a,n,i)=>a+n*view[i],0)>0.00001).sort((a,b)=>depth(average(a.p))-depth(average(b.p)));
  const select = item => { if (!moved.current) onSelectItem?.(item.id); };
  const reset = () => {setCamera(ISO);setZoom(1);};
  function line(a,b,props={}) { const p=project(a),q=project(b);return <line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} {...props}/>; }
  function dimension(a,b,text,key) { if (!showDimensions) return null; const p=project(a),q=project(b), mid=[(p[0]+q[0])/2,(p[1]+q[1])/2], lines=text.split("\n");return <g key={key} className="pmc-scene-dimension" data-dimension={key} aria-label={lines.join(" ")}>{line(a,b,{markerStart:`url(#${id}-arrow)`,markerEnd:`url(#${id}-arrow)`})}<text x={mid[0]} y={mid[1]-9-(lines.length-1)*13} textAnchor="middle">{lines.map((part,i)=><tspan key={i} x={mid[0]} dy={i?13:0}>{part}</tspan>)}</text></g>; }
  const first = indices[0];
  // Labels follow the same mirrored physical contour, not the inset base.
  const highX=mirrorContour?W:0, shoulderX=mirrorContour?W-100.33:100.33, lowX=mirrorContour?0:W;
  const highDimX=highX+(mirrorContour?18:-18), lowDimX=lowX+(mirrorContour?-22:22);
  return <section className="pmc-scene" aria-label="Üç boyutlu PMC yük yerleşimi">
    <div className="pmc-scene-toolbar"><div className="pmc-scene-view-buttons" role="group" aria-label="Kamera görünümü">
      <button type="button" onClick={reset} title="İzometrik görünüm">İzometrik</button>
      <button type="button" onClick={()=>{setCamera({yaw:0,pitch:.001});setZoom(1);}}>Ön</button>
      <button type="button" onClick={()=>{setCamera({yaw:0,pitch:Math.PI/2-.001});setZoom(1);}}>Üst</button>
    </div><div className="pmc-scene-zoom" role="group" aria-label="Yakınlaştırma">
      <button type="button" aria-label="Uzaklaştır" onClick={()=>setZoom(z=>Math.max(.55,z-.15))}>−</button><span>{Math.round(zoom*100)}%</span><button type="button" aria-label="Yakınlaştır" onClick={()=>setZoom(z=>Math.min(2.5,z+.15))}>+</button><button type="button" aria-label="Kamerayı sıfırla" title="Kamerayı sıfırla" onClick={reset}>↺</button>
    </div></div>
    {onMoveCargo && <div className="pmc-move-controls">
      <label><input type="checkbox" checked={moveMode} onChange={e=>{setMoveMode(e.target.checked);moveOrigins.current={};}}/> Yükü taşı · kamera sabit</label>
      {moveMode && (!selected?<p>Taşımak için yükü seçin. Yalnızca yüksek/alçak kenar yönünde hareket eder.</p>:<>
        <p>{selected.name} · Boyuna konum, taşma ve dönüş korunur.</p>
        {!limits?.valid?<p role="alert">Bu yük için kontur ve 8,5 cm taban sınırları içinde yatay yerleşim yok. {limits?.reason}</p>:<>
          {!validPosition && <p role="alert">Mevcut konum şematik kontur/taban sınırı dışında. Kontrolü kullanarak geçerli aralığa taşıyın.</p>}
          <label>Yatay X (cm)<input aria-label="Yatay X (cm)" type="number" step="0.1" min={limits.min} max={limits.max} value={Number(selected.x.toFixed(2))} onChange={e=>{if(e.target.value!=='')moveTo(Number(e.target.value));}}/></label>
          <input aria-label="Yükü yatay taşı" type="range" step="0.01" min={limits.min} max={limits.max} value={Math.max(limits.min,Math.min(limits.max,selected.x))} onChange={e=>moveTo(Number(e.target.value))}/>
          <p>Hareket: {units(selected.x-(moveOrigins.current[selected.id]??selected.x))} · Pozitif X fiziksel sağa</p>
          <p>Yüksek kenara kalan hareket: {validPosition?units(mirrorContour?limits.max-selected.x:selected.x-limits.min):'geçersiz konum'} · Alçak kenara kalan hareket: {validPosition?units(mirrorContour?selected.x-limits.min:limits.max-selected.x):'geçersiz konum'}</p>
          <p>Tabanda X=0 boşluğu: {units(selected.x)} · X=243,84 boşluğu: {units(W-selected.x-selected.w)}</p>
          <p>Üstte en az dikey kontur boşluğu: {units(Math.min(contourHeight(selected.x,mirrorContour),contourHeight(selected.x+selected.w,mirrorContour))-selected.z-selected.h)}</p>
        </>}
        <p>Yalnızca doğrulanmamış ZX-11 kesit geometrisi. Boyuna taşan kısımların komşu uçak konturları, destek, CG, kapı, limit ve bağlama doğrulanmadı. Uçuş/yükleme onayı değildir.</p>
      </>)}
    </div>}
    <div className="pmc-scene-canvas-wrap">
      <div className="pmc-scene-badge"><span/> {selectedPallet == null ? `${count} PMC · TÜM PALETLER` : `PMC ${selectedPallet+1} · YERLEŞİM`}</div>
      <svg className={dragging?'pmc-scene-canvas dragging':'pmc-scene-canvas'} viewBox="0 0 900 510" role="group" aria-labelledby={`${id}-title ${id}-desc`}
        onPointerDown={e=>{if(e.button!==0)return;moved.current=false;
          const itemId=e.target.closest?.('[data-item-id]')?.getAttribute('data-item-id');
          if(moveMode && onMoveCargo){const item=placements.find(p=>p.id===itemId);if(!item)return;onSelectItem?.(item.id);const bounds=lateralBounds(item,mirrorContour);if(!bounds.valid)return;
            const a=project([0,0,0]),b=project([1,0,0]);const rect=e.currentTarget.getBoundingClientRect();const scale=Math.min(rect.width/900,rect.height/510);const vx=(b[0]-a[0])*scale,vy=(b[1]-a[1])*scale;if(vx*vx+vy*vy<.01)return;
            moveOrigins.current[item.id]=item.x;drag.current={x:e.clientX,y:e.clientY,item,bounds,vx,vy};
          }else drag.current={x:e.clientX,y:e.clientY,camera,itemId};
          setDragging(true);e.currentTarget.setPointerCapture(e.pointerId);}}
        onPointerMove={e=>{if(!drag.current)return;const d=drag.current,dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.abs(dx)+Math.abs(dy)>5)moved.current=true;
          if(d.item){const x=d.item.x+(dx*d.vx+dy*d.vy)/(d.vx*d.vx+d.vy*d.vy);onMoveCargo?.(d.item,Math.max(d.bounds.min,Math.min(d.bounds.max,x)));}
          else setCamera({yaw:d.camera.yaw+dx*.008,pitch:Math.max(.04,Math.min(1.54,d.camera.pitch+dy*.006))});}}
        onPointerUp={e=>{if(!moved.current && drag.current?.itemId)onSelectItem?.(drag.current.itemId);drag.current=null;setDragging(false);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
        onPointerCancel={()=>{drag.current=null;setDragging(false);}}>
        <title id={`${id}-title`}>PMC paleti: 96 × 125 inç / 243,84 × 317,5 cm, ZX-11 konturu</title>
        <desc id={`${id}-desc`}>Döndürmek için sürükleyin. Bir yükü seçmek için tıklayın veya Tab ve Enter kullanın. Sarı şeritler dört yandaki 8,5 cm / yaklaşık 3,35 inç boşluğu gösterir. Planlama simülasyonudur.</desc>
        <defs><radialGradient id={`${id}-ground`}><stop offset="0" stopColor="#263a55" stopOpacity=".55"/><stop offset="1" stopColor="#142137" stopOpacity="0"/></radialGradient><marker id={`${id}-arrow`} viewBox="0 0 8 8" refX="4" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 8 0 L 0 4 L 8 8" fill="none" stroke="#8195b1" strokeWidth="1.2"/></marker></defs>
        <ellipse cx="450" cy="378" rx="355" ry="115" fill={`url(#${id}-ground)`}/>
        {sorted.map(f=><polygon key={f.key} data-item-id={f.item?.id} points={pts(f.p)} fill={shade(f.color,f.light)} fillOpacity={f.item && selectedPallet!=null && f.item.palletIndex!==selectedPallet ? .84 : 1} stroke={f.item?.id===selectedItemId?'#fff3ae':f.item?'#0e1728':f.margin?'#f3c75d':'#9aabc1'} strokeWidth={f.item?.id===selectedItemId?2.3:f.margin ? .5 : .8} strokeLinejoin="round" onClick={f.item?()=>select(f.item):undefined} className={f.item?'pmc-scene-box':undefined}><title>{f.item?`${f.item.name} · ${f.item.id} · ${fmt(f.item.w)} × ${fmt(f.item.l)} × ${fmt(f.item.h)} cm`:f.margin?'8,5 cm / ≈3,35″ kenar boşluğu':'PMC taban plakası'}</title></polygon>)}
        {showContour && indices.map(i=>{
          const contour = [[0,0],[0,H],[100.33,H],[W,104.14],[W,0]].map(([x,z])=>[mirrorContour?W-x:x,z]);
          return <g key={`contour-${i}`} className="pmc-scene-contour">{[i*L,(i+1)*L].map((y,k)=><polyline key={k} points={pts(contour.map(([x,z])=>point(x,y,z)))} />)}{contour.slice(1,4).map(([x,z],j)=> <g key={j}>{line(point(x,i*L,z),point(x,(i+1)*L,z),{strokeDasharray:'5 5'})}</g>)}</g>;
        })}
        {indices.map(i=>{const p=project(point(W/2,i*L+L/2,-7));return <g key={`label-${i}`} className="pmc-scene-pallet-label"><text x={p[0]} y={p[1]+26} textAnchor="middle">PMC {String(i+1).padStart(2,'0')}</text></g>;})}
        {visible.filter(p=>p.z<heightCut).map(item=>{const p=project(point(item.x+item.w/2,item.y+item.l/2,item.z+Math.min(item.h,heightCut-item.z)));return <g key={`select-${item.id}`} data-item-id={item.id} role="button" tabIndex={0} aria-label={`${item.name}, ${item.id}, ${fmt(item.w)} × ${fmt(item.l)} × ${fmt(item.h)} santimetre. Seç.`} aria-pressed={selectedItemId===item.id} className="pmc-scene-item-label" onClick={()=>select(item)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelectItem?.(item.id);}}} transform={`translate(${p[0]},${p[1]})`}><circle r="15" fill="transparent"/>{labels && <><rect x="-29" y="-12" width="58" height="22" rx="5" fill="#0a1427" fillOpacity=".84" stroke={selectedItemId===item.id?'#f5ca56':'#f8fafc'} strokeOpacity=".25"/><text textAnchor="middle" y="3">{String(item.id).length>9?String(item.id).slice(-9):item.id}</text></>}</g>;})}
        {visible.filter(b=>b.overhang).flatMap(b=>{const base=b.palletIndex*L, o=b.overhang, t=(edge,n)=>`${edge} ${fmt(n)} cm / ${fmt(n/2.54)}″`;return [
          o.front>0 && dimension(point(b.x+b.w+12,b.y,12),point(b.x+b.w+12,base,12),t('Sol kısa',o.front),`${b.id}-overhang-front`),
          o.rear>0 && dimension(point(b.x+b.w+12,base+L,12),point(b.x+b.w+12,b.y+b.l,12),t('Sağ kısa',o.rear),`${b.id}-overhang-rear`),
          o.left>0 && dimension(point(b.x,base+L/2,b.h+12),point(0,base+L/2,b.h+12),t('Ön uzun',o.left),`${b.id}-overhang-left`),
          o.right>0 && dimension(point(W,base+L/2,b.h+12),point(b.x+b.w,base+L/2,b.h+12),t('Arka uzun',o.right),`${b.id}-overhang-right`)
        ];})}
        {dimension(point(0,first*L-24),point(W,first*L-24),'96″ / 243,84 cm · X','dim-x')}
        {dimension(point(W+22,first*L),point(W+22,(first+1)*L),'125″ / 317,5 cm · Y','dim-y')}
        {camera.pitch<1.4 && dimension(point(highDimX,first*L,0),point(highDimX,first*L,H),'Yüksek kenar\n96″ / 243,84 cm · Z','dim-z')}
        {showContour && camera.pitch<1.4 && <>
          {dimension(point(highX,first*L-24,H+14),point(shoulderX,first*L-24,H+14),'Düz üst\n39,5″ / 100,33 cm','dim-flat')}
          {dimension(point(lowDimX,first*L-24,0),point(lowDimX,first*L-24,104.14),'Alçak kenar\n41″ / 104,14 cm','dim-low')}
        </>}
        {!visible.length && <text x="450" y="474" textAnchor="middle" className="pmc-scene-empty">Yük ekleyin; yerleşimi burada üç boyutlu görün.</text>}
      </svg>
      <div className="pmc-scene-hint">{moveMode && onMoveCargo?'↔ Yükü sürükleyerek yatay taşı · Kamera sabit':'↔ Sürükleyerek döndür · Yüke tıklayarak incele'}</div>
    </div>
    <div className="pmc-scene-legend"><span><i style={{background:'#e5ad36'}}/> 8,5 cm / ≈3,35″ kenar boşluğu</span><span><i className="wire"/> ZX-11 konturu</span><span>Kullanılabilir taban: 226,84 × 300,5 cm / ≈89,31 × 118,31″</span><span>1 inç = 2,54 cm · ≈ yuvarlanmış dönüşüm</span></div>
    {selected && <div className="pmc-scene-selection" aria-live="polite"><div><i style={{background:selected.color}}/><strong>{selected.name}</strong><span>{selected.id}</span></div><div><b>{fmt(selected.w)} × {fmt(selected.l)} × {fmt(selected.h)} cm</b><span>X {fmt(selected.x)} · Y {fmt(selected.y)} · Z {fmt(selected.z)} cm</span></div><div><span>{(selected.touchedPallets?.length?selected.touchedPallets:[selected.palletIndex]).map(i=>`PMC ${i+1}`).join(' + ')}</span>{selected.overhangCm>0 && <b className="pmc-scene-overhang">{fmt(selected.overhangCm)} cm taşma</b>}</div></div>}
    {selectedPallet!=null && visible.some(p=>p.palletIndex!==selectedPallet || p.y<selectedPallet*L || p.y+p.l>(selectedPallet+1)*L) && <p className="pmc-scene-note">Komşu palete taşan yükler tam boylarıyla gösterilir. Plaka dışındaki bölüm kullanılabilir taban değildir.</p>}
  </section>;
}
