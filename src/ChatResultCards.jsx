import React, { useState } from 'react';
import { ORDERS } from './cargo-import-parser.mjs';
import { checkChatRow } from './chat-manifest-parser.mjs';

const fmt = (value,digits=1) => Number.isFinite(value) ? value.toLocaleString('tr-TR',{maximumFractionDigits:digits}) : '—';

function ManifestCard({card,confirm}) {
  const [rows,setRows] = useState(card.rows);
  const results = rows.map(checkChatRow);
  const valid = rows.length && results.every(item=>item.row);
  const change = (index,key,value) => setRows(previous=>previous.map((row,i)=>i===index?{...row,[key]:value}:row));
  return <section className="chat-result" aria-label="Çıkarılan yük listesi">
    <h3>Yük listesi önizlemesi · {rows.length} satır</h3>
    {card.capped && <p>Okuma sınırına ulaşıldı. Belgenin kalanını ayrıca kontrol edin.</p>}
    <p>Adet, ölçü sırası, birim ve varsa parça ağırlığını belgeyle karşılaştırın.</p>
    <div className="chat-manifest">
      {rows.map((row,i)=><details key={i} open={rows.length===1?true:undefined}>
        <summary>{row.name || `Satır ${i+1}`} · {row.a} × {row.b} × {row.c} {row.unit || '?'} {results[i].errors.length>0&&' · İncele'}</summary>
        <small>{row.source}</small>
        <div className="chat-row-editor">
          {[['name','Yük adı'],['a','1. ölçü'],['b','2. ölçü'],['c','3. ölçü'],['quantity','Adet'],['weight','Parça kg']].map(([key,label])=>
            <label key={key}>{label}<input value={row[key]??''} onChange={event=>change(i,key,event.target.value)} maxLength={key==='name'?60:14}/></label>)}
          <label>Ölçü sırası<select value={row.order} onChange={event=>change(i,'order',event.target.value)}>
            <option value="">Seçin</option>{ORDERS.map(order=><option key={order} value={order}>{[...order].map(c=>({L:'U',W:'G',H:'Y'})[c]).join(' × ')}</option>)}</select></label>
          <label>Birim<select value={row.unit} onChange={event=>change(i,'unit',event.target.value)}>
            <option value="">Seçin</option>{['cm','mm','m','in'].map(unit=><option key={unit}>{unit}</option>)}</select></label>
        </div>
        {results[i].errors.length>0&&<small>{results[i].errors.join(' · ')}</small>}
      </details>)}
    </div>
    <button className="outline amber" type="button" disabled={!valid} onClick={()=>confirm({
      type:'import',key:card.key,title:'Yük listesini içe aktar',
      description:`${rows.length} satır PMC yük listenize eklenir.`, value:results.map(item=>item.row),
    })}>Yük Listesini İçe Aktar</button>
  </section>;
}

const metricRows = [
  ['Yerleşen',s=>s.placed],['Yerleşmeyen',s=>s.unplaced],['Bilinen yük (kg)',s=>s.kg],['Hacim (m³)',s=>s.volume],
  ['PMC',s=>s.pmcs],['Boş kontur (m³)',s=>s.remainingM3],['Boş taban (m²)',s=>s.remainingDeckM2],
  ['Ağırlığı bilinmeyen',s=>s.unknownWeight],['Şematik rezervasyon',s=>s.schematicPositions],['CG sapması (cm)',s=>s.balanceDistance],
];

function PlanCard({card,preview,confirm}) {
  const [expanded,setExpanded] = useState(false);
  const value = card.value;
  const opts = value.alternatives;
  return <section className="chat-result" aria-label="Yerleşim seçenekleri">
    <h3>{value.singlePallet===undefined?'PMC plan karşılaştırması':`PMC ${value.singlePallet+1} · yerleşim seçenekleri`}</h3>
    <p>{opts.length} farklı ve doğrulanmış aday · {fmt(value.elapsedMs/1000,2)} sn</p>
    {value.issue&&<p>{value.issue}</p>}
    {!opts.length && <p>Bu denemede farklı ve geçerli bir yerleşim bulunamadı.</p>}
    {opts.length>0&& <>
      <button type="button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>Planları Karşılaştır</button>
      {expanded&&<div className="chat-metrics"><table><thead><tr><th>Ölçüt</th><th>Başlangıç</th>{opts.map((p,i)=><th key={p.strategy}>{'ABC'[i]}</th>)}</tr></thead>
        <tbody>{metricRows.map(([label,read])=><tr key={label}><th scope="row">{label}</th>
          {[value.standard,...opts].map((p,i)=><td key={i}>{fmt(read(p.validation.stats),2)}</td>)}</tr>)}
          <tr><th scope="row">Doğrulama</th>{[value.standard,...opts].map((p,i)=><td key={i}>{p.validation.valid?'Geçti':'İncele'}</td>)}</tr>
          <tr><th scope="row">Süre (sn)</th>{[value.standard,...opts].map((p,i)=><td key={i}>{fmt(p.elapsedMs/1000,3)}</td>)}</tr>
        </tbody></table>
        <small>Mevcut uçak pozisyonu sayısı {value.aircraft?.[0]??'—'}. PMC denemesi bu atamaları korur.</small>
        <details><summary>PMC ağırlık dağılımı ve doğrulama</summary>
          {[value.standard,...opts].map((plan,i)=><div key={i}><b>{i?'Plan '+'ABC'[i-1]:'Başlangıç'}</b>
            <ul>{plan.validation.distribution.map(p=><li key={p.index}>PMC {p.index+1} · {fmt(p.knownWeightKg)} kg · {p.cg?
              `CG ${fmt(p.cg.x)} / ${fmt(p.cg.y)} / ${fmt(p.cg.z)} cm`:'CG için veri eksik'}</li>)}</ul></div>)}
          <ul>{[...new Set([value.standard,...opts].flatMap(p=>p.validation.limitations))].map(note=><li key={note}>{note}</li>)}</ul>
        </details></div>}
      {opts.map((candidate,i)=>{
        const title = 'Plan '+'ABC'[i];
        return <div key={candidate.strategy} className="chat-option"><strong>{title}{i===0?' · En iyi aday':''}</strong>
          <small>{candidate.validation.stats.placed} parça · {candidate.validation.stats.pmcs} PMC</small>
          <div><button type="button" onClick={()=>preview({result:candidate.result,title,initialPallet:value.singlePallet})}>Planı Önizle</button>
            <button type="button" className="outline amber" disabled={!candidate.canApply} onClick={()=>confirm({
              type:'apply',key:card.key,title:title+' Uygulansın mı?',description:'Mevcut PMC planı önceki plan olarak kaydedilir.',value,candidate,
            })}>Planı Uygula</button></div>
        </div>;
      })}
    </>}
  </section>;
}

