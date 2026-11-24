import { PMC, runPacking } from './pmc-engine.mjs';
import { runLongCargo } from './pmc-long-cargo.mjs';
import { layoutKey } from './pmc-plan-options.mjs';

function othersUnchanged(candidate, current, index) {
  const outside = value => value.placements.filter(box => box.palletIndex !== index || box.touchedPallets?.some(p => p !== index));
  const target = value => value.placements.filter(box => box.palletIndex === index).map(box=>box.id).sort();
  return layoutKey({placements:outside(candidate)}) === layoutKey({placements:outside(current)}) &&
    JSON.stringify(target(candidate)) === JSON.stringify(target(current));
}

export function repackOnePmc(rows, config, current, index, strategy) {
  const pallet = current?.pallets.find(p => p.index === index);
  if (!pallet?.items.length) return null;
  if (config.longCargo) {
    const candidate = runLongCargo(rows,config,strategy);
    return !candidate.errors?.length && othersUnchanged(candidate,current,index) ? candidate : null;
  }
  if (pallet.items.some(box => box.touchedPallets?.length !== 1)) return null;
  const manifest = new Map(rows.map(row=>[row.id,row]));
  const originals = new Map();
  const isolated = pallet.items.map((box,i)=>{
    const row = manifest.get(box.rowId);
    const ordinal = Number(box.id.slice(row.id.length+1));
    const id = 'pmc-search-'+i;
    originals.set(id+':1',box);
    return {...row,id,quantity:1,orientationMode:row.pieceOrientations?.[ordinal] ?? row.orientationMode, pieceOrientations:{}};
  });
  const packed = runPacking(isolated,{...config,maxPallets:1},strategy);
  if (packed.errors?.length || packed.unplaced.length) return null;
  const idFor = id => originals.get(id)?.id ?? null;
  const items = packed.placements.map(({id,rowId,y,supportId,supportIds,...box}) => ({
    ...box,id:idFor(id),rowId:originals.get(id).rowId,y:y+index*PMC.length,palletIndex:index,
    touchedPallets:[index],supportId:idFor(supportId),supportIds:supportIds.map(idFor),
  }));
  const changes = new Map(items.map(box=>[box.id,box]));
  return {...current,
    placements:current.placements.map(box => changes.get(box.id) ?? box),
    pallets:current.pallets.map(p => p.index===index ? {...packed.pallets[0],index,items} : p),
  };
}

export function samePieceSet(a,b) {
  const ids = plan => plan.placements.map(item=>item.id).sort();
  return JSON.stringify(ids(a)) === JSON.stringify(ids(b));
}
