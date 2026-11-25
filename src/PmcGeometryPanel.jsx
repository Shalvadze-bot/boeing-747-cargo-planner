import React from 'react';

const issueLabels = {
  INVALID_INPUT:'Geçersiz girdi', INVALID_OR_DUPLICATE_ITEM:'Geçersiz / tekrar eden parça',
  INVALID_ORIENTATION_SET:'Geçersiz yön izinleri', MISSING_GEOMETRY_PARAMETER:'Geometri verisi eksik',
  INVALID_GEOMETRY_PARAMETER:'Geometri girdisi geçersiz', LONGITUDINAL_PROFILE_NOT_DEFINED:'Boyuna kontur bilinmiyor',
  UNKNOWN_OR_DUPLICATE_PLACEMENT:'Bilinmeyen / tekrar eden yerleşim', INVALID_PLACEMENT:'Geçersiz koordinat veya ölçü',
  ORIENTATION_NOT_SPECIFIED:'Dik yön doğrulanamadı', ORIENTATION_OUTSIDE_V1:'Yön V1 kapsamı dışında',
  ORIENTATION_DIMENSION_MISMATCH:'Yön ve ölçü uyuşmuyor', ORIENTATION_PERMISSION_UNKNOWN:'Dönüş izni bilinmiyor',
  ORIENTATION_FORBIDDEN:'İzin verilmeyen dönüş', NEGATIVE_LOCAL_COORDINATE:'Taban başlangıcı aşıldı',
  ELEVATED_SUPPORT_OUTSIDE_V1:'İstif desteği V1 kapsamı dışında', USABLE_BASE_EXCEEDED:'Net taban aşıldı',
  CONTOUR_WIDTH_EXCEEDED:'Contour 1 genişliği aşıldı', CONTOUR_HEIGHT_EXCEEDED:'Contour 1 yüksekliği aşıldı',
  INVALID_TRANSFORM:'Geçersiz datum dönüşümü', UNKNOWN_OR_DUPLICATE_UNPLACED:'Yerleşmeyen parça kaydı geçersiz',
  ITEM_NOT_ACCOUNTED_FOR:'Parça kaydı eksik', BOX_OVERLAP:'Parçalar çakışıyor',
  HORIZONTAL_CLEARANCE_EXCEEDED:'Araştırma paket aralığı sağlanmadı', NO_PLACED_ITEMS:'Kontrol edilecek yerleşim yok',
};
const fmt = n => Number.isFinite(n) ? n.toLocaleString('tr-TR',{maximumFractionDigits:2})+' mm' : '—';

export default function PmcGeometryPanel({assessment,settings,onSetting,onItem,usesContour=false,displayedProfile='ZX-11',settingsReadOnly=false}) {
  const {report,status,phase,message,violationIds,placedIds}=assessment;
  const fails=report?.issues.filter(i=>i.status==='FAIL').length ?? 0;
  const unknowns=report?.issues.filter(i=>i.status==='UNKNOWN').length ?? 0;
  return <section className="pmc-research-validator" aria-label="A330 Contour 1 araştırma doğrulaması" data-research-status={status}>
    <div className="pmc-research-heading">
      <div><h3>A330-243F · Geometry Validator V1</h3><p>Avianca A330-200F Contour 1 · ana güverte araştırma referansı</p></div>
      <strong className={'pmc-research-status pmc-research-'+status.toLowerCase()} aria-live="polite">{status}</strong>
    </div>
    <p>Çizilen plan <b>{displayedProfile}</b> modelini kullanır. Bağımsız kontrol <b>Avianca Contour 1</b> modelini kullanır.</p>
    <p className="pmc-research-notice">SİMÜLASYON — Operasyon onayı yok. Hedef operatöre uygulanabilirlik doğrulanmadı.</p>
    {phase==='checked' ? <>
      <p aria-live="polite">{report.placedCount} yerleşen · {report.unplacedCount} yerleşmeyen · {violationIds.length} işaretli parça · {fails} ihlal / {unknowns} belirsizlik</p>
      <p>En dar hesaplanan dikey pay <b>{fmt(report.minVerticalMarginMm)}</b> · {report.complete ? 'Tüm parçalar yerleşti.' : 'Yerleşim tamamlanmadı.'}</p>
      <p>Kırmızı kenarlar Contour 1 araştırma kontrolünde işaretlenen parçaları gösterir.</p>
    </> : <p role="status">{message}</p>}
    <details className="pmc-research-details">
      <summary>Araştırma ölçüleri ve kontrol notları</summary>
      <p>Varsayımsal net taban: 2268,4 × 3005 mm. Kesit: 92 inç genişlik; 96, 72 ve 37 inç yükseklikler; 38 ve 74 inç kırılma konumları. Boyuna sabit kesit varsayılmıştır.</p>
      <div className="pmc-research-fields">
        {[
          ['gapMm','Paket aralığı (mm)'],
          ['offsetMm','Yüksek kenar datumu (mm)'],
          ['verticalMm','Dikey datum (mm)']
        ].map(([key,label])=><label key={key}>{label}<input aria-label={'Araştırma '+label} type="number" min="0" step="0.1" value={settings[key]} disabled={settingsReadOnly} onChange={e=>onSetting(key,e.target.value)}/></label>)}
      </div>
      <p>{usesContour ? 'V2 motoru, çizim ve doğrulama aynı araştırma ayarlarını kullanır. Değişiklikten sonra planı yeniden hesaplayın.' : 'Bu ayarlar araştırma kontrolünü değiştirir. ZX-11 yerleşimi aynı kalır.'}</p>
      {report?.issues.length>0 && <ul className="pmc-research-issues">{report.issues.slice(0,50).map((issue,index)=><li key={index}>
        <b>{issue.status}:</b> {issueLabels[issue.code]||issue.code}
        {Number.isFinite(issue.verticalMarginMm)&&' · '+fmt(issue.verticalMarginMm)}
        {issue.ids.length>0&&<> · {issue.ids.map((id,j)=>placedIds.includes(id)?<button key={j} type="button" className="text-btn" onClick={()=>onItem(id)}>{id}</button>:<span key={j}>{id} </span>)}</>}
      </li>)}</ul>}
      {report?.issues.length>50&&<p>{report.issues.length-50} ek kontrol kaydı.</p>}
      <p>İstif desteği, CG, zemin yükü, ambalaj dayanımı, bağlama ve kapı geçişi doğrulanmaz. <a href="https://www.aviancacargo.com/downloads/oversize_eng.pdf#page=4" target="_blank" rel="noreferrer">Kaynak: Avianca, s. 4</a></p>
    </details>
  </section>;
}
