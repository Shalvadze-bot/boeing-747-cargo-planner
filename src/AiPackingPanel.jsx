import React, { useEffect, useRef, useState } from 'react';
import { Sparkle } from '@phosphor-icons/react';
import { PmcPlanView, PmcPlacementDetails, ViewSwitch } from './PmcPlanView';

const fmt = (v, digits = 1) => Number.isFinite(v) ? v.toLocaleString('tr-TR',{maximumFractionDigits:digits}) : '—';
const seconds = ms => fmt(ms / 1000) + ' sn';
const titles = ['Plan A','Plan B','Plan C'];
const asCell = value => typeof value === 'number' ? fmt(value) : value ?? '—';

export function AiPackingButton({ ai, disabled, showObjective = true, onStart = ai.start }) {
  if (!ai.service) return null;
  return <>
    {showObjective && <label className="ai-objective">Hedef
      <select aria-label="Optimizasyon hedefi" value={ai.objective} disabled={!!ai.progress}
        onChange={event => ai.setObjective(event.target.value)}>
        {Object.entries(ai.objectives).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>}
    <button type="button" className="outline amber ai-optimize-button"
      title={!ai.service.available ? 'AI sunucu yapılandırması eksik' : undefined}
      disabled={disabled || !!ai.progress || !ai.service.available} onClick={onStart}>
      <Sparkle size={19} aria-hidden="true"/> Optimize with AI
    </button>
  </>;
}

function Distribution({ label, plan }) {
  if (!plan) return null;
  return <details className="ai-detail">
    <summary>{label} · ağırlık dağılımı ve kapasite</summary>
    {plan.validation.distribution.length ? <ul>{plan.validation.distribution.map(pallet => <li key={pallet.index}>
      PMC {pallet.index + 1} · {fmt(pallet.knownWeightKg)} kg bilinen yük
      {pallet.cg ? ` · tahmini CG (X/Y/Z) ${fmt(pallet.cg.x)} / ${fmt(pallet.cg.y)} / ${fmt(pallet.cg.z)} cm` : ' · CG için veri eksik'}
      {' · '}{fmt(pallet.remainingM3,2)} m³ modelde boş
      {pallet.remainingKg !== null && ' · ' + fmt(pallet.remainingKg) + ' kg brüt sınır payı'}
    </li>)}</ul> : <p>Yerleşen yük yok.</p>}
  </details>;
}

export function AiPlanPreview({ result, title, onClose, initialPallet }) {
  const dialog = useRef(null);
  const [pallet, setPallet] = useState(initialPallet ?? result.pallets[0]?.index ?? 0);
  const [itemId, setItemId] = useState(null);
  const [view, setView] = useState('3D');
  const choosePallet = index => {setPallet(index);setItemId(null);};
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => { if (element.open) element.close(); };
  }, []);
  return <dialog className="ai-preview-dialog" ref={dialog} onClose={onClose} aria-labelledby="ai-preview-heading">
    <h3 id="ai-preview-heading">{title} önizlemesi</h3>
    <p>Simülasyon · Uçuş operasyonları için onaylı değildir.</p>
    <div className="pmc-plan-tools">
      <label>Görüntülenen palet <select value={pallet} onChange={e => choosePallet(Number(e.target.value))}>
        {result.pallets.map(p => <option key={p.index} value={p.index}>PMC {p.index + 1}</option>)}
      </select></label>
      <ViewSwitch view={view} onChange={setView} label="Aday plan 2D / 3D görünümü"/>
    </div>
    <PmcPlanView view={view} result={result} pallet={pallet} itemId={itemId} onItem={setItemId}
      onPallet={choosePallet} showContour labels showDimensions heightCut={Infinity}/>
    <PmcPlacementDetails result={result} pallet={pallet} itemId={itemId} onItem={setItemId}/>
    <button type="button" className="outline amber" onClick={onClose}>Önizlemeyi kapat</button>
  </dialog>;
}

const comparisonRows = [
  ['Yerleşen parça', p=>p.validation.stats.placed],
  ['Yerleşmeyen parça', p=>p.validation.stats.unplaced],
  ['Bilinen yük ağırlığı (kg)', p=>p.validation.stats.kg],
  ['Ağırlığı bilinmeyen parça', p=>p.validation.stats.unknownWeight],
  ['Yük hacmi (m³)', p=>p.validation.stats.volume],
  ['Fiziksel PMC sayısı', p=>p.validation.stats.pmcs],
  ['Modelde kalan hacim (m³)', p=>p.validation.stats.remainingM3],
  ['Modelde kalan taban (m²)', p=>p.validation.stats.remainingDeckM2],
  ['Şematik pozisyon rezervasyonu', p=>p.validation.stats.schematicPositions],
  ['Mevcut uçak pozisyonları (sabit)', (_p, o)=>o.aircraft[0]],
  ['Ağırlık merkezi sapması (cm)', p=>p.validation.stats.balanceDistance],
  ['Hesaplama süresi', p=>seconds(p.elapsedMs)],
  ['Deterministik kontrol', p=>p.validation.valid?'Geçti':'İnceleme gerekli'],
];

