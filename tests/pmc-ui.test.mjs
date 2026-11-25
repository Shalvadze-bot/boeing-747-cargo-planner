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

test('PMC interface handles packing, edits, toggles and reset', async()=>{
 await act(async()=>{root.render(React.createElement(PmcPlanner));await pause();});
 await act(pause);
 assert.equal(document.querySelector('.pmc-errors'),null);
 const diagram=document.querySelector('.pmc-profile-diagram');
 for(const measure of ['96″ / 243,84 cm','39,5″','100,33 cm','56,5″','143,51 cm','41″','104,14 cm'])assert.ok(diagram.textContent.includes(measure),measure);
 // Display-only labels preserve the physical contour; clearance is drawn only at the base.
 assert.equal(diagram.querySelector('figcaption').textContent,'Burundan kuyruğa bakış');
 assert.deepEqual([...diagram.querySelectorAll('.pmc-profile-sides span')].map(n=>n.textContent),['Uçağın sağı','Uçağın solu']);
 const profileLowX=()=>Number([...diagram.querySelectorAll('svg text')].find(n=>n.textContent==='41″ / 104,14 cm').getAttribute('x'));
 const sceneLowX=()=>Number(document.querySelector('[data-dimension="dim-low"] line').getAttribute('x1'));
 const contourSelect=field('Kontur yönü');
 const initialSavedPlan=localStorage.getItem('cargo-pmc-v1');
 assert.match(contourSelect.selectedOptions[0].textContent,/solda/);
 assert.equal(profileLowX(),45);
 await click(button('Burundan kuyruğa'));
 assert.ok(sceneLowX()<450);
 assert.equal(localStorage.getItem('cargo-pmc-v1'),initialSavedPlan);
 await change(contourSelect,'mirrored');
 assert.match(contourSelect.selectedOptions[0].textContent,/sağda/);
 assert.equal(profileLowX(),255);
 await click(button('Paletlere yerleştir'));
 assert.ok(sceneLowX()>450);
 await change(contourSelect,'standard');
 await click(button('Paletlere yerleştir'));
 await click(button('İzometrik'));
 assert.ok(diagram.querySelector('.pmc-base-clearance'));
 assert.match(diagram.querySelector('.pmc-base-clearance').getAttribute('aria-label'),/yalnızca tabanda; yükseklikten çıkarılmaz/);
 assert.equal(diagram.querySelector('.pmc-base-clearance path').getAttribute('d'),`M${45+210*8.5/243.84} 170 H${255-210*8.5/243.84}`);
 assert.equal([...diagram.querySelectorAll('path')].some(p=>p.getAttribute('d')==='M55 163 V45 H128 L245 117 V163 Z'),false);
 const dims=[...document.querySelectorAll('.pmc-scene-dimension text')].map(n=>n.textContent);
 assert.deepEqual(dims,['96″ / 243,84 cm · X','125″ / 317,5 cm · Y','Yüksek kenar96″ / 243,84 cm · Z','Düz üst39,5″ / 100,33 cm','Alçak kenar41″ / 104,14 cm']);
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
 const originalPlace = document.querySelector('.pmc-input-footer .primary');
 const scenePlace = document.querySelector('.pmc-scene-toolbar .primary');
 assert.equal(scenePlace.textContent,originalPlace.textContent);
 await click(scenePlace);
 assert.equal(document.querySelector('.pmc-stale'),null);
 assert.equal(document.querySelector('.pmc-errors'),null);
 await click(button('Yük ekle'));
 assert.equal(document.querySelectorAll('.pmc-input-table tbody tr').length,4);
 // New item has unknown weight; worker normalization must accept blank/null.
 await click(button('Paletlere yerleştir'));
 assert.equal(document.querySelector('.pmc-errors'),null);
 await click(button('Tüm paletler'));
 assert.match(document.querySelector('.pmc-scene-badge').textContent,/TÜM PALETLER/);
 await click(button('Üst'));await click(button('Burundan kuyruğa'));await click(button('İzometrik'));
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
 assert.equal(document.querySelector('.pmc-import-panel'),null);
 assert.equal(document.querySelector('.pmc-piece-orientations'),null);
 assert.ok(field('Yük 1 yön izni'));
});

