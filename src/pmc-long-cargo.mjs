import { PMC, orientations, ORIENTATION_MODES, supportCoverage } from './pmc-engine.mjs';

const EPS = 1e-6;
const ALIGNMENTS = ['center', 'front', 'rear', 'left', 'right'];
export const TECHNICAL_CHECKS = ['Kapı açıklığı ve kapıdan geçiş','Uçak içinde dönüş ve yerleştirme yolu','Gerçek pozisyon aralıkları ve konturları','Yükün desteği ve sehim/dayanım','Ağırlık merkezi ve devrilme','PMC, pozisyon ve zemin yük limitleri','Bağlama ve operatör onayı'];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const overlap = (start, size, otherStart, otherSize) =>
  start < otherStart + otherSize - EPS && otherStart < start + size - EPS;

function profileLimit(height) {
  if (height <= PMC.lowHeight) return PMC.width;
  return PMC.shoulderX + (PMC.maxHeight - height) * (PMC.width - PMC.shoulderX) / (PMC.maxHeight - PMC.lowHeight);
}

/** Bounds for dragging within the base and contour on a single PMC. */
export function lateralBounds(box, mirrored = false, neighbors = []) {
  const { w, h, z = 0 } = box ?? {};
  const bad = reason => ({ valid:false, min:null, max:null, reason });
  if (![w,h,z].every(Number.isFinite) || w <= 0 || h <= 0 || z < 0)
    return bad('Geçerli genişlik, yükseklik ve taban yüksekliği gerekli.');
  if (z + h > PMC.maxHeight + EPS)
    return bad('Yükün üstü şematik kontur yüksekliğini aşıyor.');
  const limit = profileLimit(z + h);
  let min = Math.max(PMC.margin, mirrored ? PMC.width - limit : 0);
  let max = Math.min(PMC.width - PMC.margin - w, mirrored ? PMC.width - w : limit - w);
  if (max < min - EPS)
    return bad('8,5 cm taban payı ve yük yüksekliğinde kontur içinde yan hareket alanı yok.');

  for (const other of neighbors) {
    if (!overlap(box.y, box.l, other.y, other.l)) continue;
    if (other.x + other.w <= box.x + EPS) min = Math.max(min, other.x + other.w);
    else if (box.x + w <= other.x + EPS) max = Math.min(max, other.x - w);
    else return bad('Bu yük, aynı PMC’deki başka bir parçayla çakışıyor.');
  }
  if (max < min - EPS) return bad('Aynı PMC’deki parçalar arasında hareket alanı yok.');
  return { valid:true, min, max:Math.max(min,max), reason:null };
}

// A smaller dimension stays inside the net deck. An oversized one can extend
// beyond the deck, while continuing to span the net deck in that direction.
function axisRange(size, deckSize) {
  const far = deckSize - PMC.margin - size;
  return { min:Math.min(PMC.margin, far), max:Math.max(PMC.margin, far) };
}

function placementBounds({w,l,h}, mirrored, z = 0) {
  const top = z + h;
  if (top > PMC.maxHeight + EPS) return null;
  const x = axisRange(w, PMC.width);
  const y = axisRange(l, PMC.length);
  if (top > PMC.lowHeight) {
    // Check the contour over the physical plate. Adjacent cells are only
    // reservations, so there is no aircraft profile to apply outside it.
    const limit = profileLimit(top);
    if (mirrored) x.min = Math.max(x.min, PMC.width - limit);
    else x.max = Math.min(x.max, limit - w);
  }
  if (x.max < x.min - EPS) return null;
  x.max = Math.max(x.min, x.max);
  return {x,y};
}

function gridBounds({x,y,w,l}) {
  return {
    x0:Math.floor((x + EPS) / PMC.width), x1:Math.ceil((x + w - EPS) / PMC.width) - 1,
    y0:Math.floor((y + EPS) / PMC.length), y1:Math.ceil((y + l - EPS) / PMC.length) - 1,
  };
}

function positionsFor(box) {
  const {x0,x1,y0,y1}=gridBounds(box);
  const positions = [];
  for (let y=y0; y<=y1; y++) for (let x=x0; x<=x1; x++)
    positions.push({x,y,id:`S(${x},${y})`,support:x===0 && y===0});
  return positions;
}

