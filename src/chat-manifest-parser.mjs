import { reviewRow } from './cargo-import-parser.mjs';

export const MAX_ROWS = 100;
const normalized = text => String(text).normalize('NFD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').trim();

function field(value) {
  const text = normalized(value).replace(/[_-]/g,' ').replace(/\s+/g,' ');
  const dim = text.match(/^(l|w|h|length|width|height|uzunluk|genislik|yukseklik)\s*\(?(mm|cm|m|in)?\)?$/);
  if (dim) return [({l:'L',length:'L',uzunluk:'L',w:'W',width:'W',genislik:'W',h:'H',height:'H',yukseklik:'H'})[dim[1]], dim[2]];
  if (/^(qty|quantity|adet|pieces|pcs|total pallets|pallet count)$/.test(text)) return ['quantity'];
  if (/^(name|description|cargo|parca|urun|yuk adi|item)$/.test(text)) return ['name'];
  if (/^(ref\.?|reference|cargo reference|plt no\.?|pallet no\.?|referans|palet no\.?)$/.test(text)) return ['reference'];
  if (/^(unit|birim)$/.test(text)) return ['unit'];
  if (/^(weight|agirlik|unit weight|parca agirligi)\s*\(?(kg|kgs)\)?$/.test(text)) return ['weight'];
  if (/^(gross weight|brut agirlik)\s*\(?(kg|kgs)\)?$/.test(text)) return ['gross'];
  return [];
}

export function parseCsv(text, delimiter) {
  const rows = [];
  let row = [], value = '', quoted = false;
  const source = text.replace(/^\uFEFF/,'');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"' && (quoted || !value.trim())) {
      if (quoted && source[i+1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      row.push(value.trim()); value = '';
    } else if (!quoted && (char === '\r' || char === '\n')) {
      if (char === '\r' && source[i+1] === '\n') i++;
      row.push(value.trim()); if (row.some(Boolean)) rows.push(row);
      row = []; value = '';
      if (rows.length === 1000) break;
    } else value += char;
  }
  if (quoted) throw new Error('CSV tırnakları eşleşmiyor.');
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function extractTable(table) {
  const rows = [];
  let columns;
  for (const [index,raw] of table.slice(0,1000).entries()) {
    const cells = raw.map(v=>v==null?'':String(v).slice(0,160));
    const fields = cells.map(field);
    if (['L','W','H'].every(key=>fields.filter(f=>f[0]===key).length===1)) { columns=fields; continue; }
    if (!columns) continue;
    const values = Object.fromEntries(columns.filter(([key])=>key).map(([key])=>[key,'']));
    columns.forEach(([key],i)=>{ if (key) values[key]=cells[i]??''; });
    if (![values.L,values.W,values.H].every(v=>/^\d+(?:[.,]\d+)?$/.test(v))) continue;
    const explicit = columns.filter(([key])=>['L','W','H'].includes(key)).map(([,unit])=>unit);
    const units = new Set([...explicit,...(values.unit?[normalized(values.unit)]:[])].filter(Boolean));
    const unit = units.size===1 && (values.unit || explicit.every(Boolean)) ? [...units][0] : '';
    const quantity = values.quantity || '';
    const weight = values.weight || (Number(quantity)===1 ? values.gross : '') || '';
    const name = [values.reference,values.name].filter(Boolean).join(' · ') || `Satır ${index+1}`;
    rows.push({name:name.slice(0,60),a:values.L,b:values.W,c:values.H,quantity,weight,order:'LWH',unit,source:cells.join(' · ')});
    if (rows.length === MAX_ROWS) break;
  }
  return rows;
}

export function checkChatRow(row) {
  const checked = reviewRow(row);
  if (!checked.row || !String(row.weight??'').trim()) return checked;
  const weight = Number(String(row.weight).trim().replace(',','.'));
  if (!(weight > 0 && Number.isFinite(weight) && weight <= 1e7)) return {row:null,errors:['Ağırlık kg olarak pozitif olmalı.']};
  return {...checked,row:{...checked.row,weight}};
}
