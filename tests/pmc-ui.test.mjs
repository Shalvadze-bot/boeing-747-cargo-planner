import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';


const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://example.test/boeing-747-cargo-planner/' });
for (const [key,value] of Object.entries({window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})) globalThis[key]=value;
const { createRoot } = await import('react-dom/client');
let activeWorker;
globalThis.self = { postMessage(data) { if (activeWorker && !activeWorker.terminated) activeWorker.onmessage?.({ data }); } };
await import('../src/pmc-worker.mjs');
globalThis.Worker = class {
  postMessage(data) { setTimeout(() => { if (!this.terminated) { activeWorker=this; globalThis.self.onmessage({data}); } }, 0); }
  terminate() { this.terminated=true; }
};
const output = resolve(`node_modules/.cache/pmc-ui-${process.pid}.mjs`);
await mkdir(resolve('node_modules/.cache'),{recursive:true});
await build({entryPoints:['src/PmcPlanner.jsx'],outfile:output,bundle:true,packages:'external',format:'esm',platform:'node',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env.BASE_URL':'"/boeing-747-cargo-planner/"'}});
const {default:PmcPlanner}=await import(pathToFileURL(output));
const root=createRoot(document.getElementById('root'));
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
const click=async node=>act(async()=>{node.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));await pause();});
const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
const field=label=>document.querySelector(`[aria-label="${label}"]`);
const change=async(node,value)=>act(async()=>{const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node),'value').set;setter.call(node,value);node.dispatchEvent(new dom.window.Event('input',{bubbles:true}));node.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await pause();});