test('high edge dropdown preserves longitudinal placement and clears on alternate choice',async()=>{
 localStorage.setItem('cargo-pmc-v1',JSON.stringify({version:1,rows:[{id:'long',name:'Long',length:400,width:88,height:166,quantity:1,weight:25,allowRotation:false,stackable:false}],config:{maxPallets:6,longCargo:true,longCargoAlignment:'right',mirrored:true}}));
 await act(async()=>{root.render(React.createElement(PmcPlanner,{key:'high-dropdown'}));await pause();});await act(pause);
 assert.equal(button('Yüksek kenara hizala'),undefined);
 const select=field('Yerleşim seçimi');assert.ok(select.querySelector('option[value="high"]'));
 await change(select,'high');
 assert.equal(select.value,'high');
 assert.match(document.querySelector('.pmc-long-details').textContent,/Yüksek kontur tarafına hizalı/);
 assert.match(document.querySelector('.pmc-long-details').textContent,/sol kısa kenar 91 cm/);
 const saved=JSON.parse(localStorage.getItem('cargo-pmc-v1'));assert.equal(saved.config.highEdgeAnchors['long:1'].y,-91);
 await change(select,'center');assert.equal(select.value,'center');assert.equal(JSON.parse(localStorage.getItem('cargo-pmc-v1')).config.highEdgeAnchors,null);
});

test('the long cargo screen renders shared pieces and a single shared overhang reservation',async()=>{
 const rows=[{id:'long',name:'Uzun yük',length:400,width:70,height:60,quantity:3,weight:25,allowRotation:false,stackable:false}];
 localStorage.setItem('cargo-pmc-v1',JSON.stringify({version:1,rows,config:{maxPallets:1,longCargo:true}}));
 await act(async()=>{root.render(React.createElement(PmcPlanner,{key:'shared-long-pmc'}));await pause();});
 await act(pause);
 assert.equal(document.querySelectorAll('.pmc-pallet-select button:not(:disabled)').length,1);
 assert.equal(document.querySelectorAll('.pmc-scene-item-label').length,3);
 const detail=document.querySelector('.pmc-long-details');
 assert.match(detail.textContent,/1 fiziksel PMC · 3 parça · 2 şematik pozisyon/);
 assert.equal(detail.querySelectorAll('.pmc-slot-map .support').length,1);
 assert.equal(detail.querySelectorAll('.pmc-slot-map .blocked').length,1);
 assert.equal(button('Uçak paletlerine ekle'),undefined);
});

