import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';


const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://example.test/boeing-747-cargo-planner/' });
for (const [key,value] of Object.entries({window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,HTMLElement:dom.window.HTMLElement,FormData:dom.window.FormData,IS_REACT_ACT_ENVIRONMENT:true})) globalThis[key]=value;
const { createRoot } = await import('react-dom/client');
let activeWorker;
globalThis.self = { postMessage(data) { if (activeWorker && !activeWorker.terminated) activeWorker.onmessage?.({ data }); } };
await import('../src/pmc-worker.mjs');
globalThis.Worker = class {
  postMessage(data) { setTimeout(() => { if (!this.terminated) { activeWorker=this; globalThis.self.onmessage({data}); } }, 0); }
  terminate() { this.terminated=true; }
};
const output = resolve(`node_modules/.cache/pmc-aircraft-ui-${process.pid}.mjs`);
await mkdir(resolve('node_modules/.cache'),{recursive:true});
await build({entryPoints:['src/App.jsx'],outfile:output,bundle:true,packages:'external',format:'esm',platform:'node',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env.BASE_URL':'"/boeing-747-cargo-planner/"'}});
const {App}=await import(pathToFileURL(output));
const root=createRoot(document.getElementById('root'));
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
const click=async node=>act(async()=>{node.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));await pause();});
const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
const field=label=>document.querySelector(`[aria-label="${label}"]`);
const change=async(node,value)=>act(async()=>{const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node),'value').set;setter.call(node,value);node.dispatchEvent(new dom.window.Event('input',{bubbles:true}));node.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await pause();});

test('PMC import confirmation, cancellation, duplicate rejection and saved-plan reload',async()=>{
 await act(async()=>{root.render(React.createElement(App));await pause();});await act(pause);
 const original=JSON.parse(localStorage.getItem('cargo-demo-v1'));const pmcSaved=localStorage.getItem('cargo-pmc-v1');
 await click(button('PMC · 3D paletleme'));
 await click(button('Uçak paletlerine ekle'));
 assert.ok(document.querySelector('.pmc-transfer-dialog'));
 await click(button('Vazgeç'));assert.ok(!document.querySelector('.pmc-transfer-dialog'));
 assert.deepEqual(JSON.parse(localStorage.getItem('cargo-demo-v1')),original);
 await click(button('Uçak paletlerine ekle'));
 await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 assert.ok(!document.querySelector('.pmc-transfer-dialog'));
 await click(button('Uçak paletlerine ekle'));
 for(const input of document.querySelectorAll('.pmc-transfer-dialog input'))await change(input,String(Number(input.min)+100));
 await act(async()=>{document.querySelector('.pmc-transfer-dialog form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await pause();});
 assert.ok(!document.querySelector('.pmc-transfer-dialog'));assert.ok(document.querySelector('.aircraft-3d'));
 const imported=JSON.parse(localStorage.getItem('cargo-demo-v1'));
 assert.ok(imported.cargo.length>original.cargo.length);assert.deepEqual(imported.cargo.slice(0,original.cargo.length),original.cargo);assert.equal(imported.plan.M07,original.plan.M07);assert.deepEqual(imported.locked,original.locked);assert.equal(localStorage.getItem('cargo-pmc-v1'),pmcSaved);
 // Touch swipes do not enter custom drag or capture the pointer.
 const card=document.querySelector('.cargo');let captures=0;card.setPointerCapture=()=>captures++;
 const pointer=new dom.window.Event('pointerdown',{bubbles:true});Object.assign(pointer,{pointerType:'touch',button:0,pointerId:1,clientX:0,clientY:0});
 await act(async()=>card.dispatchEvent(pointer));assert.equal(captures,0);
 await click(button('PMC · 3D paletleme'));await click(button('Uçak paletlerine ekle'));
 for(const input of document.querySelectorAll('.pmc-transfer-dialog input'))await change(input,String(Number(input.min)+100));
 await act(async()=>document.querySelector('.pmc-transfer-dialog form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
 assert.match(document.querySelector('.pmc-transfer-dialog [role=alert]').textContent,/zaten/);
 assert.deepEqual(JSON.parse(localStorage.getItem('cargo-demo-v1')),imported);
 await click(button('Vazgeç'));
 await click(button('Yük ekle'));assert.equal(button('Uçak paletlerine ekle').disabled,true);
 await act(async()=>root.render(null));await act(async()=>{root.render(React.createElement(App));await pause();});
 assert.deepEqual(JSON.parse(localStorage.getItem('cargo-demo-v1')),imported);
});
test.after(async()=>{await act(async()=>root.unmount());dom.window.close();await rm(output,{force:true});});
