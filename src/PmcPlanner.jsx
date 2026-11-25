import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Cube, Plus, Trash, MagicWand, DownloadSimple, Warning, Info, ArrowCounterClockwise, CheckCircle, X } from '@phosphor-icons/react';
import { DEFAULT_CONFIG, SAMPLE_CARGO, PMC, contourHeight } from './pmc-engine.mjs';
import { PmcPlanView, PmcPlacementDetails, ViewSwitch } from './PmcPlanView';
import {runLongCargo} from './pmc-long-cargo.mjs';
import LongCargoDetails from './LongCargoDetails';
import PmcLongBalanceSettings from './PmcLongBalanceSettings';
import {preparePmcTransfer} from './pmc-aircraft.mjs';
import './pmc-planner.css';
import PmcGeometryPanel from './PmcGeometryPanel';
import { assessResearchPlan, CONTOUR_OPTIMIZER, DEFAULT_RESEARCH_SETTINGS, RESEARCH_PROFILE_LABEL, researchModelFor } from './pmc-research-review.mjs';
import { researchEnvelopeMm3, researchSectionCm } from './pmc-contour-space.mjs';
import './ai-packing.css';
import { normalizePmcConfig, STRATEGY_NAMES } from './pmc-search-strategies.mjs';
import { measuredEngine, packingSignature, unmarkedConfig, useAiPacking } from './use-ai-packing.mjs';
import { AiPackingButton, AiPackingPanel } from './AiPackingPanel';
import { cargoKey, expandPmcSnapshot, makePmcSnapshot, pmcRestoreConfig, readHistory, writeHistory } from './plan-history.mjs';
import { layoutKey } from './pmc-plan-options.mjs';
import { pmcContext, searchChatPlans } from './ai-plan-context.mjs';

const STORE = 'cargo-pmc-v1';
const profileMargin = 210 * PMC.margin / PMC.width; // Display scale only; base-edge clearance.
const COLORS = ['#4bb5f7', '#fb9a57', '#a98bf5', '#50d2ad', '#ee759d', '#e1cb57', '#78a7ff', '#bcdd77'];
const orientationOptions = [['upright','Dik (varsayılan)'],['side-width','Genişlik üzerine yatırılabilir'],['side-length','Uzunluk üzerine yatırılabilir'],['all','Tüm yönlere çevrilebilir']];
const OrientationOptions = () => orientationOptions.map(([value,label]) => <option key={value} value={value}>{label}</option>);
const format = (n, d = 1) => Number.isFinite(n) ? n.toLocaleString('tr-TR', { maximumFractionDigits: d }) : '—';
const signature = (rows, config) => JSON.stringify({ rows, config });
const isContour = config => config?.optimizer === CONTOUR_OPTIMIZER;
const contourOutcomes = {
  complete:'Tüm parçalar araştırma modelinde yerleşti.',
  'missing-input':'Geometri girdisi veya yön izni eksik.',
  'proven-infeasible':'Bu araştırma sınırlarında tam yerleşimin imkânsız olduğu kanıtlandı.',
  'heuristic-exhausted':'Arama tam yerleşim bulamadı. Matematiksel durum belirsiz.',
  'candidate-limit':'Aday bütçesi doldu. En iyi doğrulanmış sonuç gösteriliyor.',
  'time-limit':'Arama süresi doldu. En iyi doğrulanmış sonuç gösteriliyor.',
};
function nextColor(index) {
  if (index < COLORS.length) return COLORS[index];
  const h = ((index - COLORS.length) * 137.508 + 15) % 360 / 60;
  const c = 0.62, x = c * (1 - Math.abs(h % 2 - 1)), m = 0.22;
  const [r,g,b] = h < 1 ? [c,x,0] : h < 2 ? [x,c,0] : h < 3 ? [0,c,x] : h < 4 ? [0,x,c] : h < 5 ? [x,0,c] : [c,0,x];
  return '#' + [r,g,b].map(v => Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');
}
const freshRows = () => SAMPLE_CARGO.map((row, i) => ({ ...row, color: COLORS[i % COLORS.length] }));
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (saved?.version === 1 && Array.isArray(saved.rows) && saved.rows.length <= 100 && saved.config && typeof saved.config === 'object') {
      const ids = saved.rows.map(row => row?.id);
      if (ids.every(id => typeof id === 'string' && id.length < 80) && new Set(ids).size === ids.length && saved.rows.every(row => typeof row.name === 'string' && row.name.length <= 60 && ['length','width','height','quantity','weight'].every(key => row[key] == null || typeof row[key] === 'number' || typeof row[key] === 'string') && typeof row.stackable === 'boolean' && typeof row.allowRotation === 'boolean')) {
        return { rows: saved.rows, config: { ...DEFAULT_CONFIG, ...saved.config } };
      }
    }
  } catch { /* Start with examples if browser storage is unavailable or invalid. */ }
  return { rows: freshRows(), config: { ...DEFAULT_CONFIG } };
}