function placementGeometry(box) {
  const {x,y,w,l}=box;
  const positions=positionsFor(box);
  return {
    ...box, z:box.z ?? 0, positions, physicalPmcCount:1, positionCount:positions.length,
    blockedPositions:positions.filter(p=>!p.support),
    overhang:{left:Math.max(0,-x),right:Math.max(0,x+w-PMC.width),front:Math.max(0,-y),rear:Math.max(0,y+l-PMC.length)},
    usableBoundaryExcess:{left:Math.max(0,PMC.margin-x),right:Math.max(0,x+w-(PMC.width-PMC.margin)),front:Math.max(0,PMC.margin-y),rear:Math.max(0,y+l-(PMC.length-PMC.margin))},
    status:'TECHNICAL_VALIDATION_PENDING', flightApproved:false,
  };
}

function baseCandidates(row) {
  return orientations(row).flatMap(([w,l,h,orientationFace]) => ALIGNMENTS.map(alignment => ({
    w,l,h,orientationFace,alignment,rotated:w!==row.width,
    x:alignment==='front' ? PMC.margin : alignment==='rear' ? PMC.width-PMC.margin-w : (PMC.width-w)/2,
    y:alignment==='left' ? PMC.margin : alignment==='right' ? PMC.length-PMC.margin-l : (PMC.length-l)/2,
  })));
}

/** Individual candidate outlines on a schematic grid. */
export function longCargoCandidates(row) {
  return baseCandidates(row).map(placementGeometry);
}

function within(value, range) {
  return value >= range.min - EPS && value <= range.max + EPS;
}

function prepareItem(row, number, config, warnings) {
  const id = `${row.id}:${number}`;
  const mirrored = !!config.mirrored;
  const requested = config.longCargoAlignment ?? 'auto';
  const candidates = baseCandidates({...row, orientationMode:row.pieceOrientations?.[number] ?? row.orientationMode ?? 'upright'});
  const match = anchor => candidates.find(candidate =>
    candidate.w===anchor.w && candidate.l===anchor.l && candidate.h===anchor.h && candidate.rotated===anchor.rotated);
  const validY = anchor => Number.isFinite(anchor.y) && within(anchor.y, axisRange(anchor.l, PMC.length));
  const manual = config.manualXAnchors?.[id];
  const high = config.highEdgeAnchors?.[id];
  let choices;

  if (manual) {
    const shape = validY(manual) && Number.isFinite(manual.x) && match(manual);
    const bounds = shape && lateralBounds(manual, mirrored);
    if (bounds?.valid) {
      const x = clamp(manual.x, bounds.min, bounds.max);
      choices = [{ ...shape, x, y:manual.y, alignment:'manual', fixedX:true, fixedY:true }];
      if (Math.abs(x-manual.x)>EPS) warnings.push(id+': yan konum şematik kontur ve 8,5 cm taban sınırına kısıtlandı.');
    } else {
      warnings.push(id+': elle yan konum uygulanmadı; '+(bounds?.reason || 'ölçüler/yön değişti veya konum geçersiz; yeniden yerleştirin.'));
    }
  }
  if (!choices && high) {
    const shape = validY(high) && match(high);
    const bounds = shape && placementBounds(shape, mirrored);
    if (bounds) {
      choices = [{ ...shape, x:mirrored ? bounds.x.max : bounds.x.min, y:high.y, alignment:'high', fixedY:true }];
    } else {
      warnings.push(id+': ölçüler/yön değişti veya kontura sığmadı; yüksek kenar hizalaması yeniden uygulanmalı.');
    }
  }

  if (!choices) {
    choices = candidates.filter(candidate => requested==='auto' || candidate.alignment===requested).map(candidate => ({
      ...candidate,
      // An oversized width must keep equal transverse overhangs in centered mode.
      fixedX:candidate.alignment==='front' || candidate.alignment==='rear' ||
        (requested==='center' && candidate.w>PMC.usableWidth),
      fixedY:candidate.alignment==='left' || candidate.alignment==='right' || requested==='center' || candidate.l>PMC.usableLength,
    }));
  }
  choices = choices.flatMap(choice => {
    const bounds = placementBounds(choice, mirrored);
    if (!bounds || (choice.fixedX && !within(choice.x,bounds.x)) || (choice.fixedY && !within(choice.y,bounds.y))) return [];
    return [{choice, bounds}];
  });
  const minArea = Math.min(...choices.map(({choice}) => Math.min(choice.w,PMC.usableWidth)*Math.min(choice.l,PMC.usableLength)));
  return {id,row,candidates,choices,minArea,requested};
}

