import { useCallback, useEffect, useRef, useState } from 'react';
import { ORIENTATION_MODES } from './pmc-engine.mjs';
import { balanceProfile } from './pmc-long-balance.mjs';
import { normalizePmcInput } from './pmc-search-strategies.mjs';
import { OBJECTIVES, sortAlternatives, canApplyAlternative } from './pmc-plan-options.mjs';

const cap = 90000;
export const unmarkedConfig = ({ aiApplied, ...config }) => config;
export const packingSignature = (rows, config) => JSON.stringify([rows, unmarkedConfig(config)]);
const compactNumber = value => Number.isFinite(value) ? Number(value.toFixed(5)) : null;
const orientationCode = value => ORIENTATION_MODES.indexOf(value ?? 'upright');

export function toAiManifest(rows) {
  return rows.map(row => [
    row.length,row.width,row.height,row.quantity,row.weight,
    orientationCode(row.orientationMode),row.allowRotation ?? true,row.stackable ?? true,row.maxStackLoadKg ?? null,
    Object.entries(row.pieceOrientations ?? {}).map(([piece,face]) => [Number(piece),orientationCode(face)]),
  ]);
}

function metrics(validation) {
  const s = validation?.stats;
  return s && [s.placed,s.unplaced,s.pmcs,compactNumber(s.kg),s.unknownWeight,
    compactNumber(s.volume),compactNumber(s.balanceDistance),validation.valid];
}

