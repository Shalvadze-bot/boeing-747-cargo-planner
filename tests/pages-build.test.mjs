import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import test from 'node:test';

test('Pages serves built JavaScript and assets beneath the repository path', async () => {
  const base = '/boeing-747-cargo-planner/';
  const html = await readFile('dist/client/index.html', 'utf8');
  assert.ok(!html.includes('/src/main.jsx'));
  assert.ok(html.includes(`src="${base}assets/`));
  assert.ok(html.includes(`href="${base}assets/`));
  const files = await readdir('dist/client/assets');
  const js = (await Promise.all(files.filter(f => f.endsWith('.js')).map(f => readFile(`dist/client/assets/${f}`, 'utf8')))).join('');
  assert.ok(js.includes(`${base}assets/pallet.png`));
  assert.ok(js.includes(`${base}assets/aircraft.png`));
  await access('dist/client/assets/pallet.png');
  await access('dist/client/assets/aircraft.png');
});
