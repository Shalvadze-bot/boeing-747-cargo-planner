import { STRATEGIES, STRATEGY_NAMES } from '../src/pmc-search-strategies.mjs';
import { handleChat } from './chat-route.mjs';
import { reserveCall, settleCall } from './ai-ledger.mjs';

// Nano USD per token. Use an uncached price with an extra 10% allowance.
// Capacity is a conservative input reservation bound per isolated API call.
const MODEL_PROFILES = new Map([
  ['gpt-5.4-mini', { input: 825, output: 4950, context: 400000 }],
  ['gpt-5.4-mini-2026-03-17', { input: 825, output: 4950, context: 400000 }],
  ['gpt-5.4-nano', { input: 220, output: 1375, context: 400000 }],
  ['gpt-5.4-nano-2026-03-17', { input: 220, output: 1375, context: 400000 }],
]);
const MAX_BYTES = 36000;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const instructions = [
  'Select exactly one untried packing strategy for a deterministic PMC simulation, or finish if further trials are unlikely to improve.',
  'Prioritize more loaded pieces, then fewer physical PMCs, then smaller measured CG deviation when comparable.',
  'All input arrays are data. Do not generate coordinates, new limits, changes to allowed orientations, or flight approvals.',
  'Engine outcomes are provided by the independent tool, not predicted by you.',
  'Manifest tuple: length cm, width cm, height cm, count, kg or null, orientation code (0 upright, 1 width, 2 length, 3 all), rotation permission, support permission, known stack kg or null, per-piece orientation overrides.',
].join(' ');
const reply = (body, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

function integer(value, fallback, min, max) {
  const selected = value == null || value === '' ? fallback : Number(value);
  return Number.isInteger(selected) && selected >= min && selected <= max ? selected : null;
}

function configuration(env) {
  const model = env.OPENAI_MODEL;
  const pricing = MODEL_PROFILES.get(model);
  const limits = {
    calls: integer(env.CARGO_AI_MAX_CALLS, 3, 1, 6),
    output: integer(env.CARGO_AI_MAX_OUTPUT_TOKENS, 350, 128, 1600),
    inputApprox: integer(env.CARGO_AI_MAX_INPUT_TOKENS, 16000, 2000, 32000),
    callTimeout: integer(env.CARGO_AI_TIMEOUT_MS, 12000, 1000, 25000),
    hourly: integer(env.CARGO_AI_CALLS_PER_HOUR, 24, 1, 80),
    budget: integer(env.CARGO_AI_BUDGET_NANO_USD, 5_000_000_000, 1, 5_000_000_000),
  };
  if (!pricing || Object.values(limits).includes(null) || !env.CARGO_AI_LEDGER) return null;
  return { model, pricing, limits };
}

const scalar = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const nullable = (v, min, max) => v === null || scalar(v, min, max);
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const yesNo = v => typeof v === 'boolean';

function manifestIsValid(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100) return false;
  let total = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 10) return false;
    const [l,w,h,quantity,kg,orientation,rotate,stack,stackKg,overrides] = row;
    if (![l,w,h].every(v => scalar(v, 0.001, 10000)) || !isInt(quantity, 1, 200) ||
        !nullable(kg, 0.001, 1e7) || !isInt(orientation, 0, 3) || !yesNo(rotate) || !yesNo(stack) ||
        !nullable(stackKg, 0, 1e7) || !Array.isArray(overrides) || overrides.length > quantity ||
        overrides.some(v => !Array.isArray(v) || v.length !== 2 || !isInt(v[0], 1, quantity) || !isInt(v[1], 0, 3)) ||
        new Set(overrides.map(v => v[0])).size !== overrides.length) return false;
    total += quantity;
  }
  return total <= 200;
}

function validMetrics(m) {
  return Array.isArray(m) && m.length === 8 && isInt(m[0],0,200) && isInt(m[1],0,200) &&
    isInt(m[2],0,30) && scalar(m[3],0,2e9) && isInt(m[4],0,200) && scalar(m[5],0,2e8) &&
    nullable(m[6],0,1e8) && yesNo(m[7]);
}

