// Conservative extraction: a dimension triplet is a candidate, never a completed cargo row.
const NUM = '(\\d+(?:[.,]\\d+)?)';
const UNIT = '(mm|cm|m|in|inch|inches)?';
const TRIPLET = new RegExp(`(?<![\\d.,+\\-])${NUM}\\s*${UNIT}\\s*[x×*]\\s*${NUM}\\s*${UNIT}\\s*[x×*]\\s*${NUM}\\s*${UNIT}(?![a-z])`, 'gi');
const number = value => Number(value.replace(',', '.'));
export function parseCargoText(text) {
  const rows = [];
  for (const [lineIndex, line] of String(text).slice(0, 100000).split(/\r?\n/).entries()) {
    const triplets = [...line.matchAll(TRIPLET)];
    for (const match of triplets) {
      const units = [match[2],match[4],match[6]].filter(Boolean).map(x => /^inch/.test(x) ? 'in' : x.toLowerCase());
      const quantityMatches = [...line.matchAll(/(?:adet|qty|quantity|pcs|pieces|parça)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\b|\b(\d+(?:[.,]\d+)?)\s*(?:adet|pcs|pieces|parça)\b/gi)];
      const quantity = quantityMatches.length === 1 && triplets.length === 1 ? (quantityMatches[0][1] || quantityMatches[0][2]) : '';
      const prefix = line.slice(0, match.index).replace(/(?:adet|qty|quantity|pcs|pieces|parça)\s*[:=]?\s*\d+(?:[.,]\d+)?/gi,'').trim().replace(/[|:;,\-]+$/,'').trim();
      rows.push({ name: prefix || `Satır ${lineIndex + 1}`, a: String(number(match[1])), b: String(number(match[3])), c: String(number(match[5])), quantity, unit: new Set(units).size === 1 ? units[0] : '', order: '', source: line.trim(), mixedUnits: new Set(units).size > 1 });
      if (rows.length >= 40) return rows;
    }
  }
  return rows;
}
export const ORDERS = ['LWH','LHW','WLH','WHL','HLW','HWL'];
export const FACTORS = { cm: 1, mm: .1, m: 100, in: 2.54 };
export function reviewRow(row) {
  const errors = [];
  const values = [row.a,row.b,row.c].map(v => Number(String(v).replace(',', '.')));
  if (!row.name?.trim()) errors.push('Parça adı gerekli');
  if (row.name?.trim().length > 60) errors.push('Parça adı en fazla 60 karakter olmalı');
  if (values.some(v => !Number.isFinite(v) || v <= 0)) errors.push('Üç pozitif ölçü gerekli');
  const quantity = Number(String(row.quantity).replace(',', '.'));
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 200) errors.push('Adet 1–200 arasında tam sayı olmalı');
  if (!ORDERS.includes(row.order)) errors.push('Ölçü sırasını seçin');
  if (!Object.hasOwn(FACTORS, row.unit)) errors.push('Birimi seçin');
  if (errors.length) return { errors, row: null };
  const dims = Object.fromEntries([...row.order].map((key,i) => [key, values[i] * FACTORS[row.unit]]));
  if (Object.values(dims).some(v => !Number.isFinite(v) || v > 100000)) return {errors:['Ölçü çok büyük; birimi kontrol edin'],row:null};
  return {errors:[],row:{name:row.name.trim(),length:dims.L,width:dims.W,height:dims.H,quantity,weight:null,allowRotation:false,stackable:false}};
}
