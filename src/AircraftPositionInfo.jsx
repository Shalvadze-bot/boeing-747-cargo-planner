import React, { useState } from 'react';
import { fit, footprintOrientation } from './engine.mjs';

const fmt = n => Number.isFinite(n) ? n.toLocaleString('tr-TR',{maximumFractionDigits:1}) : '—';

export function AircraftPositionInfo({ slot, cargo, locked }) {
  const [partId,setPartId] = useState('');
  if (!slot && !cargo) return null;
  const parts = cargo?.pmc?.items ?? [];
  const part = parts.find(item=>item.id===partId);
  const orientation = slot && cargo ? footprintOrientation(cargo,slot) : null;
  const payload = parts.every(item=>Number.isFinite(item.weight)) ? parts.reduce((sum,item)=>sum+item.weight,0) : 0;
  const cg = payload > 0 ? ['x','y','z'].map((axis,i)=>parts.reduce((sum,item)=>
    sum + item.weight * (item[axis] + item[['w','l','h'][i]]/2),0)/payload) : null;
  return <section className="placement-info aircraft-position-info" aria-label="Uçak pozisyonu ayrıntıları">
    <h3>{slot?.label ?? 'Atanmamış yük'}{locked && ' · Sabit'}</h3>
    {parts.length > 0 && <label>PMC parçası <select aria-label="PMC parçası" value={part?.id??''}
      onChange={event=>setPartId(event.target.value)}>
      <option value="">Palet özeti</option>
      {parts.map(item=><option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}
    </select></label>}
    <dl className="placement-grid">
      <div><dt>Referans / yük</dt><dd>{part ? part.id+' · '+part.name : cargo ? cargo.id+' · '+cargo.name : 'Boş pozisyon'}</dd></div>
      <div><dt>Ölçüler (U × G × Y)</dt><dd>{part ? [part.l,part.w,part.h].map(fmt).join(' × ')+' cm'
        : (cargo||slot) ? [cargo?.l??slot.l,cargo?.w??slot.w,cargo?.h??slot.h].map(fmt).join(' × ')+' cm' : '—'}</dd></div>
      <div><dt>Ağırlık</dt><dd>{part ? part.weight == null ? 'Bilinmiyor' : fmt(part.weight)+' kg' : cargo ? fmt(cargo.weight)+' kg' : '—'}</dd></div>
      <div><dt>Yön ve dönüş</dt><dd>{part ? ({upright:'Dik','side-width':'Genişlik yüzeyi','side-length':'Uzunluk yüzeyi'}[part.orientationFace]??'Model yönü')+' · '+(part.rotated?'90°':'0°') :
        orientation ? orientation==='turned'?'90° yatay':'0° yatay' : '—'}</dd></div>
      <div><dt>Atanan PMC</dt><dd>{cargo?.pmc ? 'PMC '+(cargo.pmc.index+1) : '—'}</dd></div>
      <div><dt>Uçak pozisyonu</dt><dd>{slot?.label ?? 'Atanmadı'}</dd></div>
      <div><dt>İstif / destek</dt><dd>{part ? part.z > 0 ? (part.supportIds?.join(', ') || part.supportId || 'Doğrulanmadı')
        : 'PMC tabanı' : parts.length ? parts.filter(item=>item.z>0).length+' üstteki parça' : 'Veri yok'}</dd></div>
      <div><dt>PMC yük merkezi (X / Y / Z)</dt><dd>{cg ? cg.map(fmt).join(' / ')+' cm · dara hariç' : 'Veri eksik'}</dd></div>
      <div><dt>Şematik pozisyon kapasitesi</dt><dd>{slot ? cargo ? fmt(Math.max(0,slot.max-cargo.weight))+' kg limit payı'
        : fmt(slot.max)+' kg · '+fmt(slot.l*slot.w/1e4)+' m² taban' : '—'}</dd></div>
    </dl>
    {slot && cargo && !fit(cargo,slot) && <p className="placement-warning">Girilmiş şematik ölçü veya ağırlık sınırı aşıldı.</p>}
    {part?.reviewRequired && <p className="placement-warning">Parçanın taşma veya destek durumu teknik inceleme gerektiriyor.</p>}
  </section>;
}