test('PMC interface handles packing, edits, toggles, reset and import review', async()=>{
 await act(async()=>{root.render(React.createElement(PmcPlanner));await pause();});
 await act(pause);
 assert.equal(document.querySelector('.pmc-errors'),null);
 const diagram=document.querySelector('.pmc-profile-diagram');
 for(const measure of ['96″ / 243,84 cm','39,5″','100,33 cm','56,5″','143,51 cm','41″','104,14 cm'])assert.ok(diagram.textContent.includes(measure),measure);
 // Display-only labels preserve the physical contour; clearance is drawn only at the base.
 assert.equal(diagram.querySelectorAll('path')[0].getAttribute('d'),'M45 170 V30 H132 L255 110 V170 Z');
 assert.ok(diagram.querySelector('.pmc-base-clearance'));
 assert.match(diagram.querySelector('.pmc-base-clearance').getAttribute('aria-label'),/yalnızca tabanda; yükseklikten çıkarılmaz/);
 assert.equal(diagram.querySelector('.pmc-base-clearance path').getAttribute('d'),`M${45+210*8.5/243.84} 170 H${255-210*8.5/243.84}`);
 assert.equal([...diagram.querySelectorAll('path')].some(p=>p.getAttribute('d')==='M55 163 V45 H128 L245 117 V163 Z'),false);
 const dims=[...document.querySelectorAll('.pmc-scene-dimension text')].map(n=>n.textContent);
 assert.deepEqual(dims,['96″ / 243,84 cm · X','125″ / 317,5 cm · Y','96″ / 243,84 cm · Z','Düz üst39,5″ / 100,33 cm','Alçak kenar41″ / 104,14 cm']);
 // Measurement visibility is display-only and independent from cargo labels/contour.
 const facesBefore=[...document.querySelectorAll('.pmc-scene-box')].map(n=>n.getAttribute('points'));
 const labelsBefore=document.querySelectorAll('.pmc-scene-item-label text').length;
 const contoursBefore=document.querySelectorAll('.pmc-scene-contour').length;
 const savedBefore=localStorage.getItem('cargo-pmc-v1');
 await click(field('Ölçüler'));
 assert.equal(document.querySelectorAll('[data-dimension]').length,0);
 assert.deepEqual([...document.querySelectorAll('.pmc-scene-box')].map(n=>n.getAttribute('points')),facesBefore);
 assert.equal(document.querySelectorAll('.pmc-scene-item-label text').length,labelsBefore);
 assert.equal(document.querySelectorAll('.pmc-scene-contour').length,contoursBefore);
 assert.equal(localStorage.getItem('cargo-pmc-v1'),savedBefore);
 await click(field('Ölçüler'));
 assert.equal(document.querySelectorAll('[data-dimension]').length,5);
 assert.match(document.querySelector('.pmc-base-stat').textContent,/≈89,31 × 118,31/);
 assert.match(document.querySelector('.pmc-scene-legend').textContent,/8,5 cm \/ ≈3,35″/);
 assert.match(document.querySelector('.pmc-scene-legend').textContent,/226,84 × 300,5 cm \/ ≈89,31 × 118,31″/);
 assert.equal(96*2.54,243.84);assert.equal(125*2.54,317.5);
 assert.equal((8.5/2.54).toFixed(2),'3.35');
 assert.equal((226.84/2.54).toFixed(2),'89.31');
 assert.equal((300.5/2.54).toFixed(2),'118.31');
 assert.ok(document.querySelectorAll('.pmc-scene-box').length>0);
 assert.match(document.querySelector('.pmc-results-stats').textContent,/20/);
 const originalState=JSON.parse(localStorage.getItem('cargo-pmc-v1'));
 await click(field('Yük 1 tabanda döndürülebilir'));
 assert.equal(JSON.parse(localStorage.getItem('cargo-pmc-v1')).rows[0].allowRotation,false);
 assert.ok(document.querySelector('.pmc-stale'));
 assert.equal(button('JSON indir').disabled,true);
 await click(field('Yük 1 üstüne yük konabilir'));
 assert.equal(JSON.parse(localStorage.getItem('cargo-pmc-v1')).rows[0].stackable,false);
 await click(button('Paletlere yerleştir'));
 assert.equal(document.querySelector('.pmc-stale'),null);
 assert.equal(document.querySelector('.pmc-errors'),null);
 await click(button('Yük ekle'));
 assert.equal(document.querySelectorAll('.pmc-input-table tbody tr').length,4);
 // New item has unknown weight; worker normalization must accept blank/null.
 await click(button('Paletlere yerleştir'));
 assert.equal(document.querySelector('.pmc-errors'),null);
 await click(button('Tüm paletler'));
 assert.match(document.querySelector('.pmc-scene-badge').textContent,/TÜM PALETLER/);
 await click(button('Üst'));await click(button('Ön'));await click(button('İzometrik'));
 const selectable=document.querySelector('.pmc-scene-item-label');
 await act(async()=>{selectable.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
 assert.ok(document.querySelector('.pmc-scene-selection'));
 await click(button('Örnek yükleri getir'));
 assert.ok(document.querySelector('[role="dialog"]'));
 await act(async()=>{document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));});
 assert.equal(document.querySelector('[role="dialog"]'),null);
 assert.equal(document.querySelectorAll('.pmc-input-table tbody tr').length,4);
 await click(button('Örnek yükleri getir'));
 await click(document.querySelector('.pmc-reset-dialog .primary'));
 assert.equal(document.querySelectorAll('.pmc-input-table tbody tr').length,3);
 assert.deepEqual(JSON.parse(localStorage.getItem('cargo-pmc-v1')).rows,originalState.rows);
 // Import is review-gated; a blank candidate must never be admitted automatically.
 await click(button('Elle aday satır ekle'));
 assert.equal(button('Listeye ekle (1)').disabled,true);
 assert.match(document.querySelector('.cargo-import').textContent,/Ölçü sırasını seçin/);
 const candidate=document.querySelector('.cargo-import fieldset');
 const inputs=[...candidate.querySelectorAll('input')];
 for (const [i,value] of ['İçe aktarılan yük','120','80','50','3'].entries()) await change(inputs[i],value);
 const selects=[...candidate.querySelectorAll('select')];
 await change(selects[0],'cm');await change(selects[1],'LWH');
 assert.equal(button('Listeye ekle (1)').disabled,true);
 await click(document.querySelector('.cargo-import-confirm input'));
 assert.equal(button('Listeye ekle (1)').disabled,false);
 await click(button('Listeye ekle (1)'));
 assert.equal(document.querySelectorAll('.pmc-input-table tbody tr').length,4);
 const imported=JSON.parse(localStorage.getItem('cargo-pmc-v1')).rows.at(-1);
 assert.equal(imported.quantity,3);assert.equal(imported.length,120);assert.equal(imported.width,80);assert.equal(imported.height,50);
 assert.equal(imported.stackable,false);assert.equal(imported.allowRotation,false);
 assert.ok(document.querySelector('.pmc-stale'));
 assert.equal(document.querySelectorAll('.cargo-import fieldset').length,0);
});

test('worker normalizes edited numeric strings and rejects invalid inputs',()=>{
 let response;activeWorker={onmessage:({data})=>response=data};
 self.onmessage({data:{rows:[{id:'test',name:'Test',length:'100',width:'80',height:'50',quantity:'2',weight:'',stackable:false,allowRotation:false}],config:{maxPallets:'2',mirrored:false,allowOverhang:false,maxOverhangCm:'',minOverhangHeightCm:''}}});
 assert.deepEqual(response.result.errors,[]);assert.equal(response.result.placements.length,2);assert.equal(response.result.summary.unknownWeightCount,2);
 self.onmessage({data:{rows:[{id:'bad',length:'',width:'80',height:'50',quantity:'1.5'}],config:{maxPallets:'2',mirrored:false,allowOverhang:false}}});
 assert.ok(response.result.errors.length>0);assert.equal(response.result.placements.length,0);
});

test.after(async()=>{await act(async()=>root.unmount());dom.window.close();await rm(output,{force:true});});
