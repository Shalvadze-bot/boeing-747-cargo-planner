export const PLAN_HISTORY_KEY = 'cargo-optimization-history-v1';
const MAX_HISTORY_BYTES = 820_000;
const newHistory = () => ({ version:1, aircraft:[], pmc:[], currentPmc:null });

export function normalizeHistory(value) {
  if (value?.version !== 1 || !Array.isArray(value.aircraft) || !Array.isArray(value.pmc)) return newHistory();
  return { version:1, aircraft:value.aircraft.slice(0,3), pmc:value.pmc.slice(0,3), currentPmc:value.currentPmc ?? null };
}

export function readHistory(storage = globalThis.localStorage) {
  try { return normalizeHistory(JSON.parse(storage?.getItem(PLAN_HISTORY_KEY))); }
  catch { return newHistory(); }
}

export function writeHistory(update, storage = globalThis.localStorage) {
  const next = normalizeHistory(update(readHistory(storage)));
  const byteSize = () => new TextEncoder().encode(JSON.stringify(next)).length;
  while (byteSize() > MAX_HISTORY_BYTES && next.pmc.length > 1) next.pmc.pop();
  while (byteSize() > MAX_HISTORY_BYTES && next.aircraft.length > 1) next.aircraft.pop();
  if (byteSize() > MAX_HISTORY_BYTES) throw new Error('Önceki plan bu kayda sığmadı. Açık plan korundu.');
  storage.setItem(PLAN_HISTORY_KEY, JSON.stringify(next));
  if (typeof window !== 'undefined') window.dispatchEvent(new window.Event('cargo:local-plan-change'));
  return next;
}

export const cargoKey = cargo => JSON.stringify(cargo);

export function makePmcSnapshot(result, rows, config) {
  const { aiApplied, ...selectedConfig } = config;
  // Persist exact physical placements, without per-piece unused candidates
  // or repeated references to the same geometry in the pallet list.
  const placements = result.placements.map(({candidates,...box})=>box);
  const pallets = result.pallets.map(({items,...pallet})=>({...pallet,items:items.map(item=>item.id)}));
  const { aiApplied: ignoredMarker, ...resultConfig } = result.config ?? {};
  return { at:new Date().toISOString(), cargoKey:cargoKey(rows), config:selectedConfig,
    result:{...result,placements,pallets,config:resultConfig} };
}

export function expandPmcSnapshot(snapshot) {
  if (!Array.isArray(snapshot?.result?.placements) || !Array.isArray(snapshot.result.pallets)) return null;
  if (snapshot.result.placements.some(item=>!item || typeof item.id!=='string') ||
      snapshot.result.pallets.some(pallet=>!Array.isArray(pallet?.items))) return null;
  const positions = new Map(snapshot.result.placements.map(item=>[item.id,item]));
  return { ...snapshot.result, pallets:snapshot.result.pallets.map(pallet=>({
    ...pallet,items:pallet.items.map(id=>positions.get(id)).filter(Boolean),
  })) };
}

export function pmcRestoreConfig(snapshot, current) {
  const { aiApplied, ...config } = current;
  return { ...config, manualXAnchors:snapshot.config?.manualXAnchors ?? null,
    highEdgeAnchors:snapshot.config?.highEdgeAnchors ?? null };
}

export function aircraftSnapshot(cargo, plan, locked, deck, selected) {
  return { at:new Date().toISOString(), cargoKey:cargoKey(cargo),
    plan:{...plan}, locked:[...locked],deck,selected };
}
