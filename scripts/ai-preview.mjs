#!/usr/bin/env node
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { createReadStream, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAi } from '../worker/ai-route.mjs';
import { syntheticRows, syntheticConfig } from './ai-preview-fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicDir = resolve(root, 'dist/client');
const live = process.argv.includes('--with-key');
const mock = process.argv.includes('--mock');
if (live && mock) throw new Error('Tek bir önizleme modu seçin.');
if (!existsSync(resolve(publicDir, 'index.html'))) throw new Error('Önce npm run build çalıştırın.');
const port = Number(process.env.CARGO_AI_PREVIEW_PORT || 4178);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Geçersiz yerel port.');
const origin = 'http://127.0.0.1:' + port;
const account = 'owner@cargo-preview.invalid';
const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini-2026-03-17';

function hiddenKey() {
  if (!process.stdin.isTTY) throw new Error('Gizli anahtar girişi için Terminal açın.');
  return new Promise((resolve, reject) => {
    let buffer = '';
    const stdin = process.stdin;
    const stop = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
    };
    const onData = chunk => {
      for (const char of chunk) {
        if (char === '\u0003' || char === '\u0004') {
          stop();
          reject(new Error('Anahtar girişi iptal edildi.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          const token = buffer.trim();
          buffer = '';
          stop();
          /^sk-[a-zA-Z0-9_-]{20,500}$/.test(token)
            ? resolve(token) : reject(new Error('OpenAI anahtar biçimi okunamadı. Sadece anahtar değerini yapıştırın.'));
          return;
        }
        if (char === '\u007f' || char === '\b') buffer = buffer.slice(0, -1);
        else if (char >= ' ' && buffer.length < 512) buffer += char;
      }
    };
    process.stderr.write('OPENAI_API_KEY (gizli; yapıştırın ve Enter’a basın): ');
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.on('data', onData);
    stdin.resume();
  });
}

function database(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  sqlite.exec(readFileSync(resolve(root, 'drizzle/0001_ai_usage.sql'), 'utf8'));
  return {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return { bind: (...parameters) => ({
        first: async () => stmt.get(...parameters) ?? null,
        run: async () => stmt.run(...parameters),
      }) };
    },
  };
}

async function preflight() {
  try {
    const response = await fetch('https://api.openai.com/v1/models',{signal:AbortSignal.timeout(6000)});
    if (response.status === 401) return;
    throw new Error('Beklenmeyen OpenAI bağlantı yanıtı.');
  } catch (error) {
    const code = error.cause?.code;
    const safe = ['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','UND_ERR_CONNECT_TIMEOUT','CERT_HAS_EXPIRED'].includes(code)
      ? ' (' + code + ')' : '';
    throw new Error('Terminal OpenAI ağına ulaşamadı'+safe+'. Anahtar istenmeden önizleme durduruldu.');
  }
}
if (live) await preflight();

const env = {
  OPENAI_MODEL: model,
  OPENAI_API_KEY: live ? await hiddenKey() : '',
  CARGO_AI_ALLOWED_EMAILS: account,
  CARGO_AI_LOCAL_PREVIEW: true,
  CARGO_AI_MOCK: mock,
  CARGO_AI_MAX_CALLS: process.env.CARGO_AI_MAX_CALLS,
  CARGO_AI_MAX_OUTPUT_TOKENS: process.env.CARGO_AI_MAX_OUTPUT_TOKENS,
  CARGO_AI_MAX_INPUT_TOKENS: process.env.CARGO_AI_MAX_INPUT_TOKENS,
  CARGO_AI_TIMEOUT_MS: process.env.CARGO_AI_TIMEOUT_MS,
  CARGO_AI_CALLS_PER_HOUR: process.env.CARGO_AI_CALLS_PER_HOUR,
  CARGO_AI_BUDGET_NANO_USD: process.env.CARGO_AI_BUDGET_NANO_USD,
  CARGO_AI_LEDGER: database(resolve(root, '.ai-preview', mock ? 'mock.sqlite' : 'usage.sqlite')),
};

const cookie = 'cargo_ai_preview=' + randomBytes(32).toString('hex');
const previewId = '45cc2dc0-44fa-4e93-b2f8-91d3238dcccf';
const project = {
  id: previewId,
  name: mock ? 'AI Deneme Projesi · sentetik · API kapalı' : 'AI Deneme Projesi · sentetik',
  can_edit: true, online_count: 0, last_changed_by: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  payload: { version: 1, pmc: { version: 1, rows: syntheticRows, config: syntheticConfig }, aircraft: null, recovery: [] },
};
const types = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml',
  '.json':'application/json', '.wasm':'application/wasm', '.gz':'application/gzip',
};

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
  res.end(JSON.stringify(data));
}

