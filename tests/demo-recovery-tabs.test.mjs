import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {initialCargo} from '../src/engine.mjs';
import {AIRCRAFT_STORE} from '../src/demo-recovery.mjs';
const dom=new JSDOM('<!doctype html><div id="a"></div><div id="b"></div>',{url:'https://example.test/boeing-747-cargo-planner/'});
for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,HTMLElement:dom.window.HTMLElement,FormData:dom.window.FormData,IS_REACT_ACT_ENVIRONMENT:true}))globalThis[key]=value;
globalThis.Worker=class{postMessage(){}terminate(){}};
const {createRoot}=await import('react-dom/client');
const output=resolve(`node_modules/.cache/demo-tabs-${process.pid}.mjs`);
await mkdir(resolve('node_modules/.cache'),{recursive:true});
await build({entryPoints:['src/App.jsx'],outfile:output,bundle:true,packages:'external',format:'esm',platform:'node',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env.BASE_URL':'"/boeing-747-cargo-planner/"'}});
const {App}=await import(pathToFileURL(output));
const a=document.getElementById('a'),b=document.getElementById('b'),rootA=createRoot(a),rootB=createRoot(b);
const button=(within,text)=>[...within.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
async function add(within,name){
 await act(async()=>button(within,'Ekle').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
 const form=within.querySelector('.dialog form');
 for(const [key,value] of Object.entries({name,weight:'123',l:'100',w:'80',h:'50'}))form.elements.namedItem(key).value=value;
 await act(async()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
}
test('two mounted workspaces cannot overwrite newer custom records even if storage events are missed',async()=>{
 try{
  const pal09={id:'PAL-09',name:'Protected PMC',weight:120000,l:317.5,w:243.84,h:140,priority:1,pmc:{items:[]}};
  localStorage.setItem(AIRCRAFT_STORE,JSON.stringify({cargo:[...initialCargo,pal09],plan:{},locked:[]}));
  await act(async()=>{rootA.render(React.createElement(App));rootB.render(React.createElement(App));});
  await add(b,'New record from B');
  const newer=localStorage.getItem(AIRCRAFT_STORE);
  assert.equal(JSON.parse(newer).cargo.length,10);
  await add(a,'Stale record from A');
  assert.equal(localStorage.getItem(AIRCRAFT_STORE),newer);
  assert.match(a.querySelector('.storage-conflict').textContent,/son değişiklik kaydedilmedi/);
  assert.equal(button(a,'Demo paletlerini sil (8)').disabled,true);
  assert.equal(button(a,'Ekle').disabled,true);
  assert.equal(JSON.parse(newer).cargo.find(item=>item.id==='PAL-10').name,'New record from B');
  assert.deepEqual(JSON.parse(newer).cargo.find(item=>item.id==='PAL-09'),pal09);
  // A storage event proactively locks the other workspace before any action.
  await act(async()=>window.dispatchEvent(new dom.window.StorageEvent('storage',{key:AIRCRAFT_STORE,newValue:'different',storageArea:localStorage})));
  assert.ok(b.querySelector('.storage-conflict'));
  assert.equal(localStorage.getItem(AIRCRAFT_STORE),newer);
 }finally{await act(async()=>{rootA.unmount();rootB.unmount();});dom.window.close();await rm(output,{force:true});}
});
