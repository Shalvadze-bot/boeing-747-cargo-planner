import { parseCargoText } from './cargo-import-parser.mjs';
import { readCargoDocument } from './cargo-document-reader.mjs';
import { extractTable, parseCsv, MAX_ROWS } from './chat-manifest-parser.mjs';

function readWorkbook(file, signal) {
  return new Promise((resolve,reject)=>{
    const worker = new Worker(new URL('./chat-xlsx-worker.mjs',import.meta.url),{type:'module'});
    const finish = (callback,value) => {
      clearTimeout(timer);
      signal.removeEventListener('abort',abort);
      worker.terminate();
      callback(value);
    };
    const abort = () => finish(reject,signal.reason);
    const timer = setTimeout(()=>finish(reject,new Error('Excel okuma süresi doldu.')),15000);
    signal.addEventListener('abort',abort,{once:true});
    worker.onmessage = ({data}) => data.error ? finish(reject,new Error(data.error)) : finish(resolve,data);
    worker.onerror = () => finish(reject,new Error('Excel çalışma kitabı açılamadı.'));
    worker.postMessage(file);
  });
}

export async function readChatManifest(file, signal, progress) {
  signal.throwIfAborted();
  if (/\.(xlsx|csv)$/i.test(file.name) && (file.size < 1 || file.size > 2_000_000)) throw new Error('Excel ve CSV için en fazla 2 MB yükleyin.');
  if (/\.xlsx$/i.test(file.name)) {
    progress('Excel çalışma kitabı okunuyor');
    return readWorkbook(file,signal);
  }
  if (/\.csv$/i.test(file.name)) {
    progress('CSV satırları okunuyor');
    const text = await file.text();
    signal.throwIfAborted();
    const tables = [];
    for (const delimiter of [',',';','\t']) {
      try { tables.push(extractTable(parseCsv(text,delimiter))); } catch { /* Try the next delimiter. */ }
    }
    if (!tables.length) throw new Error('CSV satırları okunamadı.');
    const rows = tables.sort((a,b)=>b.length-a.length)[0];
    return {rows:rows.length?rows:parseCargoText(text),capped:rows.length===MAX_ROWS};
  }
  const text = await readCargoDocument(file,{signal,onProgress:progress});
  const rows = parseCargoText(text);
  return {rows,capped:rows.length>=40};
}
