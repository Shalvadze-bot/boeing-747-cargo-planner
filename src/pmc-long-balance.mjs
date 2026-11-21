const EPS = 1e-6;
const numberOrNull = value => {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim()==='') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function balanceProfile(raw = {}) {
  const input = Object.fromEntries([
    'tare','tareX','tareY','tareZ','minX','maxX','minY','maxY','maxZ','maxGross',
  ].map(key => [key,numberOrNull(raw?.[key])]));
  const {tare,tareX,tareY,tareZ,minX,maxX,minY,maxY,maxZ,maxGross}=input;
  const hasTare = tare!==null && tare>0 && [tareX,tareY,tareZ].every(value=>value!==null);
  const hasLimits = [minX,maxX,minY,maxY].every(value=>value!==null)
    && minX<=maxX && minY<=maxY && (maxZ===null || maxZ>=0) && (maxGross===null || maxGross>0);
  return {
    input,hasTare,hasLimits,
    target:hasLimits ? {x:(minX+maxX)/2,y:(minY+maxY)/2} : null,
  };
}

/** Long-mode estimate. Each item's internal CG is modeled at its box center. */
export function measurePmcBalance(boxes, profile) {
  const weighted = boxes.every(box=>Number.isFinite(box.item.row.weight) && box.item.row.weight>0);
  if (!profile.hasTare || !weighted) return {status:'geometry',cg:null,gross:null};
  const {tare,tareX,tareY,tareZ,minX,maxX,minY,maxY,maxZ,maxGross}=profile.input;
  let gross=tare;
  const moments={x:tare*tareX,y:tare*tareY,z:tare*tareZ};
  for (const box of boxes) {
    const weight=box.item.row.weight;
    gross+=weight;
    moments.x+=weight*(box.x+box.w/2);
    moments.y+=weight*(box.y+box.l/2);
    moments.z+=weight*(box.z+box.h/2);
  }
  const cg={x:moments.x/gross,y:moments.y/gross,z:moments.z/gross};
  if (!profile.hasLimits) return {status:'estimated',cg,gross};
  const within = cg.x>=minX-EPS && cg.x<=maxX+EPS && cg.y>=minY-EPS && cg.y<=maxY+EPS
    && (maxZ===null || cg.z<=maxZ+EPS) && (maxGross===null || gross<=maxGross+EPS);
  return {
    status:within?'within':'outside',cg,gross,
    distance:Math.hypot(cg.x-profile.target.x,cg.y-profile.target.y),
  };
}
