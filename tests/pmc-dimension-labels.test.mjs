import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {JSDOM} from 'jsdom';
import {PMC,contourHeight} from '../src/pmc-engine.mjs';
const output=resolve(`node_modules/.cache/pmc-labels-${process.pid}.mjs`);
await mkdir(resolve('node_modules/.cache'),{recursive:true});
await build({entryPoints:['src/PmcScene.jsx'],outfile:output,bundle:true,packages:'external',format:'esm',platform:'node',jsx:'automatic',loader:{'.css':'empty'}});
const {default:PmcScene}=await import(pathToFileURL(output));
function render(mirrored,showContour=true){
 const dom=new JSDOM(renderToStaticMarkup(React.createElement(PmcScene,{mirrorContour:mirrored,showContour})));
 return dom;
}
test('marked flat-top and low-edge dimensions use actual unchanged contour values in both units',()=>{
 assert.equal(PMC.shoulderX,100.33);assert.equal(PMC.lowHeight,104.14);
 assert.ok(Math.abs(contourHeight(PMC.width)-104.14)<1e-9);
 assert.ok(Math.abs(contourHeight(0,true)-104.14)<1e-9);
 assert.equal(PMC.maxHeight,243.84);
 for(const mirrored of [false,true]){
  const dom=render(mirrored),doc=dom.window.document;
  assert.equal(doc.querySelector('[data-dimension="dim-flat"]').getAttribute('aria-label'),'Düz üst 39,5″ / 100,33 cm');
  assert.equal(doc.querySelector('[data-dimension="dim-low"]').getAttribute('aria-label'),'Alçak kenar 41″ / 104,14 cm');
  assert.match(doc.querySelector('[data-dimension="dim-z"]').textContent,/96″ \/ 243,84 cm/);
  const flat=doc.querySelector('[data-dimension="dim-flat"] line');
  assert.equal(Number(flat.getAttribute('x2'))>Number(flat.getAttribute('x1')),!mirrored);
  const low=doc.querySelector('[data-dimension="dim-low"] line');
  assert.ok(Number(low.getAttribute('y2'))<Number(low.getAttribute('y1')));
  dom.window.close();
 }
 const normal=render(false),mirror=render(true);
 const x=dom=>Number(dom.window.document.querySelector('[data-dimension="dim-low"] line').getAttribute('x1'));
 assert.ok(x(mirror)<x(normal),'low-edge annotation moves to the mirrored side');
 normal.window.close();mirror.window.close();
 const hidden=render(false,false);
 assert.equal(hidden.window.document.querySelector('[data-dimension="dim-flat"]'),null);
 assert.equal(hidden.window.document.querySelector('[data-dimension="dim-low"]'),null);
 hidden.window.close();
});
test.after(async()=>rm(output,{force:true}));