function originOptions(range, preferred, fixed, blockers, supports, axis, sizeKey, size) {
  if (fixed) return [preferred];
  const options = new Set([clamp(preferred,range.min,range.max), range.min,range.max]);
  const add = coordinate => {
    if (within(coordinate,range)) options.add(clamp(coordinate,range.min,range.max));
  };
  for (const box of blockers) {
    add(box[axis]+box[sizeKey]);
    add(box[axis]-size);
  }
  for (const surface of supports) {
    add(surface[axis]);
    add(surface[axis]+surface[sizeKey]-size);
  }
  return [...options].sort((a,b) => Math.abs(a-preferred)-Math.abs(b-preferred));
}

function findOrigin(choice, bounds, blockers, supports, {bias,compact,z}) {
  const preferredX = choice.fixedX ? choice.x : bias==='high-x' ? bounds.x.max : bias==='low-x' ? bounds.x.min : choice.x;
  const preferredY = !choice.fixedY && compact && blockers.length ? bounds.y.min : choice.y;
  const xs = originOptions(bounds.x,preferredX,choice.fixedX,blockers,supports,'x','w',choice.w);
  const ys = originOptions(bounds.y,preferredY,choice.fixedY,blockers,supports,'y','l',choice.l);
  for (const y of ys) {
    const row = blockers.filter(box => overlap(y,choice.l,box.y,box.l));
    for (const x of xs) {
      if (row.some(box => overlap(x,choice.w,box.x,box.w))) continue;
      const {fixedX,fixedY,...dimensions}=choice;
      const box = {...dimensions,x,y,z};
      const support = z > EPS ? supportCoverage(box,supports) : null;
      if (support && !support.fullySupported) continue;
      const shifted = Math.abs(x-choice.x)>EPS || Math.abs(y-choice.y)>EPS;
      return {...box,
        alignment:shifted && choice.alignment==='center' ? 'group' : choice.alignment,
        supportIds:support?.supportIds ?? [],
      };
    }
  }
  return null;
}

function compareScore(a,b) {
  for (let i=0; i<a.length; i++) if (a[i]!==b[i]) return a[i]-b[i];
  return 0;
}

function fitItem(item, pallet, {bias,compact=false,z=0,mirrored=false} = {}) {
  let best = null;
  let bestScore;
  const supports = z > EPS ? pallet.boxes.filter(box => box.stackable && Math.abs(box.z+box.h-z)<=EPS) : [];
  for (const {choice,bounds:floorBounds} of item.choices) {
    if (z > EPS && choice.alignment==='manual') continue;
    const bounds = z > EPS ? placementBounds(choice,mirrored,z) : floorBounds;
    if (!bounds || (choice.fixedX && !within(choice.x,bounds.x))) continue;
    const blockers = pallet.boxes.filter(box => overlap(z,choice.h,box.z,box.h));
    // The whole-plan trials vary the transverse start while keeping the
    // selected end alignment and the established oversized-width offsets.
    const canPreferEdge = !choice.fixedX && choice.w<=PMC.usableWidth && choice.alignment!=='high';
    const xBias = compact || canPreferEdge ? bias : undefined;
    const box = findOrigin(choice,bounds,blockers,supports,{bias:xBias,compact,z});
    if (!box) continue;
    const positions = positionsFor(box);
    const added = positions.reduce((n,position) => n + Number(!pallet.reserved.has(position.id)),0);
    const score = [
      added,positions.length,Number(choice.rotated),
      xBias==='high-x' ? -box.x : xBias==='low-x' ? box.x : 0,
      ALIGNMENTS.indexOf(choice.alignment),
    ];
    if (!best || compareScore(score,bestScore)<0) {
      best={item,...box,id:item.id,stackable:item.row.stackable === true};
      bestScore=score;
    }
  }
  return best;
}

function addToPallet(pallet, box) {
  pallet.boxes.push(box);
  if (box.z <= EPS) pallet.minArea += box.item.minArea;
  for (const position of positionsFor(box)) pallet.reserved.set(position.id,position);
}

