import { PMC, contourHeight, orientations, supportCoverage } from './pmc-engine.mjs';
import { balanceProfile, measurePmcBalance } from './pmc-long-balance.mjs';

const EPS = 1e-5;
const equal = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= EPS;
const within = (v, low, high) => v >= low - EPS && v <= high + EPS;
const overlaps = (a, b) => [['x','w'], ['y','l'], ['z','h']].every(([axis, size]) =>
  a[axis] + a[size] > b[axis] + EPS && b[axis] + b[size] > a[axis] + EPS);
const axisBounds = (size, length) => [Math.min(PMC.margin, length - PMC.margin - size),
  Math.max(PMC.margin, length - PMC.margin - size)];
const sum = (values, read) => values.reduce((total, item) => total + read(item), 0);

function validOrigin(box, config) {
  const [x0, x1] = axisBounds(box.w, PMC.width);
  const [y0, y1] = axisBounds(box.l, PMC.length);
  if (!config.longCargo && (box.w > PMC.usableWidth + EPS || box.l > PMC.usableLength + EPS)) return false;
  if (box.z < -EPS || box.z + box.h > PMC.maxHeight + EPS) return false;
  const top = box.z + box.h;
  if (top > PMC.lowHeight || !config.longCargo) {
    const lowX = Math.max(0, Math.min(PMC.width, box.x));
    const highX = Math.max(0, Math.min(PMC.width, box.x + box.w));
    if (top > Math.min(contourHeight(lowX, config.mirrored), contourHeight(highX, config.mirrored)) + EPS) return false;
  }
  return within(box.x, x0, x1) && within(box.y, y0, y1);
}

function anchorMatches(box, config) {
  if (!config.longCargo) return true;
  const manual = config.manualXAnchors?.[box.id];
  const high = config.highEdgeAnchors?.[box.id];
  const anchor = manual || high;
  if (anchor) {
    if (![box.w, box.l, box.h, box.y].every((value, index) =>
      equal(value, [anchor.w, anchor.l, anchor.h, anchor.y][index]))) return false;
    if (manual) return equal(box.x, manual.x);
    const [minimum, maximum] = axisBounds(box.w, PMC.width);
    return equal(box.x, config.mirrored ? maximum : minimum);
  }
  const alignment = config.longCargoAlignment;
  if (alignment === 'front') return equal(box.x, PMC.margin);
  if (alignment === 'rear') return equal(box.x, PMC.width - PMC.margin - box.w);
  if (alignment === 'left') return equal(box.y, PMC.margin);
  if (alignment === 'right') return equal(box.y, PMC.length - PMC.margin - box.l);
  if (alignment === 'center' && box.l > PMC.usableLength) return equal(box.y, (PMC.length - box.l) / 2);
  return true;
}

export function modelCapacity(boxes, mirrored = false) {
  const left = PMC.margin, right = PMC.width - PMC.margin;
  const shoulder = mirrored ? PMC.width - PMC.shoulderX : PMC.shoulderX;
  const edges = [left,...(shoulder > left && shoulder < right ? [shoulder] : []),right];
  let gross = 0;
  for (let i = 1; i < edges.length; i++) {
    const a = edges[i-1], b = edges[i];
    gross += (b-a) * (contourHeight(a,mirrored) + contourHeight(b,mirrored)) / 2;
  }
  const clip = (start, size, max) => Math.max(0,Math.min(start+size,max-PMC.margin)-Math.max(start,PMC.margin));
  const boxVolume = box => clip(box.x,box.w,PMC.width)*clip(box.y,box.l,PMC.length)*box.h;
  const deck = PMC.usableLength * PMC.usableWidth;
  const floor = sum(boxes.filter(box => box.z <= EPS), box =>
    clip(box.x,box.w,PMC.width)*clip(box.y,box.l,PMC.length));
  return { remainingM3:Math.max(0,(gross*PMC.usableLength - sum(boxes,boxVolume))/1e6),
    remainingDeckM2:Math.max(0,(deck-floor)/1e4) };
}