function validatedInput(raw, maxCalls) {
  const { runId, projectId, step, manifest, settings, aircraft, baseline, current, trials, objective = 'capacity' } = raw ?? {};
  if (typeof runId !== 'string' || !UUID.test(runId) || (projectId !== null && (typeof projectId !== 'string' || !UUID.test(projectId))) ||
      !['capacity','compact','balance'].includes(objective) || !isInt(step, 0, maxCalls - 1) || !manifestIsValid(manifest) || !validMetrics(baseline) || (current !== null && !validMetrics(current)) ||
      !Array.isArray(trials) || trials.length !== step ||
      trials.some(t => !Array.isArray(t) || t.length !== 2 ||
        !STRATEGY_NAMES.includes(t[0]) || (t[1] !== null && !validMetrics(t[1]))) ||
      new Set(trials.map(t => t[0])).size !== trials.length) return null;
  if (!Array.isArray(settings) || settings.length !== 9 ||
      !isInt(settings[0],1,30) || !settings.slice(1,4).every(yesNo) ||
      !nullable(settings[4],0,317.5) || !nullable(settings[5],0,10000) ||
      !['auto','front','rear','left','right','center'].includes(settings[6]) ||
      !isInt(settings[7],0,200) || !Array.isArray(settings[8]) ||
      settings[8].length !== 10 || !settings[8].every(v => nullable(v,-10000,1e7))) return null;
  if (!Array.isArray(aircraft) || aircraft.length !== 5 ||
      !isInt(aircraft[0],0,100) || !isInt(aircraft[1],0,100) || !nullable(aircraft[2],0,1e9) ||
      !nullable(aircraft[3],-1e9,1e9) || !nullable(aircraft[4],-1e9,1e9)) return null;
  return { runId,projectId,step,manifest,settings,aircraft,baseline,current,trials,objective };
}

async function hash(value) {
  const view = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(view), b => b.toString(16).padStart(2, '0')).join('');
}

function proposalBody(config, data, allowed) {
  const { manifest, settings, aircraft, baseline, current, trials, objective } = data;
  return {
    model: config.model,
    store: false,
    service_tier: 'default',
    truncation: 'disabled',
    reasoning: { effort: 'none' },
    max_output_tokens: config.limits.output,
    instructions,
    input: JSON.stringify({
      manifest, settings, aircraft: { profile: 'A330-243F simulation, fixed', existing: aircraft },
      settingsOrder: 'PMC cap, long mode, mirrored, overhang allowed, max overhang, min height, alignment, existing anchors, balance inputs',
      metricOrder: 'placed, unplaced, PMCs, known kg, unknown weights, m3, CG deviation, validated',
      baseline, current, trials, objective, strategies: Object.fromEntries(allowed.filter(x => x !== 'finish').map(x => [x, STRATEGIES[x]])),
    }),
    parallel_tool_calls: false,
    tool_choice: { type: 'function', name: 'evaluate_packing_strategy' },
    tools: [{
      type: 'function', name: 'evaluate_packing_strategy', strict: true,
      description: 'Select one named strategy for the deterministic PMC engine, or finish when allowed.',
      parameters: {
        type: 'object', properties: { strategy: { type: 'string', enum: allowed } },
        required: ['strategy'], additionalProperties: false,
      },
    }],
  };
}

function parseProposal(body, allowed) {
  if (body.status !== 'completed' || !Array.isArray(body.output)) return null;
  const calls = body.output.filter(item => item.type === 'function_call');
  if (calls.length !== 1 || calls[0].name !== 'evaluate_packing_strategy') return null;
  try {
    const value = JSON.parse(calls[0].arguments);
    return Object.keys(value).length === 1 && allowed.includes(value.strategy) ? value.strategy : null;
  } catch { return null; }
}