const emptyPallet = () => ({boxes:[], minArea:0, reserved:new Map()});
const bySize = (a,b) =>
  Number(b.choices[0]?.choice.fixedX && b.choices[0]?.choice.fixedY) - Number(a.choices[0]?.choice.fixedX && a.choices[0]?.choice.fixedY) ||
  b.row.height - a.row.height || b.minArea - a.minArea;

function rearrangePallet(pallet, item, mirrored) {
  if (pallet.boxes.some(box => box.z>EPS)) return null;
  const items = [...pallet.boxes.map(box => box.item), item].sort(bySize);
  const biases = mirrored ? ['high-x','low-x'] : ['low-x','high-x'];
  for (const bias of biases) {
    const rearranged = emptyPallet();
    for (const queued of items) {
      const box = fitItem(queued, rearranged, {bias,compact:true});
      if (!box) break;
      addToPallet(rearranged, box);
    }
    if (rearranged.boxes.length===items.length) return rearranged;
  }
  return null;
}

function fitAboveFloor(item, pallet, mirrored, bias) {
  const levels = [...new Set(pallet.boxes.filter(box => box.stackable).map(box => box.z+box.h))].sort((a,b)=>a-b);
  for (const z of levels) {
    const box = fitItem(item,pallet,{z,mirrored,bias});
    if (box) return box;
  }
  return null;
}

function groupItems(items, maxPallets, mirrored, bias) {
  const pallets = [];
  const unplaced = [];
  const deckArea = PMC.usableWidth*PMC.usableLength;
  for (const item of items) {
    if (!item.choices.length) {
      unplaced.push({id:item.id,name:item.row.name,reason:'İzin verilen yön ve hizalamada parça PMC konturuna veya taban sınırına sığmadı.'});
      continue;
    }
    const possible = pallets.filter(pallet => pallet.minArea+item.minArea<=deckArea+EPS);
    const shared = possible.find(pallet => {
      const box = fitItem(item,pallet,{bias});
      if (!box) return false;
      addToPallet(pallet,box);
      return true;
    });
    if (shared) continue;

    let rearranged = false;
    for (const pallet of possible) {
      const combined = rearrangePallet(pallet,item,mirrored);
      if (!combined) continue;
      pallets[pallets.indexOf(pallet)]=combined;
      rearranged = true;
      break;
    }
    if (rearranged) continue;

    const stacked = pallets.find(pallet => {
      const box = fitAboveFloor(item,pallet,mirrored,bias);
      if (!box) return false;
      addToPallet(pallet,box);
      return true;
    });
    if (stacked) continue;

    if (pallets.length<maxPallets) {
      const pallet = emptyPallet();
      const box = fitItem(item,pallet,{bias});
      if (box) {
        addToPallet(pallet,box);
        pallets.push(pallet);
        continue;
      }
    }
    unplaced.push({id:item.id,name:item.row.name,reason:'Mevcut PMC’lerde uygun taban alanı veya tam destekli bir üst yüzey bulunamadı; fiziksel PMC sınırına ulaşıldı.'});
  }
  return {pallets,unplaced};
}

function chooseLayout(items, maxPallets, mirrored) {
  const anchored = items.some(item => item.choices.some(({choice}) =>
    choice.alignment==='manual' || choice.alignment==='high'));
  if (anchored) return groupItems(items,maxPallets,mirrored);

  // Keep an unbiased trial as an alternative. Compare complete layouts, so a
  // locally attractive position cannot win at the expense of a later piece.
  const preferences = mirrored ? ['high-x','low-x',undefined] : ['low-x','high-x',undefined];
  let best;
  let bestScore;
  for (const bias of preferences) {
    const layout = groupItems(items,maxPallets,mirrored,bias);
    const reserved = layout.pallets.reduce((total,pallet) => total+pallet.reserved.size-1,0);
    const score = [layout.unplaced.length,layout.pallets.length,reserved];
    if (!best || compareScore(score,bestScore)<0) {
      best = layout;
      bestScore = score;
    }
  }
  return best;
}

function describePlacement(box, requested) {
  if (box.alignment==='manual') return 'Elle yan konum; boyuna konum ve dönüş korundu.';
  if (box.alignment==='high') return 'Yüksek kontur tarafına doğru yerleştirildi; boyuna konum ve dönüş korundu.';
  if (requested==='auto') return 'Otomatik hesap farklı enine düzenleri karşılaştırdı.';
  return 'Seçilen hizalamaya göre şematik yerleşim yapıldı.';
}