function checkWeight(boxes, profile, errors, index, mirrored) {
  const complete = boxes.every(box => Number.isFinite(box.weight));
  const cargoWeight = sum(boxes, box => box.weight ?? 0);
  const { input } = profile;
  const estimated = measurePmcBalance(boxes, profile);
  const partialLimit = [
    [input.minX, estimated.cg?.x, -1], [input.maxX, estimated.cg?.x, 1],
    [input.minY, estimated.cg?.y, -1], [input.maxY, estimated.cg?.y, 1],
    [input.maxZ, estimated.cg?.z, 1],
  ].some(([limit, actual, sign]) => limit !== null && Number.isFinite(actual) && sign * (actual - limit) > EPS);
  // Known lower bound can already exceed a gross limit, even with missing weights.
  const grossLowerBound = cargoWeight + (input.tare > 0 ? input.tare : 0);
  if (partialLimit || estimated.status === 'outside' ||
      (input.maxGross !== null && grossLowerBound > input.maxGross + EPS)) {
    errors.push(`PMC ${index + 1}: girilen ağırlık veya dağılım sınırı aşıldı.`);
  }
  const hasCgLimit = [input.minX,input.maxX,input.minY,input.maxY,input.maxZ].some(v => v !== null);
  const fullyChecked = complete && (!hasCgLimit || !!estimated.cg) &&
    (input.maxGross === null || input.tare > 0);
  const metrics = modelCapacity(boxes,mirrored);
  return { index, knownWeightKg: cargoWeight, complete, ...estimated, fullyChecked, ...metrics,
    remainingKg: input.maxGross !== null && estimated.gross !== null ? Math.max(0,input.maxGross-estimated.gross) : null };
}

function checkStack(boxes, errors) {
  const contacts = new Map();
  for (const box of boxes) {
    if (box.z <= EPS) continue;
    const support = supportCoverage({ ...box, z: Math.round(box.z * 1e6) / 1e6 }, boxes);
    if (!support.fullySupported) {
      errors.push(`${box.id}: tam geometrik taban desteği yok.`);
      continue;
    }
    contacts.set(box.id, support.supportIds);
  }
  const loads = new Map();
  const accumulate = (id, lot, visited) => {
    for (const supportedBy of contacts.get(id) ?? []) {
      if (visited.has(supportedBy)) continue;
      visited.add(supportedBy);
      const old = loads.get(supportedBy) ?? { known: 0, unknown: false };
      loads.set(supportedBy, { known: old.known + (lot.weight ?? 0), unknown: old.unknown || lot.weight == null });
      accumulate(supportedBy, lot, visited);
    }
  };
  for (const box of boxes) accumulate(box.id, box, new Set([box.id]));
  for (const box of boxes) {
    const load = loads.get(box.id);
    if (!load || !Number.isFinite(box.row.maxStackLoadKg)) continue;
    // Conservatively charge the entire supported weight to each possible load path.
    if (load.unknown || load.known > box.row.maxStackLoadKg + EPS) {
      errors.push(`${box.id}: verilen istif kapasitesi doğrulanamadı.`);
    }
  }
}

