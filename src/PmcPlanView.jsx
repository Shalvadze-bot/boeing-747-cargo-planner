import React from 'react';
import { PMC } from './pmc-engine.mjs';
import { balanceProfile, measurePmcBalance } from './pmc-long-balance.mjs';
import { modelCapacity } from './pmc-ai-validation.mjs';
import { researchEnvelopeMm3, researchSectionCm } from './pmc-contour-space.mjs';
import { RESEARCH_PROFILE_LABEL } from './pmc-research-review.mjs';
import PmcScene from './PmcScene';

const fmt = (n, d=1) => Number.isFinite(n) ? n.toLocaleString('tr-TR',{maximumFractionDigits:d}) : '—';
const port = item => 'PMC ' + (item + 1);
const orientation = {
  upright:'Dik', 'side-width':'Genişlik yüzeyi', 'side-length':'Uzunluk yüzeyi',
};

export function ViewSwitch({ view, onChange, label='Plan görünümü' }) {
  return <div className="view-toggle ai-view-switch" role="group" aria-label={label}>
    {['2D','3D'].map(mode => <button key={mode} type="button" aria-pressed={view===mode}
      className={view===mode?'active':''} onClick={() => onChange(mode)}>{mode}</button>)}
  </div>;
}

function PmcFloorView({ result, pallet, itemId, onItem, onPallet, labels=true, heightCut=Infinity, placementAction, researchViolationIds=[], showContour=true }) {
  const indices = pallet == null ? result.pallets.map(p => p.index) : [pallet];
  const items = result.placements.filter(p => p.z < heightCut && (pallet == null ||
    p.palletIndex === pallet || p.touchedPallets?.includes(pallet)));
  const order = [...items].sort((a,b) => Number(a.id===itemId)-Number(b.id===itemId) || a.z-b.z);
  const minX = Math.min(0,...items.map(i=>i.x)) - 13;
  const maxX = Math.max(PMC.width,...items.map(i=>i.x+i.w)) + 13;
  const minY = Math.min(...indices.map(i=>i*PMC.length),...items.map(i=>i.y),indices.length?Infinity:0) - 15;
  const maxY = Math.max(...indices.map(i=>(i+1)*PMC.length),...items.map(i=>i.y+i.l),indices.length?-Infinity:PMC.length) + 15;
  const layout = [minX,minY,maxX-minX,maxY-minY].join(' ');
  const projection = result.researchModel && showContour ? researchSectionCm(result.researchModel) : [];
  const activate = (event, callback) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); callback(); }
  };
  return <div className="pmc-floor">
    {placementAction && <div className="pmc-floor-actions">{placementAction}</div>}
    <svg viewBox={layout} role="group" aria-label={'PMC yerleşimi, 2D üst görünüm'+(result.researchModel?' · '+RESEARCH_PROFILE_LABEL:'')}>
      {indices.map(index => <g key={index} role="button" tabIndex={0} aria-label={port(index)+' ayrıntıları'}
        onClick={()=>onPallet?.(index)} onKeyDown={event=>activate(event,()=>onPallet?.(index))}>
        <rect x={0} y={index*PMC.length} width={PMC.width} height={PMC.length} rx={3} fill="#233346"
          stroke="#8398af" strokeWidth={1.6}/>
        <rect x={PMC.margin} y={index*PMC.length+PMC.margin} width={PMC.usableWidth} height={PMC.usableLength}
          fill="none" stroke="#ffcf68" strokeWidth={1.3} strokeDasharray="4 3"/>
        {projection.map(([x],i)=><line key={i} data-research-projection={i} x1={x} x2={x}
          y1={index*PMC.length} y2={(index+1)*PMC.length} stroke="#a9c9eb" strokeOpacity=".65" strokeDasharray="4 3"/>)}
        <text x={4} y={index*PMC.length-3} fill="#c7d5e1" fontSize={7}>{port(index)}</text>
      </g>)}
      {order.map(item => <g key={item.id} role="button" tabIndex={0} aria-pressed={item.id===itemId}
        aria-label={item.name+', '+item.id} onClick={()=>onItem(item.id)} onKeyDown={event=>activate(event,()=>onItem(item.id))}>
        <rect x={item.x} y={item.y} width={item.w} height={item.l} rx={1.5}
          fill={item.color||'#6288a6'} fillOpacity={item.id===itemId?0.98:0.68}
          data-research-violation={researchViolationIds.includes(item.id)?'true':undefined}
          stroke={researchViolationIds.includes(item.id)?'#ff7272':item.id===itemId?'#ffe09a':'#101923'} strokeWidth={researchViolationIds.includes(item.id)||item.id===itemId?2.5:1}/>
        {labels && <text x={item.x+item.w/2} y={item.y+item.l/2} textAnchor="middle" fill="#09131e"
          fontWeight={700} fontSize={Math.min(7,item.w/8,item.l/4)} pointerEvents="none">{item.id}</text>}
      </g>)}
    </svg>
    {result.researchModel ?
      projection.length>0&&<span>Kesikli mavi çizgiler Contour 1 çatısının taban izdüşümünü gösterir.</span> :
      <span>Üst üste parçaları aşağıdaki parça listesinden de seçebilirsin.</span>}
  </div>;
}