test('the long cargo screen displays a supported upper layer and locks manual movement of the stack',async()=>{
 const rows=[80,80,65,80].map((width,i)=>({id:'fixture-'+i,name:'Yük '+i,length:400,width,height:i===3?40:60,quantity:1,weight:25,allowRotation:true,stackable:true}));
 localStorage.setItem('cargo-pmc-v1',JSON.stringify({version:1,rows,config:{maxPallets:1,longCargo:true,longCargoAlignment:'center'}}));
 await act(async()=>{root.render(React.createElement(PmcPlanner,{key:'stacked-long-pmc'}));await pause();});
 await act(pause);
 const details=document.querySelector('.pmc-long-details');
 assert.match(details.textContent,/1 fiziksel PMC · 4 parça · 3 şematik pozisyon/);
 assert.match(details.textContent,/Üst katman · Z 60 cm/);
 await click(document.querySelector('.pmc-move-controls input[type=checkbox]'));
 const upper=document.querySelector('.pmc-scene-item-label[data-item-id="fixture-3:1"]');
 await act(async()=>upper.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
 assert.match(document.querySelector('.pmc-move-controls [role=alert]').textContent,/taban desteği korunur/);
 assert.equal(field('Yatay X (cm)'),null);
});

test('long mode calculates balance after the pallet settings are entered',async()=>{
 const rows=[{id:'weight-test',name:'Yük',length:400,width:80,height:60,quantity:1,weight:200,allowRotation:false,stackable:true}];
 localStorage.setItem('cargo-pmc-v1',JSON.stringify({version:1,rows,config:{maxPallets:1,longCargo:true,longCargoAlignment:'center'}}));
 await act(async()=>root.render(React.createElement(PmcPlanner,{key:'pmc-balance-ui'})));
 await act(pause);
 assert.match(document.querySelector('.pmc-long-details').textContent,/Ağırlık dengesi doğrulanmadı/);
 for(const [label,value] of [['Palet ağırlığı (kg)','100'],['Palet merkezi X (cm)','121.92'],
  ['Palet merkezi Y (cm)','158.75'],['Palet merkezi Z (cm)','-2'],
  ['En küçük X (cm)','120'],['En büyük X (cm)','125'],
  ['En küçük Y (cm)','157'],['En büyük Y (cm)','161']]){
  await change(field(label),value);
 }
 await click(button('Paletlere yerleştir'));
 assert.match(document.querySelector('.pmc-long-details').textContent,/Tahmini ağırlık merkezi/);
 assert.match(document.querySelector('.pmc-long-details').textContent,/Brüt 300 kg/);
 assert.match(document.querySelector('.pmc-long-details').textContent,/girilen sınırlar içinde/);
});

test('saved long-edge placement stays intact until a new alignment is selected',async()=>{
 const rows=[{id:'long',name:'Long',length:400,width:88,height:60,quantity:1,weight:25,allowRotation:false,stackable:false}];
 for (const alignment of ['front','rear']) {
  localStorage.setItem('cargo-pmc-v1',JSON.stringify({version:1,rows,config:{maxPallets:6,longCargo:true,longCargoAlignment:alignment}}));
  await act(async()=>{root.render(React.createElement(PmcPlanner,{key:alignment}));await pause();});
  const select=field('Yerleşim seçimi');
  assert.equal(select.value,alignment);
  assert.ok(select.selectedOptions[0].disabled && select.selectedOptions[0].hidden);
  assert.ok([...select.options].every(option=>option.hidden || !['front','rear'].includes(option.value)));
  assert.equal(JSON.parse(localStorage.getItem('cargo-pmc-v1')).config.longCargoAlignment,alignment);
  await change(select,'auto');
  assert.equal(select.value,'auto');
  assert.equal(select.querySelector('option[hidden]'),null);
  assert.equal(JSON.parse(localStorage.getItem('cargo-pmc-v1')).config.longCargoAlignment,'auto');
 }
});

test('manual X controls and mouse/touch drag preserve Y and camera while clamping contour',async()=>{
 localStorage.setItem('cargo-pmc-v1',JSON.stringify({version:1,rows:[{id:'long',name:'Long',length:400,width:88,height:166,quantity:1,weight:25,allowRotation:false,stackable:false}],config:{maxPallets:6,longCargo:true,longCargoAlignment:'right',mirrored:true}}));
 await act(async()=>{root.render(React.createElement(PmcPlanner,{key:'manual-move'}));await pause();});await act(pause);
 await click(document.querySelector('.pmc-move-controls input[type=checkbox]'));
 await act(async()=>document.querySelector('.pmc-scene-item-label').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
 await change(field('Yatay X (cm)'),'1');
 assert.equal(field('Yatay X (cm)').value,'1');
 assert.equal(JSON.parse(localStorage.getItem('cargo-pmc-v1')).config.manualXAnchors,undefined);
 await change(field('Yatay X (cm)'),'100');
 await act(async()=>field('Yatay X (cm)').dispatchEvent(new dom.window.FocusEvent('focusout',{bubbles:true})));
 let saved=JSON.parse(localStorage.getItem('cargo-pmc-v1'));assert.equal(saved.config.manualXAnchors['long:1'].x,100);assert.equal(saved.config.manualXAnchors['long:1'].y,-91);
 await change(field('Yükü yatay taşı'),'120');
 assert.equal(JSON.parse(localStorage.getItem('cargo-pmc-v1')).config.manualXAnchors['long:1'].x,120);
 const svg=document.querySelector('.pmc-scene-canvas');svg.getBoundingClientRect=()=>({width:900,height:510});svg.setPointerCapture=()=>{};svg.hasPointerCapture=()=>false;
 const contourBefore=document.querySelector('.pmc-scene-contour').innerHTML;
 for(const pointerType of ['mouse','touch']){
  const face=document.querySelector('.pmc-scene-box');
  const fire=async(node,type,x,y)=>act(async()=>{const event=new dom.window.MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y});Object.defineProperties(event,{pointerType:{value:pointerType},pointerId:{value:1}});node.dispatchEvent(event);await pause();});
  await fire(face,'pointerdown',100,100);await fire(svg,'pointermove',10000,100);await fire(svg,'pointerup',10000,100);
  saved=JSON.parse(localStorage.getItem('cargo-pmc-v1'));assert.equal(saved.config.manualXAnchors['long:1'].x,147.34);assert.equal(saved.config.manualXAnchors['long:1'].y,-91);
  assert.equal(document.querySelector('.pmc-scene-contour').innerHTML,contourBefore);
  await change(field('Yatay X (cm)'),'100');
 await act(async()=>field('Yatay X (cm)').dispatchEvent(new dom.window.FocusEvent('focusout',{bubbles:true})));
 }
 assert.match(document.querySelector('.pmc-move-controls').textContent,/Yüksek kenara kalan hareket/);
 assert.match(document.querySelector('.pmc-long-details').textContent,/sol kısa kenar 91 cm/);
 await change(field('Yerleşim seçimi'),'center');assert.equal(JSON.parse(localStorage.getItem('cargo-pmc-v1')).config.manualXAnchors,null);
});