export function validatePmcCandidate(rows, config, result) {
  const errors = [];
  const limitations = [
    'Uçak konturu, pozisyonları ve kilitleri bu PMC aramasında değiştirilmez. Uçak içi alternatif tahsis hesaplanmaz.',
    'Şematik PMC geometrisi uçuş onayı değildir. Bağlama, zemin yükü, dayanım ve kapı geçişi doğrulanmadı.',
  ];
  const empty = { valid: false, errors, limitations, distribution: [], stats: null };
  if (!result || !Array.isArray(result.placements) || !Array.isArray(result.unplaced) ||
      !Array.isArray(result.pallets) || result.errors?.length ||
      !Number.isInteger(config.maxPallets) || config.maxPallets < 1 || config.maxPallets > 30) {
    errors.push('Sonuç veya giriş ayarları geçersiz.');
    return empty;
  }
  const pieces = new Map();
  for (const row of rows) {
    if (typeof row.id !== 'string' || !Number.isInteger(row.quantity) || row.quantity < 1 ||
        !['width','length','height'].every(key => Number.isFinite(row[key]) && row[key] > 0) ||
        (row.weight !== null && row.weight !== undefined && !(Number.isFinite(row.weight) && row.weight > 0)) ||
        (row.maxStackLoadKg != null && !(Number.isFinite(row.maxStackLoadKg) && row.maxStackLoadKg >= 0)) ||
        pieces.size + row.quantity > 200) {
      errors.push('Yük ölçüleri, miktarı veya ağırlığı geçersiz.');
      return empty;
    }
    for (let piece = 1; piece <= row.quantity; piece++) {
      const id = row.id + ':' + piece;
      if (pieces.has(id)) { errors.push('Yük kimliği tekrarlanıyor.'); return empty; }
      pieces.set(id, { ...row, allowRotation:row.allowRotation ?? true, orientationMode: row.pieceOrientations?.[piece] ?? row.orientationMode });
    }
  }
  const seen = new Set();
  const groups = new Map();
  let reservedPositions = 0;
  const placedIds = new Set();
  for (const original of result.placements) {
    const { id, palletIndex: index } = original;
    const row = pieces.get(id);
    if (!row || seen.has(id) || !Number.isInteger(index) || index < 0 || index >= config.maxPallets ||
        !['x','y','z','w','l','h'].every(key => Number.isFinite(original[key]))) {
      errors.push('Sonuçta parça kimliği, konum veya PMC numarası geçersiz.');
      continue;
    }
    placedIds.add(id);
    seen.add(id);
    if (original.rowId !== row.id || (original.weight ?? null) !== (row.weight ?? null) ||
        !orientations(row).some(([w,l,h,face]) =>
          equal(w,original.w) && equal(l,original.l) && equal(h,original.h) && face === original.orientationFace)) {
      errors.push(id + ': ölçü, ağırlık veya izinli yön uyuşmuyor.');
    }
    const localY = original.y - index * PMC.length;
    if ((config.longCargo && original.localY !== undefined && !equal(original.localY, localY)) ||
        original.touchedPallets?.length !== 1 || original.touchedPallets[0] !== index) {
      errors.push(id + ': komşu palete kısmi destekli taşma doğrulama kapsamı dışında.');
    }
    const box = { ...original, y: localY, weight: row.weight ?? null, stackable: row.stackable ?? true, row, item: { row } };
    if (!validOrigin(box, config)) errors.push(id + ': taban veya şematik PMC konturu aşıldı.');
    if (!anchorMatches(box, config)) errors.push(id + ': elle sabitlenen konum veya hizalama korunmadı.');
    if (!groups.has(index)) groups.set(index, []);
    groups.get(index).push(box);
  }
  for (const { id } of result.unplaced) {
    if (!pieces.has(id) || seen.has(id)) errors.push('Yerleşmeyen listesinde geçersiz veya yinelenen parça var.');
    seen.add(id);
  }
  if (seen.size !== pieces.size) errors.push('Her parça yerleşen veya yerleşmeyen listesinde bir kez bulunmalı.');
  for (const id of Object.keys({ ...config.highEdgeAnchors, ...config.manualXAnchors })) {
    if (config.longCargo && !placedIds.has(id)) errors.push(id + ': sabitlenen parça korunmadı.');
  }

  const palletIndices = new Set();
  for (const pallet of result.pallets) {
    const expected = groups.get(pallet.index) ?? [];
    const listed = pallet.items?.map(item => item.id) ?? [];
    if (palletIndices.has(pallet.index) || !expected.length || listed.length !== expected.length ||
        new Set(listed).size !== listed.length || expected.some(box => !listed.includes(box.id))) {
      errors.push('PMC yerleşim listesi ve parça listesi uyuşmuyor.');
    }
    palletIndices.add(pallet.index);
    if (config.longCargo) reservedPositions += Number(pallet.positionCount) || 0;
  }
  if (palletIndices.size !== groups.size) errors.push('Sonuçta bir PMC eksik.');
  const profile = balanceProfile(config.pmcBalance);
  const distribution = [];
  for (const [index, boxes] of groups) {
    for (let i = 0; i < boxes.length; i++) {
      if (boxes.slice(i + 1).some(box => overlaps(boxes[i], box))) errors.push(boxes[i].id + ': çakışma var.');
    }
    checkStack(boxes, errors);
    distribution.push(checkWeight(boxes, profile, errors, index, config.mirrored));
  }
  const all = [...groups.values()].flat();
  const stackCapacityIncomplete = all.some(box => box.z > EPS) && all.some(box => box.stackable && box.row.maxStackLoadKg == null);
  if (stackCapacityIncomplete) limitations.push('Bazı destekler için sayısal istif kapasitesi girilmedi. Yalnızca destek geometrisi ve mevcut kapasiteler kontrol edildi.');
  if (!profile.hasLimits || !profile.hasTare || distribution.some(item => !item.fullyChecked)) {
    limitations.push('Bazı ağırlık, dara veya dağılım limitleri eksik. Sadece verilen veriler ve hesaplanabilen sınırlar kontrol edildi.');
  }
  if (config.longCargo) limitations.push('Bloke yer sayısı şematik rezervasyondur ve uçak pozisyonu ataması değildir.');
  return {
    valid: errors.length === 0, errors, limitations, distribution,
    stats: { placed: all.length, unplaced: pieces.size - all.length, pmcs: groups.size,
      kg: sum(all, box => box.weight ?? 0), unknownWeight: all.filter(box => box.weight === null).length,
      volume: sum(all, box => box.w * box.l * box.h / 1e6),
      schematicPositions: config.longCargo ? reservedPositions : null,
      remainingM3:sum(distribution,item=>item.remainingM3),
      remainingDeckM2:sum(distribution,item=>item.remainingDeckM2),
      balanceDistance: distribution.length && distribution.every(p => Number.isFinite(p.distance))
        ? sum(distribution, item => item.distance) : null },
  };
}

export function improvesPlan(candidate, current) {
  if (!candidate?.valid) return false;
  if (!current?.stats) return true;
  const a = candidate.stats, b = current.stats;
  if (a.placed !== b.placed) return a.placed > b.placed;
  if (a.pmcs !== b.pmcs) return a.pmcs < b.pmcs;
  return a.balanceDistance != null && b.balanceDistance != null && a.balanceDistance < b.balanceDistance - EPS;
}