function PmcProfile({ mirrored, usesContour, model }) {
  // In the nose-to-tail schematic, increasing pallet X points toward screen left.
  const screenX = x => 255 - 210 * x / PMC.width;
  const screenZ = z => 170 - 140 * z / PMC.maxHeight;
  const high = screenX(mirrored ? PMC.width : 0);
  const shoulder = screenX(mirrored ? PMC.width - PMC.shoulderX : PMC.shoulderX);
  const low = screenX(mirrored ? 0 : PMC.width);
  const top = screenZ(PMC.maxHeight);
  const lowTop = screenZ(PMC.lowHeight);
  if(usesContour){
    const roof=model?researchSectionCm(model):[];
    const points=roof.length?[[roof[0][0],0],...roof,[roof.at(-1)[0],0]]:[];
    return <figure className="pmc-profile-diagram">
      <figcaption>{RESEARCH_PROFILE_LABEL} · araştırma kesiti</figcaption>
      <svg viewBox="0 0 300 209" role="img" aria-label={RESEARCH_PROFILE_LABEL+' araştırma palet kesiti'}>
        {points.length>0&&<polygon points={points.map(([x,z])=>[screenX(x),screenZ(z)].join(',')).join(' ')}
          fill="#283544" stroke="#8ca0b8" strokeWidth="1.5"/>}
        <path d={`M${45+profileMargin} 170 H${255-profileMargin}`} fill="none" stroke="#ffbc24" strokeDasharray="4 4"/>
        <path d="M45 185 H255" stroke="#5e7187"/>
        <text x="150" y="202" fill="#c1cddd" fontSize="12" textAnchor="middle">96″ / 243,84 cm</text>
      </svg>
      <div className="pmc-profile-sides"><span>Uçağın sağı</span><span>Uçağın solu</span></div>
    </figure>;
  }

  return <figure className="pmc-profile-diagram">
    <figcaption>Burundan kuyruğa bakış</figcaption>
    <svg viewBox="0 0 300 209" role="img" aria-label="ZX-11 şematik palet kesiti">
      <path className="pmc-profile-outline" d={`M${high} 170 V${top} H${shoulder} L${low} ${lowTop} V170 Z`}
        fill="#283544" stroke="#8ca0b8" strokeWidth="1.5"/>
      <g className="pmc-base-clearance" aria-label="8,5 cm kenar boşluğu yalnızca tabanda; yükseklikten çıkarılmaz">
        <path d={`M${45+profileMargin} 170 H${255-profileMargin}`} fill="none" stroke="#ffbc24" strokeDasharray="4 4"/>
        <path d={`M45 170 H${45+profileMargin} M${255-profileMargin} 170 H255`} fill="none" stroke="#ffbc24" strokeWidth="4"/>
        <path d={`M${45+profileMargin} 165 V175 M${255-profileMargin} 165 V175`} fill="none" stroke="#ffbc24"/>
      </g>
      <path d="M45 185 H255" stroke="#5e7187"/>
      <g fill="#c1cddd" fontSize="12" textAnchor="middle">
        <text x="150" y="202">96″ / 243,84 cm</text>
        <text x={(high+shoulder)/2} y="12" fontSize="10">39,5″ / 100,33 cm</text>
        <text x={(shoulder+low)/2} y="47" fontSize="10">56,5″ / 143,51 cm</text>
        <text transform={`translate(${high + (mirrored ? -13 : 13)} 100) rotate(-90)`} fontSize="10">96″ / 243,84 cm</text>
        <text x={low} y={lowTop-19} fontSize="10" fill="#ffce64">41″ / 104,14 cm</text>
      </g>
    </svg>
    <div className="pmc-profile-sides"><span>Uçağın sağı</span><span>Uçağın solu</span></div>
  </figure>;
}

