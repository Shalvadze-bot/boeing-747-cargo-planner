import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {initialCargo,initialPlan} from '../src/engine.mjs';

const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://example.test/boeing-747-cargo-planner/'});
for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true}))globalThis[key]=value;
let aircraftWriteQueue=Promise.resolve();
Object.defineProperty(dom.window.navigator,'locks',{value:{request(name,options,operation){const next=aircraftWriteQueue.then(operation);aircraftWriteQueue=next.catch(()=>{});return next;}}});
globalThis.Worker=class{postMessage(){}terminate(){}};
const {createRoot}=await import('react-dom/client');
const output=resolve(`node_modules/.cache/pmc-visual-ui-${process.pid}.mjs`);
await mkdir(resolve('node_modules/.cache'),{recursive:true});
await build({entryPoints:['src/App.jsx'],outfile:output,bundle:true,packages:'external',format:'esm',platform:'node',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env.BASE_URL':'"/boeing-747-cargo-planner/"'}});
const {App}=await import(pathToFileURL(output));
Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:true});
const root=createRoot(document.getElementById('root'));
const button=(text,within=document)=>[...within.querySelectorAll('button')].find(n=>n.textContent.trim()===text);
const click=async node=>act(async()=>{assert.ok(node);node.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});
test('visual-only dialog preserves saved weight, cargo, plan and locks through repeated use and Escape',async()=>{
 try{
  const cargo=[...initialCargo,{id:'PAL-09',name:'PMC 01 · 1 parça',weight:120000,l:317.5,w:243.84,h:140,priority:1,pmc:{items:[{id:'box-1',l:100,w:80,h:140,x:8.5,y:8.5,z:0,color:'#ff0000'}]}}];
  const saved=JSON.stringify({cargo,plan:initialPlan,locked:['M07']});
  localStorage.setItem('cargo-demo-v1',saved);
  await act(async()=>root.render(React.createElement(App)));
  const pmcSaved=localStorage.getItem('cargo-pmc-v1');
  await click([...document.querySelectorAll('.cargo')].find(n=>n.textContent.includes('PAL-09')));
  const open=()=>button('Yalnız bu PMC’yi görsel önizle');
  for(let n=0;n<2;n++){
   await click(open());
   const dialog=document.querySelector('[role="dialog"]');
   assert.equal(dialog.getAttribute('aria-label'),'PMC görsel önizleme');
   assert.match(dialog.textContent,/120.000 kg/);
   assert.match(dialog.textContent,/AĞIRLIK DOĞRULANMADI/);
   assert.match(dialog.textContent,/Yükleme veya uçuş onayı değildir/);
   assert.match(dialog.textContent,/M07; bu bir plan ataması değildir/);
   const scene=dialog.querySelector('.aircraft-3d');
   assert.equal(scene.dataset.visualOnly,'true');
   assert.equal(scene.dataset.visibleCargo,'PAL-09');
   // Fullscreen retains the warning; first Escape leaves fullscreen only.
   scene.requestFullscreen=async()=>{Object.defineProperty(document,'fullscreenElement',{configurable:true,value:scene});document.dispatchEvent(new dom.window.Event('fullscreenchange'));};
   document.exitFullscreen=async()=>{Object.defineProperty(document,'fullscreenElement',{configurable:true,value:null});document.dispatchEvent(new dom.window.Event('fullscreenchange'));};
   await click(button('Tam ekran',dialog));
   assert.equal(document.fullscreenElement,scene);
   assert.match(scene.querySelector('.visual-preview-warning').textContent,/AĞIRLIK DOĞRULANMADI/);
   await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
   assert.equal(document.fullscreenElement,null);
   assert.equal(document.querySelector('[role="dialog"]'),dialog);
   assert.equal(dialog.querySelector('.aircraft-3d-positions'),null);
   assert.equal(button('Üstten görünümü aç',dialog),undefined);
   await click(button('Güverteleri ayır',dialog));
   await click(button('Burun kapısı aç',dialog));
   assert.equal(localStorage.getItem('cargo-demo-v1'),saved);
   assert.equal(localStorage.getItem('cargo-pmc-v1'),pmcSaved);
   if(n===0)await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
   else await click(button('Önizlemeyi kapat · plana dön',dialog));
   assert.equal(document.querySelector('[role="dialog"]'),null);
   assert.equal(localStorage.getItem('cargo-demo-v1'),saved);
  }
  await click(button('M01 · Boş'));
  assert.match(document.querySelector('.toast').textContent,/ağırlık|sınır/);
  assert.equal(localStorage.getItem('cargo-demo-v1'),saved);
  assert.match(document.querySelector('.summary').textContent,/8.000/);
  assert.match(document.querySelector('.selected-cargo').textContent,/Bekliyor/);
  // A pending optimizer result must never enter the isolated preview dialog.
  await click(button('Yerleşimi öner'));
  assert.equal(open().disabled,true);
  await click(open());
  assert.equal(document.querySelector('[aria-label="PMC görsel önizleme"]'),null);
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,100));});
  assert.ok(document.querySelector('[aria-label="Yerleşim önerisi"]'));
  await click(document.querySelector('[aria-label="Kapat"]'));
  assert.equal(localStorage.getItem('cargo-demo-v1'),saved);
  await click(open());
  assert.equal(document.querySelector('.dialog .compare'),null);
  assert.equal(button('Öneriyi uygula',document.querySelector('.dialog')),undefined);
  await click(button('Önizlemeyi kapat · plana dön'));
 }finally{await act(async()=>root.unmount());dom.window.close();await rm(output,{force:true});}
});
