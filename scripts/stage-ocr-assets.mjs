import { mkdir, copyFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'public/ocr');
await rm(target, {recursive:true,force:true});
await mkdir(target,{recursive:true});
await copyFile(path.join(root,'node_modules/tesseract.js/dist/worker.min.js'),path.join(target,'worker.min.js'));
for (const file of await readdir(path.join(root,'node_modules/tesseract.js-core'))) {
  if (/\.wasm(?:\.js)?$/.test(file)) await copyFile(path.join(root,'node_modules/tesseract.js-core',file),path.join(target,file));
}
await copyFile(path.join(root,'node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz'),path.join(target,'eng.traineddata.gz'));
console.log('Staged local OCR worker, WASM and English/numeric language data.');