test('worker normalizes edited numeric strings and rejects invalid inputs',()=>{
 let response;activeWorker={onmessage:({data})=>response=data};
 self.onmessage({data:{rows:[{id:'test',name:'Test',length:'100',width:'80',height:'50',quantity:'2',weight:'',stackable:false,allowRotation:false}],config:{maxPallets:'2',mirrored:false,allowOverhang:false,maxOverhangCm:'',minOverhangHeightCm:''}}});
 assert.deepEqual(response.result.errors,[]);assert.equal(response.result.placements.length,2);assert.equal(response.result.summary.unknownWeightCount,2);
 self.onmessage({data:{rows:[{id:'bad',length:'',width:'80',height:'50',quantity:'1.5'}],config:{maxPallets:'2',mirrored:false,allowOverhang:false}}});
 assert.ok(response.result.errors.length>0);assert.equal(response.result.placements.length,0);
});

test('method selector keeps the research model, displayed contour and validation in sync',async()=>{
 localStorage.clear();
 const rows=[{id:'case',name:'Sentetik kasa',length:150,width:113,height:90,quantity:'4',
  weight:'',stackable:false,allowRotation:false}];
 localStorage.setItem('cargo-pmc-v1',JSON.stringify({version:1,rows,config:{maxPallets:'2'}}));
 await act(async()=>{root.render(React.createElement(PmcPlanner,{key:'contour-v2'}));await pause();});await act(pause);
 const method=field('Yerleşim yöntemi');
 const status=()=>document.querySelector('[data-research-status]').getAttribute('data-research-status');
 assert.ok(document.querySelector('[data-contour-profile="ZX-11"]'));
 await change(method,'contour-v2');
 assert.equal(status(),'PASS');
 assert.match(document.querySelector('.pmc-output .panel-heading p').textContent,/V2 · Avianca Contour 1 · .* ms/);
 assert.ok(document.querySelector('[data-contour-profile="Avianca Contour 1"]'));
 assert.equal(document.querySelector('[data-dimension="dim-flat"]'),null);
 await click(button('2D'));
 assert.ok(document.querySelectorAll('[data-research-projection]').length>=3);
 await change(field('Araştırma Paket aralığı (mm)'),'5');
 assert.equal(status(),'UNKNOWN');
 assert.equal(button('JSON indir').disabled,true);
 await click(button('Paletlere yerleştir'));
 assert.equal(status(),'PASS');
 assert.equal(JSON.parse(localStorage.getItem('cargo-pmc-v1')).config.researchSettings.gapMm,'5');
 await change(method,'legacy');
 await click(button('3D'));
 assert.ok(document.querySelector('[data-contour-profile="ZX-11"]'));
 assert.ok(document.querySelector('[data-dimension="dim-flat"]'));
 assert.ok(field('Tek PMC üzerinde uzun yük · TEST')||document.querySelector('.pmc-overhang input'));
});

test.after(async()=>{await act(async()=>root.unmount());dom.window.close();await rm(output,{force:true});});
