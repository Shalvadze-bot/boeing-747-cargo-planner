import React from 'react';

const format = n => Number(n).toLocaleString('tr-TR', { maximumFractionDigits:2 });
const measure = n => `${format(n)} cm / ${format(n/2.54)}″`;
const names = {
  manual:'Elle yatay konum', high:'Yüksek kontur tarafına hizalı', center:'Ortalı',
  group:'Kontura ve boş alana göre konum', front:'Ön uzun kenar · X=0', rear:'Arka uzun kenar · X=243,84',
  left:'Sol kısa kenar · Y=0', right:'Sağ kısa kenar · Y=317,5',
};

function PieceDetails({piece}) {
  const {overhang,usableBoundaryExcess}=piece;
  return <section>
    <h4>{piece.name} · {piece.id}</h4>
    <p>{names[piece.alignment]} · {piece.rotated ? '90° döndürülmüş' : 'Orijinal yön'}</p>
    <p>Fiziksel plaka kenarından taşma: ön uzun kenar {measure(overhang.left)} · arka uzun kenar {measure(overhang.right)} · sol kısa kenar {measure(overhang.front)} · sağ kısa kenar {measure(overhang.rear)}.</p>
    <p>Net kullanılabilir sınır aşımı (8,5 cm kenar boşluğu dahil): ön uzun {measure(usableBoundaryExcess.left)} · arka uzun {measure(usableBoundaryExcess.right)} · sol kısa {measure(usableBoundaryExcess.front)} · sağ kısa {measure(usableBoundaryExcess.rear)}.</p>
    <p>{piece.rationale}</p>
    {!!piece.candidates.length && <details>
      <summary>Tek parçanın yerleşim seçenekleri</summary>
      <ul>{piece.candidates.map((candidate,i)=><li key={i}>
        {names[candidate.alignment]} / {candidate.rotated?'90°':'0°'}: {candidate.positionCount} pozisyon; sol kısa {measure(candidate.overhang.front)}, sağ kısa {measure(candidate.overhang.rear)}, ön uzun {measure(candidate.overhang.left)}, arka uzun {measure(candidate.overhang.right)}
      </li>)}</ul>
    </details>}
  </section>;
}

export default function LongCargoDetails({pallets}) {
  return <section className="pmc-long-details">
    <h3>Şematik uçak pozisyonları</h3>
    <p>Her PMC ayrı bir tek katmanlı senaryodur. Aynı PMC’deki parçaların taşma alanları birlikte gösterilir. S(x,y) adresleri örnektir.</p>
    {pallets.map(pallet=><article key={pallet.index}>
      <h4>PMC {String(pallet.index+1).padStart(2,'0')}</h4>
      <p><b>1 fiziksel PMC</b> · <b>{pallet.items.length} parça</b> · <b>{pallet.positionCount} şematik pozisyon</b></p>
      <div className="pmc-slot-scroll">
        <div className="pmc-slot-map" style={{gridTemplateColumns:`repeat(${new Set(pallet.positions.map(position=>position.x)).size}, minmax(90px, 1fr))`}}>
          {pallet.positions.map(position=><div key={position.id} className={position.support?'support':'blocked'}>
            <strong>{position.id}</strong><span>{position.support?'Destek PMC':'BOŞ BIRAK'}</span>
          </div>)}
        </div>
      </div>
      <p>Boş bırakılacak: {pallet.blockedPositions.map(position=>position.id).join(', ') || 'Yok'}.</p>
      {pallet.items.map(piece=><PieceDetails key={piece.id} piece={piece}/>)}
      <p className="pmc-caution">Teknik doğrulama bekliyor. Destek alanına temas, taşıma kapasitesi veya denge onayı değildir. “BOŞ BIRAK” alanları ayrılır. Bu test planı uçak planına aktarılmaz.</p>
    </article>)}
  </section>;
}
