import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/boeing-747-cargo-planner/' });
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) globalThis[key] = value;
// This test exercises workspace navigation, not packing (covered independently).
globalThis.Worker = class { postMessage() {} terminate() {} };
const { createRoot } = await import('react-dom/client');
const output = resolve(`node_modules/.cache/aircraft-ui-${process.pid}.mjs`);
await mkdir(resolve('node_modules/.cache'), { recursive: true });
await build({ entryPoints: ['src/App.jsx'], outfile: output, bundle: true, packages: 'external', format: 'esm', platform: 'node', jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/boeing-747-cargo-planner/"' } });
const { App } = await import(pathToFileURL(output));
const root = createRoot(document.getElementById('root'));
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text);
const click = async text => act(async () => { const node = button(text); assert.ok(node, `Missing button: ${text}`); node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });

test('aircraft opens by default; deck, distribution and PMC round trips preserve both plans', async () => {
 try {
  await act(async () => root.render(React.createElement(App)));
  assert.ok(document.querySelector('.workspace'));
  assert.equal(button('Uçak yerleşimi').className, 'active');
  assert.equal(document.querySelector('.aircraft-image').getAttribute('src'), '/boeing-747-cargo-planner/assets/aircraft.png');
  assert.equal(document.querySelectorAll('.slot-grid .slot').length, 16);
  assert.match(document.querySelector('.warning').textContent, /SİMÜLASYON.*onaylı değildir/);
  const savedAircraft = localStorage.getItem('cargo-demo-v1');
  const savedPmc = localStorage.getItem('cargo-pmc-v1');
  const pmc = document.querySelector('.pmc-planner');
  assert.equal(pmc.parentElement.hidden, true);
  await click('Alt Güverte');
  assert.equal(document.querySelectorAll('.slot-grid .slot').length, 8);
  await click('Dağılım');
  assert.ok(document.querySelector('.distribution'));
  for (let i = 0; i < 2; i++) {
   await click('PMC · 3D paletleme');
   assert.equal(document.querySelector('.workspace'), null);
   assert.equal(pmc.parentElement.hidden, false);
   assert.equal(document.querySelector('.pmc-planner'), pmc);
   await click('Uçak yerleşimi');
   assert.equal(pmc.parentElement.hidden, true);
   assert.equal(button('Alt Güverte').className, 'active');
   assert.ok(document.querySelector('.distribution'));
  }
  await click('Üstten');
  assert.ok(document.querySelector('.aircraft-image'));
  assert.equal(document.querySelectorAll('.slot-grid .slot').length, 8);
  await click('Ana Güverte');
  assert.equal(document.querySelectorAll('.slot-grid .slot').length, 16);
  assert.equal(localStorage.getItem('cargo-demo-v1'), savedAircraft);
  assert.equal(localStorage.getItem('cargo-pmc-v1'), savedPmc);
  assert.match(document.querySelector('.warning').textContent, /SİMÜLASYON/);
 } finally {
  await act(async () => root.unmount());
  dom.window.close();
  await rm(output, { force: true });
 }
});
