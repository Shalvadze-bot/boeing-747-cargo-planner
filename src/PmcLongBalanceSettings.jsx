import React from 'react';

const fields = [
  ['Boş PMC', [
    ['tare','Palet ağırlığı (kg)',0.01],['tareX','Palet merkezi X (cm)'],
    ['tareY','Palet merkezi Y (cm)'],['tareZ','Palet merkezi Z (cm)'],
  ]],
  ['Operatörün onaylı sınırları', [
    ['minX','En küçük X (cm)'],['maxX','En büyük X (cm)'],
    ['minY','En küçük Y (cm)'],['maxY','En büyük Y (cm)'],
    ['maxZ','En büyük Z (cm, isteğe bağlı)'],['maxGross','Brüt ağırlık (kg, isteğe bağlı)',0.01],
  ]],
];

export default function PmcLongBalanceSettings({profile, onChange}) {
  return <details className="panel pmc-balance-settings">
    <summary>PMC ağırlık merkezi ayarları</summary>
    <p>Parça ağırlıklarını yük listesinde girin. Parçanın ağırlık merkezi kutunun ortasında varsayılır.
      X ve Y fiziksel palet kenarlarından, Z palet üst yüzeyinden ölçülür.</p>
    <div className="pmc-balance-groups">
      {fields.map(([group,inputs])=><fieldset key={group}>
        <legend>{group}</legend>
        {inputs.map(([key,label,min])=><label key={key}>{label}
          <input aria-label={label} type="number" step="any" min={min} value={profile?.[key]??''}
            onChange={event=>onChange(key,event.target.value)}/>
        </label>)}
      </fieldset>)}
    </div>
    <p>Parça veya boş palet verileri ya da X/Y sınırları eksikse yerleşim geometrik kurallarla hesaplanır. Ağırlık dengesi doğrulanmaz.</p>
  </details>;
}