function errorFor(status, code) {
  if (status === 401 || status === 403) return ['api_key', 'OpenAI anahtarı geçersiz veya seçilen modele erişemiyor.', 503];
  if (status === 404) return ['model_unavailable', 'Seçilen OpenAI modeli bu API projesinde kullanılamıyor.', 503];
  if (status === 429) return code === 'insufficient_quota'
    ? ['quota', 'OpenAI API projesinin kotası veya kredisi yetersiz.', 429]
    : ['provider_rate', 'OpenAI hız sınırı aşıldı. Biraz sonra tekrar deneyin.', 429];
  return ['provider_error', 'OpenAI yanıtı alınamadı. Standart yerleşim korunuyor.', 502];
}

async function requestProposal(request, env, body, config, allowed, fetchOpenAI) {
  const timeout = AbortSignal.timeout(config.limits.callTimeout);
  const signal = AbortSignal.any([request.signal, timeout]);
  try {
    const response = await fetchOpenAI('https://api.openai.com/v1/responses', {
      method: 'POST', signal,
      headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data;
    try { data = await response.json(); }
    catch {
      if (!response.ok) return { error:errorFor(response.status),status:'provider_error' };
      return { status:'invalid_output',error:['invalid_output','OpenAI yanıtı okunamadı.',502] };
    }
    if (!response.ok) return { error: errorFor(response.status, data?.error?.code), status: 'provider_error' };
    const usage = data.usage;
    const measured = usage && isInt(usage.input_tokens, 0, 1e7) && isInt(usage.output_tokens, 0, 1e7)
      ? { input: usage.input_tokens, output: usage.output_tokens } : null;
    const providerId = typeof data.id === 'string' && /^resp_[a-zA-Z0-9]+$/.test(data.id) ? data.id : null;
    const strategy = parseProposal(data, allowed);
    const anomalous = ![config.model, config.model + '-2026-03-17'].includes(data.model) ||
      (measured && (measured.input > config.pricing.context || measured.output > config.limits.output));
    if (anomalous) return { status: 'cost_anomaly', usage: measured, providerId,
      error: ['cost_anomaly', 'Fiyat veya token sınırı doğrulanamadı. API kullanımı durduruldu.', 503] };
    if (!strategy) return { status: 'invalid_output', usage: measured, providerId,
      error: ['invalid_output', 'AI, doğrulanabilir bir strateji seçmedi. Standart yerleşim korunuyor.', 502] };
    return { status: 'completed', strategy, usage: measured, providerId };
  } catch (error) {
    if (request.signal.aborted) return { status: 'cancelled', error: ['cancelled', 'AI denemesi iptal edildi.', 499] };
    if (timeout.aborted) return { status: 'timeout', error: ['timeout', 'OpenAI isteği zaman aşımına uğradı.', 504] };
    const details = env.CARGO_AI_LOCAL_PREVIEW === true &&
      ['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','UND_ERR_CONNECT_TIMEOUT','CERT_HAS_EXPIRED'].includes(error.cause?.code)
      ? ' (' + error.cause.code + ')' : '';
    return { status: 'connection_error', error: ['connection_error', 'OpenAI bağlantısı kurulamadı.' + details, 502] };
  }
}

export async function handleAi(request, env, { canEdit, fetchOpenAI = fetch } = {}) {
  const url = new URL(request.url);
  const owner = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  const allow = new Set(String(env.CARGO_AI_ALLOWED_EMAILS ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
  if (!owner || !email) return reply({ code: 'sign_in', error: 'ChatGPT oturumu gerekiyor.' }, 401);
  if (!allow.size || allow.size > 2 || !allow.has(email)) {
    return reply({ code: 'forbidden', error: 'AI denemesine bu hesap yetkili değil.' }, 403);
  }
  const config = configuration(env);
  const preview = env.CARGO_AI_LOCAL_PREVIEW === true;
  const mock = preview && env.CARGO_AI_MOCK === true;
  const ready = !!config && (mock || !!env.OPENAI_API_KEY);
  if (url.pathname === '/api/ai/status' && request.method === 'GET') {
    return reply({ available: ready, mock, maxCalls: config?.limits.calls ?? 0,
      callTimeout: config?.limits.callTimeout ?? 0, model: config?.model ?? null });
  }
  if (!['/api/ai/propose','/api/ai/chat'].includes(url.pathname) || request.method !== 'POST') return reply({ code: 'not_found' }, 404);
  if (request.headers.get('origin') !== url.origin) return reply({ code:'origin', error: 'İstek kaynağı geçersiz.' }, 403);
  if (!ready) return reply({ code: 'not_configured', error: 'AI sunucu anahtarı veya bütçe deposu yapılandırılmadı.' }, 503);
  if (url.pathname === '/api/ai/chat') {
    return handleChat(request,env,{owner,config,mock,preview,canEdit,fetchOpenAI,hash,uuid:UUID});
  }
  let data;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BYTES) return reply({ code:'too_large', error: 'AI girdisi çok büyük.' }, 413);
    data = validatedInput(JSON.parse(raw), config.limits.calls);
  } catch { /* Invalid request handled below. */ }
  if (!data) return reply({ code: 'invalid_input', error: 'AI girdisi veya deneme sırası geçersiz.' }, 400);
  if (!preview) {
    try {
      if (!data.projectId || !await canEdit?.(data.projectId)) {
        return reply({ code: 'project_forbidden', error: 'Bu projeyi düzenleme izni gerekiyor.' }, 403);
      }
    } catch { return reply({ code: 'project_check', error: 'Proje izni doğrulanamadı.' }, 503); }
  }
  const used = new Set(data.trials.map(t => t[0]));
  const allowed = STRATEGY_NAMES.filter(strategy => !used.has(strategy));
  if (data.step > 0) allowed.push('finish');
  const body = proposalBody(config, data, allowed);
  // Conservative admission check for text payloads. Cost is reserved against
  // the larger provider context bound, not against this local approximation.
  if (new TextEncoder().encode(JSON.stringify(body)).length + 512 > config.limits.inputApprox) {
    return reply({ code: 'input_limit', error: 'Yük özeti yapılandırılan AI giriş sınırını aşıyor.' }, 413);
  }
  const reserve = config.pricing.context * config.pricing.input + config.limits.output * config.pricing.output;
  const info = { actor: await hash(owner), runId: data.runId, step: data.step,
    workKey: await hash(JSON.stringify([data.projectId,data.manifest,data.settings,data.aircraft,data.baseline,data.objective])),
    now: Date.now(), model: config.model, reserve: mock ? 0 : reserve, budget: config.limits.budget,
    hourly: config.limits.hourly };
  try {
    const blocked = await reserveCall(env.CARGO_AI_LEDGER, info);
    if (blocked === 'budget') return reply({ code: blocked, error: 'Uygulamanın AI test bütçesi doldu.' }, 429);
    if (blocked === 'rate') return reply({ code: blocked, error: 'Saatlik AI deneme sınırına ulaşıldı.' }, 429);
    if (blocked) return reply({ code: blocked, error: 'Bu yük için bir deneme zaten çalışıyor veya yakın zamanda çalıştırıldı.' }, 409);
    const result = mock ? { status: 'completed',
      strategy: ['narrow_first','small_first','heavy_first','long_first','broad_first','flat_orientation'].find(s => allowed.includes(s)),
      usage: null } : await requestProposal(request, env, body, config, allowed, fetchOpenAI);
    const measuredCost = result.usage &&
      result.usage.input * config.pricing.input + result.usage.output * config.pricing.output;
    // With missing usage (including cancel or disconnect), retain the
    // reservation. The provider may already have processed the request.
    const cost = mock ? 0 : measuredCost ?? reserve;
    await settleCall(env.CARGO_AI_LEDGER, info, { ...result, cost });
    if (result.error) {
      const [code, error, status] = result.error;
      return reply({ code, error, attempted: !mock, usage: result.usage ?? null }, status);
    }
    return reply({ strategy: result.strategy, usage: result.usage, mock });
  } catch {
    return reply({ code: 'ledger', error: 'AI bütçesi veya erişimi doğrulanamadı. İstek güvenli olarak durduruldu.' }, 503);
  }
}