export function PmcPlacementDetails({ result, pallet, itemId, onItem }) {
  const selected = result.placements.find(p => p.id === itemId);
  const active = selected?.palletIndex ?? pallet ?? result.pallets[0]?.index;
  const group = result.pallets.find(p => p.index === active);
  const parts = result.placements.filter(p => p.palletIndex === active);
  if (active === undefined || !group) return null;
  const mirrored = !!result.config?.mirrored;
  const boxes = parts.map(item => ({ ...item,y:item.y-active*PMC.length,item:{row:{weight:item.weight}} }));
  const model = result.researchModel;
  const capacity = model ? {
    remainingM3:Math.max(0,researchEnvelopeMm3(model)/1e9-parts.reduce((sum,p)=>sum+p.w*p.l*p.h/1e6,0)),
    remainingDeckM2:Math.max(0,model.usable.widthMm*model.usable.lengthMm/1e6-parts.reduce((sum,p)=>sum+p.w*p.l/1e4,0)),
  } : modelCapacity(boxes,mirrored);
  const balance = measurePmcBalance(boxes,balanceProfile(result.config?.pmcBalance));
  const weight = parts.reduce((sum,item) => sum + (item.weight??0),0);
  const matched = selected?.supportIds ?? (selected?.supportId ? [selected.supportId] : []);
  const warnings = [
    ...(selected?.reviewRequired ? ['Şematik taşma ve destek teknik inceleme gerektirir.'] : []),
    ...(balance.status === 'outside' ? ['Girilen ağırlık veya denge sınırı aşıldı.'] : []),
    ...(parts.some(item => item.weight==null) ? ['Bazı yüklerin ağırlığı bilinmiyor.'] : []),
  ];
  return <section className="placement-info" aria-label="Yerleşim ayrıntıları">
    <div className="placement-info-heading">
      <h3>{selected ? selected.name : port(active)+' ayrıntıları'}</h3>
      <label>Parça seç <select value={selected?.id ?? ''} onChange={e=>onItem(e.target.value || null)}>
        <option value="">PMC özeti</option>
        {parts.map(part=><option key={part.id} value={part.id}>{part.id} · {part.name}</option>)}
      </select></label>
    </div>
    <dl className="placement-grid">
      <div><dt>{selected?'Referans':'Parça sayısı'}</dt><dd>{selected?.id ?? parts.length}</dd></div>
      {selected && <div><dt>Yerleşim ölçüsü (G × U × Y)</dt><dd>{fmt(selected.w)} × {fmt(selected.l)} × {fmt(selected.h)} cm</dd></div>}
      <div><dt>{selected?'Ağırlık':'Bilinen PMC yükü'}</dt><dd>{selected ? selected.weight == null ? 'Bilinmiyor' : fmt(selected.weight)+' kg' : fmt(weight)+' kg'}</dd></div>
      {selected && <div><dt>Yön / dönüş</dt><dd>{orientation[selected.orientationFace]??'Model yönü'} · {selected.rotated?'90°':'0°'}</dd></div>}
      <div><dt>Atanan PMC</dt><dd>{port(active)}</dd></div>
      <div><dt>Uçak pozisyonu</dt><dd>Bu PMC planında atanmamış</dd></div>
      {selected && <div><dt>İstif ve destek</dt><dd>{selected.z ? 'Destek: '+(matched.length?matched.join(', '):'doğrulanmadı') : 'PMC tabanı'}
        {' · '}{selected.stackable?'Üstü destek için izinli':'Üstüne yük konamaz'}</dd></div>}
      <div><dt>Tahmini PMC CG (X / Y / Z)</dt><dd>{balance.cg ? [balance.cg.x,balance.cg.y,balance.cg.z].map(n=>fmt(n)).join(' / ')+' cm' : 'Veri eksik'}</dd></div>
      <div><dt>Modelde kalan hacim / taban</dt><dd>{fmt(capacity.remainingM3,2)} m³ / {fmt(capacity.remainingDeckM2,2)} m²</dd></div>
    </dl>
    {warnings.length>0 && <p className="placement-warning">{warnings.join(' ')}</p>}
    <small>Şematik boş hacim, ek bir parçanın sığacağını veya uçuşa uygunluğu göstermez.</small>
  </section>;
}

export function PmcPlanView({ view,result,pallet,itemId,onItem,onPallet,...options }) {
  return view==='2D' ? <PmcFloorView result={result} pallet={pallet} itemId={itemId}
    onItem={onItem} onPallet={onPallet} labels={options.labels} heightCut={options.heightCut}
    placementAction={options.placementAction} researchViolationIds={options.researchViolationIds} showContour={options.showContour}/> :
    <PmcScene placements={result.placements} palletCount={Math.max(1,result.pallets.length)} selectedPallet={pallet}
      selectedItemId={itemId} onSelectItem={onItem} onSelectPallet={onPallet}
      mirrorContour={!!result.config?.mirrored} researchModel={result.researchModel} {...options}/>;
}