function AircraftCard({card,preview,confirm}) {
  const r=card.value;
  return <section className="chat-result">
    <h3>Uçak yerleşim önerisi</h3><p>{r.stats.count} / {r.total} palet · {fmt(r.stats.weight)} kg · {fmt(r.elapsedMs/1000,3)} sn</p>
    <p>Şematik pozisyon, ağırlık ve denge kontrolleri geçti.</p>
    <button type="button" onClick={()=>preview({aircraft:r})}>Planı Önizle</button>
    <button type="button" className="outline amber" onClick={()=>confirm({type:'aircraft',key:card.key,title:'Uçak planı uygulansın mı?',
      description:'Mevcut uçak planı önceki plan olarak kaydedilir.',value:r})}>Planı Uygula</button>
  </section>;
}

function InspectionCard({card}) {
  const r = card.value;
  const v = r.validation;
  return <section className="chat-result">
    <h3>{card.title}</h3>
    {card.type==='unplaced' && (r.unplaced.length?<ul>{r.unplaced.map(p=><li key={p.id}><b>{p.id}</b> · {p.reason}</li>)}</ul>:<p>Bekleyen parça yok.</p>)}
    {card.type==='aircraft-analysis' && <><p>{r.summary.count} palet · {fmt(r.summary.weight)} kg · {r.free} boş pozisyon</p>
      <p>Sol {fmt(r.summary.left)} kg · Sağ {fmt(r.summary.right)} kg</p>
      <p>Göreli boyuna yük merkezi %{fmt(r.summary.center*100)}</p>
      {r.waiting?.length>0&&<ul>{r.waiting.map(p=><li key={p.id}>{p.id} · {p.reason}</li>)}</ul>}</>}
    {v?.stats && card.type==='space'&&<p>Boş model hacmi {fmt(v.stats.remainingM3,2)} m³ · boş taban {fmt(v.stats.remainingDeckM2,2)} m²</p>}
    {v?.distribution?.length>0 && card.type==='balance' && <ul>{v.distribution.map(p=><li key={p.index}>
      PMC {p.index+1} · {fmt(p.knownWeightKg)} kg · {p.cg?`Ağırlık merkezi (cm) ${fmt(p.cg.x)} / ${fmt(p.cg.y)} / ${fmt(p.cg.z)}`:'Ağırlık merkezi için veri eksik'}</li>)}</ul>}
    {(v?.errors?.length>0 || r.warnings?.length>0)&&<details open><summary>Doğrulama uyarıları</summary><ul>
      {(v?.errors??r.warnings).map((warning,i)=><li key={i}>{warning}</li>)}</ul></details>}
    {v?.limitations?.length>0&&<details><summary>Kontrol kapsamı</summary><ul>{v.limitations.map(item=><li key={item}>{item}</li>)}</ul></details>}
  </section>;
}

export function ChatResultCard({card,preview,confirm}) {
  if (card.type==='import') return <ManifestCard card={card} confirm={confirm}/>;
  if (card.type==='plans') return <PlanCard card={card} preview={preview} confirm={confirm}/>;
  if (card.type==='aircraft') return <AircraftCard card={card} preview={preview} confirm={confirm}/>;
  if (card.type==='restore') return <section className="chat-result"><h3>Önceki plan</h3>
    <button type="button" onClick={()=>confirm({type:'restore',key:card.key,mode:card.mode,title:'Önceki Plana Dön',
      description:'Önceki yerleşim ve kilitler güncel verilerle kontrol edilir.'})}>Önceki Plana Dön</button></section>;
  return <InspectionCard card={card}/>;
}