export async function measuredEngine(input, signal) {
  if (signal.aborted) throw signal.reason;
  return new Promise((resolve, reject) => {
    let timer;
    const worker = new Worker(new URL('./pmc-ai-worker.mjs', import.meta.url), { type: 'module' });
    const stop = () => {
      clearTimeout(timer);
      worker.terminate();
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { stop(); reject(signal.reason); };
    signal.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = ({data}) => {
      stop();
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    worker.onerror = () => { stop(); reject(new Error('Yerleşim doğrulayıcısı çalışmadı.')); };
    timer = setTimeout(() => { stop(); reject(new Error('Yerleşim hesaplama süresi doldu.')); }, 30000);
    try { worker.postMessage(input); }
    catch (error) { stop(); reject(error); }
  });
}

export function useAiPacking({ rows, config, projectId, aircraft, existing, disabled }) {
  const [service, setService] = useState(null);
  const [objective, setObjective] = useState('capacity');
  const [progress, setProgress] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [message, setMessage] = useState('');
  const controllerRef = useRef(null);
  const startTimeRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const inputKey = JSON.stringify([packingSignature(rows, config), aircraft, projectId, objective]);
  const latest = useRef(inputKey);
  latest.current = inputKey;

  useEffect(() => {
    if (!projectId || disabled) return;
    const controller = new AbortController();
    fetch('/api/ai/status', { signal:controller.signal, cache:'no-store' })
      .then(response => response.ok ? response.json() : {available:false})
      .then(value => { if (!controller.signal.aborted) setService(value); })
      .catch(() => { if (!controller.signal.aborted) setService({available:false}); });
    return () => controller.abort();
  }, [projectId, disabled]);

  const cancel = useCallback((reason = 'AI denemesi iptal edildi.') => {
    controllerRef.current?.abort(new DOMException(reason, 'AbortError'));
  }, []);

  useEffect(() => () => cancel('Girdiler değişti veya proje kapatıldı.'), [inputKey, cancel]);
  useEffect(() => {
    if (!progress) return;
    const timer = setInterval(() => setElapsed(performance.now() - startTimeRef.current), 250);
    return () => clearInterval(timer);
  }, [!!progress]);

  async function start() {
    if (!service?.available || disabled || controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(new DOMException('AI arama süresi doldu.', 'TimeoutError')), cap);
    const signal = controller.signal;
    const started = performance.now();
    startTimeRef.current = started;
    setElapsed(0);
    setOutcome(null);
    setMessage('');
    setProgress({ stage:'Standart plan hesaplanıyor', completed:0, best:null });
    let standard, current, rejected = 0, apiCalls = 0;
    const candidates = [];
    const usage = { input:0, output:0, missing:0 };
    const trials = [];
    let issue = '';
    const rawConfig = unmarkedConfig(config);
    try {
      standard = await measuredEngine({ rows, config:rawConfig }, signal);
      if (!standard.validation.stats) throw new Error('Önce yük listesi ve PMC ayarlarını düzeltin.');
      if (existing) current = await measuredEngine({ rows, config:rawConfig, baseline:existing }, signal);
      const normalized = normalizePmcInput(rows, rawConfig);
      const c = normalized.config;
      const profile = balanceProfile(c.pmcBalance);
      const fixedCount = new Set([...Object.keys(c.manualXAnchors ?? {}),...Object.keys(c.highEdgeAnchors ?? {})]).size;
      const runId = crypto.randomUUID();
      const summary = {
        runId, projectId, objective, manifest:toAiManifest(normalized.rows),
        settings:[c.maxPallets,!!c.longCargo,!!c.mirrored,!!c.allowOverhang,
          c.maxOverhangCm,c.minOverhangHeightCm,c.longCargoAlignment ?? 'auto',fixedCount,Object.values(profile.input)],
        aircraft, baseline:metrics(standard.validation), current:metrics(current?.validation) ?? null,
      };
      for (let step = 0; step < service.maxCalls; step++) {
        signal.throwIfAborted();
        setProgress({ stage:'AI strateji seçiyor', completed:trials.length, best:sortAlternatives(candidates, standard, objective)[0]?.validation.stats ?? null });
        const response = await fetch('/api/ai/propose', {
          method:'POST', signal,
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({...summary,step,trials}),
        });
        const data = await response.json();
        if (response.ok || data.attempted) {
          apiCalls += service.mock ? 0 : 1;
          if (data.usage) { usage.input += data.usage.input; usage.output += data.usage.output; }
          else if (!service.mock) usage.missing++;
        }
        if (!response.ok) throw new Error(data.error ?? 'AI isteği tamamlanamadı.');
        if (data.strategy === 'finish') break;
        setProgress({ stage:'Motor hesaplıyor ve doğruluyor', completed:trials.length, best:sortAlternatives(candidates, standard, objective)[0]?.validation.stats ?? null });
        const candidate = await measuredEngine({ rows, config:rawConfig, strategy:data.strategy }, signal);
        trials.push([data.strategy,metrics(candidate.validation) ?? null]);
        if (!candidate.validation.valid) rejected++;
        else candidates.push({...candidate,strategy:data.strategy});
        setProgress({ stage:'Deneme tamamlandı', completed:trials.length, best:sortAlternatives(candidates, standard, objective)[0]?.validation.stats ?? null });
      }
    } catch (error) {
      issue = error?.message || 'AI denemesi tamamlanamadı.';
    } finally {
      clearTimeout(timeout);
      if (controllerRef.current === controller) controllerRef.current = null;
      setProgress(null);
    }
    if (latest.current !== inputKey) return;
    if (signal.aborted) {
      setMessage(issue);
      return;
    }
    if (!standard?.validation?.stats) {
      setMessage(issue);
      return;
    }
    const alternatives = sortAlternatives(candidates, standard, objective).map(candidate => ({
      ...candidate, canApply: !issue && canApplyAlternative(candidate,standard.validation,current?.validation,objective),
    }));
    setOutcome({ key:inputKey, standard, alternatives, current, objective, issue, trials,
      rejected, apiCalls, usage, elapsedMs:performance.now() - started, mock:service.mock, aircraft });
  }

  return { service, progress, objective, setObjective, objectives:OBJECTIVES, outcome:outcome?.key === inputKey ? outcome : null, message, elapsed, start, cancel };
}
