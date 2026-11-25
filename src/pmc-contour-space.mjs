// Research-model coordinates, in millimetres. The validator checks each
// accepted placement independently using forward interpolation and intervals.
export function contourRoof(points, x) {
  if (x < points[0][0] || x > points.at(-1)[0]) return -Infinity;
  const index = points.findIndex(([end], i) => i > 0 && x <= end);
  const [leftX,leftZ] = points[index-1], [rightX,rightZ] = points[index];
  return leftZ + (rightZ-leftZ) * (x-leftX) / (rightX-leftX);
}

function lastXAtHeight(points, height) {
  if (height > points[0][1]) return -Infinity;
  for (let i=1;i<points.length;i++) {
    const [rightX,rightZ] = points[i];
    if (height > rightZ) {
      const [leftX,leftZ] = points[i-1];
      return leftX + (rightX-leftX) * (leftZ-height) / (leftZ-rightZ);
    }
  }
  return points.at(-1)[0];
}

export const baseSpace = ({usable}) => ({u:0,v:0,w:usable.widthMm,l:usable.lengthMm});

export function placementRange(space, {widthMm:w,lengthMm:l,heightMm:h}, model, clearance=0) {
  if (w > space.w || l > space.l) return null;
  const {points,highEdgeOffsetMm,verticalOffsetMm,mirrored} = model.contour;
  const limit = lastXAtHeight(points,h+verticalOffsetMm+clearance)-highEdgeOffsetMm;
  const min = mirrored ? Math.max(space.u,model.usable.widthMm-limit) : space.u;
  const max = mirrored ? space.u+space.w-w : Math.min(space.u+space.w-w,limit-w);
  return min<=max ? [min,max] : null;
}

export function orientationCannotFit({widthMm:w,lengthMm:l,heightMm:h}, model) {
  const {usable,contour,numericalToleranceMm:tol}=model;
  if(w>usable.widthMm+2*tol||l>usable.lengthMm+2*tol) return true;
  const limit=contour.points.at(-1)[0];
  const far=Math.max(0,contour.highEdgeOffsetMm+w-tol);
  return far>limit+tol ||
    h+contour.verticalOffsetMm>contourRoof(contour.points,Math.min(far,limit))+2*tol;
}

export function contourClearance(box, model) {
  const {points,highEdgeOffsetMm,verticalOffsetMm,mirrored} = model.contour;
  const far = mirrored ? model.usable.widthMm-box.uMm : box.uMm+box.widthMm;
  return contourRoof(points,highEdgeOffsetMm+far)-verticalOffsetMm-box.heightMm;
}

// Split maximal empty rectangles by the rectangular keep-out of the new box.
// The strips may overlap. A feasible future rectangle lies wholly in a strip
// of every space it occupied before the split.
export function subtractPlacement(spaces, box, gap, tolerance) {
  const x0=box.uMm-gap, x1=box.uMm+box.widthMm+gap;
  const y0=box.vMm-gap, y1=box.vMm+box.lengthMm+gap;
  const next = [];
  for (const space of spaces) {
    const right=space.u+space.w, end=space.v+space.l;
    if (right<=x0 || space.u>=x1 || end<=y0 || space.v>=y1) {
      next.push(space);
      continue;
    }
    if (x0-space.u>tolerance) next.push({...space,w:x0-space.u});
    if (right-x1>tolerance) next.push({...space,u:x1,w:right-x1});
    if (y0-space.v>tolerance) next.push({...space,l:y0-space.v});
    if (end-y1>tolerance) next.push({...space,v:y1,l:end-y1});
  }
  const unique = [...new Map(next.map(space=>[[space.u,space.v,space.w,space.l].join(','),space])).values()];
  return unique.filter((space,i)=>!unique.some((outer,j)=>i!==j &&
    outer.u<=space.u && outer.v<=space.v && outer.u+outer.w>=space.u+space.w &&
    outer.v+outer.l>=space.v+space.l));
}

export function researchEnvelopeMm3({usable,contour}) {
  const {points,highEdgeOffsetMm:from,verticalOffsetMm:datum} = contour;
  const to = from+usable.widthMm;
  let area=0;
  for (let i=1;i<points.length;i++) {
    const left = Math.max(from,points[i-1][0]), right = Math.min(to,points[i][0]);
    if (right<=left) continue;
    const high=contourRoof(points,left)-datum, low=contourRoof(points,right)-datum;
    if (high<=0) continue;
    const positiveLength = low>=0 ? right-left : (right-left)*high/(high-low);
    area += positiveLength*(high+Math.max(0,low))/2;
  }
  return area*usable.lengthMm;
}

// Project the contour into the physical pallet's centimetre frame for both
// views. Clip to the displayed deck and to the pallet top at Z=0.
export function researchSectionCm({usable,nominal,contour}) {
  const {points,highEdgeOffsetMm:offset,verticalOffsetMm:datum,mirrored} = contour;
  const x = physical => offset + (mirrored ? usable.xMm+usable.widthMm-physical : physical-usable.xMm);
  const origin = x(0), end=x(nominal.widthMm);
  const lo=Math.max(0,Math.min(origin,end)), hi=Math.min(lastXAtHeight(points,datum),Math.max(origin,end));
  if(lo>=hi) return [];
  const relevant=[lo,...points.map(([u])=>u).filter(u=>u>lo&&u<hi),hi];
  return relevant.map(u=>[Math.max(0,Math.min(nominal.widthMm,mirrored?origin-u:u-origin))/10,
    Math.max(0,contourRoof(points,u)-datum)/10]);
}