export function runLongCargo(rows,config={}) {
  const result={config:{...config,longCargo:true},positionModel:'INDEPENDENT_SCENARIOS_EQUAL_PITCH_NOT_AIRCRAFT_ALLOCATION',errors:[],warnings:['YALNIZCA TEST / GEOMETRİK ÖNİZLEME — uçuş veya yükleme onayı değildir.',...TECHNICAL_CHECKS.map(s=>s+': teknik bilgi / doğrulama bekliyor.')],placements:[],pallets:[],unplaced:[],summary:{requestedCount:0,placedCount:0,palletCount:0,physicalPmcCount:0,positionCount:0,knownWeightKg:0,unknownWeightCount:0}};
  if(!Array.isArray(rows)||rows.length>100){result.errors.push('En fazla 100 yük satırı.');return result;}
  const count=rows.reduce((s,r)=>s+r.quantity,0);
  if(!Number.isInteger(count)||count>200||rows.some(r=>!Number.isInteger(r.quantity)||r.quantity<1||['width','length','height'].some(k=>!Number.isFinite(r[k])||r[k]<=0||r[k]>10000)||(r.weight!=null&&(!Number.isFinite(r.weight)||r.weight<=0)))){result.errors.push('Geçerli pozitif ölçüler (en fazla 10.000 cm), adet (toplam en fazla 200) ve varsa ağırlık girin.');return result;}
  if(rows.some(r=>(r.orientationMode!=null&&!ORIENTATION_MODES.includes(r.orientationMode)) || (r.pieceOrientations!=null&&(typeof r.pieceOrientations!=='object'||Array.isArray(r.pieceOrientations)||Object.values(r.pieceOrientations).some(v=>!ORIENTATION_MODES.includes(v)))))){result.errors.push('Yön izni geçersiz.');return result;}
  if(new Set(rows.map(r=>r.id)).size!==rows.length){result.errors.push('Yük kimlikleri benzersiz olmalı.');return result;}
  const max=Number(config.maxPallets??6);
  if(!Number.isInteger(max)||max<1||max>30){result.errors.push('Fiziksel PMC sınırı 1–30 olmalı.');return result;}
  if(!['auto',...ALIGNMENTS].includes(config.longCargoAlignment??'auto')){result.errors.push('Yerleşim seçimi geçersiz.');return result;}

  const items=rows.flatMap(row=>Array.from({length:row.quantity},(_,i)=>prepareItem(row,i+1,config,result.warnings)));
  const grouped=chooseLayout(items,max,!!config.mirrored);
  const placed=new Map();
  result.pallets=grouped.pallets.map((pallet,index)=>{
    const parts=pallet.boxes.map(({item,...placement})=>{
      const box=placementGeometry(placement);
      const part={...box,id:item.id,rowId:item.row.id,name:item.row.name,color:item.row.color,
        weight:item.row.weight??null,palletIndex:index,touchedPallets:[index],
        localY:box.y,y:box.y+index*PMC.length,overhangCm:Math.max(...Object.values(box.overhang)),
        reviewRequired:true,supportId:box.supportIds.length===1 ? box.supportIds[0] : null,
        candidates:item.candidates.filter(candidate => {
          const bounds=placementBounds(candidate,!!config.mirrored);
          return bounds && within(candidate.x,bounds.x) && within(candidate.y,bounds.y);
        }).map(placementGeometry),
        rationale:describePlacement(box,item.requested),
      };
      placed.set(part.id,part);
      return part;
    });
    const positions=[...pallet.reserved.values()].sort((a,b)=>a.y-b.y || a.x-b.x);
    return {index,items:parts,positions,positionCount:positions.length,blockedPositions:positions.filter(p=>!p.support)};
  });
  result.placements=items.flatMap(item=>placed.has(item.id)?[placed.get(item.id)]:[]);
  result.unplaced=grouped.unplaced;
  result.summary={
    requestedCount:count,placedCount:result.placements.length,palletCount:result.pallets.length,physicalPmcCount:result.pallets.length,
    positionCount:result.pallets.reduce((n,pallet)=>n+pallet.positionCount,0),
    knownWeightKg:result.placements.reduce((n,part)=>n+(part.weight??0),0),
    unknownWeightCount:result.placements.filter(part=>part.weight===null).length,
    unplacedCount:result.unplaced.length,
  };
  return result;
}