async function projectPreview(req, res, url) {
  const path = '/api/projects/' + previewId;
  if (url.pathname === '/api/projects' && req.method === 'GET') {
    const { payload, ...metadata } = project;
    return json(res, 200, { projects:[metadata] });
  }
  if (url.pathname !== path) return json(res, 404, { error:'Önizleme yalnızca örnek projeyi kullanır.' });
  if (req.method === 'GET' && url.searchParams.has('members')) return json(res, 200, { members:[] });
  if (req.method === 'GET') return json(res, 200, project);
  if (req.headers.origin !== origin) return json(res, 403, { error:'Geçersiz önizleme isteği.' });
  if (req.method === 'POST' && url.searchParams.has('presence')) return json(res, 200, {
    updated_at: project.updated_at, last_changed_by: project.last_changed_by, online:[{ name:'Yerel önizleme', you:true }],
  });
  if (req.method === 'PATCH') {
    const body = await readRequest(req, 2_000_000);
    if (!body) return json(res, 413, { error:'Veri çok büyük.' });
    const data = JSON.parse(body);
    if (data.expected !== project.updated_at) return json(res, 409, { error:'Önizleme güncellendi.' });
    if (data.payload?.version !== 1) return json(res, 400, { error:'Yerel kayıt verisi geçersiz.' });
    if (JSON.stringify(data.payload) !== JSON.stringify(project.payload)) {
      project.payload = data.payload;
      project.updated_at = new Date().toISOString();
      project.last_changed_by = 'Yerel önizleme';
    }
    return json(res, 200, { updated_at:project.updated_at });
  }
  return json(res, 403, { error:'Bu işlem yerel sentetik önizlemede kullanılamaz.' });
}

async function readRequest(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      // Drain only to allow a bounded rejection, then close the connection.
      req.resume();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (req, res) => {
  try {
    if (req.headers.host !== '127.0.0.1:' + port) return json(res, 403, { error:'Yerel önizleme bağlantısı gerekli.' });
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/api/')) {
      if (!String(req.headers.cookie || '').split(';').some(value => value.trim() === cookie)) {
        return json(res, 401, { error:'Önizleme sayfasını açın.' });
      }
      if (url.pathname.startsWith('/api/projects')) return await projectPreview(req, res, url);
      const body = req.method === 'POST' ? await readRequest(req, 38_000) : undefined;
      if (body === null) return json(res, 413, { error:'Veri çok büyük.' });
      const controller = new AbortController();
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      const headers = new Headers(req.headers);
      headers.set('oai-authenticated-user-id', 'cargo-preview-owner');
      headers.set('oai-authenticated-user-email', account);
      const response = await handleAi(new Request(url, { method:req.method, body, headers, signal:controller.signal }), env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).on('error',()=>res.destroy()).pipe(res);
      else res.end();
      return;
    }
    if (!['GET','HEAD'].includes(req.method)) return json(res, 405, { error:'Yöntem desteklenmiyor.' });
    const pathname = decodeURIComponent(url.pathname);
    const file = resolve(publicDir, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(publicDir + '/') || !existsSync(file) || !statSync(file).isFile()) {
      return json(res, 404, { error:'Sayfa bulunamadı.' });
    }
    const headers = { 'Content-Type':types[extname(file)] ?? 'application/octet-stream', 'Cache-Control':'no-store' };
    if (extname(file) === '.html') headers['Set-Cookie'] = cookie + '; HttpOnly; SameSite=Strict; Path=/';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  } catch {
    if (!res.headersSent) json(res, 500, { error:'Yerel önizleme isteği tamamlanamadı.' });
    else res.destroy();
  }
});
server.requestTimeout = 45000;
server.listen(port, '127.0.0.1', () => {
  console.log('Yerel AI önizleme: ' + origin);
  console.log(mock ? 'Simüle API yanıtları; OpenAI çağrısı yok.' :
    live ? 'OpenAI etkin. İlk denemeyi varsayılan sentetik yüklerle yapın.' :
    'API anahtarı yok. Standart yerleşim çalışır.');
});
