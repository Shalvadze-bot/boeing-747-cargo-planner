export const LIMITS = { bytes: 15 * 1024 * 1024, pages: 8, pixels: 12000000 };
export function checkFile(file) {
  if (!file || file.size > LIMITS.bytes || file.size === 0) throw new Error('Boş dosya veya dosya 15 MB sınırını aşıyor.');
  if (!['application/pdf','image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Yalnızca PDF, PNG, JPEG veya WebP seçin.');
}
export async function readCargoDocument(file, { signal, onProgress = () => {}, forceOcr = false } = {}) {
  checkFile(file);
  let worker, pdf, loading, bitmap;
  const abort = () => { worker?.terminate(); loading?.destroy(); };
  const check = () => { if (signal?.aborted) throw new DOMException('İptal edildi','AbortError'); };
  signal?.addEventListener('abort',abort,{once:true});
  async function ocr(input) {
    check();
    if (!worker) {
      const { createWorker } = await import('tesseract.js');
      check();
      const assets = new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href).href;
      worker = await createWorker('eng', 1, { workerPath: `${assets}worker.min.js`, corePath: assets, langPath: assets, workerBlobURL: false, gzip: true, logger: info => { if (!signal?.aborted && info.status === 'recognizing text') onProgress(`Metin okunuyor: %${Math.round(info.progress * 100)}`); } });
      check();
    }
    const { data } = await worker.recognize(input);
    check();
    return data.text;
  }
  try {
    check();
    if (file.type !== 'application/pdf') {
      bitmap = await createImageBitmap(file); check();
      if (bitmap.width * bitmap.height > LIMITS.pixels) throw new Error('Görsel 12 megapiksel sınırını aşıyor. Küçültüp tekrar deneyin.');
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap,0,0);
      return await ocr(canvas);
    }
    const pdfjs = await import('pdfjs-dist');
    const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    check(); pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
    check(); pdf = await loading.promise; check();
    if (pdf.numPages > LIMITS.pages) throw new Error('PDF en fazla 8 sayfa olabilir. Gerekli sayfaları ayrı dosya olarak seçin.');
    const output = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      check(); onProgress(`PDF sayfası ${index}/${pdf.numPages} okunuyor`);
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      let text = '', lastY = null;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y-lastY) > 3) text += '\n';
        text += item.str + (item.hasEOL ? '\n' : ' '); lastY = y;
      }
      if (forceOcr || text.replace(/\s/g,'').length < 20) {
        const original = page.getViewport({scale:1});
        const scale = Math.min(2, Math.sqrt(4000000 / (original.width * original.height)));
        const viewport = page.getViewport({scale});
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise; check();
        text = await ocr(canvas); canvas.width = canvas.height = 0;
      }
      output.push(text); page.cleanup();
    }
    return output.join('\n\n').slice(0,100000);
  } finally {
    signal?.removeEventListener('abort',abort);
    bitmap?.close();
    if (worker) await worker.terminate().catch(() => {});
    if (pdf) await pdf.destroy().catch(() => {});
    else if (loading) await loading.destroy().catch(() => {});
  }
}
