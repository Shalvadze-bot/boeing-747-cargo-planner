import React, { useEffect, useRef, useState } from 'react';
import { parseCargoText, reviewRow, ORDERS } from './cargo-import-parser.mjs';
import { readCargoDocument } from './cargo-document-reader.mjs';
import './cargo-import.css';
const orderLabel = order => [...order].map(v => ({L:'Uzunluk',W:'Genişlik',H:'Yükseklik'}[v])).join(' × ');
export default function CargoImport({ onImport }) {
  const [file,setFile] = useState(null), [busy,setBusy] = useState(false), [status,setStatus] = useState('');
  const [text,setText] = useState(''), [rows,setRows] = useState([]), [reviewed,setReviewed] = useState(false);
  const [forceOcr,setForceOcr] = useState(false);
  const controller = useRef(null), generation = useRef(0);
  useEffect(() => () => { generation.current++; controller.current?.abort(); },[]);
  const cancel = () => { generation.current++; controller.current?.abort(); setBusy(false); setStatus('Okuma iptal edildi. Tekrar deneyebilirsiniz.'); };
  async function read() {
    if (!file) return;
    controller.current?.abort(); const run = ++generation.current;
    controller.current = new AbortController(); setBusy(true); setStatus('Dosya bu tarayıcıda okunuyor…'); setRows([]); setText(''); setReviewed(false);
    try {
      const value = await readCargoDocument(file,{signal:controller.current.signal,forceOcr,onProgress:message => {if(run === generation.current)setStatus(message);}});
      if(run !== generation.current)return;
      setText(value); const parsed = parseCargoText(value); setRows(parsed);
      setStatus(parsed.length ? `${parsed.length} aday satır bulundu. Belgedeki tüm satırların bulunduğunu ve ölçüleri kontrol edin. En fazla 40 satır çıkarılır.` : 'Ölçü üçlüsü bulunamadı. Metni düzeltip yeniden ayrıştırın veya elle satır ekleyin.');
    } catch(error) { if(run === generation.current)setStatus(error.name === 'AbortError' ? 'İptal edildi.' : `Okunamadı: ${error.message}`); }
    finally { if(run === generation.current)setBusy(false); }
  }
  function patch(index,key,value) {setRows(prev => prev.map((row,i) => i===index ? {...row,[key]:value} : row));setReviewed(false);}
  const checked = rows.map(reviewRow);
  const valid = rows.length > 0 && checked.every(result => result.errors.length === 0);
  return <section className="cargo-import" aria-label="Belgeden yük aktarımı">
    <h3>Fotoğraf / PDF’den yük ekle</h3>
    <p>Dosya yalnızca tarayıcınızda işlenir. OCR hata yapabilir: adet, ölçü, birim ve sırayı belgeyle karşılaştırın. Otomatik yerleştirme yapılmaz.</p>
    <p className="cargo-import-hint">PDF (en fazla 8 sayfa), PNG, JPEG, WebP • 15 MB • görseller en fazla 12 MP. İngilizce/rakam odaklı OCR; Türkçe adları düzeltmeniz gerekebilir.</p>
    <div className="cargo-import-actions"><input aria-label="Yük belgesi seç" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={busy} onChange={e => {setFile(e.target.files?.[0] || null);setRows([]);setText('');setStatus('');setReviewed(false);}}/><button type="button" disabled={!file || busy} onClick={read}>Dosyayı oku / tekrar dene</button>{busy && <button type="button" onClick={cancel}>İptal</button>}</div>
    {file?.type === 'application/pdf' && <label className="cargo-import-confirm"><input type="checkbox" disabled={busy} checked={forceOcr} onChange={e=>setForceOcr(e.target.checked)}/>PDF’yi görüntü olarak oku (taranmış veya kısmen taranmış tablolar için daha yavaş OCR)</label>}
    <p role="status" aria-live="polite">{status}</p>
    {(text || rows.length > 0) && <>
      <label>Çıkarılan ham metin (düzenlenebilir)<textarea value={text} onChange={e => {setText(e.target.value);setReviewed(false);}} rows={6}/></label>
      <button type="button" disabled={busy} onClick={() => {setRows(parseCargoText(text));setReviewed(false);setStatus('Metin yeniden ayrıştırıldı; önceki satır düzeltmeleri yenilendi.');}}>Metinden satırları yeniden oluştur</button>
      <p>Ölçü sırası her satır için özellikle seçilmelidir. Boş adet/birim tahmin edilmez. Karışık birimli ölçüleri önce tek birime çevirin.</p>
    </>}
    {rows.map((row,index) => <fieldset key={index}><legend>Aday {index+1}</legend><small>{row.source}</small>{row.mixedUnits && <p className="cargo-import-error">Belgede karışık birimler var. Üç değeri aynı birime çevirin.</p>}
      <div className="cargo-import-grid">
        <label>Parça adı<input maxLength={60} value={row.name} onChange={e=>patch(index,'name',e.target.value)}/></label>
        {['a','b','c'].map((key,i)=><label key={key}>Ölçü {i+1}<input inputMode="decimal" value={row[key]} onChange={e=>patch(index,key,e.target.value)}/></label>)}
        <label>Adet<input inputMode="numeric" value={row.quantity} onChange={e=>patch(index,'quantity',e.target.value)}/></label>
        <label>Birim<select value={row.unit} onChange={e=>patch(index,'unit',e.target.value)}><option value="">Seçin</option>{['cm','mm','m','in'].map(unit=><option key={unit} value={unit}>{unit}</option>)}</select></label>
        <label>Belgedeki ölçü sırası<select value={row.order} onChange={e=>patch(index,'order',e.target.value)}><option value="">Sırayı doğrulayın</option>{ORDERS.map(order=><option key={order} value={order}>{orderLabel(order)}</option>)}</select></label>
      </div>
      {checked[index].errors.length > 0 ? <p className="cargo-import-error">{checked[index].errors.join(' • ')}</p> : <p>Listeye: {checked[index].row.length.toFixed(2)} × {checked[index].row.width.toFixed(2)} × {checked[index].row.height.toFixed(2)} cm (U × G × Y), {checked[index].row.quantity} adet</p>}
      <button type="button" onClick={()=>{setRows(rows.filter((_,i)=>i!==index));setReviewed(false);}}>Adayı kaldır</button>
    </fieldset>)}
    <div className="cargo-import-actions"><button type="button" disabled={busy || rows.length >= 40} onClick={()=>{setRows([...rows,{name:'',a:'',b:'',c:'',quantity:'',unit:'',order:'',source:'Elle eklenen aday'}]);setReviewed(false);}}>Elle aday satır ekle</button></div>
    {rows.length > 0 && <><label className="cargo-import-confirm"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>Tüm adayları belgeyle karşılaştırdım; eksik satırları, adetleri, ölçü sırasını ve birimleri kontrol ettim.</label><p>Ağırlık bilinmiyor olarak eklenir. Döndürme ve istifleme kapalı başlar.</p><button type="button" disabled={busy || !valid || !reviewed} onClick={()=>{if(onImport(checked.map(item=>item.row)) === false){setStatus('Satırlar eklenemedi. Liste sınırını kontrol edin; adaylarınız korunuyor.');return;}setRows([]);setText('');setReviewed(false);setStatus('Onaylanan satırlar listeye eklendi. Yerleştirmeyi ayrıca hesaplayın.');}}>Listeye ekle ({rows.length})</button></>}
  </section>;
}