export function AiPackingPanel({ ai, onApply }) {
  const [preview, setPreview] = useState(null);
  const [index, setIndex] = useState(0);
  const [applied, setApplied] = useState(null);
  const [validationError, setValidationError] = useState('');
  const [applying, setApplying] = useState(false);
  useEffect(() => {
    setPreview(null); setIndex(0); setValidationError(''); setApplying(false);
  }, [ai.outcome]);
  if (!ai.service) return null;
  if (!ai.service.available) return <p className="ai-note">OpenAI bağlantısı bu hesap için etkin değil. Yerel alternatifleri Kargo Asistanı’nın plan araçlarından hesaplayabilirsiniz.</p>;
  if (ai.progress) {
    const { stage, completed, best } = ai.progress;
    return <section className="ai-panel" aria-label="AI arama ilerlemesi">
      <h3>{stage}</h3>
      <p role="status">{completed} tamamlanan deneme{best ? ` · En iyi doğrulanan: ${best.placed} parça / ${best.pmcs} PMC` : ' · Doğrulanan aday bekleniyor'}</p>
      <p>Geçen süre {seconds(ai.elapsed)}</p>
      <button type="button" className="outline amber" onClick={() => ai.cancel()}>AI denemesini iptal et</button>
    </section>;
  }
  if (!ai.outcome) return <>{ai.service.mock && <p className="ai-note">Yerel deneme · API yanıtı simüle edilir. Yerleşimler mevcut hesaplama motorundan gelir.</p>}
    {ai.message && <p className="ai-note" role="status">{ai.message}</p>}</>;

  const outcome = ai.outcome;
  const plans = [outcome.standard, ...outcome.alternatives];
  const selected = outcome.alternatives[index];
  const status = applied?.outcome === outcome ? titles[applied.index]+' uygulandı.' :
    outcome.alternatives.some(plan=>plan.canApply) ? 'Daha iyi bir plan bulundu.' :
    'Mevcut plandan daha iyi doğrulanmış bir sonuç bulunamadı. Mevcut plan korunuyor.';
  return <section className="ai-panel" aria-label="Standart ve AI yerleşim karşılaştırması">
    <div className="ai-panel-heading"><h3>AI yerleşim karşılaştırması</h3><span>{outcome.mock?'Simüle API · 0 ücret':'Deneysel · simülasyon'}</span></div>
    <p role="status">{status}</p>
    <p>Hedef: {ai.objectives[outcome.objective]} · {outcome.alternatives.length} farklı ve doğrulanmış seçenek</p>
    {outcome.issue && <p className="ai-alert" role="alert">{outcome.issue}</p>}
    <div className="ai-table-wrap"><table className="ai-plan-table"><thead><tr>
      <th scope="col">Ölçüt</th><th scope="col">Standart</th>
      {outcome.alternatives.map((item,i)=><th key={item.strategy} className={i===0?'best-plan':undefined} scope="col">
        {titles[i]}{i===0 && ' · En iyi aday'}
      </th>)}
    </tr></thead><tbody>
      {comparisonRows.map(([label, read]) => <tr key={label}><th scope="row">{label}</th>
        {plans.map((item,i)=><td key={i}>{asCell(read(item,outcome))}</td>)}
      </tr>)}
    </tbody></table></div>
    <p>{outcome.trials.length} motor denemesi · {outcome.rejected} geçersiz aday · Toplam {seconds(outcome.elapsedMs)}</p>
    <p>{outcome.mock ? 'OpenAI API çağrısı ve token tüketimi yok.' :
      `${outcome.apiCalls} API çağrısı · Ölçülen tokenlar · giriş ${fmt(outcome.usage.input)} · çıkış ${fmt(outcome.usage.output)}${outcome.usage.missing ? ' · bazı çağrılarda kullanım bilgisi yok' : ''}`}</p>
    <Distribution label="Standart" plan={outcome.standard}/>
    {outcome.alternatives.map((plan,i)=><Distribution key={plan.strategy} label={titles[i]} plan={plan}/>)}
    <details className="ai-detail">
      <summary>Doğrulama kapsamı</summary>
      <ul>{[...new Set(plans.flatMap(item=>item.validation.limitations))].map(item => <li key={item}>{item}</li>)}</ul>
      {!outcome.standard.validation.valid && <p>Standart plan: {outcome.standard.validation.errors.slice(0,3).join(' ')}</p>}
    </details>
    {validationError && <p className="ai-alert" role="alert">{validationError}</p>}
    {selected && <>
      <div className="ai-plan-tabs" role="group" aria-label="Aday planlar">
        {outcome.alternatives.map((plan,i)=><button key={plan.strategy} type="button" className={i===index?'active':''}
          aria-pressed={i===index} onClick={()=>{setIndex(i);setValidationError('');}}>{titles[i]}</button>)}
      </div>
      <div className="ai-actions">
        <button type="button" className="outline amber" onClick={()=>setPreview({outcome,item:selected,index})}>Önizle</button>
        <button type="button" className="primary" disabled={!selected.canApply || applying || applied?.outcome===outcome} onClick={async () => {
          setApplying(true);setValidationError('');
          try { await onApply(outcome,selected); setApplied({outcome,index}); }
          catch (error) { setValidationError(error.message); }
          finally { setApplying(false); }
        }}>{applying?'Doğrulanıyor…':'Planı Uygula'}</button>
      </div>
    </>}
    {preview?.outcome===outcome && <AiPlanPreview result={preview.item.result} title={titles[preview.index]} onClose={()=>setPreview(null)}/>}
  </section>;
}
