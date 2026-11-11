import React, { useEffect, useRef, useState } from 'react';
import { Cube, Plus, Trash, MagicWand, DownloadSimple, Warning, Info, ArrowCounterClockwise, CheckCircle, X } from '@phosphor-icons/react';
import { DEFAULT_CONFIG, SAMPLE_CARGO, PMC, contourHeight } from './pmc-engine.mjs';
import PmcScene from './PmcScene';
import {preparePmcTransfer} from './pmc-aircraft.mjs';
import CargoImport from './CargoImport';
import './pmc-planner.css';

const STORE = 'cargo-pmc-v1';
const COLORS = ['#4bb5f7', '#fb9a57', '#a98bf5', '#50d2ad', '#ee759d', '#e1cb57', '#78a7ff', '#bcdd77'];
const format = (n, d = 1) => Number.isFinite(n) ? n.toLocaleString('tr-TR', { maximumFractionDigits: d }) : '—';
const signature = (rows, config) => JSON.stringify({ rows, config });
function nextColor(index) {
  if (index < COLORS.length) return COLORS[index];
  const h = ((index - COLORS.length) * 137.508 + 15) % 360 / 60;
  const c = 0.62, x = c * (1 - Math.abs(h % 2 - 1)), m = 0.22;
  const [r,g,b] = h < 1 ? [c,x,0] : h < 2 ? [x,c,0] : h < 3 ? [0,c,x] : h < 4 ? [0,x,c] : h < 5 ? [x,0,c] : [c,0,x];
  return '#' + [r,g,b].map(v => Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');
}
const freshRows = () => SAMPLE_CARGO.map((row, i) => ({ ...row, color: COLORS[i % COLORS.length] }));
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (saved?.version === 1 && Array.isArray(saved.rows) && saved.rows.length <= 100 && saved.config && typeof saved.config === 'object') {
      const ids = saved.rows.map(row => row?.id);
      if (ids.every(id => typeof id === 'string' && id.length < 80) && new Set(ids).size === ids.length && saved.rows.every(row => typeof row.name === 'string' && row.name.length <= 60 && ['length','width','height','quantity','weight'].every(key => row[key] == null || typeof row[key] === 'number' || typeof row[key] === 'string') && typeof row.stackable === 'boolean' && typeof row.allowRotation === 'boolean')) {
        return { rows: saved.rows, config: { ...DEFAULT_CONFIG, ...saved.config } };
      }
    }
  } catch { /* Start with examples if browser storage is unavailable or invalid. */ }
  return { rows: freshRows(), config: { ...DEFAULT_CONFIG } };
}