export default function PmcPlanner({onImportAircraft, viewOnly = false, cloudBacked = false, activityPanel, projectId, chatBridge, aircraftContext = [0,0,null,null,null]}) {
  const [transfer,setTransfer] = useState(null);
  const [transferError,setTransferError] = useState('');
  const [initial] = useState(restore);
  const [rows, setRows] = useState(initial.rows);
  const [config, setConfig] = useState(initial.config);
  const [result, setResult] = useState(null);
  const [resultSignature, setResultSignature] = useState('');
  const [planView, setPlanView] = useState('3D');
  const [history, setHistory] = useState(readHistory);
  const [restoring, setRestoring] = useState(false);
  const [historyNotice, setHistoryNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(true);
  const [selectedPallet, setSelectedPallet] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [showContour, setShowContour] = useState(true);
  const [labels, setLabels] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);
  const [heightCut, setHeightCut] = useState(244);
  const [resetOpen, setResetOpen] = useState(false);
  const [legacyResearchSettings,setLegacyResearchSettings] = useState(DEFAULT_RESEARCH_SETTINGS);
  const worker = useRef(null);
  const timeout = useRef(null);
  const usesContour=isContour(config);
  const researchSettings=usesContour?(config.researchSettings??DEFAULT_RESEARCH_SETTINGS):legacyResearchSettings;
  const draftModel=usesContour?researchModelFor(config,researchSettings):null;
  const currentSignature = signature(rows, config);
  const stale = !!result && resultSignature !== currentSignature;
  const researchAssessment = useMemo(()=>assessResearchPlan({rows,result,stale,busy:busy||restoring,settings:researchSettings}),[rows,result,stale,busy,restoring,researchSettings]);
  const lastPmc = history.pmc[0];
  const previousOutdated = lastPmc && lastPmc.cargoKey !== cargoKey(rows);
  const previousModeChanged = lastPmc && (!!lastPmc.config?.longCargo !== !!config.longCargo ||
    isContour(lastPmc.config)!==usesContour);
  const historyCheck = useRef(null);
  const chooseItem = id => {
    setSelectedItemId(id);
    const piece = result?.placements.find(item=>item.id===id);
    if (piece && selectedPallet !== null && selectedPallet !== piece.palletIndex && !piece.touchedPallets?.includes(selectedPallet)) {
      setSelectedPallet(piece.palletIndex);
    }
  };
  const choosePallet = index => {
    setSelectedPallet(index);
    setSelectedItemId(selectedItemId && result?.placements.some(item =>
      item.id===selectedItemId && (item.palletIndex===index || item.touchedPallets?.includes(index))) ? selectedItemId : null);
  };
  const ai = useAiPacking({ rows, config, projectId, aircraft:aircraftContext, existing:stale?null:result, disabled:viewOnly||usesContour });
  const currentInputs = useRef(null);
  currentInputs.current = { signature:currentSignature, aircraft:JSON.stringify(aircraftContext), result, rows, config };
  const applying = useRef(null);
  const aiPanel = useRef(null);
  const placements = result?.placements || [];
  const palletCount = result?.pallets?.length || 0;
  const visibleItems = placements.filter(item => selectedPallet === null || item.touchedPallets?.includes(selectedPallet) || item.palletIndex === selectedPallet);
  const totalRequested = rows.reduce((sum, row) => sum + (Number.isFinite(Number(row.quantity)) ? Number(row.quantity) : 0), 0);
  const volume = placements.reduce((sum, p) => sum + p.w * p.l * p.h / 1e6, 0);
  const overhangs = placements.filter(p => p.overhangCm > 0);
  const configForResult = result?.config || config;
  const displayedProfile=isContour(configForResult)?RESEARCH_PROFILE_LABEL:'ZX-11';
  const resultElapsed=result?.optimizer?.elapsedMs??result?.elapsedMs;
  const selectedAlignment = Object.keys(config.manualXAnchors ?? {}).length
    ? 'manual'
    : Object.keys(config.highEdgeAnchors ?? {}).length
      ? 'high'
      : config.longCargoAlignment || 'auto';
  const isPreviousAlignment = ['front', 'rear'].includes(selectedAlignment);
  const envelopeArea = (PMC.shoulderX - PMC.margin) * PMC.maxHeight +
    (PMC.width - PMC.margin - PMC.shoulderX) * (PMC.maxHeight + contourHeight(PMC.width - PMC.margin)) / 2;
  const clippedVolume = placements.reduce((sum, item) => sum + (item.touchedPallets || [item.palletIndex]).reduce((v, index) => v + item.w * item.h * Math.max(0, Math.min(item.y + item.l, (index + 1) * PMC.length - PMC.margin) - Math.max(item.y, index * PMC.length + PMC.margin)), 0), 0);
  const utilization = result?.researchModel ? result.optimizer.volumeUtilization*100 :
    palletCount ? clippedVolume / (envelopeArea * PMC.usableLength * palletCount) * 100 : 0;

  useEffect(() => {
    if (viewOnly || (cloudBacked && rows === initial.rows && config === initial.config)) return;
    try { localStorage.setItem(STORE, JSON.stringify({ version: 1, rows, config })); setSaved(true); window.dispatchEvent(new Event('cargo:local-plan-change')); }
    catch { setSaved(false); }
  }, [rows, config, initial, viewOnly, cloudBacked]);
  useEffect(() => {
    const saved = initial.config.aiApplied;
    const strategy = STRATEGY_NAMES.includes(saved?.strategy) &&
      saved.fingerprint === packingSignature(initial.rows,initial.config) ? saved.strategy : undefined;
    const candidate = history.currentPmc;
    const check = new AbortController();
    const savedResult = expandPmcSnapshot(candidate);
    if (savedResult && candidate.cargoKey === cargoKey(initial.rows) &&
        packingSignature(initial.rows,candidate.config) === packingSignature(initial.rows,initial.config)) {
      setBusy(true);
      measuredEngine({rows:initial.rows,config:initial.config,baseline:savedResult},check.signal).then(checked=>{
        if (check.signal.aborted) return;
        if (checked.validation.valid) {
          setResult(checked.result);setResultSignature(signature(initial.rows,initial.config));setBusy(false);
        } else calculate(initial.rows,initial.config,strategy);
      }).catch(()=>{ if(!check.signal.aborted) calculate(initial.rows,initial.config,strategy); });
    } else calculate(initial.rows, initial.config, strategy);
    return () => { check.abort(); historyCheck.current?.abort();worker.current?.terminate(); clearTimeout(timeout.current); applying.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!resetOpen && !transfer) return;
    const box = document.querySelector('.pmc-reset-dialog, .pmc-transfer-dialog');
    const previous = document.activeElement;
    box?.querySelector('button')?.focus();
    const listener = event => {
      if (event.key === 'Escape') {setResetOpen(false);setTransfer(null);}
      if (event.key === 'Tab') {
        const buttons = [...box.querySelectorAll('button,input')];
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', listener);
    return () => { document.removeEventListener('keydown', listener); previous?.focus(); };
  }, [resetOpen,transfer]);

  function stop() { worker.current?.terminate(); worker.current = null; clearTimeout(timeout.current); setBusy(false); }
  function calculate(nextRows = rows, nextConfig = config, strategy, savePrevious = false) {
    stop(); setBusy(true); setError('');
    const snap = signature(nextRows, nextConfig);
    let instance;
    try { instance = new Worker(new URL('./pmc-worker.mjs', import.meta.url), { type: 'module' }); }
    catch { setBusy(false); setError('Hesaplama işçisi açılamadı. Tarayıcıyı yenileyip tekrar deneyin.'); return; }
    worker.current = instance;
    instance.onmessage = ({ data }) => {
      if (worker.current !== instance) return;
      stop();
      if (data.error) {
        if (strategy) { calculate(nextRows, nextConfig); return; }
        setError(data.error); return;
      }
      if (savePrevious) {
        const latest = currentInputs.current;
        if (latest.signature !== snap) return;
        if (data.result.errors?.length) {
          setError(data.result.errors.join(' '));
          return;
        }
        try {
          const clean = unmarkedConfig(nextConfig);
          recordPmcResult(data.result,nextRows,clean);
          if (nextConfig.aiApplied) setConfig(clean);
          setResultSignature(signature(nextRows,clean));
        }
        catch (error) { setError(error.message); return; }
      }
      setResult(data.result); if (!savePrevious) setResultSignature(snap); setSelectedPallet(0); setSelectedItemId(null); setHeightCut(244);
    };
    instance.onerror = () => { if (worker.current === instance) { stop(); setError('Hesaplama yüklenemedi. Sayfayı yenileyip yeniden deneyin.'); } };
    timeout.current = setTimeout(() => { if (worker.current === instance) { stop(); setError('Hesaplama süresi doldu. Daha az parça ile yeniden deneyin.'); } }, 30000);
    instance.postMessage({ rows: nextRows, config: nextConfig, strategy });
  }
  function moveCargo(item, x) {
    if(stale || busy || !result?.config?.longCargo)return;
    const next={...config,manualXAnchors:{...config.manualXAnchors,[item.id]:{x,y:item.localY,w:item.w,l:item.l,h:item.h,rotated:item.rotated}}};
    const normalized=rows.map(r=>({...r,length:Number(r.length),width:Number(r.width),height:Number(r.height),quantity:Number(r.quantity),weight:r.weight===''||r.weight==null?null:Number(r.weight)}));
    const updated=runLongCargo(normalized,next);
    setConfig(next);setResult(updated);setResultSignature(signature(rows,next));
  }
  function updateRow(id, key, value) { setRows(previous => previous.map(row => {
    if (row.id !== id) return row;
    if (key === 'orientationMode') return {...row, orientationMode:value, pieceOrientations:{}};
    if (key === 'quantity') return {...row, quantity:value, pieceOrientations:Object.fromEntries(Object.entries(row.pieceOrientations||{}).filter(([i])=>Number(i)<=Number(value)))};
    return {...row, [key]: value};
  })); }
  function updateConfig(key, value) { setConfig(previous => ({ ...previous, [key]: value })); }
  function chooseOptimizer(method) {
    const {optimizer,aiApplied,...current}=config;
    const next=method===CONTOUR_OPTIMIZER?{...current,optimizer:CONTOUR_OPTIMIZER}:current;
    ai.cancel('Yerleşim yöntemi değişti.');
    setConfig(next);
    calculate(rows,next,undefined,true);
  }
  function changeResearchSetting(key,value){
    if(usesContour) updateConfig('researchSettings',{...researchSettings,[key]:value});
    else setLegacyResearchSettings(old=>({...old,[key]:value}));
  }
  function addRow() {
    setRows(previous => [...previous, { id: `K${String(Math.max(0, ...previous.map(row => Number(row.id.match(/^K(\d+)$/)?.[1]) || 0)) + 1).padStart(2, '0')}`, name: `Yük ${previous.length + 1}`, length: 100, width: 80, height: 60, quantity: 1, weight: '', stackable: false, allowRotation: true, color: Array.from({length:200}, (_, i) => nextColor(i)).find(color => !previous.some(row => row.color === color)) || nextColor(previous.length) }]);
  }
  function importRows(incoming) {
    if (rows.length + incoming.length > 100) { setError('Yük listesi en fazla 100 satır olabilir. Önce mevcut satırları azaltın.'); return false; }
    const next = [...rows];
    let maxId = Math.max(0, ...next.map(row => Number(row.id.match(/^K(\d+)$/)?.[1]) || 0));
    for (const item of incoming) {
      const color = Array.from({length:200}, (_, i) => nextColor(i)).find(candidate => !next.some(row => row.color === candidate)) || nextColor(next.length);
      next.push({...item, id: `K${String(++maxId).padStart(2,'0')}`, color});
    }
    setRows(next); setError(''); return true;
  }
  function openTransfer(){try{setTransferError('');setTransfer(preparePmcTransfer(result));}catch(cause){setError(cause.message);}}
  function submitTransfer(event){event.preventDefault();if(stale || busy || !result){setTransferError('PMC girdileri değişti. Kapatıp yeniden hesaplayın.');return;}try{const form=new FormData(event.currentTarget);onImportAircraft(result,transfer.map(p=>Number(form.get('weight-'+p.index))));setTransfer(null);}catch(cause){setTransferError(cause.message);}}
  function download() {
    if (!result || stale || result.errors?.length) return;
    const {status,phase,message,model,report} = researchAssessment;
    const payload = { version: 1, label: 'SİMÜLASYON — UÇUŞ OPERASYONLARI İÇİN ONAYLI DEĞİLDİR', generatedAt: new Date().toISOString(), input: { rows, config }, result,
      geometryValidation: { status,phase,message,settings:researchSettings,model,report } };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'pmc-3d-simulasyon-plani.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function recordPmcResult(next, nextRows, nextConfig) {
    const latest = currentInputs.current;
    const existing = latest.result;
    let basis;
    try { basis = JSON.parse(resultSignature); } catch { /* No completed geometry yet. */ }
    const previous = existing && !existing.errors?.length && basis && (
      layoutKey(existing) !== layoutKey(next) || cargoKey(basis.rows) !== cargoKey(nextRows) ||
      isContour(basis.config)!==isContour(nextConfig))
      ? makePmcSnapshot(existing,basis.rows,basis.config) : null;
    setHistory(writeHistory(current=>({ ...current,
      currentPmc:makePmcSnapshot(next,nextRows,nextConfig),
      pmc:previous ? [previous,...current.pmc] : current.pmc,
    })));
    setHistoryNotice('');
  }

  function standardPlacement() {
    ai.cancel('Standart yerleşim başlatıldı.');
    // Keep existing metadata until the new standard result passes its normal checks.
    calculate(rows,config,undefined,true);
  }

  async function applyAiPlan(outcome, candidate) {
    if (viewOnly || usesContour || busy || restoring || applying.current || !candidate.canApply) throw new Error('Bu aday uygulanamıyor.');
    const expected = currentInputs.current;
    const controller = new AbortController();
    applying.current = controller;
    try {
      const checked = await measuredEngine({ rows, config:unmarkedConfig(config), baseline:candidate.result }, controller.signal);
      const latest = currentInputs.current;
      if (latest.signature !== expected.signature || latest.aircraft !== expected.aircraft || latest.result !== expected.result) {
        throw new Error('Yerleşim veya girdiler değişti. AI denemesini yeniden çalıştırın.');
      }
      if (!checked.validation.valid) throw new Error('Aday son kontrolden geçmedi. Mevcut plan korundu.');
      const next = { ...unmarkedConfig(config), aiApplied:{
        strategy:candidate.strategy, fingerprint:packingSignature(rows,config),
      } };
      recordPmcResult(checked.result,rows,next);
      setConfig(next);
      setResult(checked.result);
      setResultSignature(signature(rows,next));
      setSelectedPallet(0);setSelectedItemId(null);setHeightCut(244);
    } finally {
      if (applying.current === controller) applying.current = null;
    }
  }

  async function restorePmcPlan() {
    if (viewOnly || busy || restoring || !lastPmc || previousOutdated || previousModeChanged || ai.progress) return false;
    const saved = expandPmcSnapshot(lastPmc);
    if (!saved) { setHistoryNotice('Önceki yerleşim okunamadı.'); return false; }
    const controller = new AbortController();
    historyCheck.current = controller;
    const before = currentInputs.current;
    const targetConfig = pmcRestoreConfig(lastPmc,config);
    setRestoring(true);
    try {
      const checked = await measuredEngine({rows,config:targetConfig,baseline:saved},controller.signal);
      if (controller.signal.aborted || currentInputs.current.signature !== before.signature ||
          currentInputs.current.result !== before.result) {
        throw new Error('Yük veya ayar değişti. Önceki plan uygulanmadı.');
      }
      if (!checked.validation.valid) throw new Error('Önceki plan güncel kısıtlarda geçerli değil: '+checked.validation.errors[0]);
      const next = {...checked.result,config:{...saved.config,...normalizePmcConfig(targetConfig)}};
      setHistory(writeHistory(current=>({...current,pmc:current.pmc.slice(1),currentPmc:makePmcSnapshot(next,rows,targetConfig)})));
      setConfig(targetConfig);
      setResult(next);
      setResultSignature(signature(rows,targetConfig));
      if (selectedItemId && !next.placements.some(item=>item.id===selectedItemId)) setSelectedItemId(null);
      if (selectedPallet !== null && !next.pallets.some(item=>item.index===selectedPallet)) setSelectedPallet(next.pallets[0]?.index ?? 0);
      setHistoryNotice('Önceki yerleşim ve sabit konumlar geri yüklendi.');
      return true;
    } catch (error) {
      if (!controller.signal.aborted) setHistoryNotice(error.message);
      return false;
    } finally {
      if (!controller.signal.aborted) setRestoring(false);
      if (historyCheck.current === controller) historyCheck.current = null;
    }
  }

  useImperativeHandle(chatBridge, () => ({
    context: () => pmcContext({rows,config,result,stale,selectedItemId,selectedPallet,outcome:usesContour?null:ai.outcome}),
    key: () => JSON.stringify([currentSignature,resultSignature,result && layoutKey(result),aircraftContext]),
    async inspect(signal) {
      if (!result || stale || busy || result.errors?.length) throw new Error('Güncel verilerle önce palet yerleşimini hesaplayın.');
      if(usesContour){
        const model=result.researchModel;
        const areaM2=model.usable.widthMm*model.usable.lengthMm*result.pallets.length/1e6;
        const remainingM3=researchEnvelopeMm3(model)*result.pallets.length/1e9-result.summary.volumeM3;
        const validation={stats:{remainingM3,remainingDeckM2:areaM2*(1-result.optimizer.footprintUtilization)},
          distribution:result.pallets.map(pallet=>({index:pallet.index,knownWeightKg:pallet.items.reduce((sum,box)=>sum+(box.weight??0),0)})),
          limitations:['Contour 1 araştırma geometrisi. Uçuş, bağlama ve ağırlık merkezi onayı yok.']};
        return {validation,unplaced:result.unplaced,selectedPallet};
      }
      const inspected = await measuredEngine({rows,config:unmarkedConfig(config),baseline:result},signal);
      return {validation:inspected.validation,unplaced:result.unplaced,selectedPallet};
    },
    async optimize(scope, signal, onProgress) {
      if (viewOnly || busy || restoring || ai.progress) throw new Error('PMC yerleşimi şu anda hesaplanamıyor.');
      if (usesContour) throw new Error('Contour 1 için V2 motorunu paletleme panelinden çalıştırın. AI seçenekleri ZX-11 modunda kullanılabilir.');
      return searchChatPlans({rows,config,current:stale?null:result,singlePallet:scope==='optimize_pmc'?selectedPallet??-1:null,
        objective:ai.objective,aircraft:aircraftContext},signal,onProgress);
    },
    getOutcome: () => ai.outcome,
    apply: applyAiPlan,
    canRestore: !!lastPmc && !previousOutdated && !previousModeChanged && !busy && !restoring && !ai.progress && !viewOnly,
    restore: restorePmcPlan,
    import(incoming) {
      if (viewOnly || busy || restoring) throw new Error('Yük listesi şu anda düzenlenemiyor.');
      if (!importRows(incoming)) throw new Error('Yük listesi en fazla 100 satır olabilir.');
    },
  }));

  const actionBlocked = busy || restoring || viewOnly || !rows.length;
  const placeButton = (
    <button type="button" className="primary" disabled={actionBlocked} onClick={standardPlacement}>
      <MagicWand size={21} aria-hidden="true"/>
      {busy ? 'Yerleşim hesaplanıyor…' : 'Paletlere yerleştir'}
    </button>
  );

  return <section className="pmc-planner" aria-label="PMC üç boyutlu paletleme">
    <div className="pmc-intro">
      <div><span className="pmc-eyebrow">A330-243F / PMC · SİMÜLASYON</span><h2>Her parçayı görün. Alanı değerlendirin.</h2><p>Yük ölçülerini girin, paletlere dağıtımı büyük ve döndürülebilir 3D görünümde inceleyin.</p></div>
      <div className="pmc-base-stat"><span>NET YÜKLENEBİLİR TABAN</span><strong>226,84 <b>×</b> 300,5 <small>cm</small></strong><small>≈89,31 × 118,31 inç net taban</small><small>96 × 125 inç / 243,84 × 317,5 cm PMC</small><small>Her kenardan 8,5 cm / ≈3,35 inç çıkarıldı</small></div>
    </div>
    <div className="pmc-layout">
      <aside className="pmc-settings panel">
        <div className="panel-heading"><h2><Cube size={21}/> Palet profili</h2><span className="pmc-tag">PMC</span></div>
        <PmcProfile mirrored={config.mirrored} usesContour={usesContour} model={draftModel}/>
        <fieldset className="pmc-profile-fields pmc-view-fieldset" disabled={viewOnly}>
          <label>Yerleşim yöntemi
            <select aria-label="Yerleşim yöntemi" disabled={busy||restoring} value={usesContour?CONTOUR_OPTIMIZER:'legacy'}
              onChange={e=>chooseOptimizer(e.target.value)}>
              <option value="legacy">Standart · ZX-11</option>
              <option value={CONTOUR_OPTIMIZER} disabled={!!config.longCargo||!!config.allowOverhang}>V2 · Avianca Contour 1</option>
            </select>
          </label>
          <label>Kontur yönü · ekrana göre
            <select aria-label="Kontur yönü" value={config.mirrored ? 'mirrored' : 'standard'} onChange={e => updateConfig('mirrored', e.target.value === 'mirrored')}>
              <option value="standard">Alçak kenar solda</option>
              <option value="mirrored">Alçak kenar sağda (ayna)</option>
            </select>
          </label>
          <label>En fazla palet<input aria-label="En fazla palet" type="number" min="1" max="30" step="1" value={config.maxPallets} onChange={e => updateConfig('maxPallets', e.target.value)}/></label>
          {usesContour ? <p className="pmc-caution">V2 dik, tek kat ve taşmasız yerleşim arar. Uzun yük ve taşma ayarları standart yöntemde bulunur.</p> : <div className="pmc-overhang">
            <label className="pmc-checkbox">
              <input type="checkbox" checked={!!config.longCargo} onChange={e => setConfig(previous => ({...previous, longCargo:e.target.checked, allowOverhang:false}))}/>
              Tek PMC üzerinde uzun yük · TEST
            </label>
            {config.longCargo && <label>Yerleşim seçimi
              <select aria-label="Yerleşim seçimi" value={selectedAlignment} onChange={e => {
                const alignment = e.target.value;
                let next;
                if (alignment === 'high') {
                  if (!result || stale || busy || !result.config?.longCargo || !result.placements?.length) return;
                  const highEdgeAnchors = Object.fromEntries(result.placements.map(box => [
                    box.id, {y:box.localY, w:box.w, l:box.l, h:box.h, rotated:box.rotated}
                  ]));
                  next = {...config, highEdgeAnchors, manualXAnchors:null};
                } else {
                  next = {...config, longCargoAlignment:alignment, highEdgeAnchors:null, manualXAnchors:null};
                }
                setConfig(next);
                calculate(rows, next);
              }}>
                {isPreviousAlignment && <option value={selectedAlignment} disabled hidden>Önceki yerleşim</option>}
                <option value="manual" disabled>Elle yatay konum</option>
                <option value="auto">En az şematik pozisyon</option>
                <option value="center">Ortalı · iki yana taşma</option>
                <option value="left">Sol kısa kenar · Y=0</option>
                <option value="right">Sağ kısa kenar · Y=317,5</option>
                <option value="high" disabled={!result || stale || busy || !result.config?.longCargo || !result.placements?.length}>Yüksek kenara hizala</option>
              </select>
            </label>}
          </div>}
          {!usesContour && !config.longCargo && <details className="pmc-overhang"><summary>Komşu palete üst taşma</summary><label className="pmc-checkbox"><input type="checkbox" checked={config.allowOverhang} onChange={e => updateConfig('allowOverhang', e.target.checked)}/> Üst taşma senaryosunu aç</label>{config.allowOverhang && <><label>İzin verilen en fazla taşma (cm)<input type="number" min="0.1" max="300.5" step="0.1" value={config.maxOverhangCm ?? ''} placeholder="Onaylı değeri girin" onChange={e => updateConfig('maxOverhangCm', e.target.value)}/></label><label>Taşmanın başlayabileceği yükseklik (cm)<input type="number" min="0.1" step="0.1" value={config.minOverhangHeightCm ?? ''} placeholder="Onaylı değeri girin" onChange={e => updateConfig('minOverhangHeightCm', e.target.value)}/></label></>}</details>}
        </fieldset>
        {activityPanel}
      </aside>
      <div className="pmc-main">
        <section className="pmc-input-panel panel">
          <fieldset className="pmc-view-fieldset" disabled={viewOnly}>
          <div className="panel-heading"><div><h2>01 <span>Yük listesi</span></h2><p>Her yük grubuna ayrı renk · Tüm ölçüler cm · En fazla 200 parça</p></div><button className="outline amber" onClick={addRow} disabled={rows.length >= 100}><Plus size={17}/> Yük ekle</button></div>
          <div className="pmc-table-scroll"><table className="pmc-input-table"><thead><tr><th>Yük / renk</th><th>Uzunluk</th><th>Genişlik</th><th>Yükseklik</th><th>Adet</th><th>kg / parça</th><th title="Yalnızca tabanda 90° döndürür; yükseklik ve dik konum korunur.">90° çevir</th><th title="Satırdaki tüm parçaların izin verilen yönünü seçin.">Yön izni</th><th title="İşaretli yük başka bir parçayı üstünde taşıyabilir. Ezilme dayanımı hesaplanmaz.">Üstüne yük</th><th><span className="pmc-sr-only">Sil</span></th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id}><td><div className="pmc-name-input"><input aria-label={`Yük ${index + 1} rengi`} type="color" value={/^#[0-9a-f]{6}$/i.test(row.color) ? row.color : COLORS[index % COLORS.length]} onChange={e => updateRow(row.id, 'color', e.target.value)}/><input aria-label={`Yük ${index + 1} adı`} value={row.name} maxLength="60" onChange={e => updateRow(row.id, 'name', e.target.value)}/></div></td>{[['length','uzunluk'],['width','genişlik'],['height','yükseklik'],['quantity','adet'],['weight','ağırlık']].map(([key, label]) => <td key={key}><input aria-label={`Yük ${index + 1} ${label}`} type="number" min={key === 'quantity' ? 1 : 0.01} step={key === 'quantity' ? 1 : 'any'} placeholder={key === 'weight' ? 'İsteğe bağlı' : ''} value={row[key] ?? ''} onChange={e => updateRow(row.id, key, e.target.value)}/></td>)}<td><input type="checkbox" aria-label={`Yük ${index + 1} tabanda döndürülebilir`} checked={row.allowRotation} onChange={e => updateRow(row.id, 'allowRotation', e.target.checked)}/></td><td><select aria-label={`Yük ${index + 1} yön izni`} value={Object.keys(row.pieceOrientations ?? {}).length ? 'saved' : row.orientationMode || 'upright'} onChange={e=>updateRow(row.id, 'orientationMode', e.target.value)}>{Object.keys(row.pieceOrientations ?? {}).length>0&&<option value="saved" disabled>Özel yönler (kayıtlı)</option>}<OrientationOptions/></select></td><td><input type="checkbox" aria-label={`Yük ${index + 1} üstüne yük konabilir`} checked={row.stackable} onChange={e => updateRow(row.id, 'stackable', e.target.checked)}/></td><td><button className="pmc-icon-button" aria-label={`Yük ${index + 1} sil`} onClick={() => setRows(previous => previous.filter(item => item.id !== row.id))}><Trash size={17}/></button></td></tr>)}</tbody></table></div>
          {!rows.length && <p className="pmc-empty-input">Başlamak için bir yük ekleyin.</p>}
          <div className="pmc-input-footer"><span><b>{rows.length}</b> yük grubu · <b>{format(totalRequested, 0)}</b> parça<small>{saved ? 'Girdiler bu tarayıcıda kaydedilir.' : 'Tarayıcı kaydı kullanılamıyor.'}</small></span><div>{busy && <button onClick={stop}>İptal</button>}{placeButton}{!usesContour&&<AiPackingButton ai={ai} disabled={actionBlocked}/>}</div></div>
          </fieldset>
        </section>
        {!viewOnly && !usesContour && <div ref={aiPanel}><AiPackingPanel ai={ai} onApply={applyAiPlan}/></div>}
        {!viewOnly && config.longCargo && <PmcLongBalanceSettings profile={config.pmcBalance}
          onChange={(key,value)=>setConfig(previous=>({...previous,pmcBalance:{...previous.pmcBalance,[key]:value}}))}/>}
        {(error || result?.errors?.length > 0) && <div className="pmc-errors" role="alert"><Warning size={21}/><div>{error && <p>{error}</p>}{result?.errors?.map((item, i) => <p key={i}>{typeof item === 'string' ? item : item.message || JSON.stringify(item)}</p>)}</div></div>}
        <section className="pmc-output panel" aria-busy={busy}>
          <div className="panel-heading"><div><h2>02 <span>{planView} palet planı</span></h2><p>{isContour(configForResult)?'V2':'Standart'} · {displayedProfile}{Number.isFinite(resultElapsed)&&' · '+format(resultElapsed,1)+' ms'}</p></div><button className="text-btn" onClick={download} disabled={!result || stale || busy || !!result.errors?.length}><DownloadSimple size={17}/> JSON indir</button></div>
          {stale && <div className="pmc-stale" role="status"><Warning size={17}/> Girdiler değişti. Görünüm önceki hesaplamayı gösteriyor; yeniden yerleştirin.</div>}
          <div className="pmc-results-stats"><div><span>{configForResult.longCargo?'Fiziksel PMC':'Kullanılan palet'}</span><strong>{palletCount}<small> PMC</small></strong></div><div><span>Yerleşen parça</span><strong>{placements.length}<small> / {result?.summary?.requestedCount ?? totalRequested}</small></strong></div><div><span>Yerleşen hacim</span><strong>{format(volume, 2)}<small> m³</small></strong></div><div title={'Net taban üzerindeki '+displayedProfile+' araştırma zarfına oran.'}><span>Geometrik zarf doluluğu</span><strong>{configForResult.longCargo ? '—' : format(utilization, 1)}<small>%</small></strong></div><div><span>{configForResult.longCargo?'Kenar taşması':'Üst taşma'}</span><strong className={overhangs.length ? 'pmc-amber-text' : ''}>{overhangs.length}<small> inceleme</small></strong></div></div>
          {onImportAircraft && !configForResult.longCargo && <div className="pmc-aircraft-transfer"><button className="outline amber" disabled={!result || stale || busy || !!result.errors?.length || !placements.length} onClick={openTransfer}>Uçak paletlerine ekle</button><p>Renkli yükler uçak 3D görünümüne kopyalanır. Mevcut yükler korunur; sonraki PMC düzenlemeleri kopyayı değiştirmez.</p></div>}
          {!busy && !stale && result?.optimizer && <p className="pmc-optimizer-status">{contourOutcomes[result.optimizer.outcome]}</p>}
          <PmcGeometryPanel assessment={researchAssessment} settings={researchSettings} onSetting={changeResearchSetting} onItem={chooseItem}
            usesContour={usesContour} displayedProfile={displayedProfile} settingsReadOnly={viewOnly&&usesContour}/>
          <div className="pmc-pallet-select" aria-label="Görüntülenecek palet"><button className={selectedPallet === null ? 'active' : ''} disabled={!!configForResult.longCargo} onClick={() => { setSelectedPallet(null); setSelectedItemId(null); }}>Tüm paletler</button>{(result?.pallets || []).map(pallet => <button key={pallet.index} className={selectedPallet === pallet.index ? 'active' : ''} onClick={() => { setSelectedPallet(pallet.index); setSelectedItemId(null); }}><Cube size={17}/><span>PMC {String(pallet.index + 1).padStart(2, '0')}<small>{pallet.items.length} parça teması</small></span></button>)}</div>
          <div className="pmc-plan-tools">
            <ViewSwitch view={planView} onChange={setPlanView} label="PMC 2D / 3D görünümü"/>
            {!viewOnly && lastPmc && <div className="plan-history">
              <button className="outline amber" disabled={!!previousOutdated || !!previousModeChanged || busy || restoring || !!ai.progress}
                onClick={restorePmcPlan}>{restoring?'Doğrulanıyor…':'Önceki Plana Dön'}</button>
              {previousOutdated && <small>Önceki plan eski. Yük listesi değişti.</small>}
              {!previousOutdated && previousModeChanged && <small>Önceki plan farklı bir PMC modunda.</small>}
            </div>}
          </div>
          {historyNotice && <p className="placement-warning" role="status">{historyNotice}</p>}
          <div className="pmc-view-options"><label className="pmc-checkbox"><input type="checkbox" checked={showContour} onChange={e => setShowContour(e.target.checked)}/> Kontur</label><label className="pmc-checkbox"><input type="checkbox" checked={labels} onChange={e => setLabels(e.target.checked)}/> Etiketler</label><label className="pmc-checkbox"><input aria-label="Ölçüler" type="checkbox" checked={showDimensions} onChange={e => setShowDimensions(e.target.checked)}/> Ölçüler</label><label className="pmc-layer">Katman üst sınırı <input aria-label="Katman üst sınırı" type="range" min="0" max="244" step="1" value={heightCut} onChange={e => setHeightCut(Number(e.target.value))}/><b>{heightCut === 244 ? 'Tümü' : `${heightCut} cm`}</b></label></div>
          {result ? <PmcPlanView view={planView} result={{...result,config:configForResult}}
            pallet={selectedPallet} itemId={selectedItemId} onItem={chooseItem} onPallet={choosePallet}
            placementAction={viewOnly ? undefined : <>{placeButton}{!usesContour&&<AiPackingButton ai={ai} disabled={actionBlocked} showObjective={false}
              onStart={() => { void ai.start(); aiPanel.current?.scrollIntoView({block:'start'}); }}/>}</>} onMoveCargo={!viewOnly && result.config?.longCargo && !stale && !busy ? moveCargo : undefined}
            showContour={showContour} labels={labels} showDimensions={showDimensions} heightCut={heightCut === 244 ? Infinity : heightCut} researchViolationIds={researchAssessment.violationIds}/> : <div className="pmc-loading"><Cube size={48}/><p>{busy ? 'Paletler hazırlanıyor…' : 'Yüklerinizi girip yerleşimi hesaplayın.'}</p></div>}
          {result && <PmcPlacementDetails result={result} pallet={selectedPallet} itemId={selectedItemId} onItem={chooseItem}/>}
          <div className="pmc-color-legend">{[...new Map(placements.map(item => [item.rowId, item])).values()].map(item => <span key={item.rowId}><i style={{background:item.color}}/>{item.name}</span>)}</div>
          {result?.config?.longCargo && <LongCargoDetails pallets={result.pallets.filter(pallet => selectedPallet === null || pallet.index === selectedPallet)}/>}
          {result && <div className="pmc-geometry-note"><Info size={17}/><p>Sezgisel geometrik arama; en iyi çözüm garantisi yoktur. Hacim, paketlerin dış ölçülerinden hesaplanır. Doluluk, net taban üzerindeki {displayedProfile} zarfına oranlanır. Bu görünüm uçuşa uygunluk veya operasyon onayı değildir.</p></div>}
        </section>
        {result?.unplaced?.length > 0 && <section className="panel pmc-unplaced"><h3><Warning size={19}/> Yerleşemeyen parçalar</h3><ul>{result.unplaced.map((item, i) => <li key={`${item.id}-${i}`}><b>{item.name || item.id}</b>{item.quantity ? ` (${item.quantity} adet)` : ''}: {item.reason}</li>)}</ul></section>}
        {result && <details className="panel pmc-details"><summary>Yerleşim listesi ve kontrol notları ({visibleItems.length} parça)</summary><div className="pmc-table-scroll"><table><thead><tr><th>Parça</th><th>Palet</th><th>Ölçü (G × U × Y), cm</th><th>Konum (x, y, z), cm</th><th>Durum</th></tr></thead><tbody>{visibleItems.map(item => <tr key={item.id} className={selectedItemId === item.id ? 'pmc-selected-row' : ''}><td><button className="text-btn" onClick={() => setSelectedItemId(item.id)}><i className="pmc-small-dot" style={{background:item.color}}/>{item.name} · {item.id}</button></td><td>{item.touchedPallets?.map(index => `PMC ${index + 1}`).join(' + ') || `PMC ${item.palletIndex + 1}`}</td><td>{[item.w,item.l,item.h].map(n => format(n)).join(' × ')}</td><td>{[item.x,item.y-item.palletIndex*317.5,item.z].map(n => format(n)).join(', ')}</td><td>{item.status==='TECHNICAL_VALIDATION_PENDING' ? 'Teknik doğrulama bekliyor' : item.overhangCm > 0 ? `${format(item.overhangCm)} cm taşma · İncele` : displayedProfile+' konturu içinde'}{researchAssessment.violationIds.includes(item.id)&&<small className="pmc-research-fail"> · Contour 1 ihlali</small>}</td></tr>)}</tbody></table></div><p className="pmc-coordinates">x: fiziksel plakanın sol kenarından; y: ana paletin ön kenarından; z: plaka üstünden. Konumlar köşe koordinatlarıdır.</p><ul className="pmc-warning-list">{(result.warnings || []).map((item, i) => <li key={i}>{typeof item === 'string' ? item : item.message || JSON.stringify(item)}</li>)}</ul></details>}
        <div className="pmc-bottom"><span><CheckCircle size={16}/> Mevcut uçak yerleşim planınız ayrı olarak korunur.</span><button className="text-btn" disabled={viewOnly} onClick={() => setResetOpen(true)}><ArrowCounterClockwise size={16}/> Örnek yükleri getir</button></div>
      </div>
    </div>
    {transfer && <div className="overlay" onClick={()=>setTransfer(null)}><section className="dialog pmc-transfer-dialog" role="dialog" aria-modal="true" aria-label="PMC paletlerini uçağa ekle" onClick={e=>e.stopPropagation()}><button className="close" aria-label="Kapat" onClick={()=>setTransfer(null)}><X size={20}/></button><h2>PMC paletlerini uçağa ekle</h2><p>Her paletin palet dahil brüt ağırlığını girin. Mevcut yerleşimler ve kilitler korunur. Uygun boş örnek pozisyonlara yerleştirilir; sığmayanlar bekleyen listesine eklenir.</p><form onSubmit={submitTransfer}>{transfer.map(p=><label key={p.index}>PMC {p.index+1} · Brüt ağırlık (kg)<small>{p.unknownWeight?'Bazı parça ağırlıkları bilinmiyor. ':''}Bilinen yük: {format(p.knownWeight)} kg; palet darası dahil değil.</small><input name={'weight-'+p.index} aria-label={`PMC ${p.index+1} brüt ağırlık`} type="number" min={Math.max(.01,p.knownWeight)} step="any" required/></label>)}{transferError&&<p role="alert">{transferError}</p>}<p>Şematik simülasyon; uçak uygunluğu, bağlama ve gerçek ağırlık merkezi onayı değildir.</p><button className="primary" type="submit">Ekle ve uçakta göster</button><button type="button" className="text-btn" onClick={()=>setTransfer(null)}>Vazgeç</button></form></section></div>}
    {resetOpen && <div className="overlay" onClick={() => setResetOpen(false)}><section className="dialog pmc-reset-dialog" role="dialog" aria-modal="true" aria-label="Örnek yükleri getir" onClick={e => e.stopPropagation()}><button className="close" aria-label="Kapat" onClick={() => setResetOpen(false)}><X size={20}/></button><h2>Örnek yükleri yeniden getir?</h2><p>PMC yük listeniz ve kontur ayarlarınız örnek değerlere döner. Uçak yerleşim planınız değişmez.</p><button className="primary" onClick={() => { const nextRows = freshRows(); const nextConfig = { ...DEFAULT_CONFIG }; setRows(nextRows); setConfig(nextConfig); setResetOpen(false); calculate(nextRows, nextConfig); }}>Örnek yükleri getir</button><button className="text-btn" onClick={() => setResetOpen(false)}>Vazgeç</button></section></div>}
  </section>;
}
