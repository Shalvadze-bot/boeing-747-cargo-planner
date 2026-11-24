import readXlsxFile from 'read-excel-file/web-worker';
import { extractTable } from './chat-manifest-parser.mjs';

function verifyWorkbook(buffer) {
  const data = new DataView(buffer);
  // Reject ZIP64, encrypted entries and workbooks that expand beyond the parser budget.
  let end = -1;
  for (let i = data.byteLength-22; i >= Math.max(0,data.byteLength-65557); i--) {
    if (data.getUint32(i,true)===0x06054b50 && i+22+data.getUint16(i+20,true)===data.byteLength) { end=i; break; }
  }
  if (end===-1) throw new Error('Geçerli bir .xlsx çalışma kitabı seçin.');
  let offset = data.getUint32(end+16,true), total = 0;
  const count = data.getUint16(end+10,true);
  if (count<1 || count>180) throw new Error('Excel çalışma kitabı çok büyük.');
  for (let i=0;i<count;i++) {
    if (offset+46>end || data.getUint32(offset,true)!==0x02014b50 || data.getUint16(offset+8,true)&1) throw new Error('Excel arşivi okunamadı.');
    total += data.getUint32(offset+24,true);
    if (total>20_000_000) throw new Error('Excel çalışma kitabı açıldığında boyut sınırını aşıyor.');
    offset += 46+data.getUint16(offset+28,true)+data.getUint16(offset+30,true)+data.getUint16(offset+32,true);
  }
}

self.onmessage = async ({data:file}) => {
  try {
    const bytes = await file.arrayBuffer();
    verifyWorkbook(bytes);
    const sheets = await readXlsxFile(file);
    const results = sheets.flatMap(sheet=>extractTable(sheet.data));
    self.postMessage({rows:results.slice(0,100),capped:results.length>=100});
  } catch (error) {
    self.postMessage({error:error instanceof Error?error.message:'Excel çalışma kitabı okunamadı.'});
  }
};