export default function PmcPlanner({onImportAircraft}) {
  const [transfer,setTransfer] = useState(null);
  const [transferError,setTransferError] = useState('');
  const [initial] = useState(restore);
  const [rows, setRows] = useState(initial.rows);
  const [config, setConfig] = useState(initial.config);
  const [result, setResult] = useState(null);
  const [resultSignature, setResultSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(true);
  const [selectedPallet, setSelectedPallet] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [showContour, setShowContour] = useState(true);
  const [labels, setLabels] = useState(true);
  const [heightCut, setHeightCut] = useState(244);
  const [resetOpen, setResetOpen] = useState(false);
  const worker = useRef(null);
  const timeout = useRef(null);
  const currentSignature = signature(rows, config);
  const stale = !!result && resultSignature !== currentSignature;
  const placements = result?.placements || [];
  const palletCount = result?.pallets?.length || 0;
  const visibleItems = placements.filter(item => selectedPallet === null || item.touchedPallets?.includes(selectedPallet) || item.palletIndex === selectedPallet);
  const totalRequested = rows.reduce((sum, row) => sum + (Number.isFinite(Number(row.quantity)) ? Number(row.quantity) : 0), 0);
  const volume = placements.reduce((sum, p) => sum + p.w * p.l * p.h / 1e6, 0);
  const overhangs = placements.filter(p => p.overhangCm > 0);
  const configForResult = result?.config || config;
  const envelopeArea = (PMC.shoulderX - PMC.margin) * PMC.maxHeight +
    (PMC.width - PMC.margin - PMC.shoulderX) * (PMC.maxHeight + contourHeight(PMC.width - PMC.margin)) / 2;
  const clippedVolume = placements.reduce((sum, item) => sum + (item.touchedPallets || [item.palletIndex]).reduce((v, index) => v + item.w * item.h * Math.max(0, Math.min(item.y + item.l, (index + 1) * PMC.length - PMC.margin) - Math.max(item.y, index * PMC.length + PMC.margin)), 0), 0);
  const utilization = palletCount ? clippedVolume / (envelopeArea * PMC.usableLength * palletCount) * 100 : 0;

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ version: 1, rows, config })); setSaved(true); }
    catch { setSaved(false); }
  }, [rows, config]);
  useEffect(() => {
    calculate(initial.rows, initial.config);
    return () => { worker.current?.terminate(); clearTimeout(timeout.current); };
  }, []);
  useEffect(() => {
    if (!resetOpen && !transfer) return;
    const box = document.querySelector('.pmc-reset-dialog, .pmc-transfer-dialog');
    const previous = document.activeElement;
    box?.querySelector('button')?.focus();
    const listener = event => {
      if (event.key === 'Escape') {setResetOpen(false);setTransfer(null);}
      if (event.key === 'Tab') {
        const buttons = [...box.querySelectorAll('button,input')];
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', listener);
    return () => { document.removeEventListener('keydown', listener); previous?.focus(); };
  }, [resetOpen,transfer]);

  function stop() { worker.current?.terminate(); worker.current = null; clearTimeout(timeout.current); setBusy(false); }
  function calculate(nextRows = rows, nextConfig = config) {
    stop(); setBusy(true); setError('');
    const snap = signature(nextRows, nextConfig);
    let instance;
    try { instance = new Worker(new URL('./pmc-worker.mjs', import.meta.url), { type: 'module' }); }
    catch { setBusy(false); setError('Hesaplama işçisi açılamadı. Tarayıcıyı yenileyip tekrar deneyin.'); return; }
    worker.current = instance;
    instance.onmessage = ({ data }) => {
      if (worker.current !== instance) return;
      stop();
      if (data.error) { setError(data.error); return; }
      setResult(data.result); setResultSignature(snap); setSelectedPallet(0); setSelectedItemId(null); setHeightCut(244);
    };
    instance.onerror = () => { if (worker.current === instance) { stop(); setError('Hesaplama yüklenemedi. Sayfayı yenileyip yeniden deneyin.'); } };
    timeout.current = setTimeout(() => { if (worker.current === instance) { stop(); setError('Hesaplama süresi doldu. Daha az parça ile yeniden deneyin.'); } }, 30000);
    instance.postMessage({ rows: nextRows, config: nextConfig });
  }
  function updateRow(id, key, value) { setRows(previous => previous.map(row => row.id === id ? { ...row, [key]: value } : row)); }
  function updateConfig(key, value) { setConfig(previous => ({ ...previous, [key]: value })); }
  function addRow() {
    setRows(previous => [...previous, { id: `K${String(Math.max(0, ...previous.map(row => Number(row.id.match(/^K(\d+)$/)?.[1]) || 0)) + 1).padStart(2, '0')}`, name: `Yük ${previous.length + 1}`, length: 100, width: 80, height: 60, quantity: 1, weight: '', stackable: false, allowRotation: true, color: Array.from({length:200}, (_, i) => nextColor(i)).find(color => !previous.some(row => row.color === color)) || nextColor(previous.length) }]);
  }
  function importRows(incoming) {
    if (rows.length + incoming.length > 100) { setError('Yük listesi en fazla 100 satır olabilir. Önce mevcut satırları azaltın.'); return false; }
    const next = [...rows];
    let maxId = Math.max(0, ...next.map(row => Number(row.id.match(/^K(\d+)$/)?.[1]) || 0));
    for (const item of incoming) {
      const color = Array.from({length:200}, (_, i) => nextColor(i)).find(candidate => !next.some(row => row.color === candidate)) || nextColor(next.length);
      next.push({...item, id: `K${String(++maxId).padStart(2,'0')}`, color});
    }
    setRows(next); setError(''); return true;
  }
  function openTransfer(){try{setTransferError('');setTransfer(preparePmcTransfer(result));}catch(cause){setError(cause.message);}}
  function submitTransfer(event){event.preventDefault();if(stale || busy || !result){setTransferError('PMC girdileri değişti. Kapatıp yeniden hesaplayın.');return;}try{const form=new FormData(event.currentTarget);onImportAircraft(result,transfer.map(p=>Number(form.get('weight-'+p.index))));setTransfer(null);}catch(cause){setTransferError(cause.message);}}
  function download() {
    if (!result || stale || result.errors?.length) return;
    const payload = { version: 1, label: 'SİMÜLASYON — UÇUŞ OPERASYONLARI İÇİN ONAYLI DEĞİLDİR', generatedAt: new Date().toISOString(), input: { rows, config }, result };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'pmc-3d-simulasyon-plani.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="pmc-planner" aria-label="PMC üç boyutlu paletleme">
    <div className="pmc-intro">
      <div><span className="pmc-eyebrow">PALET İÇİ YERLEŞİM / ZX-11</span><h2>Her parçayı görün. Alanı değerlendirin.</h2><p>Yük ölçülerini girin, paletlere dağıtımı büyük ve döndürülebilir 3D görünümde inceleyin.</p></div>
      <div className="pmc-base-stat"><span>NET YÜKLENEBİLİR TABAN</span><strong>226,84 <b>×</b> 300,5 <small>cm</small></strong><small>≈89,31 × 118,31 inç net taban</small><small>96 × 125 inç / 243,84 × 317,5 cm PMC</small><small>Her kenardan 8,5 cm / ≈3,35 inç çıkarıldı</small></div>
    </div>
    <div className="pmc-layout">
      <aside className="pmc-settings panel">
        <div className="panel-heading"><h2><Cube size={21}/> Palet profili</h2><span className="pmc-tag">PMC</span></div>
        <div className="pmc-profile-diagram" aria-label="ZX-11 görselinden alınan örnek kontur"><svg viewBox="0 0 345 212" role="img"><title>ZX-11 kontur ölçüleri, operatör onayı bekliyor</title><path d="M45 170 V30 H132 L255 110 V170 Z" fill="#283544" stroke="#8ca0b8" strokeWidth="1.5"/><path d="M55 163 V45 H128 L245 117 V163 Z" fill="#ffbc2414" stroke="#ffbc24" strokeDasharray="4 4"/><path d="M45 185 H255 M29 30 V170" stroke="#5e7187"/><g fill="#c1cddd" fontSize="12" fontFamily="inherit"><text x="112" y="202">96″ / 243,84 cm</text><text x="64" y="11" fontSize="10">39,5″<tspan x="64" dy="12">100,33 cm</tspan></text><text x="178" y="23" fontSize="10">56,5″<tspan x="178" dy="12">143,51 cm</tspan></text><text x="5" y="102" fontSize="10" transform="rotate(-90 14 102)">96″ / 243,84 cm</text><text x="264" y="135" fontSize="10">41″<tspan x="264" dy="13">104,14 cm</tspan></text><text x="83" y="145" fill="#ffce64">ZX-11 referansı</text></g></svg></div>
        <div className="pmc-profile-fields">
          <label>Kontur yönü<select value={config.mirrored ? 'left' : 'right'} onChange={e => updateConfig('mirrored', e.target.value === 'left')}><option value="right">Alçak kenar sağda</option><option value="left">Alçak kenar solda (ayna)</option></select></label>
          <label>En fazla palet<input aria-label="En fazla palet" type="number" min="1" max="20" step="1" value={config.maxPallets} onChange={e => updateConfig('maxPallets', e.target.value)}/></label>
          <div className="pmc-source"><Info size={16}/><p><b>Kaynak: gönderdiğiniz ZX-11 çizimi.</b> En yüksek nokta 96″ / 243,84 cm; alçak kenar 41″ / 104,14 cm. 1 inç = 2,54 cm; ≈ işareti yuvarlanmış dönüşümü belirtir. Kontur fiziksel plaka ekseninde korunur. Uçak tipi / pozisyon uygunluğu doğrulanmadı.</p></div>
          <details className="pmc-overhang"><summary>Komşu palete üst taşma</summary><p>Yalnızca bu senaryoda izin verilen değerleri girin. Operatör izni, taşıma ve bağlama yeterliliği bu araçla doğrulanmaz.</p><label className="pmc-checkbox"><input type="checkbox" checked={config.allowOverhang} onChange={e => updateConfig('allowOverhang', e.target.checked)}/> Üst taşma senaryosunu aç</label>{config.allowOverhang && <><label>İzin verilen en fazla taşma (cm)<input type="number" min="0.1" max="300.5" step="0.1" value={config.maxOverhangCm ?? ''} placeholder="Onaylı değeri girin" onChange={e => updateConfig('maxOverhangCm', e.target.value)}/></label><label>Taşmanın başlayabileceği yükseklik (cm)<input type="number" min="0.1" step="0.1" value={config.minOverhangHeightCm ?? ''} placeholder="Onaylı değeri girin" onChange={e => updateConfig('minOverhangHeightCm', e.target.value)}/></label><small className="pmc-caution">Komşu palet ayrılır, çakışma kontrol edilir. Destek ve ağırlık aktarımı ayrıca incelenmelidir.</small></>}</details>
          <div className="pmc-method"><b>Geometrik yerleştirme</b><p>Parçalar dik tutulur. İzin verirseniz tabanda 90° döndürülür. Normal istifler aynı yükseklikteki istiflenebilir kutuların ortak yüzeyinde tam taban desteği ister. Ağırlık, CG, zemin basıncı, ezilme ve bağlama limitleri hesaplanmaz.</p></div>
        </div>
      </aside>
      <div className="pmc-main">
        <section className="pmc-input-panel panel">
          <div className="panel-heading"><div><h2>01 <span>Yük listesi</span></h2><p>Her yük grubuna ayrı renk · Tüm ölçüler cm · En fazla 200 parça</p></div><button className="outline amber" onClick={addRow} disabled={rows.length >= 100}><Plus size={17}/> Yük ekle</button></div>
          <div className="pmc-table-scroll"><table className="pmc-input-table"><thead><tr><th>Yük / renk</th><th>Uzunluk</th><th>Genişlik</th><th>Yükseklik</th><th>Adet</th><th>kg / parça</th><th title="Yalnızca tabanda 90° döndürür; yükseklik ve dik konum korunur.">90° çevir</th><th title="İşaretli yük başka bir parçayı üstünde taşıyabilir. Ezilme dayanımı hesaplanmaz.">Üstüne yük</th><th><span className="pmc-sr-only">Sil</span></th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id}><td><div className="pmc-name-input"><input aria-label={`Yük ${index + 1} rengi`} type="color" value={/^#[0-9a-f]{6}$/i.test(row.color) ? row.color : COLORS[index % COLORS.length]} onChange={e => updateRow(row.id, 'color', e.target.value)}/><input aria-label={`Yük ${index + 1} adı`} value={row.name} maxLength="60" onChange={e => updateRow(row.id, 'name', e.target.value)}/></div></td>{[['length','uzunluk'],['width','genişlik'],['height','yükseklik'],['quantity','adet'],['weight','ağırlık']].map(([key, label]) => <td key={key}><input aria-label={`Yük ${index + 1} ${label}`} type="number" min={key === 'quantity' ? 1 : 0.01} step={key === 'quantity' ? 1 : 'any'} placeholder={key === 'weight' ? 'İsteğe bağlı' : ''} value={row[key] ?? ''} onChange={e => updateRow(row.id, key, e.target.value)}/></td>)}<td><input type="checkbox" aria-label={`Yük ${index + 1} tabanda döndürülebilir`} checked={row.allowRotation} onChange={e => updateRow(row.id, 'allowRotation', e.target.checked)}/></td><td><input type="checkbox" aria-label={`Yük ${index + 1} üstüne yük konabilir`} checked={row.stackable} onChange={e => updateRow(row.id, 'stackable', e.target.checked)}/></td><td><button className="pmc-icon-button" aria-label={`Yük ${index + 1} sil`} onClick={() => setRows(previous => previous.filter(item => item.id !== row.id))}><Trash size={17}/></button></td></tr>)}</tbody></table></div>
          {!rows.length && <p className="pmc-empty-input">Başlamak için bir yük ekleyin.</p>}
          <div className="pmc-input-footer"><span><b>{rows.length}</b> yük grubu · <b>{format(totalRequested, 0)}</b> parça<small>{saved ? 'Girdiler bu tarayıcıda kaydedilir.' : 'Tarayıcı kaydı kullanılamıyor.'}</small></span><div>{busy && <button onClick={stop}>İptal</button>}<button className="primary" disabled={busy || !rows.length} onClick={() => calculate()}><MagicWand size={21}/>{busy ? 'Yerleşim hesaplanıyor…' : 'Paletlere yerleştir'}</button></div></div>
        </section>
        <details className="panel pmc-import-panel"><summary>Fotoğraf veya PDF’den yük listesi aktar</summary><CargoImport onImport={importRows}/></details>
        {(error || result?.errors?.length > 0) && <div className="pmc-errors" role="alert"><Warning size={21}/><div>{error && <p>{error}</p>}{result?.errors?.map((item, i) => <p key={i}>{typeof item === 'string' ? item : item.message || JSON.stringify(item)}</p>)}</div></div>}
        <section className="pmc-output panel" aria-busy={busy}>
          <div className="panel-heading"><div><h2>02 <span>3D palet planı</span></h2><p>Bir paleti seçerek büyük görün · Parçaya tıklayarak ölçülerini incele</p></div><button className="text-btn" onClick={download} disabled={!result || stale || busy || !!result.errors?.length}><DownloadSimple size={17}/> JSON indir</button></div>
          {stale && <div className="pmc-stale" role="status"><Warning size={17}/> Girdiler değişti. Görünüm önceki hesaplamayı gösteriyor; yeniden yerleştirin.</div>}
          <div className="pmc-results-stats"><div><span>Kullanılan palet</span><strong>{palletCount}<small> PMC</small></strong></div><div><span>Yerleşen parça</span><strong>{placements.length}<small> / {result?.summary?.requestedCount ?? totalRequested}</small></strong></div><div><span>Yerleşen hacim</span><strong>{format(volume, 2)}<small> m³</small></strong></div><div title="Net taban üzerindeki ZX-11 geometrik zarfına oran. Kenar boşluklarına taşan hacim dahil değildir."><span>Geometrik zarf doluluğu</span><strong>{format(utilization, 1)}<small>%</small></strong></div><div><span>Üst taşma</span><strong className={overhangs.length ? 'pmc-amber-text' : ''}>{overhangs.length}<small> inceleme</small></strong></div></div>
          {onImportAircraft && <div className="pmc-aircraft-transfer"><button className="outline amber" disabled={!result || stale || busy || !!result.errors?.length || !placements.length} onClick={openTransfer}>Uçak paletlerine ekle</button><p>Renkli yükler uçak 3D görünümüne kopyalanır. Mevcut yükler korunur; sonraki PMC düzenlemeleri kopyayı değiştirmez.</p></div>}
          <div className="pmc-pallet-select" aria-label="Görüntülenecek palet"><button className={selectedPallet === null ? 'active' : ''} onClick={() => { setSelectedPallet(null); setSelectedItemId(null); }}>Tüm paletler</button>{(result?.pallets || []).map(pallet => <button key={pallet.index} className={selectedPallet === pallet.index ? 'active' : ''} onClick={() => { setSelectedPallet(pallet.index); setSelectedItemId(null); }}><Cube size={17}/><span>PMC {String(pallet.index + 1).padStart(2, '0')}<small>{pallet.items.length} parça teması</small></span></button>)}</div>
          <div className="pmc-view-options"><label className="pmc-checkbox"><input type="checkbox" checked={showContour} onChange={e => setShowContour(e.target.checked)}/> Kontur</label><label className="pmc-checkbox"><input type="checkbox" checked={labels} onChange={e => setLabels(e.target.checked)}/> Etiketler</label><label className="pmc-layer">Katman üst sınırı <input aria-label="Katman üst sınırı" type="range" min="0" max="244" step="1" value={heightCut} onChange={e => setHeightCut(Number(e.target.value))}/><b>{heightCut === 244 ? 'Tümü' : `${heightCut} cm`}</b></label></div>
          {result ? <PmcScene placements={placements} palletCount={Math.max(1, palletCount)} selectedPallet={selectedPallet} selectedItemId={selectedItemId} onSelectItem={setSelectedItemId} mirrorContour={!!configForResult.mirrored} showContour={showContour} labels={labels} heightCut={heightCut === 244 ? Infinity : heightCut}/> : <div className="pmc-loading"><Cube size={48}/><p>{busy ? 'Paletler hazırlanıyor…' : 'Yüklerinizi girip yerleşimi hesaplayın.'}</p></div>}
          <div className="pmc-color-legend">{[...new Map(placements.map(item => [item.rowId, item])).values()].map(item => <span key={item.rowId}><i style={{background:item.color}}/>{item.name}</span>)}</div>
          {result && <div className="pmc-geometry-note"><Info size={17}/><p>Sezgisel geometrik arama; en iyi çözüm garantisi yoktur. Hacim, paketlerin dış ölçülerinden hesaplanır. Doluluk, net taban üzerindeki ZX-11 zarfına oranlanır; kenar boşluklarındaki taşma hacmi hariçtir. Bu görünüm uçuşa uygunluk veya operasyon onayı değildir.</p></div>}
        </section>
        {result?.unplaced?.length > 0 && <section className="panel pmc-unplaced"><h3><Warning size={19}/> Yerleşemeyen parçalar</h3><ul>{result.unplaced.map((item, i) => <li key={`${item.id}-${i}`}><b>{item.name || item.id}</b>{item.quantity ? ` (${item.quantity} adet)` : ''}: {item.reason}</li>)}</ul></section>}
        {result && <details className="panel pmc-details"><summary>Yerleşim listesi ve kontrol notları ({visibleItems.length} parça)</summary><div className="pmc-table-scroll"><table><thead><tr><th>Parça</th><th>Palet</th><th>Ölçü (G × U × Y), cm</th><th>Konum (x, y, z), cm</th><th>Durum</th></tr></thead><tbody>{visibleItems.map(item => <tr key={item.id} className={selectedItemId === item.id ? 'pmc-selected-row' : ''}><td><button className="text-btn" onClick={() => setSelectedItemId(item.id)}><i className="pmc-small-dot" style={{background:item.color}}/>{item.name} · {item.id}</button></td><td>{item.touchedPallets?.map(index => `PMC ${index + 1}`).join(' + ') || `PMC ${item.palletIndex + 1}`}</td><td>{[item.w,item.l,item.h].map(n => format(n)).join(' × ')}</td><td>{[item.x,item.y-item.palletIndex*317.5,item.z].map(n => format(n)).join(', ')}</td><td>{item.overhangCm > 0 ? `${format(item.overhangCm)} cm taşma · İncele` : 'Kontur içinde'}</td></tr>)}</tbody></table></div><p className="pmc-coordinates">x: fiziksel plakanın sol kenarından; y: ana paletin ön kenarından; z: plaka üstünden. Konumlar köşe koordinatlarıdır.</p><ul className="pmc-warning-list">{(result.warnings || []).map((item, i) => <li key={i}>{typeof item === 'string' ? item : item.message || JSON.stringify(item)}</li>)}</ul></details>}
        <div className="pmc-bottom"><span><CheckCircle size={16}/> Mevcut uçak yerleşim planınız ayrı olarak korunur.</span><button className="text-btn" onClick={() => setResetOpen(true)}><ArrowCounterClockwise size={16}/> Örnek yükleri getir</button></div>
      </div>
    </div>
    {transfer && <div className="overlay" onClick={()=>setTransfer(null)}><section className="dialog pmc-transfer-dialog" role="dialog" aria-modal="true" aria-label="PMC paletlerini uçağa ekle" onClick={e=>e.stopPropagation()}><button className="close" aria-label="Kapat" onClick={()=>setTransfer(null)}><X size={20}/></button><h2>PMC paletlerini uçağa ekle</h2><p>Her paletin palet dahil brüt ağırlığını girin. Mevcut yerleşimler ve kilitler korunur. Uygun boş örnek pozisyonlara yerleştirilir; sığmayanlar bekleyen listesine eklenir.</p><form onSubmit={submitTransfer}>{transfer.map(p=><label key={p.index}>PMC {p.index+1} · Brüt ağırlık (kg)<small>{p.unknownWeight?'Bazı parça ağırlıkları bilinmiyor. ':''}Bilinen yük: {format(p.knownWeight)} kg; palet darası dahil değil.</small><input name={'weight-'+p.index} aria-label={`PMC ${p.index+1} brüt ağırlık`} type="number" min={Math.max(.01,p.knownWeight)} step="any" required/></label>)}{transferError&&<p role="alert">{transferError}</p>}<p>Şematik simülasyon; uçak uygunluğu, bağlama ve gerçek ağırlık merkezi onayı değildir.</p><button className="primary" type="submit">Ekle ve uçakta göster</button><button type="button" className="text-btn" onClick={()=>setTransfer(null)}>Vazgeç</button></form></section></div>}
    {resetOpen && <div className="overlay" onClick={() => setResetOpen(false)}><section className="dialog pmc-reset-dialog" role="dialog" aria-modal="true" aria-label="Örnek yükleri getir" onClick={e => e.stopPropagation()}><button className="close" aria-label="Kapat" onClick={() => setResetOpen(false)}><X size={20}/></button><h2>Örnek yükleri yeniden getir?</h2><p>PMC yük listeniz ve kontur ayarlarınız örnek değerlere döner. Uçak yerleşim planınız değişmez.</p><button className="primary" onClick={() => { const nextRows = freshRows(); const nextConfig = { ...DEFAULT_CONFIG }; setRows(nextRows); setConfig(nextConfig); setResetOpen(false); calculate(nextRows, nextConfig); }}>Örnek yükleri getir</button><button className="text-btn" onClick={() => setResetOpen(false)}>Vazgeç</button></section></div>}
  </section>;
}
