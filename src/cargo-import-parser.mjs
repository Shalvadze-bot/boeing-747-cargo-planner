// Conservative extraction: a dimension triplet is a candidate, never a completed cargo row.
const NUM = '(\\d+(?:[.,]\\d+)?)';
const UNIT = '(mm|cm|m|in|inch|inches)?';
const TRIPLET = new RegExp(`(?<![\\d.,+\\-])${NUM}\\s*${UNIT}\\s*[x×*]\\s*${NUM}\\s*${UNIT}\\s*[x×*]\\s*${NUM}\\s*${UNIT}(?![a-z])`, 'gi');
const number = value => Number(value.replace(',', '.'));
// Recognize complete, explicit column labels only; arbitrary numeric tables are ignored.
function tableCells(line, delimiter) {
  const normalized = line.trim().replace(/\b(length|width|height|uzunluk|genişlik|yükseklik)\s+\((mm|cm|m|in)\)/gi, '$1($2)');
  return delimiter ? normalized.split(delimiter).map(cell => cell.trim()) : normalized.split(/\s+/);
}
function tableHeader(line) {
  const delimiter = line.includes('\t') ? '\t' : line.includes('|') ? '|' : line.includes(';') ? ';' : null;
  const cells = tableCells(line, delimiter);
  const columns = cells.map(cell => {
    const normalized = cell.toLowerCase().replace(/\u0307/g, '');
    const dimension = normalized.match(/^(length|width|height|uzunluk|genişlik|yükseklik)(?:\((mm|cm|m|in)\))?$/);
    if (dimension) return { key: ({length:'L',uzunluk:'L',width:'W',genişlik:'W',height:'H',yükseklik:'H'})[dimension[1]], unit:dimension[2] || '' };
    return { key: ({qty:'Q',quantity:'Q',adet:'Q',pcs:'Q',name:'N',description:'N',cargo:'N',parça:'N',ürün:'N',unit:'U',birim:'U'})[normalized], unit:'' };
  });
  const keys = columns.map(column => column.key);
  if (keys.some(key => !key) || new Set(keys).size !== keys.length || !['L','W','H'].every(key => keys.includes(key))) return null;
  return { columns, delimiter, source:line.trim() };
}
function tableRow(line, header, lineIndex) {
  const cells = tableCells(line, header.delimiter);
  if (cells.length !== header.columns.length) return null;
  const dims = [], units = [];
  let name = `Satır ${lineIndex + 1}`, quantity = '', unitColumn = '';
  for (const [index,column] of header.columns.entries()) {
    const value = cells[index];
    if (['L','W','H'].includes(column.key)) {
      if (!/^\d+(?:[.,]\d+)?$/.test(value)) return null;
      dims.push(String(number(value))); units.push(column.unit);
    } else if (column.key === 'Q') {
      if (value && !/^\d+(?:[.,]\d+)?$/.test(value)) return null;
      quantity = value;
    } else if (column.key === 'N') name = value;
    else unitColumn = value.toLowerCase();
  }
  // A unit column explicitly governs the row. Partial dimension-unit labels do not.
  const explicitUnits = units.filter(Boolean);
  if (unitColumn && !['mm','cm','m','in'].includes(unitColumn)) return null;
  const mixedUnits = new Set([...explicitUnits,...(unitColumn ? [unitColumn] : [])]).size > 1;
  const unit = mixedUnits ? '' : unitColumn || (units.every(Boolean) ? units[0] : '');
  return { name, a:dims[0], b:dims[1], c:dims[2], quantity, unit, order:'', source:`${header.source}\n${line.trim()}`, mixedUnits };
}
export function parseCargoText(text) {
  const rows = [];
  let header = null;
  for (const [lineIndex, line] of String(text).slice(0, 100000).split(/\r?\n/).entries()) {
    const nextHeader = tableHeader(line);
    if (nextHeader) { header = nextHeader; continue; }
    const triplets = [...line.matchAll(TRIPLET)];
    if (!triplets.length && header && line.trim()) {
      const candidate = tableRow(line, header, lineIndex);
      if (candidate) {
        rows.push(candidate);
        if (rows.length >= 40) return rows;
        continue;
      }
      header = null; // Do not apply stale headers after prose or incompatible rows.
    }
    if (triplets.length) header = null;
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
